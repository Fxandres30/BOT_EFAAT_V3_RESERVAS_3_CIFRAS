"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Clock, Loader2, Ban, ImageIcon, Send } from "lucide-react";

import { Modal, Button, Textarea } from "@/components/ui";
import {
    compartirTabla,
    vistaPreviaCompartir,
    guardarDestinosCompartir,
    guardarMensajeCompartir,
    consultarOperacion,
    cancelarOperacion,
    mensajeCompartir,
    type EnvioCompartir,
    type EstadoGrupoOperacion,
    type OperacionCompartir,
    type ResultadoCompartir,
    type VistaPreviaCompartir
} from "@/services/tablas/compartirTabla";

// Lo que muestra el modal de «Compartir» (AccionesTabla decide cuál):
//   enviando   — la petición de envío va de camino al servidor (segundos);
//   progreso   — el envío ya es una OPERACIÓN del servidor: progreso real por
//                grupo, «Cancelar envío» y «Cerrar ventana» (no cancela);
//   resultado  — error antes de empezar, o envío sin respuesta clara;
//   configurar — vista previa real (captura del `div` de la tabla visible +
//                el texto EXACTO que llegará a WhatsApp), elección de grupos
//                y confirmación. Cargarla NUNCA envía nada.
// MENSAJE ÚNICO (04/11): el texto es siempre el mensaje guardado del
// sorteo, generado en el servidor con el mismo generador que publica. Aquí
// no hay una copia editable «para este envío»: «Editar mensaje» cambia el
// mensaje del sorteo (el mismo de «Editar») y la vista previa se recalcula.
// `reintento`: envío sin respuesta clara (red caída, tiempo agotado); se
// puede repetir con la MISMA solicitud, que no reenvía a grupos ya hechos.
export type PanelCompartir =
    | { tipo: "enviando"; grupos?: string[] }
    | { tipo: "progreso"; operacion: OperacionCompartir; reintento?: EnvioCompartir; aviso?: string }
    | { tipo: "resultado"; resultado: ResultadoCompartir; reintento?: EnvioCompartir }
    | { tipo: "configurar"; aviso?: string; imagen?: string };

interface Props {
    precio: number;
    /** PNG (data URL) del `div` de la tabla visible. */
    capturarTabla: () => Promise<string>;
    panel: PanelCompartir;
    onCambiar: (panel: PanelCompartir) => void;
    onClose: () => void;
    /** Cada lectura real del progreso (AccionesTabla la sigue al cerrar la ventana). */
    onOperacion?: (operacion: OperacionCompartir) => void;
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

// Resultado -> panel. Aceptado (o ya en curso): progreso de la operación.
// Sin respuesta clara: «Reintentar» con la misma solicitud.
export function panelResultado(resultado: ResultadoCompartir, envio: EnvioCompartir): PanelCompartir {
    if (resultado.operacion) {
        const otra = resultado.motivo === "envio_en_curso" && resultado.operacion.id !== envio.solicitudId;
        return { tipo: "progreso", operacion: resultado.operacion, ...(otra ? { aviso: "Ya había un envío de esta tabla en curso: este es su progreso. No se inició otro." } : { reintento: envio }) };
    }
    const dudoso = resultado.motivo === "sin_respuesta" || resultado.motivo === "tiempo_agotado";
    return { tipo: "resultado", resultado, ...(dudoso ? { reintento: envio } : {}) };
}

export default function CompartirTablaModal({ precio, capturarTabla, panel, onCambiar, onClose, onOperacion }: Props) {

    const enviando = panel.tipo === "enviando";

    async function reintentar(envio: EnvioCompartir) {
        onCambiar({ tipo: "enviando", grupos: envio.grupos });
        onCambiar(panelResultado(await enviarCompartir(precio, envio), envio));
    }

    const titulo = panel.tipo === "configurar" ? "Compartir tabla en WhatsApp"
        : panel.tipo === "progreso" ? "Compartiendo la tabla"
            : "Compartir tabla";

    return (
        <Modal
            open
            onClose={onClose}
            bloquearCierre={enviando}
            size="lg"
            title={titulo}
            description={panel.tipo === "configurar" ? "Revisa la imagen y el mensaje, elige los grupos y confirma. Nada se envía hasta que confirmes." : undefined}
        >
            {panel.tipo === "enviando" && (
                <p role="status" className="flex items-center gap-2 text-sm text-gray-700">
                    <Loader2 size={16} className="animate-spin" />
                    Iniciando el envío a {panel.grupos?.length ? `${panel.grupos.length} grupo(s)` : "tus grupos guardados"}…
                </p>
            )}
            {panel.tipo === "progreso" && (
                <Progreso
                    key={panel.operacion.id}
                    inicial={panel.operacion}
                    aviso={panel.aviso}
                    onOperacion={onOperacion}
                    onReintentar={panel.reintento ? () => reintentar(panel.reintento!) : undefined}
                    onCambiarGrupos={() => onCambiar({ tipo: "configurar", imagen: panel.reintento?.imagen })}
                    onClose={onClose}
                />
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

// ------------------------------------------------------------ progreso ---

const ESTADO_GRUPO: Record<EstadoGrupoOperacion, { texto: string; clase: string }> = {
    en_cola: { texto: "En cola", clase: "text-gray-600" },
    preparando: { texto: "Preparando", clase: "text-indigo-700" },
    enviando: { texto: "Enviando", clase: "text-blue-700" },
    enviado: { texto: "Enviado", clase: "text-emerald-700" },
    error: { texto: "Error", clase: "text-rose-700" },
    cancelado: { texto: "Cancelado (no recibió nada)", clase: "text-gray-500" }
};

function IconoGrupo({ estado }: { estado: EstadoGrupoOperacion }) {
    const c = "shrink-0 mt-0.5";
    if (estado === "enviado") return <CheckCircle2 size={16} className={`${c} text-emerald-600`} />;
    if (estado === "error") return <XCircle size={16} className={`${c} text-rose-600`} />;
    if (estado === "cancelado") return <Ban size={16} className={`${c} text-gray-400`} />;
    if (estado === "preparando") return <ImageIcon size={16} className={`${c} text-indigo-600 animate-pulse`} />;
    if (estado === "enviando") return <Send size={16} className={`${c} text-blue-600 animate-pulse`} />;
    return <Clock size={16} className={`${c} text-gray-400`} />;
}

// Lectura del servidor cada segundo mientras la operación no termina. Es el
// estado REAL (cada grupo cambia cuando WhatsApp responde); nada se simula.
const INTERVALO_MS = 1000;

interface PropsProgreso {
    inicial: OperacionCompartir;
    aviso?: string;
    onOperacion?: (op: OperacionCompartir) => void;
    onReintentar?: () => void;
    onCambiarGrupos: () => void;
    onClose: () => void;
}

function Progreso({ inicial, aviso, onOperacion, onReintentar, onCambiarGrupos, onClose }: PropsProgreso) {

    const [op, setOp] = useState<OperacionCompartir>(inicial);
    const [sinConexion, setSinConexion] = useState(false);
    const [perdida, setPerdida] = useState(false);
    const [confirmarCancelar, setConfirmarCancelar] = useState(false);
    const [cancelando, setCancelando] = useState(false);
    const [errorCancelar, setErrorCancelar] = useState<string | null>(null);
    // Cada estado leído del servidor se comunica (AccionesTabla lo sigue
    // cuando la ventana se cierra).
    useEffect(() => { onOperacion?.(op); }, [op, onOperacion]);

    useEffect(() => {
        if (op.terminada || perdida) return;
        let vigente = true;
        const t = setTimeout(async () => {
            try {
                const r = await consultarOperacion(op.id);
                if (!vigente) return;
                if (r.ok) { setOp(r.data); setSinConexion(false); }
                else if (r.motivo === "no_encontrada") setPerdida(true);
                else setSinConexion(true);
            } catch {
                if (vigente) setSinConexion(true);
            }
        }, INTERVALO_MS);
        return () => { vigente = false; clearTimeout(t); };
    }, [op, perdida]);

    async function cancelar() {
        if (cancelando) return;
        setCancelando(true);
        setErrorCancelar(null);
        try {
            const r = await cancelarOperacion(op.id);
            if (r.ok) { setOp(r.data); setConfirmarCancelar(false); }
            else setErrorCancelar(r.motivo === "no_encontrada" ? mensajeCompartir("no_encontrada") : "No se pudo pedir la cancelación. Inténtalo de nuevo.");
        } catch {
            setErrorCancelar("Sin conexión con el servidor: la cancelación no llegó. Inténtalo de nuevo.");
        } finally {
            setCancelando(false);
        }
    }

    const { totales } = op;
    const activados = op.grupos.filter(g => g.tipo === "activar" && g.estado === "enviado").length;

    return (
        <div className="flex flex-col gap-4">

            {aviso && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="alert">{aviso}</p>}

            <div className="flex flex-col gap-2">
                <p role="status" aria-live="polite" className={`text-sm font-medium ${op.estado === "fallida" ? "text-rose-700" : op.estado === "cancelada" || op.estado === "con_errores" ? "text-amber-700" : op.terminada ? "text-emerald-700" : "text-gray-800"}`}>
                    {op.estado === "completada"
                        ? `Publicada en ${totales.enviados} grupo(s).`
                        : op.estado === "con_errores"
                            ? `Publicada en ${totales.enviados} de ${totales.total} grupo(s). ${totales.fallidos} falló(aron).`
                            : op.etapa}
                </p>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label="Progreso del envío" aria-valuemin={0} aria-valuemax={100} aria-valuenow={totales.porcentaje}>
                    <div className={`h-full rounded-full transition-[width] duration-300 ${op.estado === "cancelada" ? "bg-gray-400" : totales.fallidos ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${totales.porcentaje}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5" aria-label="Resumen del envío">
                    <Contador nombre="Grupos" valor={totales.total} />
                    <Contador nombre="Enviados" valor={totales.enviados} tono="text-emerald-700" />
                    <Contador nombre="Pendientes" valor={totales.pendientes} />
                    <Contador nombre="Fallidos" valor={totales.fallidos} tono={totales.fallidos ? "text-rose-700" : undefined} />
                    <Contador nombre="Cancelados" valor={totales.cancelados} tono={totales.cancelados ? "text-gray-700" : undefined} />
                </dl>
            </div>

            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" aria-label="Estado por grupo">
                {op.grupos.map(g => (
                    <li key={g.grupo_id} className="flex items-start gap-2 text-sm">
                        <IconoGrupo estado={g.estado} />
                        <span className="min-w-0">
                            <b>{g.nombre || g.grupo_id}</b> — <span className={ESTADO_GRUPO[g.estado].clase}>
                                {g.tipo === "activar" && g.estado === "enviado" ? "Sorteo activado en el grupo y anuncio enviado"
                                    : g.tipo === "activar" && g.estado === "preparando" ? "Activando el sorteo en el grupo"
                                        : ESTADO_GRUPO[g.estado].texto}
                            </span>
                            {g.error && <span className="block text-gray-500">{g.error}</span>}
                            {g.detalle && !(g.tipo === "activar" && g.estado === "enviado") && <span className="block text-gray-500">{g.detalle}</span>}
                        </span>
                    </li>
                ))}
            </ul>

            {op.terminada && op.estado === "cancelada" && (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    {totales.enviados > 0
                        ? `${totales.enviados} grupo(s) ya habían recibido la tabla antes de cancelar: WhatsApp no permite retirarla desde aquí. `
                        : "Ningún grupo recibió la tabla. "}
                    {totales.cancelados} grupo(s) no recibieron nada.
                </p>
            )}
            {activados > 0 && op.terminada && <p className="text-sm text-emerald-700">El sorteo quedó activo en {activados} grupo(s) nuevo(s).</p>}
            {op.aviso && <p className="text-sm text-amber-700">{op.aviso}</p>}
            {sinConexion && !op.terminada && <p className="text-sm text-amber-700" role="alert">Sin conexión para consultar el progreso; se sigue intentando. El envío continúa en el servidor.</p>}
            {perdida && <p className="text-sm text-rose-700" role="alert">{mensajeCompartir("no_encontrada")}</p>}
            {errorCancelar && <p className="text-sm text-rose-700" role="alert">{errorCancelar}</p>}

            {op.mensaje && (
                <details className="rounded-lg border border-gray-200 p-2 text-sm">
                    <summary className="cursor-pointer text-gray-700">Mensaje de este envío</summary>
                    {op.mensaje.activo
                        ? <p className="mt-2 whitespace-pre-wrap break-words text-gray-800">{op.mensaje.texto}</p>
                        : <p className="mt-2 text-gray-600">El mensaje del sorteo está desactivado: se envía solo la imagen.</p>}
                </details>
            )}

            {!op.terminada && !perdida ? (
                confirmarCancelar ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                        <p className="font-medium">¿Cancelar el envío?</p>
                        <p className="mt-1">Los grupos que aún no han empezado no recibirán nada. Si un grupo ya se está enviando, termina y se informa. Lo ya publicado no se retira de WhatsApp.</p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button variant="secondary" onClick={() => setConfirmarCancelar(false)} disabled={cancelando}>No, seguir enviando</Button>
                            <Button variant="danger" onClick={cancelar} loading={cancelando} loadingText="Cancelando…">Sí, cancelar envío</Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="secondary" onClick={onClose}>Cerrar ventana</Button>
                            <Button variant="danger" onClick={() => setConfirmarCancelar(true)} disabled={op.cancelacion_solicitada}>
                                {op.cancelacion_solicitada ? "Cancelando…" : "Cancelar envío"}
                            </Button>
                        </div>
                        <p className="text-right text-xs text-gray-500">«Cerrar ventana» no detiene el envío: sigue en segundo plano y puedes volver a verlo con «Compartir».</p>
                    </div>
                )
            ) : (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={onCambiarGrupos}>Cambiar grupos</Button>
                    {perdida && onReintentar && <Button variant="secondary" onClick={onReintentar}>Reintentar</Button>}
                    <Button onClick={onClose}>Cerrar</Button>
                </div>
            )}

        </div>
    );

}

function Contador({ nombre, valor, tono }: { nombre: string; valor: number; tono?: string }) {
    return (
        <div className="rounded-lg bg-gray-50 px-2 py-1.5">
            <dt className="text-gray-500">{nombre}</dt>
            <dd className={`text-base font-semibold ${tono || "text-gray-900"}`}>{valor}</dd>
        </div>
    );
}

// ----------------------------------------------------------- resultado ---

// Estado del sorteo en cada grupo (vista previa del backend).
const ESTADO_EN_GRUPO = {
    activo: { texto: "Sorteo activo", clase: "bg-emerald-50 text-emerald-700" },
    pendiente: { texto: "Por publicar", clase: "bg-amber-50 text-amber-800" },
    error: { texto: "Error al publicar", clase: "bg-rose-50 text-rose-700" },
    sin_sorteo: null
} as const;

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
                                    <b>{g.nombre || g.grupo_id}</b> — {g.activado ? "Sorteo activado en el grupo y anuncio enviado" : ETIQUETA[g.estado]}
                                    {g.error && <span className="block text-gray-500">{g.error}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className="text-sm text-rose-700" role="alert">{resultado.mensaje || mensajeCompartir(resultado.motivo)}</p>
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

// ---------------------------------------------------------- configurar ---

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
    const [confirmando, setConfirmando] = useState(false);
    // Edición del MENSAJE DEL SORTEO (con {{variables}}): null = sin editar.
    const [editando, setEditando] = useState<string | null>(null);
    const [guardandoMensaje, setGuardandoMensaje] = useState(false);
    const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
    // Grupos nuevos de un sorteo del panel: ¿compartir también la tabla a los
    // que ya lo tienen? Por defecto no (no reciben nada repetido).
    const [compartirActivos, setCompartirActivos] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [mensaje, setMensaje] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
    const enviandoRef = useRef(false);

    useEffect(() => {
        let vigente = true;
        vistaPreviaCompartir(precio).then(r => {
            if (!vigente) return;
            if (!r.ok) { setCarga({ tipo: "error", mensaje: mensajeCompartir(r.motivo) }); return; }
            setSeleccion(r.data.seleccion);
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
    // Sorteo del panel: los grupos elegidos SON los del sorteo. Un grupo sin
    // el sorteo lo recibe (se activa con el anuncio); uno quitado donde
    // estaba activo deja de tenerlo (se desactiva ahí, reservas intactas).
    const delPanel = Boolean(vista.sorteo_programado_id);
    const estadoDe = (id: string) => vista.estado_grupos?.[id] || "sin_sorteo";
    const recibenSorteo = seleccion.filter(id => estadoDe(id) !== "activo");
    const yaActivos = seleccion.filter(id => estadoDe(id) === "activo");
    const seDesactivan = delPanel ? vista.grupos.filter(g => estadoDe(g.grupo_id) === "activo" && !seleccion.includes(g.grupo_id)).map(g => g.grupo_id) : [];
    const sinSorteoDetectado = !delPanel && vista.estado_grupos ? seleccion.filter(id => estadoDe(id) !== "activo") : [];
    const cambiar = (id: string) => { setMensaje(null); setConfirmando(false); setSeleccion(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); };
    const plantillaGuardada = vista.mensaje?.plantilla ?? "";
    const enEdicion = editando !== null;

    async function guardarMensaje() {
        if (guardandoMensaje || editando === null) return;
        setGuardandoMensaje(true);
        setErrorMensaje(null);
        try {
            const r = await guardarMensajeCompartir(precio, editando, plantillaGuardada);
            if (!r.ok) {
                setErrorMensaje(r.errores?.map(e => e.mensaje).join(" ") || r.mensaje || mensajeCompartir(r.motivo));
                return;
            }
            setCarga({ tipo: "ok", vista: { ...vista, texto: r.data.texto, origen_texto: r.data.origen_texto, texto_activo: r.data.texto_activo, mensaje: r.data.mensaje } });
            setEditando(null);
            setMensaje({ tono: "ok", texto: "Mensaje del sorteo guardado. La vista previa muestra exactamente lo que se enviará. No se envió nada." });
        } catch {
            setErrorMensaje("No se pudo guardar el mensaje (sin conexión con el servidor). Inténtalo de nuevo.");
        } finally {
            setGuardandoMensaje(false);
        }
    }

    async function guardarGrupos() {
        if (guardando) return;
        setGuardando(true);
        try {
            const r = await guardarDestinosCompartir(precio, seleccion);
            if (!r.ok) { setMensaje({ tono: "error", texto: r.mensaje || mensajeCompartir(r.motivo) }); return; }
            const d = r.data;
            const partes = ["Grupos del sorteo guardados (no se envió nada)."];
            if (d?.agregados?.length) partes.push(`Agregados: ${d.agregados.map(g => g.nombre || g.grupo_id).join(", ")}.`);
            if (d?.desactivados?.length) partes.push(`El sorteo se desactivó en ${d.desactivados.map(g => g.nombre || g.grupo_id).join(", ")} (sus reservas y pagos se conservan).`);
            if (d?.por_publicar) partes.push(`${d.por_publicar} grupo(s) nuevo(s) aún no tienen el sorteo: pulsa «Continuar» para activarlo ahí con el anuncio.`);
            if (d?.avisos?.length) partes.push(...d.avisos);
            setMensaje({ tono: "ok", texto: d?.agregados || d?.quitados ? partes.join(" ") : "Grupos guardados. El próximo «Compartir» publicará en ellos directamente." });
        } catch {
            setMensaje({ tono: "error", texto: "No se pudieron guardar los grupos (sin conexión con el servidor). Inténtalo de nuevo." });
        } finally {
            setGuardando(false);
        }
    }

    async function enviar() {
        if (enviandoRef.current || !imagen || enEdicion) return;
        enviandoRef.current = true;
        // Sorteo del panel con grupos nuevos: primero se GUARDA la asociación
        // (los nuevos quedan pendientes; un grupo quitado se desactiva) y
        // luego se publica solo en los nuevos (y en los activos si se marcó).
        const soloNuevos = delPanel && recibenSorteo.length > 0;
        if (soloNuevos) {
            const g = await guardarDestinosCompartir(precio, seleccion).catch(() => ({ ok: false as const, motivo: "sin_respuesta", mensaje: null }));
            if (!g.ok) {
                enviandoRef.current = false;
                setConfirmando(false);
                setMensaje({ tono: "error", texto: g.mensaje || mensajeCompartir(g.motivo) });
                return;
            }
        }
        const grupos = soloNuevos ? [...recibenSorteo, ...(compartirActivos ? yaActivos : [])] : [...seleccion];
        // Sin `texto`: el servidor toma la instantánea del mensaje guardado,
        // el mismo que se ve en la vista previa.
        const envio: EnvioCompartir = {
            solicitudId: nuevaSolicitud(),
            imagen,
            grupos,
            guardarDestinos: !soloNuevos
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
            {vista.operacion_activa && !vista.operacion_activa.terminada && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900" role="status">
                    <span>Hay un envío de esta tabla en curso ({vista.operacion_activa.totales.enviados} de {vista.operacion_activa.totales.total} grupo(s) enviados).</span>
                    <Button variant="secondary" size="sm" onClick={() => onCambiar({ tipo: "progreso", operacion: vista.operacion_activa! })}>Ver progreso</Button>
                </div>
            )}
            {!vista.sesion_conectada && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{mensajeCompartir("sin_sesion_activa")}</p>}
            {vista.invalidos.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{vista.invalidos.length} grupo(s) guardado(s) ya no están disponibles y se quitaron de la selección.</p>}

            <section aria-label="Vista previa del mensaje" className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                {imagen
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={imagen} alt={`Tabla de $${precio.toLocaleString("es-CO")}`} className="mx-auto max-h-[420px] w-auto rounded-lg" />
                    : errorImagen
                        ? <p className="text-sm text-rose-700" role="alert">{errorImagen} Sin imagen no se puede enviar.</p>
                        : <p className="text-sm text-gray-600" role="status">Capturando la tabla…</p>}

                <div className="mt-3 flex flex-col gap-1">
                    <span className="text-sm font-medium text-gray-800">Así llegará a WhatsApp (pie de foto)</span>
                    {vista.texto_activo === false ? (
                        <p className="text-sm text-gray-600">El mensaje está desactivado en el sorteo: se enviará solo la imagen.</p>
                    ) : (
                        <p data-mensaje-whatsapp className="whitespace-pre-wrap break-words rounded-lg bg-[#dcf8c6] px-3 py-2 text-sm text-gray-900 shadow-sm">{vista.texto}</p>
                    )}
                    <span className="text-xs text-gray-500">
                        {vista.origen_texto === "sorteo"
                            ? "Es el mensaje guardado del sorteo, con sus datos reales. Lo reciben igual este envío, los siguientes «Compartir» y los grupos nuevos del sorteo."
                            : "Este sorteo se detectó en WhatsApp y no tiene mensaje guardado: se usa el texto habitual de «Compartir». Puedes escribir uno: quedará guardado en el sorteo."}
                    </span>
                </div>

                {vista.mensaje?.editable && (enEdicion ? (
                    <div className="mt-3 flex flex-col gap-2">
                        <Textarea
                            label="Mensaje del sorteo (con variables)"
                            rows={8}
                            value={editando ?? ""}
                            onChange={e => { setEditando(e.target.value); setErrorMensaje(null); }}
                            error={errorMensaje || undefined}
                            hint="Las {{variables}} (nombre, hora, valor, premios, cuentas…) se reemplazan con los datos del sorteo. Guardar cambia el mensaje del sorteo (el mismo de «Editar»); lo ya publicado no cambia y no se envía nada."
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="secondary" onClick={() => { setEditando(null); setErrorMensaje(null); }} disabled={guardandoMensaje}>Descartar cambios</Button>
                            <Button onClick={guardarMensaje} loading={guardandoMensaje} loadingText="Guardando mensaje…" disabled={editando === plantillaGuardada}>Guardar mensaje</Button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-2 flex justify-end">
                        <Button variant="secondary" size="sm" onClick={() => { setEditando(plantillaGuardada); setConfirmando(false); setMensaje(null); }}>Editar mensaje</Button>
                    </div>
                ))}
            </section>

            <section aria-label="Grupos de destino" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Grupos de WhatsApp</h3>
                {vista.grupos.length === 0 ? (
                    <p className="text-sm text-gray-600">No tienes grupos autorizados. Autoriza grupos en Automatización para poder compartir.</p>
                ) : vista.grupos.map(g => {
                    const estado = ESTADO_EN_GRUPO[estadoDe(g.grupo_id)];
                    const marcado = seleccion.includes(g.grupo_id);
                    return (
                        <label key={g.grupo_id} className="flex flex-wrap items-center gap-2 text-sm">
                            <input type="checkbox" checked={marcado} onChange={() => cambiar(g.grupo_id)} />
                            {g.nombre || g.grupo_id}
                            {estado && <span className={`rounded-full px-2 py-0.5 text-xs ${estado.clase}`}>{estado.texto}</span>}
                            {!estado && marcado && delPanel && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Nuevo: recibirá este sorteo</span>}
                        </label>
                    );
                })}
                {seDesactivan.length > 0 && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                        Al guardar, el sorteo se DESACTIVA en {seDesactivan.map(nombreDe).join(", ")}: ahí deja de recibir reservas y mensajes del sorteo. Sus reservas y pagos se conservan.
                    </p>
                )}
                {sinSorteoDetectado.length > 0 && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                        Este sorteo se detectó en WhatsApp: en {sinSorteoDetectado.map(nombreDe).join(", ")} solo se enviará la imagen y ahí NO se registrarán reservas. Para activarlo en otro grupo: «Editar» → «Gestionar desde el panel» y luego agrega el grupo (misma tabla y reservas).
                    </p>
                )}
                {!vista.persistencia && <p className="text-xs text-gray-500">La selección todavía no se puede guardar: se pedirá en cada envío.</p>}
            </section>

            {mensaje && <p className={`text-sm ${mensaje.tono === "ok" ? "text-emerald-700" : "text-rose-700"}`} role="status">{mensaje.texto}</p>}
            {enEdicion && <p className="text-sm text-amber-700">Guarda o descarta el mensaje antes de continuar: así lo que ves es lo que se envía.</p>}

            {confirmando ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
                    {delPanel && recibenSorteo.length > 0 ? (
                        <>
                            <p className="font-medium text-indigo-900">Recibirán ESTE sorteo (se activa en el grupo, con su tabla, y se envía el anuncio):</p>
                            <ul className="my-2 list-disc pl-5 text-indigo-900">
                                {recibenSorteo.map(id => <li key={id}>{nombreDe(id)}</li>)}
                            </ul>
                            {yaActivos.length > 0 && (
                                <label className="my-2 flex items-start gap-2 text-indigo-900">
                                    <input type="checkbox" checked={compartirActivos} onChange={e => setCompartirActivos(e.target.checked)} />
                                    <span>
                                        Compartir también la tabla actualizada en los grupos que ya tienen el sorteo ({yaActivos.map(nombreDe).join(", ")}).
                                        <span className="block text-indigo-700">Sin marcar, esos grupos no reciben nada.</span>
                                    </span>
                                </label>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="font-medium text-indigo-900">Se publicará la imagen con este texto en:</p>
                            <ul className="my-2 list-disc pl-5 text-indigo-900">
                                {seleccion.map(id => <li key={id}>{nombreDe(id)}</li>)}
                            </ul>
                        </>
                    )}
                    {seDesactivan.length > 0 && <p className="text-amber-800">El sorteo se desactivará en {seDesactivan.map(nombreDe).join(", ")}.</p>}
                    <p className="text-indigo-800">Estos grupos quedarán guardados para los próximos «Compartir». Verás el progreso de cada grupo y podrás cancelar el envío.</p>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => setConfirmando(false)}>Volver</Button>
                        <Button onClick={enviar} disabled={!vista.sesion_conectada || !imagen || enEdicion}>Confirmar y enviar</Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    {vista.persistencia && <Button variant="secondary" onClick={guardarGrupos} loading={guardando} loadingText="Guardando grupos…" disabled={!seleccion.length}>Guardar grupos sin enviar</Button>}
                    <Button onClick={() => setConfirmando(true)} disabled={!seleccion.length || !vista.sesion_conectada || !imagen || enEdicion}>Continuar</Button>
                </div>
            )}

        </div>
    );

}
