// ==========================================================================
// Persistencia al activar un sorteo (F4): guardar la fila del evento (crear
// o reutilizar la de ESTE sorteo) con guardarEvento, que sigue siendo la
// única escritura del evento, y deshacer las sustituciones si no se guardó.
// ==========================================================================

"use strict";

const { revertirReemplazo } = require("../../../../../shared/eventos/unSorteoPorPrecio");

// datos: los argumentos de guardarEvento que prepara cada entrada.
// -> la fila guardada, o null (y el reemplazo ya deshecho).
async function guardarConReversion({ db, guardarEvento, datos, usuarioId, reemplazo, motivo }) {
    const guardado = await guardarEvento(datos);
    if (guardado?.id) return guardado;
    await revertirReemplazo(db, { usuarioId, cerradas: reemplazo.cerradas, motivo, modalidad: reemplazo.modalidad });
    return null;
}

// Contadores del evento con las reservas que ya tiene su identidad
// (anticipadas desde el panel); la fila nueva nace en cero. Best-effort.
async function sincronizarContadores(actualizarEvento, evento) {
    try { if (actualizarEvento) await actualizarEvento(evento); } catch { /* best-effort */ }
}

module.exports = { guardarConReversion, sincronizarContadores };
