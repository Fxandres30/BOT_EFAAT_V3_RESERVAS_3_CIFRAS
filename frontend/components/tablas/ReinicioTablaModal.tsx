"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, X } from "lucide-react";

import { TEXTO_CONFIRMACION, puedeConfirmar } from "@/services/tablas/impactoReinicio";
import type { ConfirmacionReinicio, ResultadoReinicio, RevisionReinicio } from "@/services/tablas/reiniciarTabla";

interface Props {
    precio: number;
    onRevisar: () => Promise<RevisionReinicio>;
    onReiniciar: (confirmacion?: ConfirmacionReinicio) => Promise<ResultadoReinicio>;
    onClose: () => void;
}

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

// Tablas → «Reiniciar»: el administrador decide. Primero se muestra el
// impacto real (estados, reservas anticipadas, sorteos en curso y otros
// precios que usan la misma tabla física); el reinicio solo se ejecuta con
// la confirmación escrita y, si hay reservas anticipadas, aceptándolas
// expresamente. Cancelar no toca nada.
export default function ReinicioTablaModal({ precio, onRevisar, onReiniciar, onClose }: Props) {

    const [revision, setRevision] = useState<RevisionReinicio | null>(null);
    const [errorRevision, setErrorRevision] = useState<string | null>(null);
    const [intento, setIntento] = useState(0);
    const [texto, setTexto] = useState("");
    const [aceptaAnticipadas, setAceptaAnticipadas] = useState(false);
    const [procesando, setProcesando] = useState(false);
    const [resultado, setResultado] = useState<ResultadoReinicio | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Doble clic antes de que se pinte «procesando»: un solo reinicio.
    const enviando = useRef(false);

    // La función del hook cambia en cada render: se revisa al abrir y en
    // cada «Revisar de nuevo», no en cada render.
    const revisar = useRef(onRevisar);
    useEffect(() => { revisar.current = onRevisar; });

    useEffect(() => {
        let vivo = true;
        revisar.current()
            .then(r => { if (vivo) { setRevision(r); setErrorRevision(null); } })
            .catch(e => { if (vivo) setErrorRevision(e instanceof Error ? e.message : "No se pudo revisar la tabla."); });
        return () => { vivo = false; };
    }, [intento]);

    const revisarDeNuevo = () => {
        setRevision(null);
        setErrorRevision(null);
        setError(null);
        setTexto("");
        setAceptaAnticipadas(false);
        setIntento(i => i + 1);
    };

    const impacto = revision?.impacto || null;
    const listo = revision?.sinCuadricula || (impacto ? puedeConfirmar(impacto, { texto, aceptaAnticipadas }) : false);

    async function confirmar() {
        if (enviando.current || !revision || !listo || resultado) return;
        enviando.current = true;
        setProcesando(true);
        setError(null);
        try {
            setResultado(await onReiniciar(impacto ? { texto, aceptaAnticipadas, huella: impacto.huella } : undefined));
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo reiniciar la tabla.");
        } finally {
            setProcesando(false);
            enviando.current = false;
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={procesando ? undefined : onClose}>
            <div
                className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh]"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Reiniciar la tabla"
            >
                <div className="p-4 sm:p-5 border-b flex items-center justify-between">
                    <h2 className="text-lg font-bold">¿Reiniciar la tabla {pesos(precio)}?</h2>
                    <button type="button" onClick={onClose} disabled={procesando} aria-label="Cerrar" className="p-2 -m-2 rounded-full text-gray-500 hover:text-gray-800 disabled:opacity-40">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 text-sm">

                    {resultado ? (
                        <div className="flex items-start gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                            <p>
                                {resultado.accion === "creada"
                                    ? `Tabla creada: ${resultado.filas} números disponibles.`
                                    : `Tabla reiniciada: ${resultado.filas} números quedan disponibles.`}
                                {resultado.anticipadasEliminadas > 0 && ` Se eliminaron ${resultado.anticipadasEliminadas} reserva(s) anticipada(s).`}
                            </p>
                        </div>
                    ) : null}

                    {resultado && resultado.noTocadas > 0 ? (
                        <p className="flex items-start gap-2 text-amber-900" role="status">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                            <span>{resultado.noTocadas} número(s) cambiaron mientras se reiniciaba (una reserva, un pago o un bloqueo nuevos) y no se tocaron. Revísalos en la tabla.</span>
                        </p>
                    ) : resultado ? null : errorRevision ? (
                        <div className="space-y-3">
                            <p className="text-red-700">{errorRevision}</p>
                            <button type="button" onClick={revisarDeNuevo} className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50">Reintentar</button>
                        </div>
                    ) : !revision ? (
                        <p className="flex items-center gap-2 text-gray-600"><Loader2 size={16} className="animate-spin" /> Revisando el estado real de la tabla...</p>
                    ) : revision.sinCuadricula || !impacto ? (
                        <p>Esta tabla todavía no tiene números: se creará la cuadrícula 00-99 vacía. No se borra nada.</p>
                    ) : (
                        <>
                            <div className="border border-red-200 bg-red-50/60 rounded-xl p-3 space-y-1.5">
                                <p className="font-semibold text-gray-900">Se borrarán las reservas y datos de los {impacto.total} números</p>
                                <p className="text-gray-700">Todos volverán a «Disponible»: se borran cliente, contacto, grupo, sorteo, fechas y pagos de cada número. Queda registrado en la actividad. Solo afecta a tus propios números; los sorteos (programados o en curso) no se borran.</p>
                            </div>

                            <div>
                                <p className="font-medium text-gray-900 mb-1">Estado actual ({impacto.ocupados} ocupados de {impacto.total}):</p>
                                <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-700" aria-label="Números por estado">
                                    <li>Reservados: <b>{impacto.porEstado.reservado}</b></li>
                                    <li>Pagados: <b>{impacto.porEstado.pagado}</b></li>
                                    <li>Bloqueados: <b>{impacto.porEstado.bloqueado}</b></li>
                                    <li>En proceso: <b>{impacto.porEstado.en_proceso}</b></li>
                                    {impacto.porEstado.otros > 0 && <li>Otros estados: <b>{impacto.porEstado.otros}</b></li>}
                                </ul>
                                {impacto.porEstado.pagado > 0 && <p className="text-red-800 mt-1">Incluye {impacto.porEstado.pagado} número(s) pagado(s): su registro de pago se borra.</p>}
                            </div>

                            {impacto.sorteosActivos.length > 0 && (
                                <p className="flex items-start gap-2 text-red-800">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                    <span>Hay un sorteo en curso en esta tabla ({impacto.sorteosActivos.map(s => `«${s.nombre}»${s.valor ? ` ${pesos(s.valor)}` : ""}`).join(", ")}): sus reservas y pagos se borrarán, aunque el sorteo sigue abierto.</span>
                                </p>
                            )}

                            {impacto.preciosCompartidos.length > 0 && (
                                <p className="flex items-start gap-2 text-amber-900">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                    <span>Esta tabla de números la comparten tus precios {impacto.preciosCompartidos.map(pesos).join(", ")}: el reinicio también los deja en blanco.</span>
                                </p>
                            )}

                            {impacto.totalAnticipadas > 0 && (
                                <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 space-y-2">
                                    <p className="font-medium text-amber-900">
                                        {impacto.totalAnticipadas} reserva(s) anticipada(s) de sorteos programados que todavía no se publicaron:
                                    </p>
                                    <ul className="text-amber-900">
                                        {impacto.anticipadas.map(a => (
                                            <li key={a.sorteoId}>«{a.nombre}»: {a.cantidad} ({a.reservados} reservado(s), {a.pagados} pagado(s))</li>
                                        ))}
                                    </ul>
                                    <p className="text-amber-900">El sorteo programado no se cancela: se publicará sin esas reservas.</p>
                                    <label className="flex items-start gap-2 cursor-pointer">
                                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={aceptaAnticipadas} onChange={(e) => setAceptaAnticipadas(e.target.checked)} disabled={procesando} />
                                        <span className="font-medium text-gray-900">Eliminar también las {impacto.totalAnticipadas} reserva(s) anticipada(s)</span>
                                    </label>
                                </div>
                            )}

                            <label className="block space-y-1">
                                <span className="text-gray-800">Para confirmar, escribe <b>{TEXTO_CONFIRMACION}</b>:</span>
                                <input
                                    className="w-full border rounded-lg px-3 py-2 bg-white font-mono"
                                    value={texto}
                                    onChange={(e) => setTexto(e.target.value)}
                                    disabled={procesando}
                                    aria-label="Texto de confirmación"
                                    autoComplete="off"
                                />
                            </label>
                        </>
                    )}

                    {error && (
                        <div className="space-y-2">
                            <p className="text-red-700">{error}</p>
                            <button type="button" onClick={revisarDeNuevo} disabled={procesando} className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50">Revisar de nuevo</button>
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
                                onClick={confirmar}
                                disabled={procesando || !listo}
                                className="flex-1 inline-flex items-center justify-center gap-2 text-white px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50"
                            >
                                {procesando ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                                {procesando ? "Reiniciando..." : revision?.sinCuadricula ? "Crear la tabla" : "Reiniciar la tabla"}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );

}
