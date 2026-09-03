"use client";

import { DollarSign, Unlock } from "lucide-react";

import type { NumeroReserva } from "./types";
import { ESTADOS_META, estadoEfectivo } from "./estadoVisual";

interface Props {
    precio: number;
    numeros: NumeroReserva[];
    accionando: string | null;
    onMarcarPagado: (numero: string) => void;
    onLiberar: (numero: string) => void;
}

export default function ReservasRecientes({
    precio,
    numeros,
    accionando,
    onMarcarPagado,
    onLiberar
}: Props) {

    function confirmarLiberar(numero: string, cliente: string | null) {

        const detalle = cliente ? ` (cliente: ${cliente})` : "";

        if (confirm(`¿Liberar el número ${numero}${detalle}? Esta acción borra la reserva y no se puede deshacer.`)) {
            onLiberar(numero);
        }

    }

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5">

            <h2 className="text-lg font-bold text-gray-900 mb-4">Reservas recientes</h2>

            {numeros.length === 0 ? (

                <p className="text-sm text-gray-500 py-6 text-center">
                    Todavía no hay reservas registradas en esta tabla.
                </p>

            ) : (

                <>

                    {/* Desktop / tablet ancha: tabla. Nunca puede empujar la página —
                        cualquier scroll queda contenido dentro de este contenedor. */}
                    <div className="hidden lg:block overflow-x-auto -mx-5">
                        <table className="w-full text-sm min-w-[720px]">

                            <thead>
                                <tr className="text-left text-gray-500 border-b">
                                    <th className="px-5 py-2 font-medium">Número</th>
                                    <th className="px-5 py-2 font-medium">Cliente</th>
                                    <th className="px-5 py-2 font-medium">Grupo</th>
                                    <th className="px-5 py-2 font-medium">Precio</th>
                                    <th className="px-5 py-2 font-medium">Estado</th>
                                    <th className="px-5 py-2 font-medium">Fecha / hora</th>
                                    <th className="px-5 py-2 font-medium">Pago</th>
                                    <th className="px-5 py-2 font-medium">Acciones</th>
                                </tr>
                            </thead>

                            <tbody>
                                {numeros.map((n) => {

                                    const estado = estadoEfectivo(n);
                                    const meta = ESTADOS_META[estado];
                                    const procesando = accionando === n.numero;

                                    return (

                                        <tr key={n.id} className="border-b last:border-0 hover:bg-gray-50">
                                            <td className="px-5 py-2.5 font-bold">{n.numero}</td>
                                            <td className="px-5 py-2.5 max-w-[160px] truncate">{n.comprador || "—"}</td>
                                            <td className="px-5 py-2.5 text-gray-500 max-w-[140px] truncate">{n.grupo_nombre || "—"}</td>
                                            <td className="px-5 py-2.5 whitespace-nowrap">${precio.toLocaleString("es-CO")}</td>
                                            <td className="px-5 py-2.5">
                                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.badge}`}>
                                                    {meta.label}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                                                {n.fecha_reserva} {n.hora_reserva}
                                            </td>
                                            <td className="px-5 py-2.5 whitespace-nowrap">{n.fecha_pago ? "Pagado" : "Pendiente"}</td>
                                            <td className="px-5 py-2.5">
                                                <div className="flex gap-3">
                                                    {estado === "reservado" && (
                                                        <button
                                                            disabled={procesando}
                                                            onClick={() => onMarcarPagado(n.numero)}
                                                            className="text-red-600 hover:text-red-800 disabled:opacity-50"
                                                            aria-label="Marcar pagado"
                                                            title="Marcar pagado"
                                                        >
                                                            <DollarSign size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        disabled={procesando}
                                                        onClick={() => confirmarLiberar(n.numero, n.comprador)}
                                                        className="text-gray-500 hover:text-gray-800 disabled:opacity-50"
                                                        aria-label="Liberar número"
                                                        title="Liberar número"
                                                    >
                                                        <Unlock size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                    );

                                })}
                            </tbody>

                        </table>
                    </div>

                    {/* Mobile / tablet angosta: cada reserva como card vertical. */}
                    <div className="lg:hidden space-y-3">

                        {numeros.map((n) => {

                            const estado = estadoEfectivo(n);
                            const meta = ESTADOS_META[estado];
                            const procesando = accionando === n.numero;

                            return (

                                <div key={n.id} className="border rounded-xl p-4">

                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-lg font-bold text-gray-900 leading-none">
                                                Número {n.numero}
                                            </p>
                                            <p className="text-sm text-gray-500 mt-1 truncate">
                                                {n.comprador || "Sin cliente"}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}>
                                            {meta.label}
                                        </span>
                                    </div>

                                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm mt-3">
                                        <CampoCard etiqueta="Grupo" valor={n.grupo_nombre} />
                                        <CampoCard etiqueta="Precio" valor={`$${precio.toLocaleString("es-CO")}`} />
                                        <CampoCard etiqueta="Fecha" valor={n.fecha_reserva ? `${n.fecha_reserva} ${n.hora_reserva || ""}` : null} />
                                        <CampoCard etiqueta="Pago" valor={n.fecha_pago ? "Pagado" : "Pendiente"} />
                                    </dl>

                                    <div className="flex flex-col sm:flex-row gap-2 mt-3">
                                        {estado === "reservado" && (
                                            <button
                                                disabled={procesando}
                                                onClick={() => onMarcarPagado(n.numero)}
                                                className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-lg px-3 py-2"
                                            >
                                                <DollarSign size={14} />
                                                Marcar pagado
                                            </button>
                                        )}
                                        <button
                                            disabled={procesando}
                                            onClick={() => confirmarLiberar(n.numero, n.comprador)}
                                            className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg px-3 py-2"
                                        >
                                            <Unlock size={14} />
                                            Liberar
                                        </button>
                                    </div>

                                </div>

                            );

                        })}

                    </div>

                </>

            )}

        </section>

    );

}

function CampoCard({
    etiqueta,
    valor
}: {
    etiqueta: string;
    valor: string | null | undefined;
}) {

    return (

        <div className="min-w-0">
            <dt className="text-gray-400 text-xs">{etiqueta}</dt>
            <dd className="font-medium text-gray-800 truncate">{valor || "—"}</dd>
        </div>

    );

}
