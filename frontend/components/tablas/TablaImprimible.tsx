"use client";

import type { Ref } from "react";

import Grid from "@/components/tablas/Grid";
import type { NumeroReserva } from "@/components/tablas/types";
import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";
import { DEFAULT_TABLA_DISENO_CONFIG } from "@/services/tablas/disenoDefaults";
import type { Resultado } from "@/services/tablas/reservaManual";

// Modo limpio: sin ventana de número, ninguna acción.
const sinAccion = async (): Promise<Resultado> => ({ ok: false, motivo: "solo_lectura", mensaje: "Vista de solo lectura." });

interface Props {
    numerosDisponibles: string[];
    numerosOcupados: string[];
    /** Subconjunto de numerosOcupados que se pinta como «Pagado». */
    numerosPagados?: string[];
    diseno?: TablaDisenoConfig | null;
    /** Solo en /tablas/imprimir: la página que abre el Chromium del servidor. */
    imprimir?: boolean;
    /** La cuadrícula, para capturarTabla (la captura de «Compartir»). */
    contenedorRef?: Ref<HTMLDivElement>;
    /** La captura ya se puede pedir (Chromium espera esta marca). */
    capturaLista?: boolean;
    /** Ancho de la columna de Tablas en la que se captura (perfilCaptura). */
    anchoContenido?: number | null;
}

// LA tabla que se comparte por WhatsApp. Única implementación, usada por la
// vista de impresión que captura Puppeteer (app/tablas/imprimir/[precio]) y
// por la vista previa de Sorteos programados: mismos datos (número + libre u
// ocupado, nunca datos personales), mismo componente Grid en modo limpio y
// mismo diseño. Sin diseño: el de por defecto.
export default function TablaImprimible({ numerosDisponibles, numerosOcupados, numerosPagados, diseno, imprimir = false, contenedorRef, capturaLista = false, anchoContenido }: Props) {

    const config = diseno || DEFAULT_TABLA_DISENO_CONFIG;
    const numeros = construirNumerosParaImprimir(numerosDisponibles, numerosOcupados, numerosPagados);

    return (

        <div
            // Para capturar, la tarjeta ocupa la columna como en Tablas: sin margen propio.
            style={contenedorRef ? { background: config.theme.pageBg, width: anchoContenido ?? undefined } : { background: config.theme.pageBg, padding: 24 }}
            {...(imprimir ? { "data-tabla-imprimir": "" } : {})}
            {...(imprimir && capturaLista ? { "data-captura-lista": "" } : {})}
        >

            <Grid
                contenedorRef={contenedorRef}
                precio={0}
                numeros={numeros}
                paquetes={[]}
                eventoActivo={null}
                coincidePrecio={true}
                diseno={config}
                onReservar={sinAccion}
                onMarcarPagado={sinAccion}
                onLiberar={sinAccion}
                limpio
            />

        </div>

    );

}

// Solo número + estado real (libre/reservado/pagado) — el resto de campos de
// NumeroReserva quedan null a propósito: esta vista nunca necesita ni
// muestra datos personales del cliente.
export function construirNumerosParaImprimir(disponibles: string[], ocupados: string[], pagados: string[] = []): NumeroReserva[] {

    const base = {
        comprador: null, contacto: null, nombre: null, telefono: null, lib: null,
        grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null,
        usuario_id: null, usuario_global_id: null, telefono_bot: null,
        fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
        temporal_por: null, bloqueado_hasta: null, ip_reserva: null, contacto_lower: null,
        creado_en: new Date().toISOString()
    };

    const conPago = new Set(pagados);
    const filas: NumeroReserva[] = [];
    let id = 0;

    for (const numero of disponibles) {
        filas.push({ id: id++, numero, estado: "libre", ...base });
    }

    for (const numero of ocupados) {
        filas.push({ id: id++, numero, estado: conPago.has(numero) ? "pagado" : "reservado", ...base });
    }

    return filas.sort((a, b) => a.numero.localeCompare(b.numero));

}
