const supabase = require("../../../lib/supabase");
const { extraerEvento } = require("./extraerEvento");
const { consultarEvento } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracion } = require("./configEvento");
const { abrirGrupo } = require("./grupos/abrirGrupo");

// Escaneo incremental de identidades: se dispara SOLO después de que
// WhatsApp confirmó la apertura del grupo (ver más abajo). No bloqueante,
// no forma parte de la decisión de abrir/cerrar el grupo.
const { escanearGrupo } = require("../usuarios/escanerIdentidadesLifecycle");

// Reintento breve y acotado (3 intentos, 300 ms aparte) SOLO para registrar
// que la apertura falló (abierto=false). Riesgo que cierra: si WhatsApp
// falla Y esta escritura también fallara al primer intento, el evento
// quedaría con abierto=true "mintiendo" y la reconciliación del worker
// (que filtra por abierto===false) nunca lo encontraría. Con 3 intentos
// cortos, ambos fallando a la vez es prácticamente descartable. No es una
// tabla ni un estado nuevo: reintenta la MISMA escritura de siempre.
async function marcarAperturaFallida(eventoId) {

    const intentos = 3;

    for (let i = 1; i <= intentos; i++) {

        const { error } = await supabase
            .from("eventos_bot")
            .update({ abierto: false })
            .eq("id", eventoId);

        if (!error) return true;

        console.error(`❌ No se pudo registrar abierto=false (intento ${i}/${intentos}):`, error.message);

        if (i < intentos) {
            await new Promise(r => setTimeout(r, 300));
        }

    }

    return false;

}

async function detectarEvento(ctx) {

    try {

        const { sock, grupo, textoOriginal } = ctx;

        const grupoId =
            grupo?.remoteJid ||
            ctx.chat.remoteJid;

        console.log("==================================");
        console.log("📨 DETECTAR EVENTO");
        console.log("Grupo:", grupoId);
        console.log("==================================");

        if (!textoOriginal?.trim()) {

            console.log("❌ Texto vacío");
            return null;

        }

        const evento = extraerEvento(textoOriginal);

        if (!evento) {

            console.log("❌ No es un evento");
            return null;

        }

        console.log("🎯 Evento detectado");

        console.table({

            nombre: evento.nombre,
            hora: evento.hora,
            valor: evento.valor,
            premios: evento.premios.length

        });

        const config = obtenerConfiguracion(evento.valor);

        if (!config) {

            console.log("❌ No existe configuración para:", evento.valor);
            return null;

        }

        console.table(config);

        const eventoCompleto = {

            ...evento,

            tabla: config.tabla,
            cifras: config.cifras,
            cantidad_numeros: config.cantidad

        };

        const eventoAnterior = await consultarEvento(grupoId);

        console.log(
            "📋 Evento anterior:",
            eventoAnterior
                ? `${eventoAnterior.nombre_evento} (${eventoAnterior.hora_fin})`
                : "No existe"
        );

        // ===============================
        // GUARDAR EVENTO
        // ===============================

        const eventoGuardado = await guardarEvento({

            sock,
            grupoId,
            evento: eventoCompleto,
            eventoAnterior

        });

        if (!eventoGuardado) {

            console.log("❌ No se pudo guardar el evento");
            return null;

        }

        console.log("✅ Evento guardado correctamente");

        // ===============================
// ABRIR GRUPO
// ===============================

const grupoAbierto = await abrirGrupo({

    sock,
    grupoId

});

if (!grupoAbierto) {

    // WhatsApp NO confirmó la apertura (típicamente rate-overlimit tras
    // agotar los reintentos de la cola). NO se reporta como exitosa:
    // se registra abierto=false en el evento YA guardado para que el
    // worker de eventos lo reintente. El flujo de detección NO se rompe:
    // el evento existe (activo=true) y las reservas siguen funcionando.

    console.log("⚠ No se pudo abrir el grupo en WhatsApp — se registra abierto=false para reintento.");

    let registrado = false;

    try {

        registrado = await marcarAperturaFallida(eventoGuardado.id);

    } catch (e) {

        console.error("❌ No se pudo registrar abierto=false:", e?.message);

    }

    if (registrado) {

        eventoGuardado.abierto = false;

    } else {

        // No se pudo registrar ni tras los reintentos: se deja constancia
        // clara en el log. El evento sigue existiendo (activo=true) y
        // podrá autocorregirse si el mismo mensaje se detecta de nuevo en
        // el grupo (guardarEvento vuelve a escribir abierto=true y se
        // reintenta abrir). No se inventa un estado nuevo para esto.
        console.error(`⚠️ Evento ${eventoGuardado.id}: quedó sin poder registrar el fallo de apertura tras los reintentos.`);

    }

} else {

    console.log("🔓 Grupo abierto correctamente");

    // Escaneo incremental de ESE grupo — solo después de la confirmación
    // de arriba. No bloqueante: nunca debe retrasar el flujo de detección
    // de eventos ni afectar su resultado.
    const sessionIdParaEscaner = sock?.context?.sessionId || null;

    if (sessionIdParaEscaner) {

        escanearGrupo(sessionIdParaEscaner, sock, grupoId).catch(err => {

            console.error(`❌ [ESCÁNER IDENTIDADES] error tras abrir grupo ${grupoId}:`, err?.message);

        });

    }

}

        return eventoGuardado;

    } catch (error) {

        console.error("❌ Error detectando evento");
        console.error(error);

        return null;

    }

}

module.exports = {
    detectarEvento
};