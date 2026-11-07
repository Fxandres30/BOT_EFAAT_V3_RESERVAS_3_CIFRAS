// ==========================================================================
// shared/mensajes/etapas/validacion.js — validación del contenido y del
// contrato de la solicitud. Pura.
//
// Reglas GENÉRICAS (las de cada motor van en su adaptador, `validar`):
//   - texto vacío o no texto: inválido salvo que el canal lo permita
//     (imagen sin pie; Compartir con el mensaje del sorteo desactivado);
//   - variables sin resolver: inválido SOLO si el tipo lo pide
//     (bloquearSiFaltan: automatización, AU6); en respuestas quedan vacías (S7);
//   - longitud máxima opcional (sorteos: 4000, SA7).
// ==========================================================================

"use strict";

const { obtenerTipo, CANALES } = require("../catalogoTipos");

// -> { ok: true } | { ok: false, motivo, detalle? }
function validarContenido({ texto, canal = "texto", faltantes = [], bloquearSiFaltan = false, maxLongitud = null, permitirVacio = false } = {}) {
    if (canal === "reaccion") return { ok: true };
    if (typeof texto !== "string") return canal === "imagen" && texto == null ? { ok: true } : { ok: false, motivo: "texto_invalido" };
    if (!texto.trim() && !(permitirVacio || canal === "imagen")) return { ok: false, motivo: "texto_vacio" };
    if (bloquearSiFaltan && faltantes.length > 0) return { ok: false, motivo: "variable_faltante", detalle: [...faltantes] };
    if (maxLongitud != null && texto.length > maxLongitud) return { ok: false, motivo: "excede_longitud", detalle: texto.length };
    return { ok: true };
}

// Contrato mínimo de la solicitud -> lista de errores (vacía = válida).
function validarSolicitud(solicitud) {
    const errores = [];
    if (!solicitud || typeof solicitud !== "object") return ["solicitud_invalida"];
    const tipo = obtenerTipo(solicitud.tipo);
    if (!tipo) errores.push("tipo_desconocido");
    if (tipo && solicitud.origen && solicitud.origen !== tipo.origen) errores.push("origen_no_coincide");
    if (!solicitud.usuarioId) errores.push("sin_usuario");
    if (!solicitud.destino?.jid) errores.push("sin_destino");
    if (solicitud.canal && !CANALES.includes(solicitud.canal)) errores.push("canal_desconocido");
    return errores;
}

module.exports = { validarContenido, validarSolicitud };
