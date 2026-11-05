// ==========================================================================
// bibliotecaStickersPago.js — guarda en la biblioteca (tabla
// stickers_pago_biblioteca + bucket privado "stickers-pago", migración 046)
// cada sticker que se registra como PREDETERMINADO.
//
// Solo se llama DESPUÉS de que guardarStickerCapturado() ya guardó el
// predeterminado (registrarStickerPago.js). Es puramente complementario:
//   - NUNCA lanza ni cambia el resultado del registro.
//   - NUNCA toca configuracion_stickers_pago (la que usa la confirmación de
//     pagos: resolverStickerPago / confirmarPagoPorSticker.js no cambian).
//   - NUNCA borra imágenes anteriores: cada sticker tiene su propio archivo
//     (<usuario_id>/<sha256>.<ext>); volver a enviar el mismo sticker solo
//     sobrescribe su propio archivo.
//   - Si la descarga falla, la fila igual se guarda (sin imagen) y no se
//     borra una imagen que ya existiera.
// ==========================================================================

const supabase = require("../../../lib/supabase");

const BUCKET_STICKERS_PAGO = "stickers-pago";

// Igual al file_size_limit del bucket (046).
const LIMITE_BYTES = 2 * 1024 * 1024;

const TIEMPO_MAX_DESCARGA_MS = 20000;

const EXTENSION_POR_MIME = {
    "image/webp": "webp",
    "image/png": "png",
    "application/was": "was"
};

const loggerSilencioso = {
    level: "silent",
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return loggerSilencioso; }
};

// Descarga real con Baileys (mismo socket que recibió el mensaje). Se carga
// de forma diferida para no pagar el require en módulos que no lo usan.
async function descargarConBaileys(msg, sock) {

    const { downloadMediaMessage } = require("@whiskeysockets/baileys");

    return downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
            logger: loggerSilencioso,
            reuploadRequest: sock?.updateMediaMessage
                ? (m) => sock.updateMediaMessage(m)
                : undefined
        }
    );

}

function conLimiteDeTiempo(promesa, ms) {

    let temporizador;

    const limite = new Promise((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error("tiempo de descarga agotado")), ms);
        if (temporizador.unref) temporizador.unref();
    });

    return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));

}

// Solo caracteres seguros para una ruta de Storage: evita "../" o "/" que
// pudieran escribir fuera de la carpeta del cliente.
const PATRON_USUARIO = /^[A-Za-z0-9_-]+$/;
const PATRON_HASH = /^[0-9a-f]+$/;

function normalizarHash(valor) {

    return valor ? String(valor).trim().toLowerCase() : null;

}

function rutaImagen(usuarioId, hash, mimetype) {

    const extension = EXTENSION_POR_MIME[String(mimetype || "").toLowerCase()] || "bin";

    return `${usuarioId}/${hash}.${extension}`;

}

// Devuelve SIEMPRE { ok, imagen, motivo? } — nunca lanza.
async function guardarEnBiblioteca({

    usuarioId,
    msg,
    sock,
    stickerSha256,
    registradoPor,
    descargar = descargarConBaileys

}) {

    try {

        const hash = normalizarHash(stickerSha256);

        if (!usuarioId || !PATRON_USUARIO.test(String(usuarioId))) {
            return { ok: false, imagen: false, motivo: "usuario_invalido" };
        }

        if (!hash || !PATRON_HASH.test(hash)) {
            return { ok: false, imagen: false, motivo: "hash_invalido" };
        }

        const sticker = msg?.message?.stickerMessage || {};
        const mimetype = sticker.mimetype || null;
        const esAnimado = sticker.isAnimated === true;

        // 1) Imagen (best-effort).
        let imagenRuta = null;

        try {

            const contenido = await conLimiteDeTiempo(
                Promise.resolve().then(() => descargar(msg, sock)),
                TIEMPO_MAX_DESCARGA_MS
            );

            const buffer = Buffer.isBuffer(contenido) ? contenido : (contenido ? Buffer.from(contenido) : null);

            if (!buffer || buffer.length === 0) {

                console.log("[STICKER-BIBLIOTECA] Descarga vacía — se guarda sin vista previa.");

            } else if (buffer.length > LIMITE_BYTES) {

                console.log("[STICKER-BIBLIOTECA] Imagen supera el límite — se guarda sin vista previa.");

            } else {

                const ruta = rutaImagen(usuarioId, hash, mimetype);

                const { error: errorSubida } = await supabase.storage
                    .from(BUCKET_STICKERS_PAGO)
                    .upload(ruta, buffer, {
                        contentType: mimetype || "application/octet-stream",
                        upsert: true
                    });

                if (errorSubida) {
                    console.log("[STICKER-BIBLIOTECA] No se pudo subir la imagen:", errorSubida.message);
                } else {
                    imagenRuta = ruta;
                }

            }

        } catch (errorImagen) {

            console.log("[STICKER-BIBLIOTECA] No se pudo obtener la imagen:", errorImagen.message);

        }

        // 2) Fila. imagen_ruta solo se incluye si se subió: un reintento
        //    fallido nunca borra la imagen que ya tenía ese sticker.
        const ahora = new Date().toISOString();

        const fila = {

            usuario_id: usuarioId,
            sticker_sha256: hash,
            mimetype,
            es_animado: esAnimado,
            registrado_en: ahora,
            registrado_por: registradoPor || null,
            actualizado_en: ahora

        };

        if (imagenRuta) fila.imagen_ruta = imagenRuta;

        const { error: errorFila } = await supabase
            .from("stickers_pago_biblioteca")
            .upsert(fila, { onConflict: "usuario_id,sticker_sha256" });

        if (errorFila) {

            console.log("[STICKER-BIBLIOTECA] No se pudo guardar en la biblioteca:", errorFila.message);

            return { ok: false, imagen: !!imagenRuta, motivo: "error_fila" };

        }

        console.log(`[STICKER-BIBLIOTECA] Sticker guardado en la biblioteca (${imagenRuta ? "con" : "sin"} vista previa).`);

        return { ok: true, imagen: !!imagenRuta };

    } catch (err) {

        console.error("⚠ [STICKER-BIBLIOTECA] Error inesperado:", err.message);

        return { ok: false, imagen: false, motivo: "error_inesperado" };

    }

}

module.exports = {

    BUCKET_STICKERS_PAGO,
    LIMITE_BYTES,
    rutaImagen,
    guardarEnBiblioteca

};
