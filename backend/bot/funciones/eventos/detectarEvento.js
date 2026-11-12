// ==========================================================================
// ENTRADA de WhatsApp: un mensaje de un grupo que anuncia un sorteo.
//
// Esta entrada solo:
//   1. extrae y valida el anuncio (datos completos, dueño de la sesión, tabla
//      del precio para ese cliente);
//   2. pide la decisión propia de WhatsApp (deteccion/decisionAnuncio.js:
//      re-anuncios, sorteos terminados, programados del panel, qué fila se
//      guarda y qué se sustituye);
//   3. invoca el NÚCLEO CENTRAL de activación con el perfil
//      «anuncio_whatsapp» (lifecycle/activarEvento.js), el mismo que usa el
//      panel: un sorteo por precio, guardar, sustituir en el grupo, ciclo de
//      automatización, apertura del grupo;
//   4. traduce el resultado a lo que espera eventHandler: la fila del evento
//      (activo o terminado) o null.
//
// Las dependencias de infraestructura se cargan AQUÍ y se pasan al núcleo:
// las pruebas recargan estos módulos con otro Supabase simulado.
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { extraerEvento } = require("./extraerEvento");
const { consultarEvento, consultarEventoDelSorteo } = require("./consultarEvento");
const { guardarEvento } = require("./guardarEvento");
const { obtenerConfiguracionCliente } = require("./tablasCliente");
const { abrirGrupo } = require("./grupos/abrirGrupo");
const { sorteoSinNumerosLibres } = require("./lifecycle/sorteoSinNumerosLibres");
const { activarEnGrupo } = require("./lifecycle/activarEvento");
const { decidirAnuncio } = require("./deteccion/decisionAnuncio");
const { remitenteAutorizado } = require("./deteccion/remitente");

// Sorteos creados y programados desde el panel (backend/sorteos). Solo se
// consulta para NO reemplazar un sorteo programado que sigue activo.
const { esEventoDeSorteoProgramado } = require("../../../sorteos/repo");

// MOTOR CENTRAL de automatización (automation/motorEventos.js), el mismo del
// panel: un evento es un evento, venga de donde venga.
const motorEventos = require("../../../automation/motorEventos");

// Escaneo incremental de identidades: SOLO después de que WhatsApp confirmó
// la apertura del grupo. No bloqueante; no decide nada.
const { escanearGrupo } = require("../usuarios/escanerIdentidadesLifecycle");

// Paso 1: anuncio completo de un dueño válido, con tabla para su precio.
// -> { eventoCompleto, duenoSesion } | null
async function prepararAnuncio(ctx, grupoId) {

    const { sock, textoOriginal } = ctx;

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
    console.table({ nombre: evento.nombre, hora: evento.hora, valor: evento.valor, premios: evento.premios.length });

    // Anuncio reconocido pero sin un dato obligatorio (p. ej. "10:30" sin
    // am/pm, o sin valor por número): no se inventa ni se guarda.
    if (evento.faltantes?.length) {
        console.log(`⚠️ Anuncio incompleto — falta: ${evento.faltantes.join(", ")}. No se crea el sorteo.`);
        return null;
    }

    // Tabla del precio SEGÚN EL DUEÑO de la sesión (tablas_cliente). Sin dueño
    // no se crea el sorteo: sus reservas se rechazarían igual
    // (filtroCliente.js) y nunca debe apuntar a la cuadrícula de nadie.
    const duenoSesion = sock?.context?.usuarioId ?? null;

    if (!duenoSesion) {
        console.error("❌ Anuncio en una sesión sin usuario_id: no se crea el sorteo.");
        return null;
    }

    // El dueño validado por el dispatcher (ctx.session) y el del socket que
    // guardará el evento deben ser el mismo cliente.
    const duenoValidado = ctx.session?.usuarioId ?? null;

    if (duenoValidado && duenoValidado !== duenoSesion) {
        console.error("❌ El dueño de la sesión no coincide con el del socket: no se crea el sorteo.");
        return null;
    }

    let config = await obtenerConfiguracionCliente(duenoSesion, evento.valor);

    // Motor único de rifas (12/11/2026): el tamaño del sorteo es el de la
    // RIFA que el grupo resuelve para ese precio (la misma regla que usa
    // guardarEvento para asignar tabla_id). Una rifa nueva (p. ej. $13.000)
    // no tiene fila en tablas_cliente y antes el anuncio se descartaba.
    if (require("../../../rifas/motor").motorNuevo()) {
        const rifa = await rifaDelAnuncio(duenoSesion, grupoId, evento.valor);
        if (rifa) config = { tabla: config?.tabla || "numeros_rifa", cifras: rifa.cifras, cantidad: rifa.cantidad };
    }

    if (!config) {
        console.log("❌ No existe configuración para:", evento.valor);
        return null;
    }

    console.table(config);

    return {
        duenoSesion,
        eventoCompleto: { ...evento, tabla: config.tabla, cifras: config.cifras, cantidad_numeros: config.cantidad }
    };

}

// Rifa que el grupo resuelve para el precio del anuncio (o null). Nunca por
// precio fuera de los vínculos del grupo ni al azar (rifa_resolver, D1).
async function rifaDelAnuncio(usuarioId, grupoId, valor) {
    try {
        const rifas = require("../../../rifas/repositorio");
        const r = await rifas.resolver(usuarioId, grupoId, { precio: Number(String(valor ?? "").replace(/[^0-9]/g, "")) });
        if (!r?.ok || !r.tabla_id) return null;
        return await rifas.obtenerRifa(usuarioId, r.tabla_id);
    } catch (e) {
        console.error(`❌ [RIFAS] anuncio en ${grupoId}: no se pudo resolver la rifa (${e.message})`);
        return null;
    }
}

async function detectarEvento(ctx) {

    try {

        const { sock, grupo } = ctx;
        const grupoId = grupo?.remoteJid || ctx.chat.remoteJid;

        console.log("==================================");
        console.log("📨 DETECTAR EVENTO");
        console.log("Grupo:", grupoId);
        console.log("==================================");

        const anuncio = await prepararAnuncio(ctx, grupoId);
        if (!anuncio) return null;
        const { eventoCompleto, duenoSesion } = anuncio;

        const decision = await decidirAnuncio({
            ctx, grupoId, duenoSesion, eventoCompleto,
            deps: { db: supabase, consultarEvento, consultarEventoDelSorteo, esEventoDeSorteoProgramado, sorteoSinNumerosLibres }
        });
        if ("terminar" in decision) return decision.terminar;

        const { eventoAnterior, sorteoVigente, fechaSorteo, identidadAnunciada, filaAGuardar, sustituir } = decision.activar;

        const r = await activarEnGrupo({
            entrada: "anuncio_whatsapp",
            sock,
            usuarioId: duenoSesion,
            grupoId,
            valor: eventoCompleto.valor,
            identidad: identidadAnunciada,
            excepto: filaAGuardar?.id || null,
            motivoReemplazo: `sustituido por el anuncio de ${eventoCompleto.nombre || "otro sorteo"} ${eventoCompleto.hora || ""}`.trim(),
            datosEvento: { sock, grupoId, evento: eventoCompleto, eventoAnterior: filaAGuardar, sorteoVigente, fechaSorteo },
            sustituir,
            // Cerrar el sorteo de este precio en OTROS grupos exige que el
            // anuncio lo publique la cuenta del bot o un administrador.
            autorizarOtrosGrupos: () => remitenteAutorizado(ctx, grupoId),
            // Escaneo incremental de ESE grupo, tras confirmar la apertura.
            trasAbrir: () => {
                const sessionId = sock?.context?.sessionId || null;
                if (!sessionId) return;
                escanearGrupo(sessionId, sock, grupoId).catch(err => {
                    console.error(`❌ [ESCÁNER IDENTIDADES] error tras abrir grupo ${grupoId}:`, err?.message);
                });
            },
            deps: { db: supabase, guardarEvento, abrirGrupo, consultarEventoDelSorteo, motor: motorEventos }
        });

        // F4-F.1 (C2, corrección): el plan era CORREGIR hacia este sorteo la
        // fila de otro sin números, pero otra operación creó a la vez la fila
        // de este sorteo en el grupo. Se vuelve a decidir UNA vez con el estado
        // actual: ahora la reutiliza y sustituye la anterior, como si hubiera
        // llegado después (sin la corrección, quedarían dos sorteos activos).
        const eraCorreccion = Boolean(filaAGuardar) && filaAGuardar.identidad_evento_real !== identidadAnunciada;
        if (r.resultado === "adoptado" && eraCorreccion && !ctx.__trasAdopcion) {
            console.log("🔁 Otra operación activó este sorteo mientras se corregía la fila del grupo: se vuelve a decidir con el estado actual.");
            return detectarEvento({ ...ctx, __trasAdopcion: true });
        }

        return resultadoDeLaDeteccion(r, { eventoCompleto, eventoAnterior });

    } catch (error) {

        console.error("❌ Error detectando evento");
        console.error(error);

        return null;

    }

}

// Resultado del núcleo -> lo que devuelve la detección (contrato de siempre).
function resultadoDeLaDeteccion(r, { eventoCompleto, eventoAnterior }) {
    switch (r.resultado) {
        case "activado":
            return r.evento;
        case "adoptado":
            // F4-F (C2): otra operación creó a la vez la fila de este sorteo en
            // el grupo (otro anuncio igual, o el panel): se adopta y no se repite
            // nada (ni apertura, ni ciclo, ni sustituciones).
            console.log(`🤝 El sorteo ya lo estaba activando otra operación en este grupo: se adopta su fila (${r.evento.id}).`);
            return r.evento;
        case "activacion_en_curso":
            console.log("⏳ Otra operación sigue activando este sorteo en el grupo: este anuncio no hace nada más.");
            return null;
        case "no_autorizado":
            console.log(`⏭️ El precio $${eventoCompleto.valor} tiene activo otro sorteo en otros grupos y este anuncio no lo publicó un administrador — no se reemplaza.`);
            return eventoAnterior;
        case "precio_sin_revisar":
            console.error("❌ No se pudo revisar si el precio tiene otro sorteo activo; no se guarda el anuncio:", r.error?.message);
            return null;
        case "precio_sin_reemplazar":
            console.error("❌ No se pudo reemplazar el sorteo anterior de la tabla; no se guarda el anuncio:", r.error?.message);
            return null;
        case "sin_guardar":
            console.log("❌ No se pudo guardar el evento");
            return null;
        default:
            throw new Error(`detectarEvento: resultado inesperado del núcleo: ${r.resultado}`);
    }
}

module.exports = {
    detectarEvento
};
