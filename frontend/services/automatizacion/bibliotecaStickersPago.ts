import { supabase } from "@/lib/supabase";

import { BUCKET_STICKERS_PAGO, StickerBiblioteca, rutasFirmables } from "./bibliotecaStickersVista";

// Biblioteca de stickers de pago (migración 046). El panel solo LEE y
// ELIMINA sus propias filas e imágenes (RLS + policies de Storage por
// carpeta <usuario_id>/). Agregar = el registro de siempre por WhatsApp:
// el backend guarda la imagen y la fila (bibliotecaStickersPago.js).
//
// Nada de aquí toca configuracion_stickers_pago: desactivar el
// predeterminado sigue siendo desactivarStickerPago() de stickerPago.ts.

const SEGUNDOS_URL_FIRMADA = 60 * 60;

export async function listarBibliotecaStickers(usuarioId: string) {

    return await supabase
        .from("stickers_pago_biblioteca")
        .select("id, usuario_id, sticker_sha256, mimetype, es_animado, imagen_ruta, registrado_en, registrado_por")
        .eq("usuario_id", usuarioId)
        .order("registrado_en", { ascending: false });

}

// Devuelve { ruta -> url firmada temporal }. El bucket es privado.
export async function obtenerUrlsStickers(stickers: StickerBiblioteca[], usuarioId: string): Promise<Record<string, string>> {

    const rutas = rutasFirmables(stickers, usuarioId);

    if (rutas.length === 0) return {};

    const { data, error } = await supabase.storage
        .from(BUCKET_STICKERS_PAGO)
        .createSignedUrls(rutas, SEGUNDOS_URL_FIRMADA);

    if (error || !data) return {};

    const urls: Record<string, string> = {};

    for (const item of data) {
        if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    }

    return urls;

}

// Elimina UN sticker de la biblioteca: primero su imagen, luego la fila.
// Si la imagen no se puede borrar, la fila se conserva (nunca queda una
// imagen huérfana sin forma de borrarla desde el panel).
export async function eliminarStickerBiblioteca(usuarioId: string, sticker: StickerBiblioteca) {

    if (sticker.usuario_id !== usuarioId) {
        return { error: { message: "El sticker no pertenece a esta cuenta." } };
    }

    if (sticker.imagen_ruta) {

        const { error: errorImagen } = await supabase.storage
            .from(BUCKET_STICKERS_PAGO)
            .remove([sticker.imagen_ruta]);

        if (errorImagen) return { error: errorImagen };

    }

    return await supabase
        .from("stickers_pago_biblioteca")
        .delete()
        .eq("id", sticker.id)
        .eq("usuario_id", usuarioId);

}
