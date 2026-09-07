"use client";

import { Search, X } from "lucide-react";
import { FILTROS_ESTADO, type FiltroEstado } from "./estadoVisual";

interface ConteoFiltros {
    todos: number;
    libre: number;
    reservado: number;
    pagado: number;
}

interface Props {
    busqueda: string;
    onBusquedaChange: (valor: string) => void;
    filtro: FiltroEstado;
    onFiltroChange: (valor: FiltroEstado) => void;
    conteos: ConteoFiltros;
}

export default function FiltrosBar({
    busqueda,
    onBusquedaChange,
    filtro,
    onFiltroChange,
    conteos
}: Props) {

    return (

        <div className="bg-white border rounded-2xl shadow-sm p-3 sm:p-4 flex flex-col md:flex-row md:items-center gap-3">

            <div className="relative w-full md:w-80 md:shrink-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    value={busqueda}
                    onChange={(e) => onBusquedaChange(e.target.value)}
                    placeholder="Buscar número, cliente o contacto..."
                    className="w-full pl-9 pr-8 py-2.5 md:py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {busqueda && (
                    <button
                        onClick={() => onBusquedaChange("")}
                        aria-label="Limpiar búsqueda"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="flex flex-wrap gap-1.5 min-w-0">

                {FILTROS_ESTADO.map((f) => {

                    const activo = filtro === f.valor;
                    const total = conteos[f.valor];

                    return (

                        <button
                            key={f.valor}
                            onClick={() => onFiltroChange(f.valor)}
                            className={`px-3 py-2 sm:py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
                                activo
                                    ? "bg-gray-900 text-white border-gray-900"
                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                            }`}
                        >
                            {f.label}
                            <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                                activo ? "bg-white/20" : "bg-gray-100 text-gray-500"
                            }`}>
                                {total}
                            </span>
                        </button>

                    );

                })}

            </div>

        </div>

    );

}
