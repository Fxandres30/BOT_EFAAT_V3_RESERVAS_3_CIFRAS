"use client";

import { useMemo, useRef, useState } from "react";
import { CheckSquare, DollarSign, Unlock, X, Loader2, CheckCircle2, AlertTriangle, Info, MinusCircle } from "lucide-react";

import {
    clasificarOperacion,
    exigeMotivo,
    operacionesCompatibles,
    type DatosOperacion,
    type EstadoResultado,
    type NumeroSeleccionable,
    type OperacionLote,
    type ResultadoOperacion
} from "@/services/tablas/pagoLote";
import { nuevaSolicitudId } from "@/services/tablas/reservaManual";

// Mismas opciones que el pago de un número (NumeroDetalleModal).
const METODOS_PAGO = ["Efectivo", "Nequi", "Daviplata", "Transferencia bancaria", "Otro"];

export type ProcesarLote = (
    operacion: OperacionLote,
    incluidos: NumeroSeleccionable[],
    datos: DatosOperacion,
    solicitudLote: string,
    alAvanzar: (hechos: number, total: number) => void
) => Promise<ResultadoOperacion | null>;

interface Props {
    activo: boolean;
    numeros: NumeroSeleccionable[];
    seleccion: string[];
    onActivar: () => void;
    onSalir: () => void;
    onLimpiar: () => void;
    onProcesar: ProcesarLote;
}

const BOTON: Record<OperacionLote, { texto: string; icon: typeof DollarSign; clase: string }> = {
    pagar: { texto: "Registrar pago", icon: DollarSign, clase: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    liberar: { texto: "Liberar", icon: Unlock, clase: "bg-gray-800 hover:bg-black text-white" },
    desbloquear: { texto: "Desbloquear", icon: Unlock, clase: "bg-slate-700 hover:bg-slate-800 text-white" }
};

const OPERACIONES: OperacionLote[] = ["pagar", "liberar", "desbloquear"];

// Tablas → «Seleccionar»: marcar varios números (en la cuadrícula o en
// «Historial de números») y aplicarles una operación. Solo se ofrecen las
// operaciones que admite al menos uno de los seleccionados; cada número se
// procesa con la misma operación de su detalle (el servidor decide) y el
// resultado se informa número a número.
export default function SeleccionPagos({ activo, numeros, seleccion, onActivar, onSalir, onLimpiar, onProcesar }: Props) {

    const [dialogo, setDialogo] = useState<OperacionLote | null>(null);
    const compatibles = useMemo(() => operacionesCompatibles(numeros, seleccion), [numeros, seleccion]);
    const ninguna = seleccion.length > 0 && OPERACIONES.every(op => compatibles[op] === 0);

    if (!activo) {
        return (
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={onActivar}
                    className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200"
                >
                    <CheckSquare size={16} /> Seleccionar
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-2 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl px-3 py-2 shadow-sm">
                <span className="text-sm font-medium">
                    {seleccion.length === 0
                        ? "Toca los números en la tabla o márcalos en «Historial de números»."
                        : `${seleccion.length} seleccionado${seleccion.length === 1 ? "" : "s"}`}
                    {ninguna && <span className="block text-xs font-normal text-indigo-800">Ninguno admite una acción rápida (libres o en proceso): ábrelos desde su detalle.</span>}
                </span>
                <div className="flex flex-wrap gap-2">
                    {OPERACIONES.filter(op => compatibles[op] > 0).map(op => {
                        const { texto, icon: Icon, clase } = BOTON[op];
                        return (
                            <button key={op} type="button" onClick={() => setDialogo(op)} className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg ${clase}`}>
                                <Icon size={15} /> {texto} ({compatibles[op]})
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        disabled={seleccion.length === 0}
                        onClick={onLimpiar}
                        className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                        Limpiar
                    </button>
                    <button
                        type="button"
                        onClick={onSalir}
                        className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        aria-label="Terminar la selección"
                    >
                        <X size={15} /> Terminar
                    </button>
                </div>
            </div>

            {dialogo && (
                <DialogoOperacion
                    operacion={dialogo}
                    numeros={numeros}
                    seleccion={seleccion}
                    onProcesar={onProcesar}
                    onTerminado={onLimpiar}
                    onClose={() => setDialogo(null)}
                />
            )}
        </>
    );

}

const TITULO: Record<OperacionLote, string> = {
    pagar: "Registrar pago",
    liberar: "Liberar números",
    desbloquear: "Desbloquear números"
};

const ICONO_RESULTADO: Record<EstadoResultado, typeof Info> = { hecho: CheckCircle2, sin_cambio: Info, omitido: MinusCircle, error: AlertTriangle };
const COLOR_RESULTADO: Record<EstadoResultado, string> = { hecho: "text-emerald-700", sin_cambio: "text-gray-600", omitido: "text-amber-800", error: "text-red-700" };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function textoConfirmar(operacion: OperacionLote, n: number) {
    if (operacion === "pagar") return `Registrar ${plural(n, "pago", "pagos")}`;
    if (operacion === "liberar") return n === 1 ? "Sí, liberar" : `Sí, liberar ${n}`;
    return n === 1 ? "Sí, desbloquear" : `Sí, desbloquear ${n}`;
}

/**
 * Confirmación + ejecución de una operación sobre uno o varios números.
 * La clasificación se congela al abrir (lo que se confirma es lo que se
 * envía); los datos del número no cambian en pantalla hasta que el
 * servidor confirma y la tabla se recarga.
 */
export function DialogoOperacion({ operacion, numeros, seleccion, onProcesar, onTerminado, onClose }: {
    operacion: OperacionLote;
    numeros: NumeroSeleccionable[];
    seleccion: string[];
    onProcesar: ProcesarLote;
    onTerminado?: () => void;
    onClose: () => void;
}) {

    const [{ incluidos, excluidos }] = useState(() => clasificarOperacion(numeros, seleccion, operacion));
    // Una solicitud por lote: reintentar ESTE lote no duplica operaciones.
    const [solicitudLote] = useState(nuevaSolicitudId);
    const [metodo, setMetodo] = useState("");
    const [motivo, setMotivo] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [procesando, setProcesando] = useState(false);
    const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null);
    const [resultado, setResultado] = useState<ResultadoOperacion | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Doble clic antes de que se pinte «procesando»: un solo envío.
    const enviando = useRef(false);

    const motivoObligatorio = exigeMotivo(operacion, incluidos);
    const hayPagados = incluidos.some(n => n.estado === "pagado");
    const lista = incluidos.map(n => n.numero).join(", ");

    const resumen = useMemo(() => {
        if (!resultado) return null;
        const hecho = operacion === "pagar" ? ["pagado", "pagados"] : operacion === "liberar" ? ["liberado", "liberados"] : ["desbloqueado", "desbloqueados"];
        const partes = [plural(resultado.hechos, hecho[0], hecho[1])];
        if (resultado.sinCambio) partes.push(`${resultado.sinCambio} sin cambios`);
        if (resultado.omitidos) partes.push(`${resultado.omitidos} omitido${resultado.omitidos === 1 ? "" : "s"} por cambio de estado`);
        if (resultado.errores) partes.push(`${resultado.errores} con error`);
        return partes.join(" · ");
    }, [resultado, operacion]);

    async function ejecutar() {
        if (enviando.current || resultado || incluidos.length === 0) return;
        if (motivoObligatorio && motivo.trim().length < 3) return;
        enviando.current = true;
        setProcesando(true);
        setError(null);
        setAvance({ hechos: 0, total: incluidos.length });
        try {
            const r = await onProcesar(
                operacion,
                incluidos,
                {
                    metodoPago: operacion === "pagar" ? metodo || undefined : undefined,
                    motivo: operacion === "pagar" ? undefined : motivo.trim() || undefined,
                    observaciones: observaciones.trim() || undefined
                },
                solicitudLote,
                (hechos, total) => setAvance({ hechos, total })
            );
            if (!r) setError("Ya hay otra operación en curso. Espera a que termine.");
            else { setResultado(r); onTerminado?.(); }
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
        } finally {
            setProcesando(false);
            enviando.current = false;
        }
    }

    const confirmarDeshabilitado = procesando || incluidos.length === 0 || (motivoObligatorio && motivo.trim().length < 3);
    const BotonIcon = operacion === "pagar" ? DollarSign : Unlock;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={procesando ? undefined : onClose}>
            <div
                className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh]"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={TITULO[operacion]}
            >
                <div className="p-4 sm:p-5 border-b flex items-center justify-between">
                    <h2 className="text-lg font-bold">{TITULO[operacion]}</h2>
                    <button type="button" onClick={onClose} disabled={procesando} aria-label="Cerrar" className="p-2 -m-2 rounded-full text-gray-500 hover:text-gray-800 disabled:opacity-40">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 text-sm">

                    {!resultado && (
                        <>
                            {incluidos.length === 0 ? (
                                <p>Ninguno de los números seleccionados admite esta operación.</p>
                            ) : operacion === "pagar" ? (
                                <p>Se registrará el pago de <b>{incluidos.length}</b> número{incluidos.length === 1 ? "" : "s"} reservado{incluidos.length === 1 ? "" : "s"}: <span className="tabular-nums">{lista}</span>.</p>
                            ) : (
                                <div className="border border-red-200 rounded-xl p-3 bg-red-50/50 space-y-1.5">
                                    <p className="font-semibold text-gray-900">
                                        {operacion === "desbloquear"
                                            ? `¿Desbloquear ${incluidos.length === 1 ? "el" : "los"} ${lista}?`
                                            : `¿Liberar ${incluidos.length === 1 ? "el" : "los"} ${lista}?`}
                                    </p>
                                    <p className="text-gray-700">
                                        {operacion === "desbloquear"
                                            ? `${incluidos.length === 1 ? "El número volverá" : "Los números volverán"} a estar disponible${incluidos.length === 1 ? "" : "s"} para reservas automáticas y desde el panel.`
                                            : `${incluidos.length === 1 ? "El número volverá" : "Los números volverán"} a estar disponible${incluidos.length === 1 ? "" : "s"}: se borran el cliente, el grupo y las fechas de la reserva. Queda registrado en el historial.`}
                                    </p>
                                    {hayPagados && (
                                        <p className="text-red-800">
                                            Incluye pagados ({incluidos.filter(n => n.estado === "pagado").map(n => n.numero).join(", ")}): se anula su pago. Indica el motivo.
                                        </p>
                                    )}
                                </div>
                            )}

                            {excluidos.length > 0 && (
                                <div className="border rounded-xl p-3 bg-amber-50 border-amber-200 space-y-1">
                                    <p className="font-medium text-amber-900">No se incluyen ({excluidos.length}):</p>
                                    <ul className="space-y-0.5 text-amber-900">
                                        {excluidos.map(x => <li key={x.numero}><span className="tabular-nums font-semibold">{x.numero}</span> — {x.motivo}</li>)}
                                    </ul>
                                </div>
                            )}

                            {incluidos.length > 0 && (
                                <div className="space-y-2">
                                    {operacion === "pagar" ? (
                                        <select className="w-full border rounded-lg px-3 py-2 bg-white" value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={procesando} aria-label="Método de pago">
                                            <option value="">Método de pago (opcional)</option>
                                            {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                    ) : (
                                        <input className="w-full border rounded-lg px-3 py-2 bg-white" placeholder={motivoObligatorio ? "Motivo (obligatorio)" : "Motivo (opcional)"} aria-label="Motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={procesando} />
                                    )}
                                    <textarea
                                        className="w-full border rounded-lg px-3 py-2 bg-white min-h-[60px]"
                                        placeholder={operacion === "pagar" ? "Observaciones (comprobante, referencia...)" : "Observaciones (opcional)"}
                                        aria-label="Observaciones"
                                        maxLength={1000}
                                        value={observaciones}
                                        onChange={(e) => setObservaciones(e.target.value)}
                                        disabled={procesando}
                                    />
                                    <p className="text-xs text-gray-500">
                                        {operacion === "pagar"
                                            ? "Cada número se confirma por separado y solo si sigue reservado. No cambia su propietario, grupo ni sorteo."
                                            : "Antes de enviar cada número se comprueba su estado real; si cambió, no se toca. Hasta que el servidor confirme, el número conserva su propietario y sus datos."}
                                    </p>
                                </div>
                            )}

                            {error && <p className="text-red-700">{error}</p>}
                        </>
                    )}

                    {procesando && avance && (
                        <p className="flex items-center gap-2 text-gray-600">
                            <Loader2 size={16} className="animate-spin" /> Procesando {avance.hechos} de {avance.total}...
                        </p>
                    )}

                    {resultado && (
                        <div className="space-y-3">
                            <p className={`font-semibold ${resultado.errores ? "text-red-700" : resultado.omitidos ? "text-amber-800" : "text-emerald-700"}`}>{resumen}</p>
                            <ul className="space-y-1">
                                {resultado.resultados.map(x => {
                                    const Icono = ICONO_RESULTADO[x.estado];
                                    return (
                                        <li key={x.numero} className={`flex items-start gap-2 ${COLOR_RESULTADO[x.estado]}`}>
                                            <Icono size={15} className="shrink-0 mt-0.5" />
                                            <span><span className="tabular-nums font-semibold">{x.numero}</span> — {x.mensaje}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                            {excluidos.length > 0 && <p className="text-gray-500">No incluidos: {excluidos.map(x => x.numero).join(", ")}.</p>}
                        </div>
                    )}

                </div>

                <div className="p-4 sm:p-5 border-t flex gap-2">
                    {resultado ? (
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border bg-white hover:bg-gray-50">Cerrar</button>
                    ) : (
                        <>
                            <button type="button" onClick={onClose} disabled={procesando} className="flex-1 px-4 py-2.5 rounded-xl border bg-white disabled:opacity-50">Cancelar</button>
                            <button
                                type="button"
                                onClick={ejecutar}
                                disabled={confirmarDeshabilitado}
                                className={`flex-1 inline-flex items-center justify-center gap-2 text-white px-4 py-2.5 rounded-xl disabled:opacity-50 ${BOTON[operacion].clase}`}
                            >
                                {procesando ? <Loader2 size={16} className="animate-spin" /> : <BotonIcon size={16} />}
                                {procesando ? "Procesando..." : textoConfirmar(operacion, incluidos.length)}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );

}
