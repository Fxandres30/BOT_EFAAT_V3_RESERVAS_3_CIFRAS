"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

import { Modal, Button, Textarea } from "@/components/ui";
import {
    compartirTabla,
    vistaPreviaCompartir,
    guardarDestinosCompartir,
    mensajeCompartir,
    type EnvioCompartir,
    type ResultadoCompartir,
    type VistaPreviaCompartir
} from "@/services/tablas/compartirTabla";

// Lo que muestra el modal de «Compartir» (AccionesTabla decide cuál):
//   enviando   — envío de un clic a los grupos guardados, en curso;
//   resultado  — cómo fue cada grupo (incluidos los que fallaron);
//   configurar — vista previa real (captura del `div` de la tabla visible +
//                texto), elección de grupos y confirmación antes de enviar.
//                Cargarla NUNCA envía nada. Se envía la MISMA captura que
//                se ve en la vista previa.
// `reintento`: envío sin respuesta clara (red caída, tiempo agotado); se
// puede repetir con la MISMA solicitud, que no reenvía a grupos ya hechos.
export type PanelCompartir =
    | { tipo: "enviando"; grupos?: string[] }
    | { tipo: "resultado"; resultado: ResultadoCompartir; reintento?: EnvioCompartir }
    | { tipo: "configurar"; aviso?: string; imagen?: string };

interface Props {
    precio: number;
    /** PNG (data URL) del `div` de la tabla visible. */
    capturarTabla: () => Promise<string>;
    panel: PanelCompartir;
    onCambiar: (panel: PanelCompartir) => void;
    onClose: () => void;
}

export function nuevaSolicitud(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const h = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Un envío de «Compartir» que SIEMPRE termina con un resultado: si la red
// falla (fetch lanza) el modal no se queda en «Publicando…» sin poder cerrarse.
export async function enviarCompartir(precio: number, envio: EnvioCompartir): Promise<ResultadoCompartir> {
    try {
        return await compartirTabla(precio, envio);
    } catch {
        return { ok: false, enviado: false, motivo: "sin_respuesta" };
    }
}

// Resultado -> panel; un envío sin respuesta clara ofrece «Reintentar».
export function panelResultado(resultado: ResultadoCompartir, envio: EnvioCompartir): PanelCompartir {
    const dudoso = resultado.motivo === "sin_respuesta" || resultado.motivo === "tiempo_agotado";
    return { tipo: "resultado", resultado, ...(dudoso ? { reintento: envio } : {}) };
}

export default function CompartirTablaModal({ precio, capturarTabla, panel, onCambiar, onClose }: Props) {

    const enviando = panel.tipo === "enviando";

    async function reintentar(envio: EnvioCompartir) {
        onCambiar({ tipo: "enviando", grupos: envio.grupos });
        onCambiar(panelResultado(await enviarCompartir(precio, envio), envio));
    }

    return (
        <Modal
            open
            onClose={onClose}
            bloquearCierre={enviando}
            size="lg"
            title={panel.tipo === "configurar" ? "Compartir tabla en WhatsApp" : "Compartir tabla"}
            description={panel.tipo === "configurar" ? "Revisa la imagen y el texto, elige los grupos y confirma. Nada se envía hasta que confirmes." : undefined}
        >
            {panel.tipo === "enviando" && (
                <p role="status" className="text-sm text-gray-700">
                    Publicando la imagen de la tabla en {panel.grupos?.length ? `${panel.grupos.length} grupo(s)` : "tus grupos guardados"}… No cierres esta ventana.
                </p>
            )}
            {panel.tipo === "resultado" && (
                <Resultado
                    resultado={panel.resultado}
                    onCambiarGrupos={() => onCambiar({ tipo: "configurar", imagen: panel.reintento?.imagen })}
                    onReintentar={panel.reintento ? () => reintentar(panel.reintento!) : undefined}
                    onClose={onClose}
                />
            )}
            {panel.tipo === "configurar" && (
                <Configurar precio={precio} aviso={panel.aviso} imagenInicial={panel.imagen} capturarTabla={capturarTabla} onCambiar={onCambiar} onClose={onClose} />
            )}
        </Modal>
    );

}

const ETIQUETA = {
    enviado: "Enviado",
    ya_enviado: "Ya enviado en esta misma solicitud (no se duplicó)",
    en_curso: "Envío en curso",
    fallido: "Falló"
} as const;

function Resultado({ resultado, onCambiarGrupos, onReintentar, onClose }: { resultado: ResultadoCompartir; onCambiarGrupos: () => void; onReintentar?: () => void; onClose: () => void }) {

    const lista = resultado.resultados || [];

    return (
        <div className="flex flex-col gap-3">
            {lista.length > 0 ? (
                <>
                    <p className={`text-sm font-medium ${resultado.fallidos ? "text-amber-700" : "text-emerald-700"}`} role="status">
                        {resultado.fallidos
                            ? `Publicada en ${resultado.enviados} de ${lista.length} grupo(s). ${resultado.fallidos} falló(aron).`
                            : `Publicada en ${resultado.enviados} grupo(s).`}
                    </p>
                    <ul className="flex flex-col gap-1.5" aria-label="Resultado por grupo">
                        {lista.map(g => (
                            <li key={g.grupo_id} className="flex items-start gap-2 text-sm">
                                {g.estado === "fallido" ? <XCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                                    : g.estado === "en_curso" ? <Clock size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                        : <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />}
                                <span>
                                    <b>{g.nombre || g.grupo_id}</b> — {ETIQUETA[g.estado]}
                                    {g.error && <span className="block text-gray-500">{g.error}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className="text-sm text-rose-700" role="alert">{mensajeCompartir(resultado.motivo)}</p>
            )}
            {resultado.aviso && <p className="text-sm text-amber-700">{resultado.aviso}</p>}
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={onCambiarGrupos}>Cambiar grupos</Button>
                {onReintentar && <Button variant="secondary" onClick={onReintentar}>Reintentar</Button>}
                <Button onClick={onClose}>Cerrar</Button>
            </div>
        </div>
    );

}

type Carga = { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "ok"; vista: VistaPreviaCompartir };

interface PropsConfigurar {
    precio: number;
    aviso?: string;
    imagenInicial?: string;
    capturarTabla: () => Promise<string>;
    onCambiar: (p: PanelCompartir) => void;
    onClose: () => void;
}

function Configurar({ precio, aviso, imagenInicial, capturarTabla, onCambiar, onClose }: PropsConfigurar) {

    const [carga, setCarga] = useState<Carga>({ tipo: "cargando" });
    // Captura del `div` de la tabla visible: la que se ve aquí es la que se envía.
    const [imagen, setImagen] = useState<string | null>(imagenInicial || null);
    const [errorImagen, setErrorImagen] = useState<string | null>(null);
    const [seleccion, setSeleccion] = useState<string[]>([]);
    const [texto, setTexto] = useState("");
    const [confirmando, setConfirmando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [mensaje, setMensaje] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
    const enviandoRef = useRef(false);

    useEffect(() => {
        let vigente = true;
        vistaPreviaCompartir(precio).then(r => {
            if (!vigente) return;
            if (!r.ok) { setCarga({ tipo: "error", mensaje: mensajeCompartir(r.motivo) }); return; }
            setSeleccion(r.data.seleccion);
            setTexto(r.data.texto);
            setCarga({ tipo: "ok", vista: r.data });
        }).catch(() => {
            if (vigente) setCarga({ tipo: "error", mensaje: mensajeCompartir("vista_previa_sin_respuesta") });
        });
        if (!imagenInicial) {
            capturarTabla()
                .then(png => { if (vigente) setImagen(png); })
                .catch(e => { if (vigente) setErrorImagen(e instanceof Error ? e.message : "No se pudo generar la imagen de la tabla."); });
        }
        return () => { vigente = false; };
    // Se carga una vez al abrir; capturarTabla/imagenInicial no cambian mientras está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [precio]);

    if (carga.tipo === "cargando") return <p role="status" className="text-sm text-gray-600">Generando la vista previa de la tabla…</p>;
    if (carga.tipo === "error") return <p role="alert" className="text-sm text-rose-700">{carga.mensaje}</p>;

    const vista = carga.vista;
    const nombreDe = (id: string) => vista.grupos.find(g => g.grupo_id === id)?.nombre || id;
    const cambiar = (id: string) => { setMensaje(null); setConfirmando(false); setSeleccion(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); };

    async function guardarGrupos() {
        if (guardando) return;
        setGuardando(true);
        try {
            const r = await guardarDestinosCompartir(precio, seleccion);
            setMensaje(r.ok ? { tono: "ok", texto: "Grupos guardados. El próximo «Compartir» publicará en ellos directamente." } : { tono: "error", texto: mensajeCompartir(r.motivo) });
        } catch {
            setMensaje({ tono: "error", texto: "No se pudieron guardar los grupos (sin conexión con el servidor). Inténtalo de nuevo." });
        } finally {
            setGuardando(false);
        }
    }

    async function enviar() {
        if (enviandoRef.current || !imagen) return;
        enviandoRef.current = true;
        const grupos = [...seleccion];
        const envio: EnvioCompartir = {
            solicitudId: nuevaSolicitud(),
            imagen,
            grupos,
            guardarDestinos: true,
            ...(texto.trim() !== vista.texto.trim() ? { texto } : {})
        };
        onCambiar({ tipo: "enviando", grupos });
        const resultado = await enviarCompartir(precio, envio);
        if (resultado.motivo === "destinos_no_disponibles" || resultado.motivo === "sin_destinos") {
            onCambiar({ tipo: "configurar", imagen, aviso: mensajeCompartir(resultado.motivo) });
            return;
        }
        onCambiar(panelResultado(resultado, envio));
    }

    return (
        <div className="flex flex-col gap-4">

            {aviso && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="alert">{aviso}</p>}
            {!vista.sesion_conectada && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{mensajeCompartir("sin_sesion_activa")}</p>}
            {vista.invalidos.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{vista.invalidos.length} grupo(s) guardado(s) ya no están disponibles y se quitaron de la selección.</p>}

            <section aria-label="Vista previa del mensaje" className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                {imagen
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={imagen} alt={`Tabla de $${precio.toLocaleString("es-CO")}`} className="mx-auto max-h-[420px] w-auto rounded-lg" />
                    : errorImagen
                        ? <p className="text-sm text-rose-700" role="alert">{errorImagen} Sin imagen no se puede enviar.</p>
                        : <p className="text-sm text-gray-600" role="status">Capturando la tabla…</p>}
                <Textarea
                    label="Texto de la publicación (pie de foto)"
                    rows={6}
                    value={texto}
                    onChange={e => { setTexto(e.target.value); setConfirmando(false); }}
                    hint={vista.origen_texto === "sorteo"
                        ? "Es el «Mensaje de publicación» del sorteo activo. Lo que cambies aquí vale solo para este envío; para cambiarlo siempre, usa «Editar»."
                        : "Texto habitual de «Compartir» (el sorteo no tiene mensaje de publicación). Lo que cambies aquí vale solo para este envío; para fijarlo, usa «Editar» → Mensaje de publicación."}
                />
            </section>

            <section aria-label="Grupos de destino" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Grupos de WhatsApp</h3>
                {vista.grupos.length === 0 ? (
                    <p className="text-sm text-gray-600">No tienes grupos autorizados. Autoriza grupos en Automatización para poder compartir.</p>
                ) : vista.grupos.map(g => (
                    <label key={g.grupo_id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={seleccion.includes(g.grupo_id)} onChange={() => cambiar(g.grupo_id)} />
                        {g.nombre || g.grupo_id}
                    </label>
                ))}
                {!vista.persistencia && <p className="text-xs text-gray-500">La selección todavía no se puede guardar: se pedirá en cada envío.</p>}
            </section>

            {mensaje && <p className={`text-sm ${mensaje.tono === "ok" ? "text-emerald-700" : "text-rose-700"}`} role="status">{mensaje.texto}</p>}

            {confirmando ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
                    <p className="font-medium text-indigo-900">Se publicará la imagen con este texto en:</p>
                    <ul className="my-2 list-disc pl-5 text-indigo-900">
                        {seleccion.map(id => <li key={id}>{nombreDe(id)}</li>)}
                    </ul>
                    <p className="text-indigo-800">Estos grupos quedarán guardados para los próximos «Compartir».</p>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => setConfirmando(false)}>Volver</Button>
                        <Button onClick={enviar} disabled={!vista.sesion_conectada || !imagen}>Confirmar y enviar</Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    {vista.persistencia && <Button variant="secondary" onClick={guardarGrupos} loading={guardando} loadingText="Guardando grupos…" disabled={!seleccion.length}>Guardar grupos sin enviar</Button>}
                    <Button onClick={() => setConfirmando(true)} disabled={!seleccion.length || !vista.sesion_conectada || !imagen}>Continuar</Button>
                </div>
            )}

        </div>
    );

}
