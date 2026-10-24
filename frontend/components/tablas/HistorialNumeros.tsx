"use client";

import { useMemo, useState } from "react";
import { ChevronRight, History, Info, Search, X } from "lucide-react";

import BotonContraer from "./BotonContraer";
import AccionesNumero from "./AccionesNumero";
import type { AccionRapida } from "@/services/tablas/pagoLote";
import { ESTADOS_META_VISUAL, ESTADO_INTERNO_META, bucketEstado } from "./estadoVisual";
import {
    FILTROS_HISTORIAL_VACIOS,
    etiquetaReserva,
    filtrarHistorial,
    gruposDelHistorial,
    hayFiltrosActivos,
    type EventoHistorial,
    type FilaHistorial,
    type FiltroEstadoHistorial,
    type FiltrosHistorial,
    type FuenteEvento
} from "./historialDatos";
import type { EstadoNumero } from "./types";

interface Props {
    filas: FilaHistorial[];
    auditoriaDisponible: boolean;
    // Estado compartido con la cuadrícula (vive en TablaPrecioView): este es
    // el único buscador del panel.
    filtros: FiltrosHistorial;
    onFiltrosChange: (filtros: FiltrosHistorial) => void;
    expandido: boolean;
    onToggleExpandido: () => void;
    /** Acciones rápidas por número (etiqueta de estado). Ausente = sin ellas. */
    onAccion?: (numero: string, accion: AccionRapida) => void;
    /** Hay una operación en curso: las acciones rápidas esperan. */
    ocupado?: boolean;
    /** Modo «Seleccionar» (compartido con la cuadrícula): null = inactivo. */
    seleccion?: Set<string> | null;
    onAlternarSeleccion?: (numero: string) => void;
}

const POR_PAGINA = 30;

const ESTADOS_FILTRO: EstadoNumero[] = ["reservado", "en_proceso", "bloqueado", "pagado", "libre"];

const FUENTE: Record<FuenteEvento, { label: string; clase: string }> = {
    auditoria: { label: "auditoría", clase: "bg-blue-50 text-blue-700" },
    actividad: { label: "actividad registrada", clase: "bg-gray-100 text-gray-600" },
    archivo: { label: "archivo de reinicio", clase: "bg-violet-50 text-violet-700" }
};

const RESULTADO: Record<EventoHistorial["resultado"], string> = {
    ok: "",
    rechazado: "text-amber-800 bg-amber-50",
    error: "text-red-700 bg-red-50"
};

const formato = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });

// "2026-10-22" + "14:05:09" -> "2026-10-22 14:05" (hora de Colombia, tal
// como la guardó el bot o el panel).
function fechaHora(v: { fecha: string; hora: string | null } | null) {
    if (!v) return null;
    return v.hora ? `${v.fecha} ${v.hora.slice(0, 5)}` : v.fecha;
}

const etiquetaEstado = (e: string | null) => (e ? ESTADO_INTERNO_META[e as EstadoNumero]?.label || e : "?");

function EstadoBadge({ estado }: { estado: EstadoNumero }) {
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${ESTADOS_META_VISUAL[bucketEstado(estado)].badge}`}>
            {ESTADO_INTERNO_META[estado].label}
        </span>
    );
}

const sinDato = <span className="text-gray-400">—</span>;

export default function HistorialNumeros({ filas, auditoriaDisponible, filtros, onFiltrosChange, expandido, onToggleExpandido, onAccion, ocupado = false, seleccion = null, onAlternarSeleccion }: Props) {

    const [visibles, setVisibles] = useState(POR_PAGINA);
    const [abierto, setAbierto] = useState<string | null>(null);

    const grupos = useMemo(() => gruposDelHistorial(filas), [filas]);
    const filtradas = useMemo(() => filtrarHistorial(filas, filtros), [filas, filtros]);
    const hayFiltros = hayFiltrosActivos(filtros);

    function cambiar(parcial: Partial<FiltrosHistorial>) {
        onFiltrosChange({ ...filtros, ...parcial });
        setVisibles(POR_PAGINA);
    }

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 min-w-0">

            <div className={`flex items-center justify-between gap-2 ${expandido ? "mb-4" : ""}`}>
                <h2 className="text-lg font-bold text-gray-900">
                    Historial de números
                    {filas.length > 0 && <span className="ml-2 text-sm font-normal text-gray-400">({filas.length})</span>}
                </h2>
                <BotonContraer expandido={expandido} seccion="historial de números" onToggle={onToggleExpandido} />
            </div>

            {!expandido ? null : (

                <>

                    <p className="flex items-start gap-2 text-xs text-gray-500 mb-4">
                        <Info size={14} className="shrink-0 mt-0.5" />
                        <span>
                            El <strong>estado actual</strong> es el de la tabla ahora mismo. Los <strong>movimientos</strong> son
                            solo los que quedaron registrados.
                            {!auditoriaDisponible && " La auditoría de operaciones aún no está activada en la base: se muestra la actividad registrada y el archivo de reinicios."}
                        </span>
                    </p>

                    <label className="relative block min-w-0 mb-2">
                        <span className="sr-only">Buscar por número, nombre o contacto</span>
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={filtros.texto}
                            onChange={(e) => cambiar({ texto: e.target.value })}
                            placeholder="Buscar número (07 o 7), nombre o teléfono/contacto"
                            className="w-full h-11 pl-9 pr-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                    </label>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] mb-2">

                        <select
                            aria-label="Filtrar por estado actual"
                            value={filtros.estado}
                            onChange={(e) => cambiar({ estado: e.target.value as FiltroEstadoHistorial })}
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white min-w-0"
                        >
                            <option value="todos">Estado actual: todos</option>
                            {ESTADOS_FILTRO.map((e) => <option key={e} value={e}>{ESTADO_INTERNO_META[e].label}</option>)}
                        </select>

                        <select
                            aria-label="Filtrar por grupo de WhatsApp"
                            value={filtros.grupo}
                            onChange={(e) => cambiar({ grupo: e.target.value })}
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white min-w-0"
                            disabled={grupos.length === 0}
                        >
                            <option value="">Todos los grupos</option>
                            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>

                        <input
                            type="date"
                            aria-label="Filtrar por fecha"
                            value={filtros.fecha}
                            onChange={(e) => cambiar({ fecha: e.target.value })}
                            className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white min-w-0"
                        />

                        {hayFiltros ? (
                            <button
                                type="button"
                                onClick={() => cambiar(FILTROS_HISTORIAL_VACIOS)}
                                className="h-10 px-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1"
                            >
                                <X size={14} /> Limpiar
                            </button>
                        ) : <span className="hidden lg:block" />}

                    </div>

                    <p className="text-xs text-gray-500 mb-4">
                        La búsqueda y los filtros se aplican también a la cuadrícula.
                        {filtros.estado !== "todos" && " El estado filtra por el estado actual: los números que tuvieron ese estado antes siguen visibles con «Estado actual: todos», y cada número conserva todos sus movimientos."}
                    </p>

                    {filas.length === 0 ? (

                        <div className="text-sm text-gray-500 py-6 text-center flex flex-col items-center gap-2">
                            <History size={22} className="text-gray-300" />
                            Todavía no hay números con reservas ni movimientos registrados en esta tabla.
                        </div>

                    ) : filtradas.length === 0 ? (

                        <p className="text-sm text-gray-500 py-6 text-center">Ningún número coincide con la búsqueda o los filtros.</p>

                    ) : (

                        <>

                            <ul className="divide-y border rounded-xl">
                                {filtradas.slice(0, visibles).map((fila) => (
                                    <FilaNumero
                                        key={fila.numero}
                                        fila={fila}
                                        abierta={abierto === fila.numero}
                                        onAlternar={() => setAbierto(abierto === fila.numero ? null : fila.numero)}
                                        onAccion={onAccion}
                                        ocupado={ocupado}
                                        seleccionado={seleccion && onAlternarSeleccion ? seleccion.has(fila.numero) : undefined}
                                        onAlternarSeleccion={onAlternarSeleccion}
                                    />
                                ))}
                            </ul>

                            <div className="flex items-center justify-between gap-2 mt-3 text-xs text-gray-500">
                                <span>{Math.min(visibles, filtradas.length)} de {filtradas.length} números</span>
                                {visibles < filtradas.length && (
                                    <button
                                        type="button"
                                        onClick={() => setVisibles((v) => v + POR_PAGINA)}
                                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                                    >
                                        Ver más
                                    </button>
                                )}
                            </div>

                        </>

                    )}

                </>

            )}

        </section>

    );

}

function FilaNumero({ fila, abierta, onAlternar, onAccion, ocupado, seleccionado, onAlternarSeleccion }: {
    fila: FilaHistorial;
    abierta: boolean;
    onAlternar: () => void;
    onAccion?: Props["onAccion"];
    ocupado: boolean;
    /** undefined = no se está seleccionando. */
    seleccionado?: boolean;
    onAlternarSeleccion?: (numero: string) => void;
}) {

    const idDetalle = `historial-${fila.numero}`;

    return (

        <li className="min-w-0">

            {/* Tres controles separados (nunca anidados): marcar en la
                selección, expandir la fila y las acciones de su estado. */}
            <div className={`flex items-center min-w-0 pr-2 ${seleccionado ? "bg-indigo-50/60" : ""}`}>

                {seleccionado !== undefined && (
                    <label className="pl-3 py-2.5 flex items-center shrink-0 cursor-pointer">
                        <span className="sr-only">Seleccionar el número {fila.numero}</span>
                        <input
                            type="checkbox"
                            checked={seleccionado}
                            onChange={() => onAlternarSeleccion?.(fila.numero)}
                            className="h-4 w-4 accent-indigo-600"
                        />
                    </label>
                )}

                <button
                    type="button"
                    onClick={onAlternar}
                    aria-expanded={abierta}
                    aria-controls={idDetalle}
                    className="flex-1 text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 min-w-0"
                >
                    <ChevronRight size={15} className={`shrink-0 text-gray-400 transition-transform ${abierta ? "rotate-90" : ""}`} />
                    <span className="font-mono font-bold text-gray-900 w-10 shrink-0">{fila.numero}</span>
                    {!onAccion && <EstadoBadge estado={fila.estado} />}
                    <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">
                        {[fila.cliente, fila.contacto, fila.grupo].filter(Boolean).join(" · ") || <span className="text-gray-400">Sin reserva actual</span>}
                    </span>
                    <span className="hidden sm:block text-xs text-gray-500 shrink-0">{etiquetaReserva(fila.reserva) || ""}</span>
                    <span className="text-xs text-gray-400 shrink-0">{fila.eventos.length} mov.</span>
                </button>

                {onAccion && (
                    <AccionesNumero
                        numero={fila.numero}
                        estado={fila.estado}
                        deshabilitado={ocupado}
                        onAccion={(accion) => onAccion(fila.numero, accion)}
                    />
                )}

            </div>

            {abierta && (

                <div id={idDetalle} className="px-3 pb-4 pt-1 sm:pl-12 grid gap-4 lg:grid-cols-2 min-w-0">

                    <div className="min-w-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Estado actual</h3>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                            <dt className="text-gray-500">Estado</dt><dd><EstadoBadge estado={fila.estado} /></dd>
                            <dt className="text-gray-500">Cliente</dt><dd className="break-words">{fila.cliente || sinDato}</dd>
                            <dt className="text-gray-500">Contacto</dt><dd className="break-words">{fila.contacto || sinDato}</dd>
                            <dt className="text-gray-500">Grupo</dt><dd className="break-words">{fila.grupo || sinDato}</dd>
                            <dt className="text-gray-500">Sorteo</dt><dd className="break-words">{fila.sorteo || sinDato}</dd>
                            <dt className="text-gray-500">Reservado</dt><dd>{fechaHora(fila.reserva) || sinDato}</dd>
                            <dt className="text-gray-500">Pagado</dt><dd>{fechaHora(fila.pago) || sinDato}</dd>
                        </dl>
                    </div>

                    <div className="min-w-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Movimientos registrados</h3>
                        {fila.eventos.length === 0 ? (
                            <p className="text-sm text-gray-500">No hay movimientos registrados para este número.</p>
                        ) : (
                            <ol className="space-y-2">
                                {fila.eventos.map((e) => <Movimiento key={e.id} evento={e} />)}
                            </ol>
                        )}
                    </div>

                </div>

            )}

        </li>

    );

}

function Movimiento({ evento: e }: { evento: EventoHistorial }) {

    return (

        <li className="text-sm border-l-2 pl-3 py-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-gray-900">{e.titulo}</span>
                {e.resultado !== "ok" && (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RESULTADO[e.resultado]}`}>{e.resultado}</span>
                )}
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${FUENTE[e.fuente].clase}`}>{FUENTE[e.fuente].label}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 break-words">
                {formato.format(new Date(e.en))}
                {e.origen ? ` · ${e.origen}` : ""}
                {e.estadoAnterior || e.estadoNuevo ? ` · ${etiquetaEstado(e.estadoAnterior)} → ${e.estadoNuevo ? etiquetaEstado(e.estadoNuevo) : "sin cambio"}` : ""}
            </p>
            {(e.cliente || e.contacto || e.grupo) && (
                <p className="text-xs text-gray-600 break-words">{[e.cliente, e.contacto, e.grupo].filter(Boolean).join(" · ")}</p>
            )}
            {e.detalles.map((d) => <p key={d} className="text-xs text-gray-600 break-words">{d}</p>)}
        </li>

    );

}
