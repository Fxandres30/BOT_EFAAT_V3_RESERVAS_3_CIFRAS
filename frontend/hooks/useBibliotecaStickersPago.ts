"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import {
    eliminarStickerBiblioteca,
    listarBibliotecaStickers,
    obtenerUrlsStickers
} from "@/services/automatizacion/bibliotecaStickersPago";
import { StickerBiblioteca, esTablaAusente } from "@/services/automatizacion/bibliotecaStickersVista";

// Biblioteca de stickers de pago del cliente (046). Persistente: todo vive
// en Supabase, nada en el navegador. Si la tabla aún no existe (046 sin
// aplicar) el hook queda en "disponible=false" y la sección sigue
// funcionando como antes con el predeterminado.
export function useBibliotecaStickersPago(usuarioId: string | null) {

    const [stickers, setStickers] = useState<StickerBiblioteca[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [cargando, setCargando] = useState(true);
    const [disponible, setDisponible] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);

    const cargar = useCallback(async () => {

        if (!usuarioId) return;

        const { data, error: errorCarga } = await listarBibliotecaStickers(usuarioId);

        if (errorCarga) {

            if (esTablaAusente(errorCarga)) {
                setDisponible(false);
                setError(null);
            } else {
                setError("No se pudo cargar la biblioteca de stickers.");
            }

            setCargando(false);
            return;

        }

        const lista = (data as StickerBiblioteca[] | null) ?? [];

        setDisponible(true);
        setStickers(lista);
        setError(null);
        setCargando(false);

        setUrls(await obtenerUrlsStickers(lista, usuarioId));

    }, [usuarioId]);

    useEffect(() => {

        // Carga inicial al montar o al cambiar de cuenta.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void cargar();

    }, [cargar]);

    // Tiempo real: la fila la escribe el backend al capturar el sticker.
    useEffect(() => {

        if (!usuarioId || !disponible) return;

        const canal = supabase
            .channel(`stickers-pago-biblioteca-${usuarioId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "stickers_pago_biblioteca",
                    filter: `usuario_id=eq.${usuarioId}`
                },
                () => { void cargar(); }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(canal);
        };

    }, [usuarioId, disponible, cargar]);

    const eliminar = useCallback(async (sticker: StickerBiblioteca) => {

        if (!usuarioId) return false;

        setEliminandoId(sticker.id);
        setError(null);

        const { error: errorEliminar } = await eliminarStickerBiblioteca(usuarioId, sticker);

        setEliminandoId(null);

        if (errorEliminar) {
            setError("No se pudo eliminar el sticker. Intenta nuevamente.");
            return false;
        }

        setStickers(prev => prev.filter(s => s.id !== sticker.id));

        return true;

    }, [usuarioId]);

    return {
        stickers,
        urls,
        cargando,
        disponible,
        error,
        eliminandoId,
        eliminar,
        recargar: cargar
    };

}
