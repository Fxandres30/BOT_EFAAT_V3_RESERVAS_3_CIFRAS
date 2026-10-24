"use client";

import { useMemo, useState, type Ref } from "react";

import NumeroCard from "./NumeroCard";
import NumeroDetalleModal from "./NumeroDetalleModal";
import Leyenda from "./Leyenda";
import type { NumeroReserva, PaqueteReserva, EventoActivo } from "./types";
import type { TablaDisenoConfig } from "./disenoTypes";
import { cssVarsFromConfig } from "./disenoCssVars";
import type { DatosLiberar, DatosPago, DatosReserva, Resultado } from "@/services/tablas/reservaManual";

interface Props {
    precio: number;
    numeros: NumeroReserva[];
    paquetes: PaqueteReserva[];
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
    /** Números que cumplen la búsqueda y los filtros de «Historial de
     *  números» (historialDatos.numerosCoincidentes); null o ausente = todos. */
    coincidentes?: Set<string> | null;
    accionando: string | null;
    diseno: TablaDisenoConfig;
    onReservar: (numero: string, datos: DatosReserva) => Promise<Resultado>;
    onMarcarPagado: (numero: string, datos?: DatosPago) => Promise<Resultado>;
    onLiberar: (numero: string, datos?: DatosLiberar) => Promise<Resultado>;
    /** Representación exportada/compartida: solo la cuadrícula de números,
     *  sin leyenda ni modal de detalle (ver /tablas/imprimir/[precio]). */
    limpio?: boolean;
    /** La cuadrícula de números tal como se ve (sin la leyenda, que es solo
     *  para administración): «Compartir» la captura como PNG. */
    contenedorRef?: Ref<HTMLDivElement>;
    /** Modo «Seleccionar»: con él, un clic marca/desmarca el número en vez
     *  de abrir su detalle. null o ausente = comportamiento de siempre. */
    seleccion?: Set<string> | null;
    onAlternarSeleccion?: (numero: string) => void;
    /** Detalle abierto controlado desde fuera («Ver detalle» de «Historial
     *  de números»): mismo modal que al tocar la celda. Ausente = interno. */
    detalle?: string | null;
    onDetalleChange?: (numero: string | null) => void;
}

export default function Grid({
    precio,
    numeros,
    paquetes,
    eventoActivo,
    coincidePrecio,
    coincidentes = null,
    accionando,
    diseno,
    onReservar,
    onMarcarPagado,
    onLiberar,
    limpio = false,
    contenedorRef,
    seleccion = null,
    onAlternarSeleccion,
    detalle,
    onDetalleChange
}: Props) {

    const seleccionando = Boolean(seleccion && onAlternarSeleccion);

    const [detalleInterno, setDetalleInterno] = useState<string | null>(null);
    const controlado = onDetalleChange !== undefined;
    const numeroDetalle = controlado ? detalle ?? null : detalleInterno;
    const setDetalle = controlado ? onDetalleChange : setDetalleInterno;
    // La fila vigente (tras cada recarga), no una copia del momento del clic.
    const seleccionado = numeroDetalle ? numeros.find(n => n.numero === numeroDetalle) || null : null;

    const numerosEnGrupo = useMemo(() => {
        const set = new Set<string>();
        paquetes.forEach(p => p.numeros.forEach(n => set.add(n)));
        return set;
    }, [paquetes]);

    const paquetePorNumero = useMemo(() => {
        const mapa = new Map<string, PaqueteReserva>();
        paquetes.forEach(p => p.numeros.forEach(n => mapa.set(n, p)));
        return mapa;
    }, [paquetes]);

    const visibles = useMemo(
        () => (coincidentes ? numeros.filter(n => coincidentes.has(n.numero)) : numeros),
        [numeros, coincidentes]
    );

    const estiloDiseno = {
        ...cssVarsFromConfig(diseno),
        background: "var(--efaat-tabla-table-bg)",
        borderColor: "var(--efaat-tabla-border)"
    };

    return (

        <div className="border rounded-2xl shadow-sm p-2.5 sm:p-4" style={estiloDiseno}>

            {!limpio && (
                <div className="flex justify-center sm:justify-start pb-3 sm:pb-4 mb-1 border-b border-gray-100">
                    <Leyenda diseno={diseno} />
                </div>
            )}

            {visibles.length === 0 ? (

                <div className="p-6 sm:p-10 text-center text-gray-500">
                    No hay números que coincidan con la búsqueda o el filtro actual.
                </div>

            ) : (

                <div
                    ref={contenedorRef}
                    className="mx-auto max-w-2xl grid grid-cols-10"
                    style={{ gap: "var(--efaat-tabla-cell-gap)" }}
                >

                    {visibles.map((numero) => {

                        const deOtroEvento = Boolean(
                            numero.evento_id &&
                            (!eventoActivo || numero.evento_id !== eventoActivo.id)
                        );

                        const atenuado = !coincidePrecio && numero.estado === "libre";

                        return (

                            <NumeroCard
                                key={numero.id}
                                numero={numero}
                                enGrupo={numerosEnGrupo.has(numero.numero)}
                                atenuado={atenuado}
                                deOtroEvento={deOtroEvento}
                                seleccionado={seleccionando ? Boolean(seleccion?.has(numero.numero)) : undefined}
                                onClick={() => (seleccionando ? onAlternarSeleccion?.(numero.numero) : setDetalle(numero.numero))}
                            />

                        );

                    })}

                </div>

            )}

            {!limpio && (
                <NumeroDetalleModal
                    precio={precio}
                    numero={seleccionado}
                    paquete={seleccionado ? paquetePorNumero.get(seleccionado.numero) || null : null}
                    accionando={accionando}
                    onClose={() => setDetalle(null)}
                    onReservar={onReservar}
                    onMarcarPagado={onMarcarPagado}
                    onLiberar={onLiberar}
                />
            )}

        </div>

    );

}
