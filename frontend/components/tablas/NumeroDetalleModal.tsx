"use client";

import { useState } from "react";
import { X, Users, DollarSign, Lock, Unlock, CircleDot } from "lucide-react";

import type { NumeroReserva, PaqueteReserva } from "./types";
import { ESTADOS_META, estadoEfectivo } from "./estadoVisual";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
    numero: NumeroReserva | null;
    paquete: PaqueteReserva | null;
    accionando: string | null;
    onClose: () => void;
    onMarcarPagado: (numero: string) => void;
    onLiberar: (numero: string) => void;
    onBloquear: (numero: string, motivo?: string) => void;
    onMarcarEnProceso: (numero: string, minutos?: number) => void;
}

export default function NumeroDetalleModal({
    numero,
    paquete,
    accionando,
    onClose,
    onMarcarPagado,
    onLiberar,
    onBloquear,
    onMarcarEnProceso
}: Props) {

    const [confirmandoLiberar, setConfirmandoLiberar] = useState(false);

    if (!numero) return null;

    const estado = estadoEfectivo(numero);
    const meta = ESTADOS_META[estado];
    const Icon = meta.icon;
    const procesando = accionando === numero.numero;

    return (

        <div
            className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
            onClick={onClose}
        >

            <div
                className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85dvh]"
                onClick={(e) => e.stopPropagation()}
            >

                <div className="sm:hidden flex justify-center pt-2 shrink-0">
                    <span className="h-1.5 w-12 rounded-full bg-black/10" />
                </div>

                <div className={`shrink-0 p-4 sm:p-5 flex items-center justify-between ${meta.card}`}>

                    <div className="min-w-0">
                        <p className="text-xs opacity-80">Número</p>
                        <h2 className="text-2xl sm:text-3xl font-bold">{numero.numero}</h2>
                        <span className="inline-flex items-center gap-1 text-xs font-medium mt-1 bg-white/20 px-2 py-0.5 rounded-full">
                            <Icon size={12} />
                            {meta.label}
                        </span>
                    </div>

                    <button
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="text-white/80 hover:text-white p-2 -m-2 rounded-full shrink-0"
                    >
                        <X size={20} />
                    </button>

                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-1">

                    <Dato etiqueta="Cliente" valor={numero.comprador || numero.nombre} />
                    <Dato etiqueta="Contacto" valor={numero.contacto || numero.telefono} />
                    <Dato etiqueta="Grupo de WhatsApp" valor={numero.grupo_nombre} />

                    {paquete && paquete.numeros.length > 1 && (
                        <div className="flex justify-between text-sm border-b pb-2 pt-2">
                            <span className="text-gray-500 flex items-center gap-1 shrink-0">
                                <Users size={13} /> Reservado junto con
                            </span>
                            <span className="font-medium text-right min-w-0 break-words">
                                {paquete.numeros.filter(n => n !== numero.numero).join(", ")}
                            </span>
                        </div>
                    )}

                    <Dato etiqueta="Evento" valor={numero.nombre_evento} />
                    <Dato etiqueta="Fecha de reserva" valor={numero.fecha_reserva} />
                    <Dato etiqueta="Hora de reserva" valor={numero.hora_reserva} />
                    <Dato etiqueta="Fecha de pago" valor={numero.fecha_pago} />
                    <Dato etiqueta="Hora de pago" valor={numero.hora_pago} />

                    {estado === "en_proceso" && (
                        <Dato etiqueta="En proceso hasta" valor={
                            numero.bloqueado_hasta
                                ? new Date(numero.bloqueado_hasta).toLocaleString("es-CO")
                                : null
                        } />
                    )}

                    {estado === "bloqueado" && (
                        <Dato etiqueta="Motivo del bloqueo" valor={numero.temporal_por} />
                    )}

                    <Dato etiqueta="Método de pago" valor={null} nota="No disponible todavía en el backend" />
                    <Dato etiqueta="Observaciones" valor={null} nota="No disponible todavía en el backend" />

                </div>

                <div className="shrink-0 p-4 sm:p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-5 border-t bg-gray-50 flex flex-col sm:flex-row sm:flex-wrap gap-2">

                    {estado === "reservado" && (
                        <BotonAccion
                            icon={DollarSign}
                            texto="Marcar pagado"
                            color="bg-red-600 hover:bg-red-700"
                            cargando={procesando}
                            onClick={() => onMarcarPagado(numero.numero)}
                        />
                    )}

                    {estado === "libre" && (
                        <>
                            <BotonAccion
                                icon={CircleDot}
                                texto="Poner en proceso"
                                color="bg-sky-600 hover:bg-sky-700"
                                cargando={procesando}
                                onClick={() => onMarcarEnProceso(numero.numero)}
                            />
                            <BotonAccion
                                icon={Lock}
                                texto="Bloquear"
                                color="bg-slate-700 hover:bg-slate-800"
                                cargando={procesando}
                                onClick={() => onBloquear(numero.numero)}
                            />
                        </>
                    )}

                    {(estado === "reservado" || estado === "pagado" || estado === "en_proceso" || estado === "bloqueado") && (
                        <BotonAccion
                            icon={Unlock}
                            texto={estado === "pagado" ? "Cancelar reserva" : "Liberar número"}
                            color="bg-gray-800 hover:bg-black"
                            cargando={procesando}
                            onClick={() => setConfirmandoLiberar(true)}
                        />
                    )}

                </div>

            </div>

            <ConfirmDialog
                abierto={confirmandoLiberar}
                titulo={`¿Liberar el número ${numero.numero}?`}
                descripcion="Esto borra el cliente, contacto, grupo y fechas de esta reserva y deja el número disponible otra vez. No se puede deshacer."
                detalle={numero.comprador ? `Cliente actual: ${numero.comprador}` : undefined}
                textoConfirmar="Sí, liberar"
                cargando={procesando}
                onConfirmar={() => {
                    onLiberar(numero.numero);
                    setConfirmandoLiberar(false);
                }}
                onCancelar={() => setConfirmandoLiberar(false)}
            />

        </div>

    );

}

function Dato({
    etiqueta,
    valor,
    nota
}: {
    etiqueta: string;
    valor: string | null | undefined;
    nota?: string;
}) {

    return (

        <div className="flex justify-between items-start text-sm border-b pb-2 pt-2 gap-4">
            <span className="text-gray-500 shrink-0">{etiqueta}</span>
            <span className={`font-medium text-right min-w-0 break-words ${!valor ? "text-gray-400 italic" : ""}`}>
                {valor || nota || "—"}
            </span>
        </div>

    );

}

function BotonAccion({
    icon: Icon,
    texto,
    color,
    cargando,
    onClick
}: {
    icon: typeof DollarSign;
    texto: string;
    color: string;
    cargando: boolean;
    onClick: () => void;
}) {

    return (

        <button
            onClick={onClick}
            disabled={cargando}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 text-white text-sm px-4 py-2.5 rounded-xl disabled:opacity-50 ${color}`}
        >
            <Icon size={15} />
            {cargando ? "Procesando..." : texto}
        </button>

    );

}
