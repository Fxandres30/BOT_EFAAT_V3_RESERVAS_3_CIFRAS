"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { Aviso, avisar } from "@/components/ui/Avisos";
import { useAccion } from "@/hooks/useAccion";
import { formatHora12 } from "@/lib/formatHora";

import {
    AutomationConfig,
    ConfigRecordatorios,
    guardarSiNoCambio,
    normalizarPublicacionInicialTabla,
    obtenerConfiguracion
} from "@/services/automatizacion/automationConfigs";
import { AutomationMessage, listarMensajes } from "@/services/automatizacion/mensajesAutomation";
import { CATEGORIAS_AUTOMATIZACION, DIAS_SEMANA, nombreCategoria } from "@/services/automatizacion/tiposCategorias";
import {
    EstadoRecordatorio,
    claveRecordatorio,
    formatearMomento,
    formatearRestante
} from "@/services/automatizacion/estadoProgramacion";
import {
    cambiarMinutos,
    columnasCambiadas,
    listarProgramaciones,
    minutosParaDuplicado,
    validarEspera,
    validarHora,
    validarMinutos,
    validarUmbral
} from "@/services/automatizacion/centroAutomatizaciones";

import type { FilaGrupo } from "./filaGrupo";
import type { SeccionEditor } from "./TarjetaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

interface Props {
    usuarioId: string;
    fila: FilaGrupo;
    seccionInicial: SeccionEditor;
    ahora: Date;
    onClose: () => void;
    onGuardado: (config: AutomationConfig) => void;
    onHistorial: () => void;
}

// El contenido de los mensajes NO se edita aquí: vive solo en la biblioteca
// central (/mensajes → «Mensajes de automatización»). Aquí solo se elige
// qué mensajes de esa biblioteca usa cada envío.
const SECCIONES: { value: SeccionEditor; label: string }[] = [
    { value: "general", label: "General" },
    { value: "programaciones", label: "Recordatorios" },
    { value: "reglas", label: "Actualizaciones y cierre" },
    { value: "tabla", label: "Tabla inicial" }
];

// Enlace a la biblioteca central, filtrada por tipo y categoría.
export function enlaceBiblioteca(tipo: string, categoria: string | null): string {
    const q = new URLSearchParams({ vista: "automatizacion", tipo });
    if (categoria) q.set("categoria", categoria);
    return `/mensajes?${q.toString()}`;
}

function EnlaceBiblioteca({ tipo, categoria, children }: { tipo: string; categoria: string | null; children: ReactNode }) {
    return (
        <Link href={enlaceBiblioteca(tipo, categoria)} target="_blank" rel="noopener noreferrer" prefetch={false} className={styles.enlaceBiblioteca}>
            {children} <ExternalLink size={12} aria-hidden="true" />
        </Link>
    );
}

const TONO_ESTADO: Record<EstadoRecordatorio, BadgeTone> = {
    desactivado: "neutral",
    pausado: "neutral",
    sin_evento: "neutral",
    sin_hora: "warning",
    programado: "primary",
    proximo: "primary",
    pendiente: "primary",
    enviando: "primary",
    sin_registro: "warning",
    sin_confirmar: "warning",
    enviado: "success",
    omitido: "neutral",
    error: "error",
    no_enviado: "warning"
};

function sinClave(obj: Record<string, string>, clave: string): Record<string, string> {
    const copia = { ...obj };
    delete copia[clave];
    return copia;
}

function borradorDe(config: AutomationConfig): AutomationConfig {
    return {
        ...config,
        recordatorios: JSON.parse(JSON.stringify(config.recordatorios || {})),
        mensaje_actualizacion: { activo: config.mensaje_actualizacion?.activo === true, categoria: config.mensaje_actualizacion?.categoria ?? null },
        mensaje_cierre: { activo: config.mensaje_cierre?.activo === true, categoria: config.mensaje_cierre?.categoria ?? null },
        publicacion_inicial_tabla: normalizarPublicacionInicialTabla(config.publicacion_inicial_tabla)
    };
}

function Interruptor({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            className={`${styles.switch} ${on ? styles.switchOn : ""}`}
            onClick={onClick}
            disabled={disabled}
        />
    );
}

// Elige QUÉ mensajes de la biblioteca central usa un envío: cualquiera de
// su tipo o solo los de una categoría (el backend elige uno al azar entre
// los activos — messageSelector.js, sin cambios).
function SelectorCategoria({ valor, onChange, label }: { valor: string | null; onChange: (v: string | null) => void; label: string }) {
    return (
        <select className={styles.selectCorto} value={valor || ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
            <option value="">Cualquier mensaje activo</option>
            {CATEGORIAS_AUTOMATIZACION.map((c) => <option key={c.id} value={c.id}>Solo «{c.label}»</option>)}
        </select>
    );
}

function textoActivos(cuenta: Record<string, number> | undefined, categoria: string | null): string | null {
    if (!cuenta) return null;
    const n = categoria ? cuenta[categoria] || 0 : cuenta["*"] || 0;
    return n === 0 ? "Sin mensajes activos" : `${n} mensaje${n === 1 ? "" : "s"} activo${n === 1 ? "" : "s"}`;
}

export default function EditorAutomatizacion({ usuarioId, fila, seccionInicial, ahora, onClose, onGuardado, onHistorial }: Props) {

    // Base = la versión guardada que se está editando (cambia al guardar o
    // al cargar la versión vigente tras un conflicto).
    const [base, setBase] = useState<AutomationConfig>(() => borradorDe(fila.config));
    const [borrador, setBorrador] = useState<AutomationConfig>(() => borradorDe(fila.config));
    const [seccion, setSeccion] = useState<SeccionEditor>(seccionInicial);

    const [minutosEditando, setMinutosEditando] = useState<Record<string, string>>({});
    const [erroresMinutos, setErroresMinutos] = useState<Record<string, string>>({});
    const [nuevoMinutos, setNuevoMinutos] = useState("");
    const [nuevaCategoria, setNuevaCategoria] = useState<string | null>(null);
    const [errorNuevo, setErrorNuevo] = useState<string | null>(null);

    const [conflicto, setConflicto] = useState(false);
    const [pidiendoCierre, setPidiendoCierre] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);

    // tipo -> (categoría | "*") -> mensajes activos en la biblioteca central.
    const [activosPorTipo, setActivosPorTipo] = useState<Record<string, Record<string, number>> | null>(null);
    const activosPorCategoria = activosPorTipo ? activosPorTipo.REMINDER_MESSAGE || { "*": 0 } : null;

    const guardar = useAccion(async () => {

        const cambios = columnasCambiadas(base, borrador);

        if (Object.keys(cambios).length === 0) return null;

        return guardarSiNoCambio(usuarioId, base.grupo_id, base.actualizado_en, cambios);

    }, { mensajeError: "No se pudo guardar la configuración." });

    const recargar = useAccion(async () => obtenerConfiguracion(usuarioId, base.grupo_id));

    // Mensajes activos de la biblioteca por tipo y categoría (solo lectura):
    // muestra cuántos textos puede usar cada envío y avisa si no tendría
    // ninguno que enviar.
    useEffect(() => {

        let vigente = true;

        listarMensajes(usuarioId, { estado: "activos" }).then(({ data, error }) => {
            if (!vigente || error) return;
            const cuenta: Record<string, Record<string, number>> = {};
            for (const m of (data as AutomationMessage[]) || []) {
                const porTipo = (cuenta[m.tipo] ||= { "*": 0 });
                porTipo["*"] += 1;
                const c = m.categoria ?? "";
                porTipo[c] = (porTipo[c] || 0) + 1;
            }
            setActivosPorTipo(cuenta);
        });

        return () => { vigente = false; };

    }, [usuarioId, seccion]);

    const cambios = useMemo(() => columnasCambiadas(base, borrador), [base, borrador]);
    const sucio = Object.keys(cambios).length > 0;

    const programaciones = listarProgramaciones(borrador.recordatorios);
    const minutosEnEdicion = Object.keys(minutosEditando).length > 0;

    const erroresReglas = [
        validarUmbral(borrador.umbral_reservas),
        validarEspera(borrador.cooldown_minutos),
        borrador.publicacion_inicial_tabla.activo ? validarHora(borrador.publicacion_inicial_tabla.hora) : null
    ].filter(Boolean) as string[];

    const bloqueoGuardar = erroresReglas.length > 0 || Object.keys(erroresMinutos).length > 0 || minutosEnEdicion;

    // --------------------------------------------------------- acciones ---

    function setRecordatorios(nuevo: ConfigRecordatorios) {
        setGuardadoOk(false);
        setBorrador((prev) => ({ ...prev, recordatorios: nuevo }));
    }

    function actualizarProgramacion(clave: string, cambiosCfg: Partial<{ activo: boolean; categoria: string | null }>) {
        const actual = borrador.recordatorios[clave] || { activo: false, categoria: null };
        setRecordatorios({ ...borrador.recordatorios, [clave]: { ...actual, ...cambiosCfg } });
    }

    function confirmarMinutos(clave: string) {

        const texto = minutosEditando[clave];

        if (texto === undefined) return;

        const error = validarMinutos(texto, Object.keys(borrador.recordatorios), clave);

        if (error) {
            setErroresMinutos((prev) => ({ ...prev, [clave]: error }));
            return;
        }

        const destino = String(Number(texto.trim()));

        setRecordatorios(cambiarMinutos(borrador.recordatorios, clave, destino));
        setMinutosEditando((prev) => sinClave(prev, clave));
        setErroresMinutos((prev) => sinClave(prev, clave));

    }

    function cancelarMinutos(clave: string) {
        setMinutosEditando((prev) => sinClave(prev, clave));
        setErroresMinutos((prev) => sinClave(prev, clave));
    }

    function eliminarProgramacion(clave: string) {
        const copia = { ...borrador.recordatorios };
        delete copia[clave];
        setRecordatorios(copia);
        cancelarMinutos(clave);
    }

    function duplicarProgramacion(minutos: number, clave: string) {
        const libre = minutosParaDuplicado(borrador.recordatorios, minutos);
        if (libre === null) return;
        const original = borrador.recordatorios[clave];
        setRecordatorios({ ...borrador.recordatorios, [String(libre)]: { activo: original?.activo === true, categoria: original?.categoria ?? null } });
        setMinutosEditando((prev) => ({ ...prev, [String(libre)]: String(libre) }));
    }

    function agregarProgramacion() {

        const error = validarMinutos(nuevoMinutos, Object.keys(borrador.recordatorios));

        if (error) {
            setErrorNuevo(error);
            return;
        }

        setRecordatorios({ ...borrador.recordatorios, [String(Number(nuevoMinutos.trim()))]: { activo: true, categoria: nuevaCategoria } });
        setNuevoMinutos("");
        setErrorNuevo(null);

    }

    function cambiar<K extends keyof AutomationConfig>(columna: K, valor: AutomationConfig[K]) {
        setGuardadoOk(false);
        setBorrador((prev) => ({ ...prev, [columna]: valor }));
    }

    async function onGuardar() {

        if (!sucio || bloqueoGuardar) return;

        const r = await guardar.ejecutar();

        if (!r.ok || r.valor === null) return;

        const resultado = r.valor;

        if (resultado.ok) {
            const guardada = borradorDe(resultado.config);
            setBase(guardada);
            setBorrador(guardada);
            setConflicto(false);
            setGuardadoOk(true);
            onGuardado(resultado.config);
            avisar.ok("Cambios guardados. La automatización los aplica en menos de un minuto.");
            return;
        }

        if (resultado.conflicto) {
            setConflicto(true);
            return;
        }

        avisar.error(`No se pudo guardar (${resultado.mensaje}).`);

    }

    async function cargarVigente() {

        const r = await recargar.ejecutar();

        if (!r.ok || r.valor.error || !r.valor.data) {
            avisar.error("No pudimos leer la versión actual del grupo.");
            return;
        }

        const vigente = borradorDe(r.valor.data as AutomationConfig);
        setBase(vigente);
        setBorrador(vigente);
        setMinutosEditando({});
        setErroresMinutos({});
        setConflicto(false);
        onGuardado(r.valor.data as AutomationConfig);
        avisar.info("Se cargó la versión actual del grupo. Tus cambios anteriores se descartaron.");

    }

    function pedirCierre() {
        if (guardar.procesando) return;
        if (sucio || minutosEnEdicion) {
            setPidiendoCierre(true);
            return;
        }
        onClose();
    }

    // ------------------------------------------------------- secciones ---

    const restante = fila.cierre ? fila.cierre.getTime() - ahora.getTime() : null;
    const accionesPorClave = new Map(fila.acciones.map((a) => [a.clave_idempotencia, a]));

    function seccionGeneral() {

        return (

            <div className={styles.seccion}>

                <div className={styles.bloque}>
                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Automatización de este grupo</span>
                        <span className={styles.switchFila}>
                            {borrador.activo ? "Activa" : "Desactivada"}
                            <Interruptor on={borrador.activo} label="Automatización del grupo" onClick={() => cambiar("activo", !borrador.activo)} />
                        </span>
                    </div>
                    {base.activo && !borrador.activo && (
                        <p className={styles.alerta}>
                            <AlertTriangle size={14} />
                            Al guardar, este grupo no enviará recordatorios, actualizaciones, tabla inicial ni cierre nuevos
                            mientras siga desactivado. Lo ya enviado se conserva en el historial. Los recordatorios cuyo momento
                            llegue durante la pausa quedan como «omitidos» y no se envían después.
                        </p>
                    )}
                    <p className={styles.nota}>
                        La apertura y el inicio del día se configuran en{" "}
                        <Link href={`/automatizacion/grupos/${encodeURIComponent(fila.config.grupo_id)}`} prefetch={false}>Detalles del grupo</Link>.
                    </p>
                    {fila.autorizado === false && (
                        <p className={styles.alerta}>
                            <AlertTriangle size={14} />
                            <span>
                                El grupo no está autorizado: la automatización no abrirá ciclos aquí hasta autorizarlo en{" "}
                                <Link href="/automatizacion/grupos" prefetch={false}>Grupos</Link>.
                            </span>
                        </p>
                    )}
                </div>

                <dl className={`${styles.bloque} ${styles.datos}`}>
                    <div className={styles.dato}>
                        <dt>Conexión de WhatsApp</dt>
                        <dd>
                            {{
                                conectado: "Conectado",
                                no_visto: "No aparece en tus sesiones conectadas",
                                sin_sesion: "Sin sesión de WhatsApp conectada",
                                no_verificable: "Sin verificar",
                                comprobando: "Comprobando…"
                            }[fila.conexion]}
                        </dd>
                    </div>
                    <div className={styles.dato}>
                        <dt>Evento detectado</dt>
                        <dd>{!fila.datosDisponibles ? "No disponible" : fila.evento ? fila.evento.nombre_evento || "Sorteo sin nombre" : "Sin evento activo"}</dd>
                    </div>
                    <div className={styles.dato}>
                        <dt>Hora de cierre</dt>
                        <dd>
                            {fila.cierre
                                ? formatearMomento(fila.cierre, ahora)
                                : fila.horaCierre ? `${formatHora12(fila.horaCierre)} · fecha no confirmada` : "—"}
                        </dd>
                    </div>
                    <div className={styles.dato}>
                        <dt>Tiempo restante</dt>
                        <dd>{restante === null ? "—" : restante > 0 ? formatearRestante(restante) : "Hora de cierre alcanzada"}</dd>
                    </div>
                </dl>

                <p className={styles.nota}>
                    La hora de cierre y los datos del sorteo salen siempre del evento real detectado. Esta pantalla no los
                    cambia ni puede cancelar, mover o modificar un sorteo.
                </p>

            </div>

        );

    }

    function seccionProgramaciones() {

        return (

            <div className={styles.seccion}>

                <p className={styles.nota}>
                    Cada recordatorio sale los minutos indicados antes del cierre real del sorteo, una sola vez por sorteo.
                    Elige qué mensajes de la biblioteca usa; los textos se escriben en{" "}
                    <EnlaceBiblioteca tipo="REMINDER_MESSAGE" categoria={null}>Mensajes</EnlaceBiblioteca>.
                </p>

                {programaciones.length === 0 && <p className={styles.nota}>Sin programaciones todavía.</p>}

                {programaciones.map(({ minutos, clave, cfg }) => {

                    const original = base.recordatorios?.[clave];
                    const enVivo = original ? fila.recordatorios.find((r) => r.clave === clave) : undefined;
                    const accion = fila.ciclo ? accionesPorClave.get(claveRecordatorio(fila.ciclo.id, minutos)) : undefined;
                    const momento = fila.cierre ? new Date(fila.cierre.getTime() - minutos * 60000) : null;
                    const yaPaso = !!momento && fila.cicloAbierto && momento.getTime() <= ahora.getTime() && (restante ?? 0) > 0;
                    const activosCategoria = activosPorCategoria ? (cfg.categoria ? activosPorCategoria[cfg.categoria] || 0 : activosPorCategoria["*"]) : null;
                    const editando = minutosEditando[clave] !== undefined;

                    return (

                        <div key={clave} className={`${styles.programacion} ${cfg.activo ? "" : styles.programacionApagada}`}>

                            <span className={styles.programacionMinutos}>
                                <input
                                    className={`${styles.campoCorto} ${erroresMinutos[clave] ? styles.campoInvalido : ""}`}
                                    inputMode="numeric"
                                    aria-label="Minutos antes del cierre"
                                    value={editando ? minutosEditando[clave] : String(minutos)}
                                    onChange={(e) => setMinutosEditando((prev) => ({ ...prev, [clave]: e.target.value }))}
                                    onBlur={() => confirmarMinutos(clave)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") confirmarMinutos(clave);
                                        if (e.key === "Escape") cancelarMinutos(clave);
                                    }}
                                />
                                min antes
                            </span>

                            <div className={styles.programacionCentro}>
                                <Interruptor
                                    on={cfg.activo}
                                    label={`Programación ${minutos} minutos antes`}
                                    onClick={() => actualizarProgramacion(clave, { activo: !cfg.activo })}
                                />
                                <SelectorCategoria
                                    valor={cfg.categoria}
                                    label={`Categoría de la programación ${minutos} minutos antes`}
                                    onChange={(categoria) => actualizarProgramacion(clave, { categoria })}
                                />
                                {!original ? (
                                    <Badge size="sm" tone="warning">Nueva · sin guardar</Badge>
                                ) : enVivo && fila.datosDisponibles ? (
                                    <Badge size="sm" tone={TONO_ESTADO[enVivo.resultado.estado]}>
                                        {enVivo.resultado.etiqueta}
                                        {enVivo.resultado.restanteMs !== null && ` · ${formatearRestante(enVivo.resultado.restanteMs)}`}
                                    </Badge>
                                ) : null}
                            </div>

                            <div className={styles.programacionAcciones}>
                                <Link
                                    href={enlaceBiblioteca("REMINDER_MESSAGE", cfg.categoria)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    prefetch={false}
                                    className={styles.iconoBoton}
                                    title="Ver estos mensajes en la biblioteca (Mensajes)"
                                    aria-label="Ver mensajes en la biblioteca"
                                >
                                    <ExternalLink size={14} />
                                </Link>
                                <button type="button" className={styles.iconoBoton} title="Duplicar" aria-label="Duplicar programación" onClick={() => duplicarProgramacion(minutos, clave)}>
                                    <Copy size={14} />
                                </button>
                                <button type="button" className={`${styles.iconoBoton} ${styles.iconoBotonPeligro}`} title="Eliminar" aria-label="Eliminar programación" onClick={() => eliminarProgramacion(clave)}>
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className={styles.programacionNotas}>
                                {erroresMinutos[clave] && <p className={styles.textoError}>{erroresMinutos[clave]}</p>}
                                {enVivo?.resultado.motivo && fila.datosDisponibles && <p className={styles.nota}>{enVivo.resultado.motivo}</p>}
                                {cfg.activo && activosCategoria === 0 && (
                                    <p className={styles.textoAviso}>
                                        No hay mensajes activos {cfg.categoria ? `en «${nombreCategoria(cfg.categoria)}»` : "de recordatorio"}: no se enviará nada.
                                    </p>
                                )}
                                {cfg.activo && borrador.activo && yaPaso && !accion && (
                                    <p className={styles.textoAviso}>Su momento ya pasó en el evento actual: al guardar se enviará en el próximo minuto.</p>
                                )}
                                {accion && !original && (
                                    <p className={styles.nota}>Esta anticipación ya se registró en el evento actual: no se repetirá.</p>
                                )}
                                {!cfg.activo && original?.activo && (
                                    <p className={styles.nota}>Desactivada: no se harán nuevos envíos de esta programación mientras siga así.</p>
                                )}
                            </div>

                        </div>

                    );

                })}

                <div className={styles.nuevaProgramacion}>
                    <span className={styles.programacionMinutos}>
                        <input
                            className={`${styles.campoCorto} ${errorNuevo ? styles.campoInvalido : ""}`}
                            inputMode="numeric"
                            placeholder="Minutos"
                            aria-label="Minutos antes del cierre de la nueva programación"
                            value={nuevoMinutos}
                            onChange={(e) => { setNuevoMinutos(e.target.value); setErrorNuevo(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") agregarProgramacion(); }}
                        />
                        min antes
                    </span>
                    <SelectorCategoria valor={nuevaCategoria} label="Categoría de la nueva programación" onChange={setNuevaCategoria} />
                    <Button size="sm" variant="secondary" onClick={agregarProgramacion}>
                        <Plus size={13} /> Agregar programación
                    </Button>
                    {errorNuevo && <p className={styles.textoError} style={{ width: "100%" }}>{errorNuevo}</p>}
                </div>

            </div>

        );

    }

    function seccionTabla() {

        const tabla = borrador.publicacion_inicial_tabla;
        const accion = fila.ciclo ? accionesPorClave.get(`${fila.ciclo.id}:INITIAL_TABLE`) : undefined;
        const errorHora = tabla.activo ? validarHora(tabla.hora) : null;

        const estadoTabla = !fila.datosDisponibles
            ? "No disponible"
            : !fila.evento
                ? "Sin evento activo"
                : accion
                    ? accion.estado === "ok" ? "Publicada en este evento" : accion.estado === "error" ? "Error al publicar en este evento" : "Publicándose"
                    : tabla.activo && borrador.activo ? "Pendiente para este evento" : "No se publicará en este evento";

        return (

            <div className={styles.seccion}>

                <div className={styles.bloque}>
                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Publicar la tabla al iniciar el evento</span>
                        <Interruptor
                            on={tabla.activo}
                            label="Tabla inicial"
                            onClick={() => cambiar("publicacion_inicial_tabla", { ...tabla, activo: !tabla.activo })}
                        />
                    </div>

                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Hora de publicación</span>
                        <input
                            type="time"
                            className={`${styles.campoCorto} ${errorHora ? styles.campoInvalido : ""}`}
                            style={{ width: 120 }}
                            value={tabla.hora}
                            onChange={(e) => cambiar("publicacion_inicial_tabla", { ...tabla, hora: e.target.value })}
                        />
                    </div>
                    {errorHora && <p className={styles.textoError}>{errorHora}</p>}

                    <span className={styles.etiqueta}>Días</span>
                    <div className={styles.dias}>
                        {DIAS_SEMANA.map((d) => {
                            const on = tabla.dias_permitidos[d.id] === true;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    aria-pressed={on}
                                    className={`${styles.dia} ${on ? styles.diaOn : ""}`}
                                    onClick={() => cambiar("publicacion_inicial_tabla", { ...tabla, dias_permitidos: { ...tabla.dias_permitidos, [d.id]: !on } })}
                                >
                                    {d.label}
                                </button>
                            );
                        })}
                    </div>

                    <p className={styles.nota}>
                        Se publica una vez por evento, a partir de esta hora, cuando hay un evento abierto con su tabla. Si el
                        evento se detecta después de la hora, se publica en ese momento. Usa la misma imagen y el mismo texto que
                        «Compartir» en Tablas (ese texto no se edita aquí).
                    </p>
                </div>

                <div className={styles.bloque}>
                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Estado</span>
                        <Badge size="sm" tone={accion?.estado === "ok" ? "success" : accion?.estado === "error" ? "error" : "neutral"}>{estadoTabla}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={onHistorial}>Ver historial de este grupo</Button>
                </div>

            </div>

        );

    }

    function seccionReglas() {

        const act = borrador.mensaje_actualizacion;
        const cierre = borrador.mensaje_cierre;
        const errorUmbral = validarUmbral(borrador.umbral_reservas);
        const errorEspera = validarEspera(borrador.cooldown_minutos);

        return (

            <div className={styles.seccion}>

                <div className={styles.bloque}>
                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Actualizaciones (avisos de movimiento)</span>
                        <Interruptor on={act.activo} label="Avisos de movimiento" onClick={() => cambiar("mensaje_actualizacion", { ...act, activo: !act.activo })} />
                    </div>
                    <div className={styles.filaControl}>
                        <span className={styles.nota}>
                            Mensaje de la biblioteca
                            {textoActivos(activosPorTipo?.UPDATE_MESSAGE, act.categoria) && <> · {textoActivos(activosPorTipo?.UPDATE_MESSAGE, act.categoria)}</>}
                        </span>
                        <SelectorCategoria valor={act.categoria} label="Mensajes de actualización que se usan" onChange={(categoria) => cambiar("mensaje_actualizacion", { ...act, categoria })} />
                    </div>
                    <div className={styles.filaControl}>
                        <span className={styles.nota}>Enviar cuando haya al menos estas reservas nuevas</span>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            className={`${styles.campoCorto} ${errorUmbral ? styles.campoInvalido : ""}`}
                            value={Number.isFinite(borrador.umbral_reservas) ? borrador.umbral_reservas : ""}
                            onChange={(e) => cambiar("umbral_reservas", e.target.value === "" ? NaN : Number(e.target.value))}
                            aria-label="Umbral de reservas nuevas"
                        />
                    </div>
                    {errorUmbral && <p className={styles.textoError}>{errorUmbral}</p>}
                    <div className={styles.filaControl}>
                        <span className={styles.nota}>Espera mínima entre avisos (minutos)</span>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            className={`${styles.campoCorto} ${errorEspera ? styles.campoInvalido : ""}`}
                            value={Number.isFinite(borrador.cooldown_minutos) ? borrador.cooldown_minutos : ""}
                            onChange={(e) => cambiar("cooldown_minutos", e.target.value === "" ? NaN : Number(e.target.value))}
                            aria-label="Espera entre avisos"
                        />
                    </div>
                    {errorEspera && <p className={styles.textoError}>{errorEspera}</p>}
                    <p className={styles.nota}>
                        Solo se envía con números libres y el grupo abierto. Las reservas nuevas se cuentan desde el último aviso
                        (o desde la apertura).
                    </p>
                    <EnlaceBiblioteca tipo="UPDATE_MESSAGE" categoria={act.categoria}>Ver estos mensajes en la biblioteca</EnlaceBiblioteca>
                </div>

                <div className={styles.bloque}>
                    <div className={styles.filaControl}>
                        <span className={styles.etiqueta}>Mensaje de cierre</span>
                        <Interruptor on={cierre.activo} label="Mensaje de cierre" onClick={() => cambiar("mensaje_cierre", { ...cierre, activo: !cierre.activo })} />
                    </div>
                    <div className={styles.filaControl}>
                        <span className={styles.nota}>
                            Mensaje de la biblioteca
                            {textoActivos(activosPorTipo?.CLOSE_MESSAGE, cierre.categoria) && <> · {textoActivos(activosPorTipo?.CLOSE_MESSAGE, cierre.categoria)}</>}
                        </span>
                        <SelectorCategoria valor={cierre.categoria} label="Mensajes de cierre que se usan" onChange={(categoria) => cambiar("mensaje_cierre", { ...cierre, categoria })} />
                    </div>
                    <p className={styles.nota}>
                        Se envía cuando el sistema confirma el cierre real del evento, salvo que el sorteo tenga su propio aviso de
                        cierre (nunca se envían dos).
                    </p>
                    <EnlaceBiblioteca tipo="CLOSE_MESSAGE" categoria={cierre.categoria}>Ver estos mensajes en la biblioteca</EnlaceBiblioteca>
                </div>

            </div>

        );

    }

    // ----------------------------------------------------------- render ---

    return (

        <Modal
            open
            onClose={pedirCierre}
            size="lg"
            bloquearCierre={guardar.procesando}
            title={fila.nombre}
            description="Configuración de la automatización de este grupo"
            footer={
                <div className={styles.pieEditor}>
                    {sucio || minutosEnEdicion
                        ? <span className={styles.sinGuardar}>Cambios sin guardar</span>
                        : <span className={styles.nota}>{guardadoOk ? "Todo guardado." : "Sin cambios."}</span>}
                    <div className={styles.botonesPie}>
                        <Button variant="ghost" size="sm" onClick={pedirCierre} disabled={guardar.procesando}>Cerrar</Button>
                        <Button size="sm" onClick={onGuardar} loading={guardar.procesando} disabled={!sucio || bloqueoGuardar || guardar.procesando || conflicto}>
                            Guardar cambios
                        </Button>
                    </div>
                </div>
            }
        >

            <div className={styles.editor}>

                {pidiendoCierre && (
                    <Aviso tono="aviso">
                        <span>Tienes cambios sin guardar. </span>
                        <Button size="sm" variant="danger" onClick={onClose}>Descartar y cerrar</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => setPidiendoCierre(false)}>Seguir editando</Button>
                    </Aviso>
                )}

                {conflicto && (
                    <Aviso tono="error">
                        <span>Este grupo se modificó en otro lugar mientras lo editabas. No se guardó nada para no pisar esos cambios. </span>
                        <Button size="sm" variant="secondary" onClick={cargarVigente} loading={recargar.procesando}>Cargar la versión actual</Button>
                    </Aviso>
                )}

                {guardar.error && <Aviso tono="error">{guardar.error}</Aviso>}

                {erroresReglas.length > 0 && seccion !== "reglas" && seccion !== "tabla" && (
                    <Aviso tono="aviso">Hay datos por corregir en «Actualizaciones y cierre» o «Tabla inicial» antes de guardar.</Aviso>
                )}

                <Tabs items={SECCIONES} value={seccion} onValueChange={(v) => setSeccion(v as SeccionEditor)} aria-label="Secciones de la configuración" />

                {seccion === "general" && seccionGeneral()}
                {seccion === "programaciones" && seccionProgramaciones()}
                {seccion === "tabla" && seccionTabla()}
                {seccion === "reglas" && seccionReglas()}

            </div>

        </Modal>

    );

}
