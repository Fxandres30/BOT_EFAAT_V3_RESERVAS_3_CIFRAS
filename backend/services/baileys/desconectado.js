const { DisconnectReason } = require("@whiskeysockets/baileys");
const supabase = require("../../lib/supabase");
const lease = require("./lease");

// ---------------------------------------------------------------------
// Backoff para la rama de "desconexión temporal" (reintento automático de
// la MISMA sesión, con las MISMAS credenciales ya persistidas en
// backend/auth/<sessionId>/ — esto NO crea ni borra credenciales, solo
// espacia los reintentos). Antes se reintentaba cada 5s de forma fija e
// indefinida: cada intento crea un socket real nuevo (makeWASocket) y
// sube un lote de pre-keys al servidor, así que un corte prolongado
// terminaba en una tormenta de reconexiones — justo el tipo de patrón que
// WhatsApp puede interpretar como abuso y responder invalidando el
// dispositivo (forzando un QR nuevo).
//
// 5s -> 10s -> 20s -> 40s -> 60s (tope), y se queda en 60s mientras la
// sesión siga fallando — NO se reinicia por tiempo transcurrido. El único
// reset válido es una confirmación real de conexión (ver resetBackoff más
// abajo, llamado desde conectado.js cuando connection === "open").
// ---------------------------------------------------------------------
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;

const backoffPorSesion = new Map(); // sessionId -> { intentos }

// setTimeout pendientes de la rama de reconexión temporal, por sessionId.
// Se guardan para poder cancelarlos si la sesión se detiene manualmente
// (ver cancelarReintentoPendiente / manager.stop()) antes de que disparen.
const timersPendientes = new Map(); // sessionId -> handle de setTimeout

function proximoDelayReconexion(sessionId) {

    const previo = backoffPorSesion.get(sessionId);
    const intentosPrevios = previo ? previo.intentos : 0;

    const intentos = intentosPrevios + 1;

    const delay = Math.min(
        BACKOFF_BASE_MS * (2 ** (intentos - 1)),
        BACKOFF_MAX_MS
    );

    backoffPorSesion.set(sessionId, { intentos });

    return { intentos, delay };

}

// Reset REAL del backoff: se llama únicamente desde conectado.js cuando
// Baileys confirma connection === "open" para esta sesión. A partir de ahí
// una futura desconexión temporal vuelve a empezar en 5s.
function resetBackoff(sessionId) {

    backoffPorSesion.delete(sessionId);

}

// Cancela un reintento de reconexión temporal que todavía no disparó (si
// existe) y limpia el backoff asociado. Se usa desde manager.stop() para
// que una desconexión manual no deje un setTimeout vivo que vuelva a
// levantar la sesión después. También se reutiliza en el resto de ramas
// "definitivas" de este archivo (403/401/440/500-411/408 sin auth) para
// no dejar nunca un timer huérfano corriendo en paralelo a una decisión
// distinta ya tomada para la misma sesión.
function cancelarReintentoPendiente(sessionId) {

    const handle = timersPendientes.get(sessionId);

    if (handle) {

        clearTimeout(handle);

        timersPendientes.delete(sessionId);

    }

    backoffPorSesion.delete(sessionId);

}

async function desconectado(sessionId, statusCode, contexto) {

    const { sockets, manager } = contexto;

    console.log("STATUS:", statusCode);

    // Socket que se está cerrando — en este punto TODAVÍA sigue en el Map
    // (estados.js solo llega a llamar desconectado() después de verificar
    // que sockets.get(sessionId) === sock). Se usa exclusivamente para leer
    // sock.user (== authState.creds.me) y saber si esta sesión YA estaba
    // autenticada antes de decidir qué hacer con un 408 — no se reemplaza
    // ni se toca el socket ni las credenciales aquí.
    const sockActual = sockets.get(sessionId);
    const yaAutenticada = !!sockActual?.user;

    // WhatsApp rechazó la sesión
    if (statusCode === 403) {

        console.log("❌ Sesión rechazada por WhatsApp:", sessionId);

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "bloqueado"
            })
            .eq("id", sessionId);

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Reinicio requerido: se reintenta la MISMA sesión, no es un caso de
    // failover (no se toca activeSession ni el listener del BOT).
    if (statusCode === DisconnectReason.restartRequired) {

        console.log("🔄 Reiniciando...");

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        return manager.start(sessionId);
    }

    // Logout o QR expirado
    if (
        statusCode === 401 ||
        statusCode === DisconnectReason.loggedOut
    ) {

        console.log("❌ Logout / QR expirado");

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",

                telefono: null,

                qr: null,

                qr_generado_en: null,

                qr_expira_en: null

            })
            .eq("id", sessionId);

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Conflict/replaced: otra conexión (real o, si había una condición de
    // carrera, un segundo socket nuestro) tomó el control de la MISMA
    // identidad de WhatsApp. Esto NO es un corte de red transitorio: si se
    // reintenta de inmediato con las mismas credenciales sin más, lo más
    // probable es volver a chocar con lo que sea que sigue vivo del otro
    // lado, produciendo el bucle infinito conflict/replaced observado en
    // producción/local. Por eso esta rama NUNCA llama a manager.start()
    // automáticamente — solo limpia el socket y, si esta sesión era la
    // activa del BOT, deja que el manager decida el failover desde su
    // único punto de decisión (manejarDesconexionActiva), igual que ya
    // hace para 403/401/408. No se cambia la política de failover entre
    // sesiones: se reutiliza tal cual la que ya existía para esos casos.
    if (statusCode === DisconnectReason.connectionReplaced) {

        console.log("⚠️ Conexión reemplazada (conflict/replaced, 440):", sessionId);

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "desconectado"
            })
            .eq("id", sessionId);

        // Liberar el lease distribuido: esta instancia ya no debe seguir
        // siendo dueña de una sesión que WhatsApp acaba de reemplazar; si
        // el "otro lado" es la otra instancia (LOCAL/VPS), que quede libre
        // para tomar el lease en su próximo intento.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Sesión/credenciales localmente inconsistentes con lo que espera el
    // protocolo (badSession=500, multideviceMismatch=411). No es un
    // "logout" real ni un corte de red transitorio: reintentar en loop con
    // la MISMA sesión rota no la arregla y solo insiste contra WhatsApp.
    // Se reutiliza tal cual el tratamiento que ya existía para
    // connectionReplaced (440): no se genera QR, no se tocan credenciales
    // ni Supabase más allá del estado, solo se libera esta instancia y se
    // deja decidir el failover.
    //
    // NOTA sobre 500 (badSession): en la librería Baileys instalada, este
    // código NO es exclusivo de "credenciales corruptas" — es el valor por
    // defecto/catch-all que usa la librería cuando el servidor manda un
    // error de stream que no coincide con ningún motivo específico conocido
    // (ver Utils/generics.js: "code || CODE_MAP[reason] || badSession").
    // Es decir, un 500 puede en algunos casos ser un error de stream no
    // catalogado y no necesariamente una sesión rota de verdad. Por eso
    // aquí SOLO se libera la instancia y se deja decidir el failover — en
    // ningún caso esta rama borra backend/auth/<sessionId>/ ni genera un
    // QR nuevo por su cuenta. Sin más evidencia, no conviene asumir
    // automáticamente que todo 500 exige invalidar la sesión; queda fuera
    // de alcance de este cambio afinar esta distinción más.
    if (
        statusCode === 500 || // DisconnectReason.badSession
        statusCode === 411    // DisconnectReason.multideviceMismatch
    ) {

        console.log("⚠️ Sesión/credenciales inconsistentes (badSession/multideviceMismatch):", sessionId, statusCode);

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "desconectado"
            })
            .eq("id", sessionId);

        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // 408: en la versión instalada de Baileys, DisconnectReason.timedOut y
    // DisconnectReason.connectionLost comparten el mismo código (408). Antes
    // CUALQUIER 408 se trataba como "se acabaron los intentos del QR" y la
    // sesión se abandonaba para siempre — incluida una sesión YA
    // AUTENTICADA que solo perdió la conexión un instante. Se distingue
    // usando yaAutenticada (sock.user == creds.me, calculado arriba):
    //   - sin creds.me todavía (QR nunca escaneado) -> comportamiento
    //     original: se acabaron los intentos del QR, no reconectar.
    //   - con creds.me (sesión ya emparejada) -> es una desconexión
    //     temporal más, sigue el camino de abajo y se reconecta con las
    //     MISMAS credenciales persistidas en disco.
    if (statusCode === 408 && !yaAutenticada) {

        console.log("⌛ Fin de intentos del QR. No se reconecta.");

        cancelarReintentoPendiente(sessionId);

        sockets.delete(sessionId);

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Errores temporales (incluye el 408 de una sesión YA autenticada, ver
    // arriba): se reintenta la MISMA sesión, con backoff exponencial en vez
    // de cada 5s indefinidamente. No es un caso de failover (no se toca
    // activeSession ni el listener del BOT), no se tocan credenciales.
    const { intentos, delay } = proximoDelayReconexion(sessionId);

    console.log(`♻️ Reconexión temporal (intento ${intentos}, próximo intento en ${delay}ms)...`, sessionId);

    sockets.delete(sessionId);

    // Se guarda el handle para poder cancelarlo (cancelarReintentoPendiente)
    // si algo más — típicamente una desconexión manual vía manager.stop() —
    // decide el destino de esta sesión antes de que este intento dispare.
    const handle = setTimeout(() => {

        timersPendientes.delete(sessionId);

        manager.start(sessionId);

    }, delay);

    timersPendientes.set(sessionId, handle);

}

desconectado.resetBackoff = resetBackoff;
desconectado.cancelarReintentoPendiente = cancelarReintentoPendiente;

module.exports = desconectado;