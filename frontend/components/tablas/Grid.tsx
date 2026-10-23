"use client";

import { useMemo, useState, type Ref } from "react";

import NumeroCard from "./NumeroCard";
import NumeroDetalleModal from "./NumeroDetalleModal";
import Leyenda from "./Leyenda";
import type { NumeroReserva, PaqueteReserva, EventoActivo } from "./types";
import { estadoVisualSimplificado, type FiltroEstado } from "./estadoVisual";
import type { TablaDisenoConfig } from "./disenoTypes";
import { cssVarsFromConfig } from "./disenoCssVars";
import type { DatosLiberar, DatosPago, DatosReserva, Resultado } from "@/services/tablas/reservaManual";

interface Props {
    precio: number;
    numeros: NumeroReserva[];
    paquetes: PaqueteReserva[];
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
    busqueda: string;
    filtro: FiltroEstado;
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
}

export default function Grid({
    precio,
    numeros,
    paquetes,
    eventoActivo,
    coincidePrecio,
    busqueda,
    filtro,
    accionando,
    diseno,
    onReservar,
    onMarcarPagado,
    onLiberar,
    limpio = false,
    contenedorRef
}: Props) {

    const [seleccionado, setSeleccionado] = useState<NumeroReserva | null>(null);

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

    const visibles = useMemo(() => {

        const termino = busqueda.trim().toLowerCase();

        return numeros.filter((n) => {

            const estado = estadoVisualSimplificado(n);

            if (filtro !== "todos" && estado !== filtro)
                return false;

            if (!termino)
                return true;

            const campos = [
                n.numero,
                n.comprador,
                n.contacto,
                n.telefono,
                n.grupo_nombre,
                paquetePorNumero.get(n.numero)?.cliente
            ];

            return campos.some(campo => campo?.toLowerCase().includes(termino));

        });

    }, [numeros, busqueda, filtro, numerosEnGrupo, paquetePorNumero]);

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
                                onClick={() => setSeleccionado(numero)}
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
                    onClose={() => setSeleccionado(null)}
                    onReservar={onReservar}
                    onMarcarPagado={onMarcarPagado}
                    onLiberar={onLiberar}
                />
            )}

        </div>

    );

}
