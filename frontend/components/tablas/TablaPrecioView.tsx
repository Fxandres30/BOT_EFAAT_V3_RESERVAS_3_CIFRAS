"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, Info } from "lucide-react";

import { useTablaPrecio } from "@/hooks/useTablaPrecio";
import AccionesTabla from "./AccionesTabla";
import StatsBar from "./StatsBar";
import FiltrosBar from "./FiltrosBar";
import Grid from "./Grid";
import ReservasRecientes from "./ReservasRecientes";
import GruposPanel from "./GruposPanel";
import ActividadReciente from "./ActividadReciente";
import type { FiltroEstado } from "./estadoVisual";
import type { EventoActivo } from "./types";

interface Props {
    precio: number;
}

export default function TablaPrecioView({ precio }: Props) {

    const {
        config,
        loading,
        error,
        numeros,
        eventoActivo,
        coincidePrecio,
        stats,
        paquetes,
        recientes,
        actividad,
        accionando,
        marcarPagado,
        liberar,
        bloquear,
        marcarEnProceso,
        reiniciar
    } = useTablaPrecio(precio);

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<FiltroEstado>("todos");

    if (!config) {

        return (
            <EstadoMensaje
                icon={AlertTriangle}
                titulo="Precio no válido"
                descripcion={`No existe una tabla configurada para $${precio}.`}
            />
        );

    }

    if (loading) {

        return (
            <EstadoMensaje
                icon={Loader2}
                titulo="Cargando tabla..."
                descripcion="Obteniendo el estado real de las reservas."
                animarIcono
            />
        );

    }

    if (error) {

        return (
            <EstadoMensaje
                icon={AlertTriangle}
                titulo="No se pudo cargar la tabla"
                descripcion={error}
                tono="error"
            />
        );

    }

    if (numeros.length === 0) {

        return (

            <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

                <Cabecera precio={precio} eventoActivo={eventoActivo} coincidePrecio={coincidePrecio} />

                <div className="border rounded-2xl p-6 sm:p-10 text-center bg-white">
                    <h2 className="text-xl font-bold mb-2">Esta tabla está vacía</h2>
                    <p className="text-gray-500 mb-6">
                        Presiona <b>Reiniciar</b> para crear automáticamente los números del 00 al 99.
                    </p>
                    <div className="flex justify-center">
                        <AccionesTabla
                            precio={precio}
                            totalNumeros={0}
                            disponibles={0}
                            onReiniciar={reiniciar}
                        />
                    </div>
                </div>

            </div>

        );

    }

    return (

        <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

            <Cabecera precio={precio} eventoActivo={eventoActivo} coincidePrecio={coincidePrecio} />

            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 sm:gap-4">
                <div className="flex-1 min-w-0">
                    <StatsBar stats={stats} />
                </div>
                <div className="lg:shrink-0">
                    <AccionesTabla
                        precio={precio}
                        totalNumeros={stats.total}
                        disponibles={stats.disponibles}
                        onReiniciar={reiniciar}
                    />
                </div>
            </div>

            <FiltrosBar
                busqueda={busqueda}
                onBusquedaChange={setBusqueda}
                filtro={filtro}
                onFiltroChange={setFiltro}
            />

            <Grid
                numeros={numeros}
                paquetes={paquetes}
                eventoActivo={eventoActivo}
                coincidePrecio={coincidePrecio}
                busqueda={busqueda}
                filtro={filtro}
                accionando={accionando}
                onMarcarPagado={marcarPagado}
                onLiberar={liberar}
                onBloquear={bloquear}
                onMarcarEnProceso={marcarEnProceso}
            />

            <ReservasRecientes
                precio={precio}
                numeros={recientes}
                accionando={accionando}
                onMarcarPagado={marcarPagado}
                onLiberar={liberar}
            />

            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                <GruposPanel paquetes={paquetes} precio={precio} />
                <ActividadReciente actividad={actividad} />
            </div>

        </div>

    );

}

function Cabecera({
    precio,
    eventoActivo,
    coincidePrecio
}: {
    precio: number;
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
}) {

    return (

        <div className="bg-white border rounded-2xl shadow-sm p-4 sm:p-6 min-w-0">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                <div className="min-w-0">
                    <h1 className="font-bold text-gray-900 text-[clamp(1.5rem,5vw,2.25rem)] leading-tight">
                        Tabla ${precio.toLocaleString("es-CO")}
                    </h1>
                    <p className="text-gray-500 mt-1 break-words">
                        {eventoActivo?.nombre_evento || "Administra las reservas de esta dinámica."}
                    </p>
                </div>

                {coincidePrecio ? (
                    <span className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                        🟢 Evento activo
                    </span>
                ) : (
                    <span className="bg-gray-100 text-gray-600 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                        ⚪ Sin evento activo para ${precio.toLocaleString("es-CO")}
                    </span>
                )}

            </div>

            {!coincidePrecio && (

                <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 min-w-0">
                    <Info size={16} className="shrink-0 mt-0.5" />
                    <span>
                        {eventoActivo
                            ? `El evento activo en esta tabla física ahora mismo es "${eventoActivo.nombre_evento}" por $${Number(eventoActivo.valor).toLocaleString("es-CO")}, no por $${precio.toLocaleString("es-CO")}. Los números marcados con un punto naranja pertenecen a ese evento.`
                            : `No hay ningún evento activo en esta tabla ahora mismo. Las celdas muestran su último estado real, pero no se pueden reservar hasta abrir un evento de $${precio.toLocaleString("es-CO")}.`}
                    </span>
                </div>

            )}

        </div>

    );

}

function EstadoMensaje({
    icon: Icon,
    titulo,
    descripcion,
    tono = "normal",
    animarIcono = false
}: {
    icon: typeof Loader2;
    titulo: string;
    descripcion: string;
    tono?: "normal" | "error";
    animarIcono?: boolean;
}) {

    return (

        <div className="flex flex-col items-center justify-center text-center py-12 sm:py-24 px-4 gap-3">
            <Icon
                size={32}
                className={`${tono === "error" ? "text-red-500" : "text-gray-400"} ${animarIcono ? "animate-spin" : ""}`}
            />
            <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
            <p className="text-gray-500 max-w-sm break-words">{descripcion}</p>
        </div>

    );

}
