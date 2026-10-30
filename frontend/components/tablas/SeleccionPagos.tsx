"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckSquare, DollarSign, Unlock, X, Loader2, CheckCircle2, AlertTriangle, Info, MinusCircle, Ticket, ListChecks, Eye, EyeOff } from "lucide-react";

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
import { nuevaSolicitudId, obtenerContextoNumero, type ContextoNumero, type DatosReserva, type Resultado } from "@/services/tablas/reservaManual";
import { anadirSeleccion, numerosEnRango, numerosLibres } from "@/services/tablas/seleccionTabla";
import ReservaManualForm, { Aviso } from "./ReservaManualForm";

// Mismas opciones que el pago de un número (NumeroDetalleModal).
const METODOS_PAGO = ["Efectivo", "Nequi", "Daviplata", "Transferencia bancaria", "Otro"];

export type ProcesarLote = (
    operacion: OperacionLote,
    incluidos: NumeroSeleccionable[],
    datos: DatosOperacion,
    solicitudLote: string
) => Promise<ResultadoOperacion | null>;

interface Props {
    precio: number;
    activo: boolean;
    /** La tabla se está recargando tras un lote: la selección no cambia hasta que termine. */
    bloqueado?: boolean;
    numeros: NumeroSeleccionable[];
    seleccion: string[];
    onActivar: () => void;
    onSalir: () => void;
    onLimpiar: () => void;
    /** Sustituye la selección («Todos los libres», rango). */
    onCambiarSeleccion: (numeros: string[]) => void;
    onQuitar: (numero: string) => void;
    onProcesar: ProcesarLote;
}

const BOTON: Record<OperacionLote, { texto: string; icon: typeof DollarSign; clase: string }> = {
    reservar: { texto: "Reservar", icon: Ticket, clase: "bg-red-600 hover:bg-red-700 text-white" },
    pagar: { texto: "Registrar pago", icon: DollarSign, clase: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    liberar: { texto: "Liberar", icon: Unlock, clase: "bg-gray-800 hover:bg-black text-white" },
    desbloquear: { texto: "Desbloquear", icon: Unlock, clase: "bg-slate-700 hover:bg-slate-800 text-white" }
};

const OPERACIONES: OperacionLote[] = ["reservar", "pagar", "liberar", "desbloquear"];

const ETIQUETA_ESTADO: Record<NumeroSeleccionable["estado"], string> = {
    libre: "Libres", reservado: "Reservados", pagado: "Pagados", bloqueado: "Bloqueados", en_proceso: "En proceso"
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Qué se está ejecutando, mientras el servidor procesa el lote (una sola
// solicitud: no hay avance por número).
function textoProcesando(operacion: OperacionLote, n: number) {
    if (operacion === "reservar") return `Reservando ${plural(n, "número", "números")}...`;
    if (operacion === "pagar") return `Marcando ${plural(n, "pago", "pagos")}...`;
    if (operacion === "liberar") return `Liberando ${plural(n, "número", "números")}...`;
    return `Desbloqueando ${plural(n, "número", "números")}...`;
}

// Tablas → «Seleccionar»: marcar varios números (en la cuadrícula, en
// «Historial de números», todos los libres o un rango) y aplicarles una
// operación. Solo se ofrecen las operaciones que admite al menos uno de los
// seleccionados; cada número se procesa con la misma operación de su
// detalle (el servidor decide) y el resultado se informa número a número.
export default function SeleccionPagos({ precio, activo, bloqueado = false, numeros, seleccion, onActivar, onSalir, onLimpiar, onCambiarSeleccion, onQuitar, onProcesar }: Props) {

    const [dialogo, setDialogo] = useState<OperacionLote | null>(null);
    const [verSeleccion, setVerSeleccion] = useState(false);
    const [desde, setDesde] = useState("");
    const [hasta, setHasta] = useState("");
    const [errorRango, setErrorRango] = useState<string | null>(null);

    const compatibles = useMemo(() => operacionesCompatibles(numeros, seleccion), [numeros, seleccion]);
    const libres = useMemo(() => numerosLibres(numeros), [numeros]);
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

    function anadirRango() {
        const r = numerosEnRango(numeros, desde, hasta);
        if (!r.ok) { setErrorRango(r.mensaje); return; }
        setErrorRango(null);
        onCambiarSeleccion(anadirSeleccion(seleccion, r.numeros));
    }

    return (
        <>
            <div className="sticky top-2 z-30 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl px-3 py-2 shadow-sm space-y-2">

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium" aria-live="polite">
                        {seleccion.length === 0
                            ? "Toca los números en la tabla o márcalos en «Historial de números»."
                            : `${seleccion.length} seleccionado${seleccion.length === 1 ? "" : "s"}`}
                        {ninguna && <span className="block text-xs font-normal text-indigo-800">Ninguno admite una acción rápida (en proceso): ábrelos desde su detalle.</span>}
                        {bloqueado && (
                            <span className="flex items-center gap-1.5 text-xs font-normal text-indigo-800" role="status">
                                <Loader2 size={13} className="animate-spin" /> Actualizando la tabla con el resultado...
                            </span>
                        )}
                    </span>
                    <div className="flex flex-wrap gap-2">
                        {OPERACIONES.filter(op => compatibles[op] > 0).map(op => {
                            const { texto, icon: Icon, clase } = BOTON[op];
                            return (
                                <button key={op} type="button" onClick={() => setDialogo(op)} disabled={bloqueado} className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${clase}`}>
                                    <Icon size={15} /> {texto} ({compatibles[op]})
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            disabled={bloqueado || seleccion.length === 0}
                            onClick={() => { onLimpiar(); setVerSeleccion(false); }}
                            className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                        >
                            Limpiar
                        </button>
                        <button
                            type="button"
                            onClick={onSalir}
                            disabled={bloqueado}
                            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                            aria-label="Terminar la selección"
                        >
                            <X size={15} /> Terminar
                        </button>
                    </div>
                </div>

                {/* Herramientas de selección: discretas, en una segunda línea. */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <button
                        type="button"
                        disabled={bloqueado || libres.length === 0}
                        onClick={() => onCambiarSeleccion(anadirSeleccion(seleccion, libres))}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                        <ListChecks size={14} /> Todos los libres ({libres.length})
                    </button>
                    <span className="inline-flex items-center gap-1" role="group" aria-label="Seleccionar un rango">
                        <span className="text-indigo-800">Rango</span>
                        <input
                            className="w-14 border rounded-lg px-2 py-1 bg-white tabular-nums"
                            inputMode="numeric" aria-label="Desde" placeholder="00" maxLength={4}
                            value={desde} onChange={(e) => { setDesde(e.target.value); setErrorRango(null); }}
                        />
                        <span aria-hidden="true">–</span>
                        <input
                            className="w-14 border rounded-lg px-2 py-1 bg-white tabular-nums"
                            inputMode="numeric" aria-label="Hasta" placeholder="99" maxLength={4}
                            value={hasta} onChange={(e) => { setHasta(e.target.value); setErrorRango(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !bloqueado) anadirRango(); }}
                        />
                        <button type="button" onClick={anadirRango} disabled={bloqueado || !desde || !hasta} className="px-2.5 py-1 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50">
                            Añadir
                        </button>
                    </span>
                    {seleccion.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setVerSeleccion(v => !v)}
                            aria-expanded={verSeleccion}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-white hover:bg-gray-50"
                        >
                            {verSeleccion ? <EyeOff size={14} /> : <Eye size={14} />} {verSeleccion ? "Ocultar selección" : "Ver selección"}
                        </button>
                    )}
                    {errorRango && <span className="text-red-700 text-xs" role="alert">{errorRango}</span>}
                </div>

                {verSeleccion && seleccion.length > 0 && (
                    <ResumenSeleccion numeros={numeros} seleccion={seleccion} onQuitar={(n) => { if (!bloqueado) onQuitar(n); }} />
                )}

            </div>

            {dialogo === "reservar" && (
                <DialogoReservaLote
                    precio={precio}
                    numeros={numeros}
                    seleccion={seleccion}
                    onProcesar={onProcesar}
                    onTerminado={onLimpiar}
                    onClose={() => setDialogo(null)}
                />
            )}

            {dialogo && dialogo !== "reservar" && (
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

// «Ver selección»: los seleccionados agrupados por estado, cada uno con su
// botón para quitarlo. Marca los de otro sorteo.
function ResumenSeleccion({ numeros, seleccion, onQuitar }: { numeros: NumeroSeleccionable[]; seleccion: string[]; onQuitar: (numero: string) => void }) {

    const porNumero = new Map(numeros.map(n => [n.numero, n]));
    const grupos = new Map<string, NumeroSeleccionable[]>();
    for (const numero of [...seleccion].sort()) {
        const n = porNumero.get(numero);
        if (!n) continue;
        grupos.set(n.estado, [...(grupos.get(n.estado) || []), n]);
    }

    return (
        <div className="border-t border-indigo-200 pt-2 space-y-1.5 max-h-48 overflow-y-auto">
            {[...grupos].map(([estado, lista]) => (
                <div key={estado} className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-medium w-24 shrink-0">{ETIQUETA_ESTADO[estado as NumeroSeleccionable["estado"]]} ({lista.length})</span>
                    {lista.map(n => (
                        <button
                            key={n.numero}
                            type="button"
                            onClick={() => onQuitar(n.numero)}
                            title={n.otroSorteo ? "De otro sorteo · quitar" : "Quitar de la selección"}
                            aria-label={`Quitar ${n.numero} de la selección`}
                            className={`inline-flex items-center gap-1 tabular-nums px-2 py-0.5 rounded-full border bg-white hover:bg-gray-50 ${n.otroSorteo ? "border-amber-300 text-amber-900" : ""}`}
                        >
                            {n.numero}{n.otroSorteo && <span className="text-[10px]">otro sorteo</span>}<X size={12} />
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );

}

const TITULO: Record<OperacionLote, string> = {
    reservar: "Reservar números",
    pagar: "Registrar pago",
    liberar: "Liberar números",
    desbloquear: "Desbloquear números"
};

const ICONO_RESULTADO: Record<EstadoResultado, typeof Info> = { hecho: CheckCircle2, sin_cambio: Info, omitido: MinusCircle, error: AlertTriangle };
const COLOR_RESULTADO: Record<EstadoResultado, string> = { hecho: "text-emerald-700", sin_cambio: "text-gray-600", omitido: "text-amber-800", error: "text-red-700" };

const HECHO: Record<OperacionLote, [string, string]> = {
    reservar: ["reservado", "reservados"],
    pagar: ["pagado", "pagados"],
    liberar: ["liberado", "liberados"],
    desbloquear: ["desbloqueado", "desbloqueados"]
};

function resumenDe(operacion: OperacionLote, resultado: ResultadoOperacion) {
    const partes = [plural(resultado.hechos, HECHO[operacion][0], HECHO[operacion][1])];
    if (resultado.sinCambio) partes.push(`${resultado.sinCambio} sin cambios`);
    if (resultado.omitidos) partes.push(`${resultado.omitidos} omitido${resultado.omitidos === 1 ? "" : "s"}${operacion === "reservar" ? " (ya no estaban libres o no se intentaron)" : " por cambio de estado"}`);
    if (resultado.errores) partes.push(`${resultado.errores} con error`);
    return partes.join(" · ");
}

function textoConfirmar(operacion: OperacionLote, n: number) {
    if (operacion === "pagar") return `Registrar ${plural(n, "pago", "pagos")}`;
    if (operacion === "liberar") return n === 1 ? "Sí, liberar" : `Sí, liberar ${n}`;
    return n === 1 ? "Sí, desbloquear" : `Sí, desbloquear ${n}`;
}

// Resultado número a número de un lote.
function ListaResultados({ operacion, resultado, excluidos }: { operacion: OperacionLote; resultado: ResultadoOperacion; excluidos: { numero: string }[] }) {
    return (
        <div className="space-y-3">
            <p className={`font-semibold ${resultado.errores ? "text-red-700" : resultado.omitidos ? "text-amber-800" : "text-emerald-700"}`}>{resumenDe(operacion, resultado)}</p>
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
    );
}

// Hoja/modal de una operación (abajo en móvil, centrada en escritorio).
function Hoja({ titulo, bloqueada, onClose, pie, children }: { titulo: string; bloqueada: boolean; onClose: () => void; pie?: ReactNode; children: ReactNode }) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={bloqueada ? undefined : onClose}>
            <div
                className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh]"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={titulo}
            >
                <div className="p-4 sm:p-5 border-b flex items-center justify-between">
                    <h2 className="text-lg font-bold">{titulo}</h2>
                    <button type="button" onClick={onClose} disabled={bloqueada} aria-label="Cerrar" className="p-2 -m-2 rounded-full text-gray-500 hover:text-gray-800 disabled:opacity-40">
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 text-sm">{children}</div>
                {pie && <div className="p-4 sm:p-5 border-t flex gap-2">{pie}</div>}
            </div>
        </div>
    );
}

function Excluidos({ excluidos }: { excluidos: { numero: string; motivo: string }[] }) {
    if (!excluidos.length) return null;
    return (
        <div className="border rounded-xl p-3 bg-amber-50 border-amber-200 space-y-1">
            <p className="font-medium text-amber-900">No se incluyen ({excluidos.length}):</p>
            <ul className="space-y-0.5 text-amber-900">
                {excluidos.map(x => <li key={x.numero}><span className="tabular-nums font-semibold">{x.numero}</span> — {x.motivo}</li>)}
            </ul>
        </div>
    );
}

/**
 * Reservar varios números LIBRES: los mismos datos de la reserva manual de
 * un número (sorteo, grupo, contacto, motivo) para todos, y cada número se
 * reserva con la misma ruta del servidor, en serie. Si otro lo tomó antes,
 * ese número se informa y los demás siguen.
 */
export function DialogoReservaLote({ precio, numeros, seleccion, onProcesar, onTerminado, onClose }: {
    precio: number;
    numeros: NumeroSeleccionable[];
    seleccion: string[];
    onProcesar: ProcesarLote;
    onTerminado?: () => void;
    onClose: () => void;
}) {

    const [{ incluidos, excluidos }] = useState(() => clasificarOperacion(numeros, seleccion, "reservar"));
    const [contexto, setContexto] = useState<ContextoNumero | null>(null);
    const [errorContexto, setErrorContexto] = useState<string | null>(null);
    const [procesando, setProcesando] = useState(false);
    const [resultado, setResultado] = useState<ResultadoOperacion | null>(null);
    const lista = incluidos.map(n => n.numero).join(", ");

    // Sorteos y grupos posibles: los de la tabla (iguales para todos sus
    // números libres); se piden con el primero.
    useEffect(() => {
        if (!incluidos.length) return;
        let vigente = true;
        obtenerContextoNumero(precio, incluidos[0].numero).then(r => {
            if (!vigente) return;
            if (r.ok) setContexto(r);
            else setErrorContexto(r.mensaje);
        });
        return () => { vigente = false; };
    }, [precio, incluidos]);

    async function reservar(datos: DatosReserva): Promise<Resultado> {
        const { solicitudId, ...resto } = datos;
        setProcesando(true);
        try {
            // solicitudId del formulario = id del lote: reintentar no duplica.
            const r = await onProcesar("reservar", incluidos, resto, solicitudId);
            if (!r) return { ok: false, motivo: "en_curso", mensaje: "Ya hay otra operación en curso. Espera a que termine." };
            setResultado(r);
            onTerminado?.();
            return { ok: true, estado: "reservado" };
        } finally {
            setProcesando(false);
        }
    }

    return (
        <Hoja
            titulo={TITULO.reservar}
            bloqueada={procesando}
            onClose={onClose}
            pie={resultado ? <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border bg-white hover:bg-gray-50">Cerrar</button> : undefined}
        >
            {resultado ? (
                <ListaResultados operacion="reservar" resultado={resultado} excluidos={excluidos} />
            ) : incluidos.length === 0 ? (
                <>
                    <p>Ninguno de los números seleccionados está libre.</p>
                    <Excluidos excluidos={excluidos} />
                </>
            ) : (
                <>
                    <p>
                        Se reservarán <b>{incluidos.length}</b> número{incluidos.length === 1 ? "" : "s"} libre{incluidos.length === 1 ? "" : "s"} al mismo contacto: <span className="tabular-nums">{lista}</span>.
                    </p>
                    <p className="text-xs text-gray-500">Se reservan todos en una sola operación y solo los que sigan libres en ese momento; si otra persona o el bot tomó alguno antes, se informa y los demás se reservan igual.</p>
                    <Excluidos excluidos={excluidos} />
                    {procesando && (
                        <p className="flex items-center gap-2 text-gray-600" role="status">
                            <Loader2 size={16} className="animate-spin" /> {textoProcesando("reservar", incluidos.length)}
                        </p>
                    )}
                    {errorContexto && <Aviso>{errorContexto}</Aviso>}
                    {!contexto && !errorContexto && (
                        <p className="flex items-center gap-2 text-gray-600"><Loader2 size={16} className="animate-spin" /> Cargando sorteos y grupos...</p>
                    )}
                    {contexto && (
                        <ReservaManualForm
                            contexto={contexto}
                            onReservar={reservar}
                            etiquetaBoton={incluidos.length === 1 ? `Reservar el ${incluidos[0].numero}` : `Reservar ${incluidos.length} números`}
                            etiquetaProcesando={textoProcesando("reservar", incluidos.length)}
                        />
                    )}
                </>
            )}
        </Hoja>
    );

}

/**
 * Confirmación + ejecución de una operación sobre uno o varios números.
 * La tabla se congela al abrir (lo que se confirma es lo que se envía); los
 * datos del número no cambian en pantalla hasta que el servidor confirma y
 * la tabla se recarga. Los de otro sorteo quedan fuera salvo que el
 * administrador los incluya expresamente (`incluirOtroSorteoInicial`: una
 * acción rápida sobre UN número ya es esa decisión).
 */
export function DialogoOperacion({ operacion, numeros, seleccion, onProcesar, onTerminado, onClose, incluirOtroSorteoInicial = false }: {
    operacion: Exclude<OperacionLote, "reservar">;
    numeros: NumeroSeleccionable[];
    seleccion: string[];
    onProcesar: ProcesarLote;
    onTerminado?: () => void;
    onClose: () => void;
    incluirOtroSorteoInicial?: boolean;
}) {

    const [foto] = useState(() => numeros);
    const [incluirOtro, setIncluirOtro] = useState(incluirOtroSorteoInicial);
    const { incluidos, excluidos } = useMemo(
        () => clasificarOperacion(foto, seleccion, operacion, { incluirOtroSorteo: incluirOtro }),
        [foto, seleccion, operacion, incluirOtro]
    );
    const otrosSorteo = useMemo(
        () => clasificarOperacion(foto, seleccion, operacion, { incluirOtroSorteo: true }).incluidos.filter(n => n.otroSorteo),
        [foto, seleccion, operacion]
    );
    // Una solicitud por lote: reintentar ESTE lote no duplica operaciones.
    const [solicitudLote] = useState(nuevaSolicitudId);
    const [metodo, setMetodo] = useState("");
    const [motivo, setMotivo] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [procesando, setProcesando] = useState(false);
    const [resultado, setResultado] = useState<ResultadoOperacion | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Doble clic antes de que se pinte «procesando»: un solo envío.
    const enviando = useRef(false);

    const motivoObligatorio = exigeMotivo(operacion, incluidos);
    const hayPagados = incluidos.some(n => n.estado === "pagado");
    const lista = incluidos.map(n => n.numero).join(", ");

    async function ejecutar() {
        if (enviando.current || resultado || incluidos.length === 0) return;
        if (motivoObligatorio && motivo.trim().length < 3) return;
        enviando.current = true;
        setProcesando(true);
        setError(null);
        try {
            const r = await onProcesar(
                operacion,
                incluidos,
                {
                    metodoPago: operacion === "pagar" ? metodo || undefined : undefined,
                    motivo: operacion === "pagar" ? undefined : motivo.trim() || undefined,
                    observaciones: observaciones.trim() || undefined
                },
                solicitudLote
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
        <Hoja
            titulo={TITULO[operacion]}
            bloqueada={procesando}
            onClose={onClose}
            pie={resultado ? (
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
                        {procesando ? textoProcesando(operacion, incluidos.length) : textoConfirmar(operacion, incluidos.length)}
                    </button>
                </>
            )}
        >

            {!resultado && (
                <>
                    {incluidos.length === 0 ? (
                        <p>Ninguno de los números seleccionados admite esta operación{otrosSorteo.length && !incluirOtro ? " sin incluir los de otro sorteo" : ""}.</p>
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

                    {otrosSorteo.length > 0 && (
                        <label className="flex items-start gap-2 border rounded-xl p-3 bg-amber-50 border-amber-200 text-amber-900 cursor-pointer">
                            <input type="checkbox" className="mt-0.5" checked={incluirOtro} disabled={procesando} onChange={(e) => setIncluirOtro(e.target.checked)} />
                            <span>
                                Incluir {plural(otrosSorteo.length, "número", "números")} de otro sorteo (<span className="tabular-nums">{otrosSorteo.map(n => n.numero).join(", ")}</span>).
                                <span className="block text-xs">No son del sorteo activo de esta tabla: solo se tocan si lo marcas.</span>
                            </span>
                        </label>
                    )}

                    <Excluidos excluidos={excluidos.filter(x => !x.otroSorteo)} />

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
                                    ? "Se registran todos en una sola operación y solo los que sigan reservados. No cambia su propietario, grupo ni sorteo."
                                    : "El servidor comprueba el estado real de cada número; si cambió, no se toca. Hasta que confirme, el número conserva su propietario y sus datos."}
                            </p>
                        </div>
                    )}

                    {error && <p className="text-red-700">{error}</p>}
                </>
            )}

            {resultado && <ListaResultados operacion={operacion} resultado={resultado} excluidos={excluidos} />}

        </Hoja>
    );

}
