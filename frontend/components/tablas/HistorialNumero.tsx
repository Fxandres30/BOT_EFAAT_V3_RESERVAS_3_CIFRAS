"use client";

import { History } from "lucide-react";

import type { EntradaHistorial } from "@/services/tablas/reservaManual";

const ACCION: Record<string, string> = {
    reservar: "Reserva",
    pagar: "Pago registrado",
    liberar: "Liberación",
    desbloquear: "Desbloqueo"
};

const RESULTADO: Record<string, string> = {
    ok: "text-emerald-700 bg-emerald-50",
    rechazado: "text-amber-800 bg-amber-50",
    error: "text-red-700 bg-red-50"
};

const formato = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });

// Historial del número (reservas_auditoria, solo lectura): quién, cuándo,
// desde dónde (bot o panel) y con qué resultado.
export default function HistorialNumero({ historial, disponible }: { historial: EntradaHistorial[]; disponible: boolean }) {

    return (

        <details className="border rounded-xl group" open={historial.length > 0 && historial.length <= 3}>

            <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <History size={14} /> Historial {historial.length > 0 && <span className="text-gray-400">({historial.length})</span>}
            </summary>

            <div className="px-3 pb-3">

                {!disponible ? (
                    <p className="text-sm text-gray-500">El historial de este número todavía no está disponible en tu cuenta.</p>
                ) : historial.length === 0 ? (
                    <p className="text-sm text-gray-500">Sin operaciones registradas todavía.</p>
                ) : (
                    <ol className="space-y-2">
                        {historial.map((h) => (
                            <li key={h.id} className="text-sm border-l-2 pl-3 py-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium text-gray-900">{ACCION[h.accion] || h.accion}</span>
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RESULTADO[h.resultado] || ""}`}>
                                        {h.resultado === "ok" ? "hecho" : h.resultado}{h.codigo ? ` · ${h.codigo}` : ""}
                                    </span>
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{h.origen === "bot" ? "automático" : "manual"}</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {formato.format(new Date(h.creadoEn))}
                                    {h.operador ? ` · ${h.operador}` : ""}
                                    {h.estadoAnterior || h.estadoNuevo ? ` · ${h.estadoAnterior || "?"} → ${h.estadoNuevo || "sin cambio"}` : ""}
                                </p>
                                {(h.contactoNombre || h.grupoNombre) && (
                                    <p className="text-xs text-gray-600">{[h.contactoNombre, h.grupoNombre].filter(Boolean).join(" · ")}</p>
                                )}
                                {h.metodoPago && <p className="text-xs text-gray-600">Método: {h.metodoPago}</p>}
                                {h.motivo && <p className="text-xs text-gray-600">Motivo: {h.motivo}</p>}
                                {h.observaciones && <p className="text-xs text-gray-600">Obs.: {h.observaciones}</p>}
                            </li>
                        ))}
                    </ol>
                )}

            </div>

        </details>

    );

}
