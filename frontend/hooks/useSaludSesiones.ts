"use client";

import { useEffect, useState } from "react";

import { obtenerSaludSesiones, type SaludSesion } from "@/services/sessions/saludSesiones";

const INTERVALO_MS = 15000;

// Consulta periódica del estado real de las sesiones. `error` describe por
// qué no se pudo leer (el panel no inventa un estado en ese caso).
export default function useSaludSesiones(habilitado: boolean) {

    const [salud, setSalud] = useState<Record<string, SaludSesion>>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        if (!habilitado) return;

        let vivo = true;

        async function consultar() {

            const r = await obtenerSaludSesiones();

            if (!vivo) return;

            if (!r.ok) {
                // El motivo técnico va a la consola (administrador), no a la pantalla.
                console.warn("[salud sesiones] no disponible:", r.motivo);
                setError(r.motivo);
                return;
            }

            setError(null);
            setSalud(Object.fromEntries(r.sesiones.map(s => [s.sessionId, s])));

        }

        consultar();

        const id = setInterval(consultar, INTERVALO_MS);

        return () => {
            vivo = false;
            clearInterval(id);
        };

    }, [habilitado]);

    return { salud, error };

}
