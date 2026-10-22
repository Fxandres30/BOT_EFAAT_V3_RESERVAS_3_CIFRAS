"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import TablaImprimible from "@/components/tablas/TablaImprimible";
import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// Vista de IMPRESIÓN — usada SOLO por Puppeteer (backend/services/compartirTabla.js)
// para capturar la imagen real que se comparte por WhatsApp. La tabla es
// components/tablas/TablaImprimible (la MISMA que la vista previa de Sorteos
// programados): solo número+estado, nunca datos personales, Grid en modo
// limpio, con el diseño ACTIVO de esa tabla que devuelve el backend (antes
// siempre el de por defecto).
//
// Requiere un token firmado (?token=...) verificado por el backend en
// /tablas/imprimir-datos — sin él no hay datos que mostrar. Esta página
// NUNCA usa la sesión de Supabase del navegador: no hace falta estar
// logueado, y no expone nada sin el token correcto.
export default function ImprimirTablaPage() {

    const params = useParams<{ precio: string }>();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const precio = Number(params.precio);

    const [datos, setDatos] = useState<{ numerosDisponibles: string[]; numerosOcupados: string[]; diseno?: TablaDisenoConfig | null } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        let vivo = true;

        async function cargar() {

            try {

                const res = await fetch(`/api/tablas/imprimir?precio=${precio}&token=${encodeURIComponent(token || "")}`);
                const data = await res.json();

                if (!vivo) return;

                if (!res.ok) {
                    setError(data.error || "No se pudo cargar la tabla.");
                    return;
                }

                setDatos(data);

            } catch {

                if (vivo) setError("No se pudo cargar la tabla.");

            }

        }

        if (precio && token) {
            cargar();
        }

        return () => { vivo = false; };

    }, [precio, token]);

    if (!precio || !token) {
        return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Faltan parámetros.</div>;
    }

    if (error) {
        return <div style={{ padding: 24, fontFamily: "sans-serif" }}>{error}</div>;
    }

    if (!datos) {
        return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Cargando…</div>;
    }

    return (
        <TablaImprimible
            numerosDisponibles={datos.numerosDisponibles}
            numerosOcupados={datos.numerosOcupados}
            diseno={datos.diseno}
            imprimir
        />
    );

}
