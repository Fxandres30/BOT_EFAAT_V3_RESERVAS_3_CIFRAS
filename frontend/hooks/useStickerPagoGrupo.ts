"use client";

import { useStickerPago } from "./useStickerPago";

export type NivelStickerPagoGrupo = "especifico" | "predeterminado" | "ninguno";

// Vista combinada para la sección "Sticker de pago de este grupo": qué
// nivel está efectivamente en uso (para pintar Caso 1/2/3 del panel), sin
// duplicar la lógica de carga/Realtime/expiración — reutiliza
// useStickerPago.ts DOS VECES (una por nivel) en vez de reimplementarla.
export function useStickerPagoGrupo(usuarioId: string | null, grupoId: string) {

    const especifico = useStickerPago(usuarioId, grupoId);
    const predeterminado = useStickerPago(usuarioId, null);

    const cargando = especifico.estado === "cargando" || predeterminado.estado === "cargando";

    // Prioridad idéntica a la del backend (resolverStickerPago): el
    // específico del grupo gana si está configurado; si no, se usa el
    // predeterminado del tenant si existe; si tampoco, no hay ninguno.
    const nivelActivo: NivelStickerPagoGrupo = cargando
        ? "ninguno"
        : especifico.estado === "configurado"
            ? "especifico"
            : predeterminado.estado === "configurado"
                ? "predeterminado"
                : "ninguno";

    return {

        cargando,
        nivelActivo,

        // Estado completo del NIVEL ESPECÍFICO de este grupo — es el único
        // nivel que esta vista puede registrar/cancelar/desactivar
        // directamente (el predeterminado se administra desde la sección
        // general, no desde aquí).
        especifico,

        // Solo para saber "hay un predeterminado configurado" y mostrar su
        // fecha si hace falta — su ciclo de vida se administra en la
        // sección general (grupos/page.tsx), no aquí.
        predeterminado

    };

}
