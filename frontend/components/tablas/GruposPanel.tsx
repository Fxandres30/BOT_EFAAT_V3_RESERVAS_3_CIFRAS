"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import type { PaqueteReserva } from "./types";
import { ESTADOS_META } from "./estadoVisual";

interface Props {
    paquetes: PaqueteReserva[];
    precio: number;
}

export default function GruposPanel({ paquetes, precio }: Props) {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-4">
                <h2 className="text-lg font-bold text-gray-900">Grupos</h2>
                <span className="text-xs text-gray-400">
                    Números reservados juntos por un mismo cliente
                </span>
            </div>

            {paquetes.length === 0 ? (

                <p className="text-sm text-gray-500 py-6 text-center">
                    No hay reservas de varios números juntos todavía.
                </p>

            ) : (

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                    {paquetes.map((p) => {

                        const meta = p.estado !== "mixto" ? ESTADOS_META[p.estado] : null;

                        return (

                            <div key={p.id} className="min-w-0 border rounded-xl p-4">

                                <div className="flex items-start justify-between gap-2">

                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="h-8 w-8 shrink-0 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
                                            <Users size={15} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-gray-900 truncate" title={p.cliente || undefined}>
                                                {p.cliente || "Cliente sin nombre"}
                                            </p>
                                            <p className="text-xs text-gray-500 truncate">{p.contacto || "Sin contacto"}</p>
                                        </div>
                                    </div>

                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${
                                        meta ? meta.badge : "bg-gray-50 text-gray-600 border-gray-200"
                                    }`}>
                                        {meta ? meta.label : "Estados mixtos"}
                                    </span>

                                </div>

                                <p className="text-sm text-gray-600 mt-3">
                                    {p.numeros.length} números
                                </p>

                                <NumerosChips numeros={p.numeros} />

                                <p className="text-sm font-medium text-gray-900 mt-2">
                                    Total: ${(p.numeros.length * precio).toLocaleString("es-CO")}
                                </p>

                                {p.grupoWhatsApp && (
                                    <p className="text-xs text-gray-400 mt-1 truncate" title={p.grupoWhatsApp}>
                                        Grupo de WhatsApp: {p.grupoWhatsApp}
                                    </p>
                                )}

                                <p className="text-xs text-gray-400 mt-1">
                                    {p.fechaReserva} {p.horaReserva}
                                </p>

                            </div>

                        );

                    })}

                </div>

            )}

        </section>

    );

}

function NumerosChips({ numeros }: { numeros: string[] }) {

    const [expandido, setExpandido] = useState(false);

    const limite = 10;
    const visibles = expandido ? numeros : numeros.slice(0, limite);
    const restantes = numeros.length - limite;

    return (

        <div className="flex flex-wrap gap-1 mt-1.5">

            {visibles.map((n) => (
                <span key={n} className="text-xs font-medium bg-gray-100 text-gray-700 rounded-md px-1.5 py-0.5">
                    {n}
                </span>
            ))}

            {!expandido && restantes > 0 && (
                <button
                    onClick={() => setExpandido(true)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 px-1.5 py-0.5"
                >
                    +{restantes} más
                </button>
            )}

            {expandido && numeros.length > limite && (
                <button
                    onClick={() => setExpandido(false)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-700 px-1.5 py-0.5"
                >
                    Ver menos
                </button>
            )}

        </div>

    );

}
