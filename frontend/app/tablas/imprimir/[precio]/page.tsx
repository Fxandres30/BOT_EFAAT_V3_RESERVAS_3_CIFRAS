"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import Grid from "@/components/tablas/Grid";
import type { NumeroReserva } from "@/components/tablas/types";
import { DEFAULT_TABLA_DISENO_CONFIG } from "@/services/tablas/disenoDefaults";

// Vista de IMPRESIÓN — usada SOLO por Puppeteer (backend/services/compartirTabla.js)
// para capturar la imagen real que se comparte por WhatsApp. Reutiliza el
// mismo componente Grid que ve el admin (no se duplica ni se rediseña la
// tabla visual); la diferencia es que aquí SOLO se pintan número+estado
// (nunca nombre/teléfono real) y no hay ninguna interacción — nunca se
// abre el modal de detalle, así que ningún dato personal llega a
// aparecer en la imagen capturada.
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

    const [datos, setDatos] = useState<{ numerosDisponibles: string[]; numerosOcupados: string[] } | null>(null);
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

    const numeros: NumeroReserva[] = construirNumerosParaImprimir(datos.numerosDisponibles, datos.numerosOcupados);

    return (

        <div style={{ background: "#F6F8FC", padding: 24 }} data-tabla-imprimir>

            <Grid
                numeros={numeros}
                paquetes={[]}
                eventoActivo={null}
                coincidePrecio={true}
                busqueda=""
                filtro="todos"
                accionando={null}
                diseno={DEFAULT_TABLA_DISENO_CONFIG}
                onMarcarPagado={() => {}}
                onLiberar={() => {}}
                onBloquear={() => {}}
                onMarcarEnProceso={() => {}}
            />

        </div>

    );

}

// Solo número + estado real (libre/ocupado) — el resto de campos de
// NumeroReserva quedan null a propósito: esta vista nunca necesita ni
// muestra datos personales del cliente.
function construirNumerosParaImprimir(disponibles: string[], ocupados: string[]): NumeroReserva[] {

    const base = {
        comprador: null, contacto: null, nombre: null, telefono: null, lib: null,
        grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null,
        usuario_id: null, usuario_global_id: null, telefono_bot: null,
        fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
        temporal_por: null, bloqueado_hasta: null, ip_reserva: null, contacto_lower: null,
        creado_en: new Date().toISOString()
    };

    const filas: NumeroReserva[] = [];
    let id = 0;

    for (const numero of disponibles) {
        filas.push({ id: id++, numero, estado: "libre", ...base });
    }

    for (const numero of ocupados) {
        filas.push({ id: id++, numero, estado: "reservado", ...base });
    }

    return filas.sort((a, b) => a.numero.localeCompare(b.numero));

}
