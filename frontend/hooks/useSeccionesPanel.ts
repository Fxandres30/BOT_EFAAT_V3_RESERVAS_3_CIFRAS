"use client";

import { useState } from "react";

import {
    almacenNavegador,
    guardarSecciones,
    leerSecciones,
    type EstadoSecciones,
    type SeccionPanel
} from "@/services/tablas/preferenciasSecciones";

// Estado abierto/contraído de las secciones del panel de tablas, recordado
// por usuario. Se lee de forma síncrona en el primer render (la vista solo
// monta las secciones tras cargar, con el usuario ya resuelto): no hay
// parpadeo de «abierto» a «cerrado».
export function useSeccionesPanel(usuarioId: string | null) {

    const [actual, setActual] = useState(() => ({
        usuarioId,
        secciones: leerSecciones(almacenNavegador(), usuarioId)
    }));

    // Cambio de cuenta sin desmontar: se cargan las preferencias de la nueva
    // (ajuste de estado durante el render, como en EditorDisenoModal).
    if (actual.usuarioId !== usuarioId) {
        setActual({ usuarioId, secciones: leerSecciones(almacenNavegador(), usuarioId) });
    }

    function alternar(seccion: SeccionPanel) {
        const secciones: EstadoSecciones = { ...actual.secciones, [seccion]: !actual.secciones[seccion] };
        guardarSecciones(almacenNavegador(), actual.usuarioId, secciones);
        setActual({ usuarioId: actual.usuarioId, secciones });
    }

    return { secciones: actual.secciones, alternar };

}
