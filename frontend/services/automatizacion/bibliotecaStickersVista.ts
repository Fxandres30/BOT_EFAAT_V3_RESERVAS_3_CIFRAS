// ==========================================================================
// Lógica PURA de la galería de stickers de pago (sin red ni Supabase), para
// poder probarla aislada. Ver bibliotecaStickersPago.ts (datos) y
// backend/supabase_migrations/046_biblioteca_stickers_pago.sql.
//
// «Predeterminado» se decide SOLO comparando huellas con
// configuracion_stickers_pago.sticker_sha256 (grupo_id null), la misma fila
// que usa la confirmación de pagos. La biblioteca nunca decide cuál
// confirma pagos.
// ==========================================================================

export const BUCKET_STICKERS_PAGO = "stickers-pago";

export interface StickerBiblioteca {
    id: string;
    usuario_id: string;
    sticker_sha256: string;
    mimetype: string | null;
    es_animado: boolean;
    imagen_ruta: string | null;
    registrado_en: string;
    registrado_por: string | null;
}

export type TipoVistaSticker = "imagen" | "lottie" | "sin_imagen";

export interface TarjetaSticker {
    // id de la fila, o "predeterminado-sin-fila" si el predeterminado aún
    // no está en la biblioteca (046 sin aplicar o carga inicial pendiente).
    clave: string;
    sticker: StickerBiblioteca | null;
    hash: string;
    esPredeterminado: boolean;
    vista: TipoVistaSticker;
    registradoEn: string | null;
}

export function normalizarHash(valor: string | null | undefined): string | null {
    const limpio = valor ? String(valor).trim().toLowerCase() : "";
    return limpio || null;
}

// Lottie (application/was) no se puede animar con <img>; webp/png sí
// (incluido el webp animado, que el navegador reproduce solo).
export function tipoVista(sticker: Pick<StickerBiblioteca, "mimetype" | "imagen_ruta">): TipoVistaSticker {
    if ((sticker.mimetype || "").toLowerCase() === "application/was") return "lottie";
    if (!sticker.imagen_ruta) return "sin_imagen";
    return "imagen";
}

// Predeterminado primero; el resto del más reciente al más antiguo.
export function armarGaleria(
    stickers: StickerBiblioteca[],
    hashPredeterminado: string | null | undefined
): TarjetaSticker[] {

    const pred = normalizarHash(hashPredeterminado);

    const tarjetas: TarjetaSticker[] = stickers.map(s => {
        const hash = normalizarHash(s.sticker_sha256) || "";
        return {
            clave: s.id,
            sticker: s,
            hash,
            esPredeterminado: !!pred && hash === pred,
            vista: tipoVista(s),
            registradoEn: s.registrado_en || null
        };
    });

    // No perder de vista el predeterminado vigente aunque todavía no tenga
    // fila en la biblioteca.
    if (pred && !tarjetas.some(t => t.esPredeterminado)) {
        tarjetas.push({
            clave: "predeterminado-sin-fila",
            sticker: null,
            hash: pred,
            esPredeterminado: true,
            vista: "sin_imagen",
            registradoEn: null
        });
    }

    return tarjetas.sort((a, b) => {
        if (a.esPredeterminado !== b.esPredeterminado) return a.esPredeterminado ? -1 : 1;
        return (b.registradoEn || "").localeCompare(a.registradoEn || "");
    });

}

// Solo rutas dentro de la carpeta del propio usuario (la policy de Storage
// ya lo impone; esto evita siquiera pedir una URL ajena).
export function rutasFirmables(stickers: StickerBiblioteca[], usuarioId: string): string[] {
    const prefijo = `${usuarioId}/`;
    return stickers
        .map(s => s.imagen_ruta)
        .filter((r): r is string => !!r && r.startsWith(prefijo) && !r.includes(".."));
}

// Errores de PostgREST cuando la tabla todavía no existe (046 sin aplicar).
export function esTablaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    if (error.code === "42P01" || error.code === "PGRST205") return true;
    return /stickers_pago_biblioteca/.test(error.message || "") && /not exist|could not find|schema cache/i.test(error.message || "");
}
