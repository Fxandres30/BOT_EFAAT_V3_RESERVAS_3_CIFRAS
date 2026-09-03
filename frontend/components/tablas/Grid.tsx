"use client";

import { useMemo, useState } from "react";

import NumeroCard from "./NumeroCard";
import NumeroDetalleModal from "./NumeroDetalleModal";
import type { NumeroReserva, PaqueteReserva, EventoActivo } from "./types";
import { estadoEfectivo, type FiltroEstado } from "./estadoVisual";

interface Props {
    numeros: NumeroReserva[];
    paquetes: PaqueteReserva[];
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
    busqueda: string;
    filtro: FiltroEstado;
    accionando: string | null;
    onMarcarPagado: (numero: string) => void;
    onLiberar: (numero: string) => void;
    onBloquear: (numero: string, motivo?: string) => void;
    onMarcarEnProceso: (numero: string, minutos?: number) => void;
}

export default function Grid({
    numeros,
    paquetes,
    eventoActivo,
    coincidePrecio,
    busqueda,
    filtro,
    accionando,
    onMarcarPagado,
    onLiberar,
    onBloquear,
    onMarcarEnProceso
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

            const estado = estadoEfectivo(n);

            if (filtro === "grupo" && !numerosEnGrupo.has(n.numero))
                return false;

            if (filtro !== "todos" && filtro !== "grupo" && estado !== filtro)
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

    return (

        <>

            {visibles.length === 0 ? (

                <div className="border rounded-2xl p-6 sm:p-10 text-center text-gray-500 bg-white">
                    No hay números que coincidan con la búsqueda o el filtro actual.
                </div>

            ) : (

                <div className="grid gap-1.5 sm:gap-2.5 grid-cols-[repeat(auto-fill,minmax(52px,1fr))]">

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

            <NumeroDetalleModal
                numero={seleccionado}
                paquete={seleccionado ? paquetePorNumero.get(seleccionado.numero) || null : null}
                accionando={accionando}
                onClose={() => setSeleccionado(null)}
                onMarcarPagado={onMarcarPagado}
                onLiberar={onLiberar}
                onBloquear={onBloquear}
                onMarcarEnProceso={onMarcarEnProceso}
            />

        </>

    );

}
