"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Rocket, Bell, RefreshCw, Lock, TableProperties, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/Badge";

import { formatHora12 } from "@/lib/formatHora";

import { getUser } from "@/services/auth/getUser";
import {
    AutomationConfig,
    ConfigRecordatorios,
    configuracionPorDefecto,
    diasPermitidosSiempreAbierto,
    normalizarPublicacionInicialTabla,
    obtenerConfiguracion,
    guardarConfiguracion
} from "@/services/automatizacion/automationConfigs";
import { listarGruposAutorizados, autorizarGrupo, GrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposConversacion } from "@/services/chats/obtenerGruposConversacion";
import { obtenerGruposDisponibles } from "@/services/automatizacion/gruposDisponibles";
import { CATEGORIAS_AUTOMATIZACION, DIAS_SEMANA } from "@/services/automatizacion/tiposCategorias";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";

import styles from "./ConfiguracionGrupo.module.css";

interface Props {
    grupoId: string;
}

type Estado = "cargando" | "sin-sesion" | "listo" | "error";

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            className={`${styles.switch} ${on ? styles.switchOn : ""}`}
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onClick}
        />
    );
}

function Dot({ on }: { on: boolean }) {
    return (
        <StatusBadge status={on ? "active" : "inactive"} label={on ? "Sí" : "No"} size="sm" />
    );
}

export default function ConfiguracionGrupo({ grupoId }: Props) {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [estado, setEstado] = useState<Estado>("cargando");
    const [error, setError] = useState<string | null>(null);

    const [nombreGrupo, setNombreGrupo] = useState<string | null>(null);
    const [autorizacion, setAutorizacion] = useState<GrupoAutorizado | null>(null);

    const [config, setConfig] = useState<Omit<AutomationConfig, "id" | "creado_en" | "actualizado_en"> | null>(null);

    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);

    const [nuevoOffset, setNuevoOffset] = useState("");

    useEffect(() => {

        async function cargar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (!uid) {
                setEstado("sin-sesion");
                return;
            }

            const [autorizadosRes, conocidosRes, disponiblesRes, configRes] = await Promise.all([
                listarGruposAutorizados(uid),
                obtenerGruposConversacion(),
                obtenerGruposDisponibles(uid),
                obtenerConfiguracion(uid, grupoId)
            ]);

            if (configRes.error) {
                setError(`No se pudo cargar la configuración (${configRes.error.message}).`);
                setEstado("error");
                return;
            }

            const propia = (autorizadosRes.data || []).find((g: GrupoAutorizado) => g.grupo_id === grupoId) || null;
            setAutorizacion(propia);

            // Prioridad: grupo REAL de la sesión conectada > histórico de
            // mensajes_grupos_sorteos > el JID crudo (ver GruposAutomatizacion).
            const real = disponiblesRes.flatMap((s) => s.grupos).find((g) => g.id === grupoId);
            const conocido = conocidosRes.data.find((g) => g.grupo_id === grupoId);
            setNombreGrupo(real?.nombre || conocido?.grupo_nombre || null);

            const base = (configRes.data as AutomationConfig | null) || configuracionPorDefecto(uid, grupoId);

            // Fila vieja (creada antes de la migración 009) o sin guardar
            // todavía -> publicacion_inicial_tabla llega {} — se normaliza
            // a los mismos defaults que vería un grupo nuevo, nunca "todo
            // desmarcado" sin explicación.
            base.publicacion_inicial_tabla = normalizarPublicacionInicialTabla(base.publicacion_inicial_tabla);

            setConfig(base);

            setEstado("listo");

        }

        cargar();

    }, [grupoId]);

    async function autorizarSiHaceFalta() {

        if (!usuarioId) return;

        const { data, error: errorAutorizar } = await autorizarGrupo(usuarioId, grupoId);

        if (!errorAutorizar && data) {
            setAutorizacion(data as GrupoAutorizado);
        }

    }

    // Apertura sí acepta legado sin el campo "activo" (configs guardadas
    // antes de que este toggle existiera, columna jsonb libre) — se trata
    // como activa por defecto, solo un false explícito la apaga.
    const aperturaActiva = config ? config.mensaje_apertura?.activo !== false : false;

    const recordatorios = config
        ? Object.entries(config.recordatorios).sort((a, b) => Number(a[0]) - Number(b[0]))
        : [];
    const algunRecordatorioActivo = recordatorios.some(([, cfg]) => cfg.activo);

    function alternarTodosRecordatorios() {

        setConfig((prev) => {

            if (!prev) return prev;

            const activarTodos = !Object.values(prev.recordatorios).some((c) => c.activo);
            const actualizados: ConfigRecordatorios = {};

            for (const [offset, cfg] of Object.entries(prev.recordatorios)) {
                actualizados[offset] = { ...cfg, activo: activarTodos };
            }

            return { ...prev, recordatorios: actualizados };

        });

    }

    function actualizarRecordatorio(offset: string, cambios: Partial<{ activo: boolean; categoria: string | null }>) {

        setConfig((prev) => {

            if (!prev) return prev;

            const actual = prev.recordatorios[offset] || { activo: false, categoria: null };

            return {
                ...prev,
                recordatorios: {
                    ...prev.recordatorios,
                    [offset]: { ...actual, ...cambios }
                }
            };

        });

    }

    function quitarRecordatorio(offset: string) {

        setConfig((prev) => {

            if (!prev) return prev;

            const copia = { ...prev.recordatorios };
            delete copia[offset];

            return { ...prev, recordatorios: copia };

        });

    }

    function alternarDiaTabla(diaId: string) {

        setConfig((prev) => {

            if (!prev) return prev;

            return {
                ...prev,
                publicacion_inicial_tabla: {
                    ...prev.publicacion_inicial_tabla,
                    dias_permitidos: {
                        ...prev.publicacion_inicial_tabla.dias_permitidos,
                        [diaId]: !prev.publicacion_inicial_tabla.dias_permitidos[diaId]
                    }
                }
            };

        });

    }

    function agregarRecordatorio() {

        const minutos = Number(nuevoOffset);

        if (!Number.isFinite(minutos) || minutos <= 0) return;

        setConfig((prev) => {

            if (!prev) return prev;

            if (prev.recordatorios[String(minutos)]) return prev;

            return {
                ...prev,
                recordatorios: {
                    ...prev.recordatorios,
                    [String(minutos)]: { activo: true, categoria: null }
                }
            };

        });

        setNuevoOffset("");

    }

    async function guardar() {

        if (!usuarioId || !config) return;

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            activo: config.activo,
            // Siempre abierto los 7 días — el evento real detectado decide
            // cuándo arranca el ciclo, no un horario configurado aquí.
            dias_permitidos: diasPermitidosSiempreAbierto(),
            mensaje_apertura: config.mensaje_apertura,
            mensaje_cierre: config.mensaje_cierre,
            mensaje_actualizacion: config.mensaje_actualizacion,
            recordatorios: config.recordatorios,
            publicacion_inicial_tabla: config.publicacion_inicial_tabla,
            umbral_reservas: config.umbral_reservas,
            cooldown_minutos: config.cooldown_minutos
        });

        setGuardando(false);

        if (errorGuardar || !data) {
            setError(`No se pudo guardar (${errorGuardar?.message || "error desconocido"}).`);
            return;
        }

        setConfig(data as AutomationConfig);
        setGuardadoOk(true);

    }

    if (estado === "cargando") {
        return <div className={styles.state}>Cargando configuración…</div>;
    }

    if (estado === "sin-sesion") {
        return <div className={styles.state}>Debes iniciar sesión.</div>;
    }

    if (estado === "error" || !config) {
        return <div className={styles.state}>{error}</div>;
    }

    return (

        <div className={styles.page}>

            <AutomatizacionHeader />

            <div className={styles.header}>

                <div>
                    <Link href="/automatizacion/grupos" className={styles.back}>
                        <ChevronLeft size={13} /> Grupos
                    </Link>
                    <h1 className={styles.title}>{nombreGrupo || grupoId}</h1>
                    <p className={styles.jid}>{grupoId}</p>
                </div>

                <StatusBadge
                    status={config.activo ? "active" : "inactive"}
                    label={config.activo ? "Activa" : "Inactiva"}
                />

            </div>

            {!autorizacion && (
                <div className={styles.aviso}>
                    <span>
                        Este grupo todavía no está en <strong>grupos_autorizados</strong> — la
                        automatización nunca operará aquí hasta autorizarlo.
                    </span>
                    <Button size="sm" variant="secondary" onClick={autorizarSiHaceFalta}>
                        Autorizar ahora
                    </Button>
                </div>
            )}

            {error && (
                <p className={styles.noteError}>
                    <AlertTriangle size={13} /> {error}
                </p>
            )}
            {guardadoOk && <p className={styles.noteOk}>Configuración guardada.</p>}

            <div className={styles.resumen}>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Apertura</span>
                    <span className={styles.resumenValue}><Dot on={aperturaActiva} /></span>
                </div>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Tabla inicial</span>
                    <span className={styles.resumenValue}>
                        {config.publicacion_inicial_tabla.activo
                            ? formatHora12(config.publicacion_inicial_tabla.hora)
                            : <Dot on={false} />}
                    </span>
                </div>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Recordatorios</span>
                    <span className={styles.resumenValue}><Dot on={algunRecordatorioActivo} /></span>
                </div>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Actualización</span>
                    <span className={styles.resumenValue}><Dot on={config.mensaje_actualizacion.activo} /></span>
                </div>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Cierre</span>
                    <span className={styles.resumenValue}><Dot on={config.mensaje_cierre.activo} /></span>
                </div>
            </div>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Automatización</h2>

                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={config.activo}
                        onChange={(e) => setConfig({ ...config, activo: e.target.checked })}
                    />
                    Automatización activa para este grupo
                </label>

                <p className={styles.nota}>
                    El nombre, valor, premios, hora de cierre y demás datos del sorteo SIEMPRE
                    vienen del evento real detectado (Automation Engine, sin cambios). Aquí solo
                    se define qué debe hacer la automatización cuando eso pase — sin horario ni
                    días propios.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Acciones</h2>

                <div className={styles.actionRow}>
                    <span className={styles.actionLabel}><Rocket size={14} /> Apertura</span>
                    <Switch
                        on={aperturaActiva}
                        label="Apertura"
                        onClick={() => setConfig({
                            ...config,
                            mensaje_apertura: { ...config.mensaje_apertura, activo: !aperturaActiva }
                        })}
                    />
                </div>

                <div className={styles.actionRow}>
                    <span className={styles.actionLabel}><Bell size={14} /> Recordatorios</span>
                    <Switch on={algunRecordatorioActivo} label="Recordatorios" onClick={alternarTodosRecordatorios} />
                </div>

                <div className={styles.actionRow}>
                    <span className={styles.actionLabel}><RefreshCw size={14} /> Actualización</span>
                    <Switch
                        on={config.mensaje_actualizacion.activo}
                        label="Actualización"
                        onClick={() => setConfig({
                            ...config,
                            mensaje_actualizacion: { ...config.mensaje_actualizacion, activo: !config.mensaje_actualizacion.activo }
                        })}
                    />
                </div>

                <div className={styles.actionRow}>
                    <span className={styles.actionLabel}><Lock size={14} /> Cierre</span>
                    <Switch
                        on={config.mensaje_cierre.activo}
                        label="Cierre"
                        onClick={() => setConfig({
                            ...config,
                            mensaje_cierre: { ...config.mensaje_cierre, activo: !config.mensaje_cierre.activo }
                        })}
                    />
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Recordatorios</h2>

                <p className={styles.nota}>
                    Cada recordatorio se calcula sobre la hora de cierre REAL del evento
                    detectado (evento.hora_cierre − offset) — nunca una hora fija guardada aquí.
                </p>

                <div className={styles.recordatorios}>

                    {recordatorios.length === 0 && (
                        <p className={styles.nota}>Sin recordatorios configurados todavía.</p>
                    )}

                    {recordatorios.map(([offset, cfg]) => (
                        <div key={offset} className={styles.recRow}>
                            <span className={styles.recOffset}>{offset} min antes</span>
                            <Switch
                                on={cfg.activo}
                                label={`Recordatorio ${offset} min`}
                                onClick={() => actualizarRecordatorio(offset, { activo: !cfg.activo })}
                            />
                            <button className={styles.recRemove} onClick={() => quitarRecordatorio(offset)}>
                                Quitar
                            </button>
                        </div>
                    ))}

                </div>

                <div className={styles.recNuevo}>
                    <Input
                        type="number"
                        min={1}
                        placeholder="Minutos antes"
                        value={nuevoOffset}
                        onChange={(e) => setNuevoOffset(e.target.value)}
                    />
                    <Button size="sm" variant="secondary" onClick={agregarRecordatorio}>
                        Agregar
                    </Button>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Actualizaciones</h2>

                <div className={styles.grid2}>
                    <Input
                        label="Umbral (reservas nuevas)"
                        type="number"
                        min={1}
                        value={config.umbral_reservas}
                        onChange={(e) => setConfig({ ...config, umbral_reservas: Number(e.target.value) || 1 })}
                    />
                    <Input
                        label="Cooldown (minutos)"
                        type="number"
                        min={1}
                        value={config.cooldown_minutos}
                        onChange={(e) => setConfig({ ...config, cooldown_minutos: Number(e.target.value) || 1 })}
                    />
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}><TableProperties size={15} /> Publicación inicial de tabla</h2>

                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={config.publicacion_inicial_tabla.activo}
                        onChange={(e) => setConfig({
                            ...config,
                            publicacion_inicial_tabla: { ...config.publicacion_inicial_tabla, activo: e.target.checked }
                        })}
                    />
                    {config.publicacion_inicial_tabla.activo ? "Activada" : "Desactivada"}
                </label>

                <div className={styles.grid2} style={{ marginTop: 12 }}>
                    <Input
                        label="Hora de publicación"
                        type="time"
                        value={config.publicacion_inicial_tabla.hora}
                        onChange={(e) => setConfig({
                            ...config,
                            publicacion_inicial_tabla: { ...config.publicacion_inicial_tabla, hora: e.target.value }
                        })}
                    />
                </div>

                <div className={styles.dias}>
                    {DIAS_SEMANA.map((dia) => (
                        <label key={dia.id} className={styles.dia}>
                            <input
                                type="checkbox"
                                checked={!!config.publicacion_inicial_tabla.dias_permitidos[dia.id]}
                                onChange={() => alternarDiaTabla(dia.id)}
                            />
                            {dia.label}
                        </label>
                    ))}
                </div>

                <p className={styles.nota}>
                    La hora indica cuándo se intenta publicar la primera tabla. Los datos de la
                    tabla siempre salen del evento real detectado.
                </p>
                <p className={styles.nota}>
                    Si el evento todavía no ha sido detectado, no se envía nada. Cuando el evento
                    aparezca después de la hora programada, se publicará si todavía no se ha realizado.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Mensajes</h2>

                <p className={styles.nota}>
                    Categoría preferida por acción — el texto real siempre sale del Message Pool
                    (pestaña Mensajes). «Sin categoría» usa cualquiera activa de ese tipo.
                </p>

                <div className={styles.msgRow}>
                    <span className={styles.actionLabel}><Rocket size={14} /> Apertura</span>
                    <SelectorCategoria
                        valor={config.mensaje_apertura.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_apertura: { ...config.mensaje_apertura, categoria }
                        })}
                    />
                </div>

                <div className={styles.msgRow}>
                    <span className={styles.actionLabel}><Bell size={14} /> Recordatorios</span>
                    <span className={styles.nota}>Categoría por cada offset, arriba en Recordatorios.</span>
                </div>

                <div className={styles.msgRow}>
                    <span className={styles.actionLabel}><RefreshCw size={14} /> Actualización</span>
                    <SelectorCategoria
                        valor={config.mensaje_actualizacion.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_actualizacion: { ...config.mensaje_actualizacion, categoria }
                        })}
                    />
                </div>

                <div className={styles.msgRow}>
                    <span className={styles.actionLabel}><Lock size={14} /> Cierre</span>
                    <SelectorCategoria
                        valor={config.mensaje_cierre.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_cierre: { ...config.mensaje_cierre, categoria }
                        })}
                    />
                </div>
            </section>

            <div className={styles.saveBar}>
                <Button disabled={guardando} loading={guardando} onClick={guardar}>
                    Guardar configuración
                </Button>
            </div>

        </div>

    );

}

function SelectorCategoria({ valor, onChange }: { valor: string | null; onChange: (v: string | null) => void }) {

    return (

        <Select
            value={valor || ""}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">Sin categoría (cualquiera)</option>
            {CATEGORIAS_AUTOMATIZACION.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
            ))}
        </Select>

    );

}
