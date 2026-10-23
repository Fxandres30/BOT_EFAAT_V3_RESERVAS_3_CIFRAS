"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Users, DollarSign, Unlock, Loader2, RotateCcw, CheckCircle2 } from "lucide-react";

import type { NumeroReserva, PaqueteReserva } from "./types";
import { ESTADOS_META_VISUAL, estadoVisualSimplificado } from "./estadoVisual";
import ReservaManualForm, { Aviso } from "./ReservaManualForm";
import HistorialNumero from "./HistorialNumero";
import {
    nuevaSolicitudId,
    obtenerContextoNumero,
    type ContextoNumero,
    type DatosLiberar,
    type DatosPago,
    type DatosReserva,
    type EstadoReal,
    type Resultado
} from "@/services/tablas/reservaManual";

interface Props {
    precio: number;
    numero: NumeroReserva | null;
    paquete: PaqueteReserva | null;
    accionando: string | null;
    onClose: () => void;
    onReservar: (numero: string, datos: DatosReserva) => Promise<Resultado>;
    onMarcarPagado: (numero: string, datos?: DatosPago) => Promise<Resultado>;
    onLiberar: (numero: string, datos?: DatosLiberar) => Promise<Resultado>;
}

const ETIQUETA_ESTADO: Record<EstadoReal, string> = {
    libre: "Disponible",
    reservado: "Reservado · pendiente de pago",
    pagado: "Pagado",
    bloqueado: "Bloqueado",
    en_proceso: "En proceso (retención temporal)",
    en_proceso_vencido: "Retención vencida"
};

const METODOS_PAGO = ["Efectivo", "Nequi", "Daviplata", "Transferencia bancaria", "Otro"];

// Ventana de un número. El estado, las acciones permitidas, el sorteo, los
// grupos y el historial salen del SERVIDOR (GET /api/tablas/numero), no de la
// fila que tiene la cuadrícula: así la acción que se ofrece corresponde al
// estado real en el momento de abrirla. Todas las acciones pasan por el
// backend (mismas reglas que el bot, auditoría con el operador del token).
export default function NumeroDetalleModal(props: Props) {

    if (!props.numero) return null;

    // Un componente por número: al cambiar de número se reinicia todo.
    return <DetalleNumero key={props.numero.numero} {...props} numero={props.numero} />;

}

function DetalleNumero({
    precio,
    numero,
    paquete,
    accionando,
    onClose,
    onReservar,
    onMarcarPagado,
    onLiberar
}: Props & { numero: NumeroReserva }) {

    const [contexto, setContexto] = useState<ContextoNumero | null>(null);
    const [errorCarga, setErrorCarga] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

    const cargar = useCallback(async () => {
        const r = await obtenerContextoNumero(precio, numero.numero);
        if (r.ok) { setContexto(r); setErrorCarga(null); }
        else setErrorCarga(r.mensaje);
        setCargando(false);
    }, [precio, numero.numero]);

    useEffect(() => {
        let vivo = true;
        obtenerContextoNumero(precio, numero.numero).then((r) => {
            if (!vivo) return;
            if (r.ok) setContexto(r);
            else setErrorCarga(r.mensaje);
            setCargando(false);
        });
        return () => { vivo = false; };
    }, [precio, numero.numero]);

    // El formulario de reserva muestra su propio error (con reintento).
    async function tras(r: Resultado, textoOk: string, errorEnFormulario = false) {
        if (r.ok) setAviso({ tipo: "ok", texto: r.idempotente ? `${textoOk} (ya estaba registrado).` : textoOk });
        // Si el número dejó de estar libre, el formulario desaparece: el aviso va arriba.
        else setAviso(errorEnFormulario && r.motivo !== "no_disponible" ? null : { tipo: "error", texto: r.mensaje });
        setCargando(true);
        await cargar();
        return r;
    }

    const meta = ESTADOS_META_VISUAL[estadoVisualSimplificado(numero)];
    const Icon = meta.icon;
    const procesando = accionando === numero.numero;
    const estado = contexto?.estado;

    return (

        <div
            className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
            onClick={onClose}
        >

            <div
                className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88dvh]"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Número ${numero.numero}`}
            >

                <div className="sm:hidden flex justify-center pt-2 shrink-0">
                    <span className="h-1.5 w-12 rounded-full bg-black/10" />
                </div>

                <div className={`shrink-0 p-4 sm:p-5 flex items-center justify-between ${meta.card}`}>

                    <div className="min-w-0">
                        <p className="text-xs opacity-80">Número · ${precio.toLocaleString("es-CO")}</p>
                        <h2 className="text-2xl sm:text-3xl font-bold">{numero.numero}</h2>
                        <span className="inline-flex items-center gap-1 text-xs font-medium mt-1 bg-white/20 px-2 py-0.5 rounded-full">
                            <Icon size={12} />
                            {estado ? ETIQUETA_ESTADO[estado] : meta.label}
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

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">

                    {aviso && (
                        aviso.tipo === "ok" ? (
                            <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3">
                                <CheckCircle2 size={16} className="shrink-0" /> {aviso.texto}
                            </div>
                        ) : <Aviso>{aviso.texto}</Aviso>
                    )}

                    {cargando && !contexto ? (

                        <div className="py-10 flex flex-col items-center gap-2 text-sm text-gray-500">
                            <Loader2 size={20} className="animate-spin" />
                            Consultando el estado real del número...
                        </div>

                    ) : !contexto ? (

                        <div className="space-y-3">
                            <Aviso>{errorCarga || "No se pudo cargar el número."}</Aviso>
                            <button
                                type="button"
                                onClick={() => { setCargando(true); cargar(); }}
                                className="w-full flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-xl border hover:bg-gray-50"
                            >
                                <RotateCcw size={15} /> Reintentar
                            </button>
                        </div>

                    ) : contexto.estado === "libre" ? (

                        <ReservaManualForm
                            contexto={contexto}
                            onReservar={(datos) => onReservar(numero.numero, datos).then(r => tras(r, "Reserva registrada", true))}
                        />

                    ) : (

                        <Ocupado
                            contexto={contexto}
                            paquete={paquete}
                            procesando={procesando}
                            onPagar={(datos) => onMarcarPagado(numero.numero, datos).then(r => tras(r, "Pago registrado"))}
                            onLiberar={(datos) => onLiberar(numero.numero, datos).then(r => tras(r, contexto.acciones.includes("desbloquear") ? "Número desbloqueado" : "Número liberado"))}
                        />

                    )}

                    {contexto && <HistorialNumero historial={contexto.historial} disponible={contexto.auditoriaDisponible} />}

                </div>

            </div>

        </div>

    );

}

// Reservado / pagado / bloqueado / en proceso: datos del número y las
// acciones que admite su estado real.
function Ocupado({
    contexto,
    paquete,
    procesando,
    onPagar,
    onLiberar
}: {
    contexto: ContextoNumero;
    paquete: PaqueteReserva | null;
    procesando: boolean;
    onPagar: (datos: DatosPago) => Promise<Resultado>;
    onLiberar: (datos: DatosLiberar) => Promise<Resultado>;
}) {

    const { fila, estado, acciones, pago } = contexto;
    const [panel, setPanel] = useState<"pagar" | "liberar" | null>(null);
    const [metodo, setMetodo] = useState("");
    const [motivo, setMotivo] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [solicitudId] = useState(nuevaSolicitudId);

    const bloqueado = estado === "bloqueado" || estado === "en_proceso" || estado === "en_proceso_vencido";
    const motivoObligatorio = estado === "pagado";

    const abrir = (p: "pagar" | "liberar") => { setPanel(p); setMotivo(""); setObservaciones(""); };

    return (

        <div className="space-y-4">

            {bloqueado ? (

                <div className="space-y-1">
                    <Dato etiqueta="Estado" valor={ETIQUETA_ESTADO[estado]} />
                    <Dato etiqueta="Motivo del bloqueo" valor={fila.motivoBloqueo} />
                    {fila.bloqueadoHasta && <Dato etiqueta={estado === "en_proceso_vencido" ? "Retención vencida el" : "Retenido hasta"} valor={new Date(fila.bloqueadoHasta).toLocaleString("es-CO")} />}
                    {estado === "en_proceso_vencido" && (
                        <p className="text-xs text-gray-500 pt-2">La tabla lo muestra disponible, pero sigue retenido en la base: no se puede reservar (ni de forma automática ni desde el panel) hasta liberarlo.</p>
                    )}
                </div>

            ) : (

                <div className="space-y-1">
                    <Dato etiqueta="Cliente" valor={fila.comprador} />
                    <Dato etiqueta="Teléfono" valor={fila.telefono} />
                    <Dato etiqueta="Grupo de WhatsApp" valor={fila.grupoNombre} />
                    {paquete && paquete.numeros.length > 1 && (
                        <div className="flex justify-between text-sm border-b pb-2 pt-2 gap-4">
                            <span className="text-gray-500 flex items-center gap-1 shrink-0"><Users size={13} /> Reservado junto con</span>
                            <span className="font-medium text-right min-w-0 break-words">{paquete.numeros.filter(n => n !== contexto.numero).join(", ")}</span>
                        </div>
                    )}
                    <Dato etiqueta="Sorteo" valor={fila.sorteoAnticipado ? `${fila.sorteoAnticipado} (reserva anticipada, sin publicar)` : fila.nombreEvento} />
                    <Dato etiqueta="Reservado" valor={[fila.fechaReserva, fila.horaReserva].filter(Boolean).join(" ") || null} />
                    {estado === "pagado" && (
                        <>
                            <Dato etiqueta="Pagado" valor={[fila.fechaPago, fila.horaPago].filter(Boolean).join(" ") || null} />
                            <Dato etiqueta="Método de pago" valor={pago?.metodoPago} nota={pago ? "No indicado" : "Sin registro en el panel"} />
                            <Dato etiqueta="Observaciones del pago" valor={pago?.observaciones} nota="—" />
                            {pago?.operador && <Dato etiqueta="Registrado por" valor={pago.operador} />}
                        </>
                    )}
                </div>

            )}

            {panel === "pagar" && (
                <div className="border rounded-xl p-3 space-y-2 bg-gray-50">
                    <p className="text-sm font-semibold text-gray-800">Registrar pago</p>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white" value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={procesando} aria-label="Método de pago">
                        <option value="">Método de pago (opcional)</option>
                        {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <textarea className="w-full border rounded-lg px-3 py-2 text-sm bg-white min-h-[60px]" placeholder="Observaciones (comprobante, referencia...)" maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={procesando} />
                    <p className="text-xs text-gray-500">Como propietario, registrarlo aquí lo deja confirmado (pasa a Pagado).</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setPanel(null)} className="flex-1 text-sm px-4 py-2.5 rounded-xl border bg-white" disabled={procesando}>Cancelar</button>
                        <BotonAccion icon={DollarSign} texto="Confirmar pago" color="bg-emerald-600 hover:bg-emerald-700" cargando={procesando}
                            onClick={async () => { const r = await onPagar({ metodoPago: metodo || undefined, observaciones: observaciones.trim() || undefined, solicitudId }); if (r.ok) setPanel(null); }} />
                    </div>
                </div>
            )}

            {panel === "liberar" && (
                <div className="border border-red-200 rounded-xl p-3 space-y-2 bg-red-50/50">
                    <p className="text-sm font-semibold text-gray-900">
                        {bloqueado ? `¿Desbloquear el ${contexto.numero}?` : estado === "pagado" ? `¿Anular el pago y liberar el ${contexto.numero}?` : `¿Liberar el ${contexto.numero}?`}
                    </p>
                    <p className="text-xs text-gray-600">
                        {bloqueado
                            ? "El número vuelve a estar disponible para reservas automáticas y desde el panel."
                            : "Se borran el cliente, el grupo y las fechas de esta reserva; el número queda disponible. Queda registrado en el historial."}
                    </p>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm bg-white" placeholder={motivoObligatorio ? "Motivo (obligatorio)" : "Motivo (opcional)"} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={procesando} />
                    <textarea className="w-full border rounded-lg px-3 py-2 text-sm bg-white min-h-[56px]" placeholder="Observaciones (opcional)" maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={procesando} />
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setPanel(null)} className="flex-1 text-sm px-4 py-2.5 rounded-xl border bg-white" disabled={procesando}>Cancelar</button>
                        <BotonAccion icon={Unlock} texto={bloqueado ? "Sí, desbloquear" : "Sí, liberar"} color="bg-gray-900 hover:bg-black" cargando={procesando}
                            deshabilitado={motivoObligatorio && motivo.trim().length < 3}
                            onClick={async () => { const r = await onLiberar({ motivo: motivo.trim() || undefined, observaciones: observaciones.trim() || undefined, solicitudId }); if (r.ok) setPanel(null); }} />
                    </div>
                </div>
            )}

            {panel === null && (
                <div className="flex flex-col sm:flex-row gap-2">
                    {acciones.includes("pagar") && (
                        <BotonAccion icon={DollarSign} texto="Registrar pago" color="bg-emerald-600 hover:bg-emerald-700" cargando={procesando} onClick={() => abrir("pagar")} />
                    )}
                    {acciones.includes("liberar") && (
                        <BotonAccion icon={Unlock} texto={estado === "pagado" ? "Anular y liberar" : "Liberar reserva"} color="bg-gray-800 hover:bg-black" cargando={procesando} onClick={() => abrir("liberar")} />
                    )}
                    {acciones.includes("desbloquear") && (
                        <BotonAccion icon={Unlock} texto="Desbloquear" color="bg-slate-700 hover:bg-slate-800" cargando={procesando} onClick={() => abrir("liberar")} />
                    )}
                </div>
            )}

            {estado === "pagado" && (
                <p className="text-xs text-gray-500">Un número pagado no admite una nueva reserva: primero habría que anular el pago.</p>
            )}

        </div>

    );

}

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string | null | undefined; nota?: string }) {

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
    deshabilitado = false,
    onClick
}: {
    icon: typeof DollarSign;
    texto: string;
    color: string;
    cargando: boolean;
    deshabilitado?: boolean;
    onClick: () => void;
}) {

    return (

        <button
            type="button"
            onClick={onClick}
            disabled={cargando || deshabilitado}
            className={`flex-1 flex items-center justify-center gap-2 text-white text-sm px-4 py-2.5 rounded-xl disabled:opacity-50 ${color}`}
        >
            {cargando ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
            {cargando ? "Procesando..." : texto}
        </button>

    );

}
