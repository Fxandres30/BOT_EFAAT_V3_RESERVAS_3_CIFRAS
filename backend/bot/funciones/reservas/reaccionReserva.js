// ==========================================================================
// reaccionReserva.js — reacción de WhatsApp sobre el mensaje del cliente
// cuando pide números en el grupo. Se AÑADE a la respuesta de siempre; nunca
// la sustituye ni la condiciona.
//
//   ✅  TODOS los números pedidos estaban libres y se reservaron de verdad.
//   ❌  TODOS los números pedidos estaban ocupados por otras personas.
//   —   cualquier otro caso: mixto, alguno ya era del cliente, bloqueado o
//       en proceso, número inexistente, reserva fallida o parcial.
//
// Decide con la clasificación REAL (validarReservas.js) y las filas que
// reservarNumeros.js devolvió, número por número; nunca por el texto.
// ==========================================================================

// Interruptor del panel (/mensajes → «Reacciones automáticas ✅/❌»): una fila
// más de configuracion_seleccion_mensajes (misma tabla y columna «habilitada»
// que el interruptor de cada tipo de respuesta). Sin fila = ACTIVADO, que es
// el comportamiento de hoy. No necesita migración.
const TIPO_INTERRUPTOR = "reacciones_reserva";

const REACCION_TODOS_RESERVADOS = "✅";
const REACCION_TODOS_OCUPADOS = "❌";

const unicos = (lista) => [...new Set((lista || []).map(n => String(n)))];

// decidirReaccion({ solicitados, resultado, reservados }) -> "✅" | "❌" | null
//   solicitados: números pedidos (ya filtrados por formato)
//   resultado:   salida de validarReservas()
//   reservados:  números que reservarNumeros() devolvió como reservados
function decidirReaccion({ solicitados, resultado, reservados = [] }) {

    const pedidos = unicos(solicitados);

    if (!pedidos.length || !resultado) return null;

    const libres = new Set(unicos((resultado.disponibles || []).map(r => r.numero)));
    const ocupados = new Set(unicos((resultado.ocupadosPorOtros || []).map(r => r.numero)));
    const hechos = new Set(unicos(reservados));

    if (pedidos.every(n => libres.has(n) && hechos.has(n))) return REACCION_TODOS_RESERVADOS;

    if (pedidos.every(n => ocupados.has(n))) return REACCION_TODOS_OCUPADOS;

    return null;

}

// ------------------------------------------------- interruptor (caché) ---
// Solo se consulta cuando ya hay una reacción que enviar, y como mucho una
// vez cada REACCIONES_CACHE_MS por cliente (30 s por defecto): un cambio en
// el panel se aplica en ese plazo. Si la consulta falla se conserva el último
// valor conocido; sin ninguno, ACTIVADO (comportamiento de hoy).
const cache = new Map();   // usuarioId -> { activado, hasta }

// Lectura del interruptor SIN caché (única consulta; la usan la caché de
// arriba y, en O5, la comparación en sombra, que no debe tocar la caché).
// Sin fila = ACTIVADO. Lanza si la consulta falla.
async function leerInterruptorReacciones(usuarioId) {
    const supabase = require("../../../lib/supabase");
    const { data, error } = await supabase
        .from("configuracion_seleccion_mensajes")
        .select("habilitada")
        .eq("usuario_id", usuarioId)
        .eq("tipo_respuesta", TIPO_INTERRUPTOR)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.habilitada !== false : true;
}

function ttlMs() {
    const v = Number(process.env.REACCIONES_CACHE_MS);
    return Number.isFinite(v) && v >= 0 ? v : 30000;
}

async function reaccionesActivadas(usuarioId, { ahora = Date.now() } = {}) {

    if (!usuarioId) return true;

    const guardado = cache.get(usuarioId);
    if (guardado && ahora < guardado.hasta) return guardado.activado;

    let activado = guardado ? guardado.activado : true;

    try {
        activado = await leerInterruptorReacciones(usuarioId);
    } catch (error) {
        console.log("⚠️ [REACCIONES] no se pudo leer el interruptor; se usa el último valor conocido:", error?.message || error);
    }

    cache.set(usuarioId, { activado, hasta: ahora + ttlMs() });
    return activado;

}

// Un mensaje se reacciona como mucho una vez por proceso, aunque llegue de
// nuevo (además de la compuerta de ingreso, que ya descarta repetidos).
const reaccionados = new Set();
const LIMITE = 5000;

function claveMensaje(key) {
    return key?.id ? `${key.remoteJid || ""}::${key.id}` : null;
}

// Envía la reacción. Nunca lanza: un fallo solo se registra y el flujo
// normal del bot sigue igual. Devuelve true si se envió.
async function reaccionarAlMensaje({ ctx, emoji, enviar }) {

    const r = await reaccionarConMotivo({ ctx, emoji, enviar });

    // FASE O5 — comparación en SOMBRA (nunca reacciona ni marca nada).
    await compararReaccionEnSombra({ ctx, emoji, resultado: r });

    return r.ok;

}

// Mismo flujo de siempre; además del resultado devuelve el motivo (O5).
async function reaccionarConMotivo({ ctx, emoji, enviar }) {

    if (!emoji || !ctx?.message?.key || ctx.message.key.fromMe || !ctx.chat?.esGrupo) return { ok: false, motivo: "no_aplica" };

    const clave = claveMensaje(ctx.message.key);

    if (!clave || reaccionados.has(clave)) return { ok: false, motivo: "ya_reaccionado" };

    // Desactivado en el panel: ninguna reacción. La respuesta de texto y la
    // reserva ya ocurrieron igual que siempre.
    if (!(await reaccionesActivadas(ctx.session?.usuarioId || null))) return { ok: false, motivo: "interruptor_apagado" };

    reaccionados.add(clave);
    if (reaccionados.size > LIMITE) reaccionados.delete(reaccionados.values().next().value);

    try {

        const enviarReaccion = enviar || require("../../../services/baileys/send").sendReaction;

        await enviarReaccion({ sock: ctx.sock, jid: ctx.chat.remoteJid, key: ctx.message.key, emoji });

        console.log("[RESPONSE] reacción enviada →", emoji);

        return { ok: true, motivo: "enviada" };

    } catch (error) {

        console.log("⚠️ [RESPONSE] no se pudo enviar la reacción (la respuesta ya salió):", error?.message || error);

        return { ok: false, motivo: "fallo_envio" };

    }

}

// FASE O5: compara la reacción con el orquestador central EN SOMBRA
// (sombraReacciones.js). Solo cuando el motor llegó a decidir (enviada,
// fallo de envío o interruptor apagado). No hace nada salvo con
// MENSAJES_ORQUESTADOR_REACCION=shadow y NUNCA lanza.
async function compararReaccionEnSombra(datos) {
    if (!["enviada", "fallo_envio", "interruptor_apagado"].includes(datos.resultado?.motivo)) return;
    try {
        await require("./sombraReacciones").compararReaccionEnSombra(datos);
    } catch (error) {
        console.error("⚠️ [MENSAJES SOMBRA] reaccion: comparación omitida:", error?.message);
    }
}

module.exports = {
    decidirReaccion,
    reaccionarAlMensaje,
    REACCION_TODOS_RESERVADOS,
    REACCION_TODOS_OCUPADOS,
    TIPO_INTERRUPTOR,
    reaccionesActivadas,
    leerInterruptorReacciones,
    _reiniciar: () => { reaccionados.clear(); cache.clear(); }
};
