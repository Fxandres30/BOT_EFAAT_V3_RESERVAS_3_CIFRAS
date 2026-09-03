"use client";

import { Search } from "lucide-react";
import { FILTROS_ESTADO, type FiltroEstado } from "./estadoVisual";

interface Props {
    busqueda: string;
    onBusquedaChange: (valor: string) => void;
    filtro: FiltroEstado;
    onFiltroChange: (valor: FiltroEstado) => void;
}

export default function FiltrosBar({
    busqueda,
    onBusquedaChange,
    filtro,
    onFiltroChange
}: Props) {

    return (

        <div className="bg-white border rounded-2xl shadow-sm p-3 sm:p-4 flex flex-col md:flex-row md:items-center gap-3">

            <div className="relative w-full md:w-64 md:shrink-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    value={busqueda}
                    onChange={(e) => onBusquedaChange(e.target.value)}
                    placeholder="Buscar número, cliente, contacto o grupo..."
                    className="w-full pl-9 pr-3 py-2.5 md:py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>

            <div className="flex flex-wrap gap-2 min-w-0">

                {FILTROS_ESTADO.map((f) => (

                    <button
                        key={f.valor}
                        onClick={() => onFiltroChange(f.valor)}
                        className={`px-3 py-2 sm:py-1.5 rounded-full text-xs font-medium border transition ${
                            filtro === f.valor
                                ? "bg-gray-900 text-white border-gray-900"
                                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                    >
                        {f.label}
                    </button>

                ))}

            </div>

        </div>

    );

}
