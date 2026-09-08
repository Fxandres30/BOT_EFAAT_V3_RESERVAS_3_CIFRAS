"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./ConfiguracionGrupo.css";

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

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";

interface Props {
    grupoId: string;
}

type Estado = "cargando" | "sin-sesion" | "listo" | "error";

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
        return <div className="config-grupo-estado">Cargando configuración...</div>;
    }

    if (estado === "sin-sesion") {
        return <div className="config-grupo-estado">Debes iniciar sesión.</div>;
    }

    if (estado === "error" || !config) {
        return <div className="config-grupo-estado config-grupo-error">⚠️ {error}</div>;
    }

    return (

        <div className="config-grupo">

            <AutomatizacionNav />

            <div className="config-grupo-header">

                <div>
                    <Link href="/automatizacion/grupos" className="config-grupo-volver">← Grupos</Link>
                    <h1 className="config-grupo-titulo">{nombreGrupo || grupoId}</h1>
                    <p className="config-grupo-jid">{grupoId}</p>
                </div>

                <div className="config-grupo-estado-chip">
                    {config.activo ? "🟢 Activa" : "🔴 Inactiva"}
                </div>

            </div>

            {!autorizacion && (

                <div className="config-grupo-aviso">
                    Este grupo todavía no está en <strong>grupos_autorizados</strong> — la
                    automatización nunca operará aquí hasta autorizarlo.
                    <button onClick={autorizarSiHaceFalta}>Autorizar ahora</button>
                </div>

            )}

            {error && <p className="config-grupo-error-linea">⚠️ {error}</p>}
            {guardadoOk && <p className="config-grupo-ok">✅ Configuración guardada.</p>}

            <div className="config-resumen">

                <div className="config-resumen-fila">
                    <span>Apertura</span>
                    <strong>{aperturaActiva ? "🟢" : "⚪"}</strong>
                </div>

                <div className="config-resumen-fila">
                    <span>Tabla inicial</span>
                    <strong>{config.publicacion_inicial_tabla.activo ? `🟢 ${config.publicacion_inicial_tabla.hora}` : "⚪"}</strong>
                </div>

                <div className="config-resumen-fila">
                    <span>Recordatorios</span>
                    <strong>{algunRecordatorioActivo ? "🟢" : "⚪"}</strong>
                </div>

                <div className="config-resumen-fila">
                    <span>Actualización</span>
                    <strong>{config.mensaje_actualizacion.activo ? "🟢" : "⚪"}</strong>
                </div>

                <div className="config-resumen-fila">
                    <span>Cierre</span>
                    <strong>{config.mensaje_cierre.activo ? "🟢" : "⚪"}</strong>
                </div>

            </div>

            <section className="config-seccion">

                <h2>Automatización</h2>

                <label className="config-switch">
                    <input
                        type="checkbox"
                        checked={config.activo}
                        onChange={(e) => setConfig({ ...config, activo: e.target.checked })}
                    />
                    Automatización activa para este grupo
                </label>

                <p className="config-nota">
                    El nombre, valor, premios, hora de cierre y demás datos del sorteo SIEMPRE
                    vienen del evento real detectado (Automation Engine, sin cambios). Aquí solo
                    se define qué debe hacer la automatización cuando eso pase — sin horario ni
                    días propios.
                </p>

            </section>

            <section className="config-seccion">

                <h2>Acciones</h2>

                <div className="config-accion-fila">

                    <span className="config-accion-fila-label">🚀 Apertura</span>

                    <button
                        className={`config-recordatorio-toggle ${aperturaActiva ? "on" : "off"}`}
                        onClick={() => setConfig({
                            ...config,
                            mensaje_apertura: { ...config.mensaje_apertura, activo: !aperturaActiva }
                        })}
                    >
                        {aperturaActiva ? "🟢" : "⚪"}
                    </button>

                </div>

                <div className="config-accion-fila">

                    <span className="config-accion-fila-label">⏰ Recordatorios</span>

                    <button
                        className={`config-recordatorio-toggle ${algunRecordatorioActivo ? "on" : "off"}`}
                        onClick={alternarTodosRecordatorios}
                    >
                        {algunRecordatorioActivo ? "🟢" : "⚪"}
                    </button>

                </div>

                <div className="config-accion-fila">

                    <span className="config-accion-fila-label">🔄 Actualización</span>

                    <button
                        className={`config-recordatorio-toggle ${config.mensaje_actualizacion.activo ? "on" : "off"}`}
                        onClick={() => setConfig({
                            ...config,
                            mensaje_actualizacion: { ...config.mensaje_actualizacion, activo: !config.mensaje_actualizacion.activo }
                        })}
                    >
                        {config.mensaje_actualizacion.activo ? "🟢" : "⚪"}
                    </button>

                </div>

                <div className="config-accion-fila">

                    <span className="config-accion-fila-label">🔒 Cierre</span>

                    <button
                        className={`config-recordatorio-toggle ${config.mensaje_cierre.activo ? "on" : "off"}`}
                        onClick={() => setConfig({
                            ...config,
                            mensaje_cierre: { ...config.mensaje_cierre, activo: !config.mensaje_cierre.activo }
                        })}
                    >
                        {config.mensaje_cierre.activo ? "🟢" : "⚪"}
                    </button>

                </div>

            </section>

            <section className="config-seccion">

                <h2>Recordatorios</h2>

                <p className="config-nota">
                    Cada recordatorio se calcula sobre la hora de cierre REAL del evento
                    detectado (evento.hora_cierre − offset) — nunca una hora fija guardada aquí.
                </p>

                <div className="config-recordatorios">

                    {recordatorios.length === 0 && (
                        <p className="config-nota">Sin recordatorios configurados todavía.</p>
                    )}

                    {recordatorios.map(([offset, cfg]) => (

                        <div key={offset} className="config-recordatorio-fila">

                            <span className="config-recordatorio-offset">{offset} min antes</span>

                            <button
                                className={`config-recordatorio-toggle ${cfg.activo ? "on" : "off"}`}
                                onClick={() => actualizarRecordatorio(offset, { activo: !cfg.activo })}
                            >
                                {cfg.activo ? "🟢" : "⚪"}
                            </button>

                            <button className="config-recordatorio-quitar" onClick={() => quitarRecordatorio(offset)}>
                                Quitar
                            </button>

                        </div>

                    ))}

                </div>

                <div className="config-recordatorio-nuevo">

                    <input
                        type="number"
                        min={1}
                        placeholder="Minutos antes"
                        value={nuevoOffset}
                        onChange={(e) => setNuevoOffset(e.target.value)}
                    />

                    <button onClick={agregarRecordatorio}>+ Agregar recordatorio</button>

                </div>

            </section>

            <section className="config-seccion">

                <h2>Actualizaciones</h2>

                <div className="config-umbral-cooldown">

                    <label>
                        Umbral (reservas nuevas)
                        <input
                            type="number"
                            min={1}
                            value={config.umbral_reservas}
                            onChange={(e) => setConfig({ ...config, umbral_reservas: Number(e.target.value) || 1 })}
                        />
                    </label>

                    <label>
                        Cooldown (minutos)
                        <input
                            type="number"
                            min={1}
                            value={config.cooldown_minutos}
                            onChange={(e) => setConfig({ ...config, cooldown_minutos: Number(e.target.value) || 1 })}
                        />
                    </label>

                </div>

            </section>

            <section className="config-seccion">

                <h2>📋 Publicación inicial de tabla</h2>

                <label className="config-switch">
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

                <div className="config-tabla-hora">

                    <label>
                        Hora de publicación
                        <input
                            type="time"
                            value={config.publicacion_inicial_tabla.hora}
                            onChange={(e) => setConfig({
                                ...config,
                                publicacion_inicial_tabla: { ...config.publicacion_inicial_tabla, hora: e.target.value }
                            })}
                        />
                    </label>

                </div>

                <div className="config-dias">

                    {DIAS_SEMANA.map((dia) => (

                        <label key={dia.id} className="config-dia-item">
                            <input
                                type="checkbox"
                                checked={!!config.publicacion_inicial_tabla.dias_permitidos[dia.id]}
                                onChange={() => alternarDiaTabla(dia.id)}
                            />
                            {dia.label}
                        </label>

                    ))}

                </div>

                <p className="config-nota">
                    La hora indica cuándo se intenta publicar la primera tabla. Los datos de
                    la tabla siempre salen del evento real detectado.
                </p>

                <p className="config-nota">
                    Si el evento todavía no ha sido detectado, no se envía nada. Cuando el
                    evento aparezca después de la hora programada, se publicará si todavía
                    no se ha realizado.
                </p>

            </section>

            <section className="config-seccion">

                <h2>Mensajes</h2>

                <p className="config-nota">
                    Categoría preferida por acción — el texto real siempre sale del Message
                    Pool (pestaña Mensajes). &quot;Sin categoría&quot; usa cualquiera activa de ese tipo.
                </p>

                <div className="config-mensajes-fila">
                    <span className="config-accion-fila-label">🚀 Apertura</span>
                    <SelectorCategoria
                        valor={config.mensaje_apertura.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_apertura: { ...config.mensaje_apertura, categoria }
                        })}
                    />
                </div>

                <div className="config-mensajes-fila">
                    <span className="config-accion-fila-label">⏰ Recordatorios</span>
                    <span className="config-nota config-mensajes-nota">Categoría por cada offset, arriba en Recordatorios.</span>
                </div>

                <div className="config-mensajes-fila">
                    <span className="config-accion-fila-label">🔄 Actualización</span>
                    <SelectorCategoria
                        valor={config.mensaje_actualizacion.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_actualizacion: { ...config.mensaje_actualizacion, categoria }
                        })}
                    />
                </div>

                <div className="config-mensajes-fila">
                    <span className="config-accion-fila-label">🔒 Cierre</span>
                    <SelectorCategoria
                        valor={config.mensaje_cierre.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_cierre: { ...config.mensaje_cierre, categoria }
                        })}
                    />
                </div>

            </section>

            <div className="config-guardar-barra">
                <button className="config-guardar" disabled={guardando} onClick={guardar}>
                    {guardando ? "Guardando..." : "Guardar configuración"}
                </button>
            </div>

        </div>

    );

}

function SelectorCategoria({ valor, onChange }: { valor: string | null; onChange: (v: string | null) => void }) {

    return (

        <select
            className="config-selector-categoria"
            value={valor || ""}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">Sin categoría (cualquiera)</option>
            {CATEGORIAS_AUTOMATIZACION.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
            ))}
        </select>

    );

}
