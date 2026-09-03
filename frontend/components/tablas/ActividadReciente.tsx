import { History, DollarSign, Unlock, Lock, Ban, Users, RotateCcw, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ActividadReserva, TipoActividad } from "./types";

const ICONOS: Record<TipoActividad, LucideIcon> = {
    reservado: Clock,
    pagado: DollarSign,
    liberado: Unlock,
    bloqueado: Lock,
    cancelado: Ban,
    grupo_creado: Users,
    grupo_modificado: Users,
    tabla_reiniciada: RotateCcw
};

const TEXTOS: Record<TipoActividad, string> = {
    reservado: "Número reservado",
    pagado: "Pago registrado",
    liberado: "Número liberado",
    bloqueado: "Número bloqueado",
    cancelado: "Reserva cancelada",
    grupo_creado: "Grupo creado",
    grupo_modificado: "Grupo modificado",
    tabla_reiniciada: "Tabla reiniciada"
};

interface Props {
    actividad: ActividadReserva[];
}

export default function ActividadReciente({ actividad }: Props) {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 min-w-0">

            <h2 className="text-lg font-bold text-gray-900 mb-4">Actividad reciente</h2>

            {actividad.length === 0 ? (

                <div className="text-sm text-gray-500 py-6 text-center flex flex-col items-center gap-2">
                    <History size={22} className="text-gray-300" />
                    Todavía no hay actividad registrada en esta tabla.
                </div>

            ) : (

                <ul className="space-y-3">

                    {actividad.map((evento) => {

                        const Icon = ICONOS[evento.tipo] || History;
                        const numeroTexto = evento.numero ? `Número ${evento.numero}` : "";
                        const comprador = (evento.detalle?.comprador as string) || null;

                        return (

                            <li key={evento.id} className="flex items-start gap-3 text-sm">

                                <span className="mt-0.5 h-7 w-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center shrink-0">
                                    <Icon size={13} />
                                </span>

                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-800 break-words">
                                        <span className="font-medium">{TEXTOS[evento.tipo] || evento.tipo}</span>
                                        {numeroTexto && <> · {numeroTexto}</>}
                                        {comprador && <> · {comprador}</>}
                                    </p>
                                    <p className="text-xs text-gray-400 break-words">
                                        {new Date(evento.creado_en).toLocaleString("es-CO")}
                                        {evento.realizado_por ? ` · ${evento.realizado_por}` : ""}
                                    </p>
                                </div>

                            </li>

                        );

                    })}

                </ul>

            )}

        </section>

    );

}
