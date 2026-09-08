"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./ConfiguracionGrupo.css";

import { getUser } from "@/services/auth/getUser";
import {
    AutomationConfig,
    configuracionPorDefecto,
    obtenerConfiguracion,
    guardarConfiguracion
} from "@/services/automatizacion/automationConfigs";
import { listarGruposAutorizados, autorizarGrupo, GrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposConversacion } from "@/services/chats/obtenerGruposConversacion";
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

    const [horaInicioGlobal, setHoraInicioGlobal] = useState("07:00");
    const [horaFinGlobal, setHoraFinGlobal] = useState("22:30");
    const [diasActivos, setDiasActivos] = useState<Record<string, boolean>>({});

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

            const [autorizadosRes, conocidosRes, configRes] = await Promise.all([
                listarGruposAutorizados(uid),
                obtenerGruposConversacion(),
                obtenerConfiguracion(uid, grupoId)
            ]);

            if (configRes.error) {
                setError(`No se pudo cargar la configuración (${configRes.error.message}).`);
                setEstado("error");
                return;
            }

            const propia = (autorizadosRes.data || []).find((g: GrupoAutorizado) => g.grupo_id === grupoId) || null;
            setAutorizacion(propia);

            const conocido = conocidosRes.data.find((g) => g.grupo_id === grupoId);
            setNombreGrupo(conocido?.grupo_nombre || null);

            const base = (configRes.data as AutomationConfig | null) || configuracionPorDefecto(uid, grupoId);
            setConfig(base);

            const dias: Record<string, boolean> = {};
            let inicioEncontrado: string | null = null;
            let finEncontrado: string | null = null;

            for (const dia of DIAS_SEMANA) {
                const cfgDia = base.dias_permitidos?.[dia.id];
                dias[dia.id] = !!cfgDia?.activo;
                if (cfgDia?.activo) {
                    inicioEncontrado = inicioEncontrado || cfgDia.desde;
                    finEncontrado = finEncontrado || cfgDia.hasta;
                }
            }

            setDiasActivos(dias);
            if (inicioEncontrado) setHoraInicioGlobal(inicioEncontrado);
            if (finEncontrado) setHoraFinGlobal(finEncontrado);

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

    function alternarDia(diaId: string) {
        setDiasActivos((prev) => ({ ...prev, [diaId]: !prev[diaId] }));
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

        const diasPermitidos: AutomationConfig["dias_permitidos"] = {};

        for (const dia of DIAS_SEMANA) {
            diasPermitidos[dia.id] = {
                activo: !!diasActivos[dia.id],
                desde: horaInicioGlobal,
                hasta: horaFinGlobal
            };
        }

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            activo: config.activo,
            dias_permitidos: diasPermitidos,
            mensaje_cierre: config.mensaje_cierre,
            mensaje_actualizacion: config.mensaje_actualizacion,
            recordatorios: config.recordatorios,
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

    const recordatorios = Object.entries(config.recordatorios).sort((a, b) => Number(a[0]) - Number(b[0]));

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

            <section className="config-seccion">

                <h2>Estado</h2>

                <label className="config-switch">
                    <input
                        type="checkbox"
                        checked={config.activo}
                        onChange={(e) => setConfig({ ...config, activo: e.target.checked })}
                    />
                    Automatización activa para este grupo
                </label>

                <p className="config-nota">
                    Aunque esté activa, un grupo solo se abre automáticamente si además hay
                    horario permitido y un evento real detectado (Automation Engine, sin cambios).
                </p>

            </section>

            <section className="config-seccion">

                <h2>Días y horario</h2>

                <div className="config-dias">

                    {DIAS_SEMANA.map((dia) => (

                        <label key={dia.id} className="config-dia-item">
                            <input
                                type="checkbox"
                                checked={!!diasActivos[dia.id]}
                                onChange={() => alternarDia(dia.id)}
                            />
                            {dia.label}
                        </label>

                    ))}

                </div>

                <div className="config-horario">

                    <label>
                        Inicio
                        <input type="time" value={horaInicioGlobal} onChange={(e) => setHoraInicioGlobal(e.target.value)} />
                    </label>

                    <label>
                        Fin
                        <input type="time" value={horaFinGlobal} onChange={(e) => setHoraFinGlobal(e.target.value)} />
                    </label>

                </div>

                <p className="config-nota">
                    Es el horario en que se PERMITE operar — nunca la hora del sorteo (esa
                    siempre sale del evento real detectado).
                </p>

            </section>

            <section className="config-seccion">

                <h2>Mensajes automáticos</h2>

                <div className="config-accion-bloque">
                    <span className="config-accion-titulo">🚀 Apertura</span>
                    <p className="config-nota">
                        Envía cualquier mensaje activo de tipo Apertura (todavía no filtra por
                        categoría — así quedó definido en el motor).
                    </p>
                </div>

                <div className="config-accion-bloque">

                    <span className="config-accion-titulo">🔄 Actualización</span>

                    <label className="config-switch">
                        <input
                            type="checkbox"
                            checked={config.mensaje_actualizacion.activo}
                            onChange={(e) => setConfig({
                                ...config,
                                mensaje_actualizacion: { ...config.mensaje_actualizacion, activo: e.target.checked }
                            })}
                        />
                        Activa
                    </label>

                    <SelectorCategoria
                        valor={config.mensaje_actualizacion.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_actualizacion: { ...config.mensaje_actualizacion, categoria }
                        })}
                    />

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

                </div>

                <div className="config-accion-bloque">

                    <span className="config-accion-titulo">🔒 Cierre</span>

                    <label className="config-switch">
                        <input
                            type="checkbox"
                            checked={config.mensaje_cierre.activo}
                            onChange={(e) => setConfig({
                                ...config,
                                mensaje_cierre: { ...config.mensaje_cierre, activo: e.target.checked }
                            })}
                        />
                        Activa
                    </label>

                    <SelectorCategoria
                        valor={config.mensaje_cierre.categoria}
                        onChange={(categoria) => setConfig({
                            ...config,
                            mensaje_cierre: { ...config.mensaje_cierre, categoria }
                        })}
                    />

                </div>

            </section>

            <section className="config-seccion">

                <h2>Programación de recordatorios</h2>

                <p className="config-nota">
                    Cada recordatorio se calcula sobre la hora de cierre REAL del evento
                    detectado — nunca una hora fija guardada aquí.
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

                            <SelectorCategoria
                                valor={cfg.categoria}
                                onChange={(categoria) => actualizarRecordatorio(offset, { categoria })}
                            />

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
