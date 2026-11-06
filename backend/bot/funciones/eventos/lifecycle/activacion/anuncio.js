// ==========================================================================
// Anuncio del sorteo en el grupo (perfiles del panel, F4): el texto aprobado
// del sorteo y el envío con imagen por compartirEnGrupos, protegido contra
// duplicados por el ExecutionGuard. La detección no envía anuncio: el
// anuncio es el propio mensaje del grupo.
// ==========================================================================

"use strict";

// Mensaje desactivado en el sorteo (activo=false): se publica la imagen sin
// texto. Un texto vacío por cualquier otro motivo no se publica.
// -> el texto ({ texto, activo, origen }) o null si no hay texto válido.
async function textoDelAnuncio(textoParaCompartir, usuarioId, evento) {
    const texto = await textoParaCompartir(usuarioId, evento);
    if (texto?.origen !== "sorteo" || (!texto.texto && texto.activo !== false)) return null;
    return texto;
}

// Solicitud FIJA por sorteo, grupo y reintento manual: los reintentos
// automáticos usan la misma clave y nunca duplican el anuncio; solo el
// administrador abre una nueva (reintentos_manuales).
const solicitudDelAnuncio = (sorteo, grupo) => `sorteo-${sorteo.id}-publicacion-${Number(grupo.reintentos_manuales) || 0}`;

// -> { estado: "enviado" }                       llegó (o ya había llegado)
//  | { estado: "rechazado", motivo }             no se envió (sin sesión...)
//  | { estado: "sin_registro" }                  no se pudo registrar: no se envió
//  | { estado: "incierto", motivo, error }       falló o quedó a medias
async function enviarAnuncio({ compartirEnGrupos, evento, sock, grupo, sorteo, texto, imagen }) {
    const r = await compartirEnGrupos({
        evento,
        sock,
        grupos: [{ grupo_id: grupo.grupo_id, nombre: evento.grupo_nombre || null }],
        caption: texto.texto,
        solicitudId: solicitudDelAnuncio(sorteo, grupo),
        imagen
    });
    if (!r?.ok) return { estado: "rechazado", motivo: r?.motivo || "error" };
    const envio = r.resultados[0] || { estado: "fallido", motivo: "sin_resultado" };
    if (envio.estado === "enviado" || envio.estado === "ya_enviado") return { estado: "enviado" };
    if (envio.motivo === "error_insert") return { estado: "sin_registro" };
    return { estado: "incierto", motivo: envio.motivo, error: envio.error };
}

module.exports = { textoDelAnuncio, enviarAnuncio, solicitudDelAnuncio };
