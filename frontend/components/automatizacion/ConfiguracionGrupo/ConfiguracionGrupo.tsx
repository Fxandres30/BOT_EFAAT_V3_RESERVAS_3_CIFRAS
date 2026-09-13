"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Sunrise, Hourglass, Rocket, TableProperties, Bell, RefreshCw, Lock, Trophy, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";

import { formatHora12 } from "@/lib/formatHora";

import { getUser } from "@/services/auth/getUser";
import {
    AutomationConfig,
    configuracionPorDefecto,
    normalizarPublicacionInicialTabla,
    normalizarInicioDia,
    obtenerConfiguracion,
    guardarConfiguracion
} from "@/services/automatizacion/automationConfigs";
import { listarGruposAutorizados, autorizarGrupo, GrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposConversacion } from "@/services/chats/obtenerGruposConversacion";
import { obtenerGruposDisponibles } from "@/services/automatizacion/gruposDisponibles";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import StickerPagoSection from "./StickerPagoSection";
import { Dot, Switch } from "./secciones/compartido";
import SeccionInicioDia from "./secciones/SeccionInicioDia";
import SeccionApertura from "./secciones/SeccionApertura";
import SeccionTablaInicial from "./secciones/SeccionTablaInicial";
import SeccionRecordatorios from "./secciones/SeccionRecordatorios";
import SeccionActualizacion from "./secciones/SeccionActualizacion";
import SeccionCierre from "./secciones/SeccionCierre";
import SeccionProximamente from "./secciones/SeccionProximamente";

import styles from "./ConfiguracionGrupo.module.css";

interface Props {
    grupoId: string;
}

type Estado = "cargando" | "sin-sesion" | "listo" | "error" | "no-encontrado";

type TipoConfig = Omit<AutomationConfig, "id" | "creado_en" | "actualizado_en">;

// Estructura conceptual pedida — CADA acción es su propia pestaña, con su
// propio guardado (ver secciones/*). Esta pantalla (el detalle de UN
// grupo) sigue siendo donde vive la CONFIGURACIÓN; la AUTORIZACIÓN
// (¿puede este grupo operar automatización, sí/no?) sigue viviendo
// exclusivamente en /automatizacion/grupos — sin cambios aquí.
const TABS = [
    { value: "inicio_dia", label: "Inicio del día", icon: <Sunrise size={13} /> },
    { value: "aviso_apertura", label: "Aviso de apertura", icon: <Hourglass size={13} /> },
    { value: "apertura", label: "Apertura", icon: <Rocket size={13} /> },
    { value: "tabla_inicial", label: "Tabla inicial", icon: <TableProperties size={13} /> },
    { value: "recordatorios", label: "Recordatorios", icon: <Bell size={13} /> },
    { value: "actualizacion", label: "Actualización", icon: <RefreshCw size={13} /> },
    { value: "cierre", label: "Cierre", icon: <Lock size={13} /> },
    { value: "resultado", label: "Resultado", icon: <Trophy size={13} /> }
];

export default function ConfiguracionGrupo({ grupoId }: Props) {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [estado, setEstado] = useState<Estado>("cargando");
    const [error, setError] = useState<string | null>(null);

    const [nombreGrupo, setNombreGrupo] = useState<string | null>(null);
    const [autorizacion, setAutorizacion] = useState<GrupoAutorizado | null>(null);

    const [config, setConfig] = useState<TipoConfig | null>(null);
    const [tabActiva, setTabActiva] = useState("inicio_dia");
    const [guardandoActivo, setGuardandoActivo] = useState(false);

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

            // Prioridad: grupo REAL de la sesión conectada > histórico de
            // mensajes_grupos_sorteos > el JID crudo (ver GruposAutomatizacion).
            const real = disponiblesRes.flatMap((s) => s.grupos).find((g) => g.id === grupoId);
            const conocido = conocidosRes.data.find((g) => g.grupo_id === grupoId);

            if (!propia && !real && !conocido) {
                setEstado("no-encontrado");
                return;
            }

            setAutorizacion(propia);
            setNombreGrupo(real?.nombre || conocido?.grupo_nombre || null);

            let base = (configRes.data as AutomationConfig | null);

            if (!base) {

                // Grupo sin fila todavía: se materializa UNA vez con los
                // defaults completos (mismo objeto que ya se usaba como
                // estado inicial antes de esta fase) — necesario para que,
                // a partir de ahora, cada sección pueda guardar solo SU
                // propia columna sin dejar el resto en blanco/NULL en un
                // INSERT. Nunca se sobreescribe una fila que ya existía.
                const defecto = configuracionPorDefecto(uid, grupoId);
                const { data: creada, error: errorCrear } = await guardarConfiguracion(uid, grupoId, defecto);

                if (errorCrear || !creada) {
                    setError(`No se pudo inicializar la configuración (${errorCrear?.message || "error desconocido"}).`);
                    setEstado("error");
                    return;
                }

                base = creada as AutomationConfig;

            }

            // Filas viejas (creadas antes de las migraciones 009/"Inicio del
            // día") pueden traer estos campos como "{}" — se normalizan a
            // los mismos defaults que vería un grupo nuevo, nunca "todo
            // vacío" sin explicación.
            base.publicacion_inicial_tabla = normalizarPublicacionInicialTabla(base.publicacion_inicial_tabla);
            base.mensaje_inicio_dia = normalizarInicioDia(base.mensaje_inicio_dia);

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

    // Interruptor MAESTRO del grupo — distinto de las 8 acciones (ninguna
    // funciona si este está apagado, sin importar su propia configuración).
    // Se guarda al instante, igual que ya hacen otros interruptores
    // simples del panel (alternarGrupoAutorizado, alternarTipoHabilitado).
    async function alternarActivo() {

        if (!usuarioId || !config) return;

        const nuevo = !config.activo;

        setGuardandoActivo(true);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, { activo: nuevo });

        setGuardandoActivo(false);

        if (!errorGuardar && data) {
            setConfig((prev) => (prev ? { ...prev, activo: nuevo } : prev));
        }

    }

    if (estado === "cargando") {
        return <div className={styles.state}>Cargando configuración…</div>;
    }

    if (estado === "sin-sesion") {
        return <div className={styles.state}>Debes iniciar sesión.</div>;
    }

    if (estado === "error" || !config || !usuarioId) {
        return <div className={styles.state}>{error}</div>;
    }

    if (estado === "no-encontrado") {
        return (
            <div className={styles.page}>
                <AutomatizacionHeader />
                <div className={styles.state}>
                    <p className={styles.title}>Grupo no encontrado</p>
                    <p className={styles.nota}>
                        Este grupo ya no está disponible en la sesión de WhatsApp conectada.
                    </p>
                    <Link href="/automatizacion/grupos" className={styles.back}>
                        <ChevronLeft size={13} /> Volver a grupos
                    </Link>
                </div>
            </div>
        );
    }

    const aperturaActiva = config.mensaje_apertura?.activo !== false;
    const algunRecordatorioActivo = Object.values(config.recordatorios).some((c) => c.activo);

    return (

        <div className={styles.page}>

            <AutomatizacionHeader />

            <div className={styles.header}>

                <div>
                    <Link href="/automatizacion/grupos" className={styles.back}>
                        <ChevronLeft size={13} /> Grupos
                    </Link>
                    <h1 className={styles.title}>{nombreGrupo || grupoId}</h1>
                    <p className={styles.jidLabel}>ID de WhatsApp</p>
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
                        automatización nunca operará aquí hasta autorizarlo (ver la pantalla
                        Grupos, que es la única que decide esto).
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

            <div className={styles.resumen}>
                <div className={styles.resumenItem}>
                    <span className={styles.resumenLabel}>Inicio del día</span>
                    <span className={styles.resumenValue}>
                        {config.mensaje_inicio_dia.activo
                            ? formatHora12(config.mensaje_inicio_dia.hora)
                            : <Dot on={false} />}
                    </span>
                </div>
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

            <StickerPagoSection usuarioId={usuarioId} grupoId={grupoId} />

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Automatización</h2>

                <div className={styles.actionRow} style={{ borderTop: "none" }}>
                    <span className={styles.actionLabel}>
                        Automatización activa para este grupo
                        {guardandoActivo && " (guardando…)"}
                    </span>
                    <Switch on={config.activo} label="Automatización activa" onClick={alternarActivo} />
                </div>

                <p className={styles.nota}>
                    El nombre, valor, premios, hora de cierre y demás datos del sorteo SIEMPRE
                    vienen del evento real detectado (Automation Engine, sin cambios). Este
                    interruptor es el único que afecta a TODAS las acciones de abajo a la vez —
                    cada una, además, tiene su propio interruptor independiente en su pestaña.
                </p>
            </section>

            <Tabs
                items={TABS}
                value={tabActiva}
                onValueChange={setTabActiva}
                aria-label="Configuración por acción"
                fullWidth
            />

            <div style={{ marginTop: 12 }}>

                {tabActiva === "inicio_dia" && (
                    <SeccionInicioDia
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicial={config.mensaje_inicio_dia}
                        onGuardado={(nuevo) => setConfig((prev) => (prev ? { ...prev, mensaje_inicio_dia: nuevo } : prev))}
                    />
                )}

                {tabActiva === "aviso_apertura" && (
                    <SeccionProximamente
                        icon={Hourglass}
                        titulo="Aviso de apertura"
                        descripcion="Un mensaje de cuenta regresiva antes de la apertura real del grupo."
                    />
                )}

                {tabActiva === "apertura" && (
                    <SeccionApertura
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicial={config.mensaje_apertura}
                        onGuardado={(nuevo) => setConfig((prev) => (prev ? { ...prev, mensaje_apertura: nuevo } : prev))}
                    />
                )}

                {tabActiva === "tabla_inicial" && (
                    <SeccionTablaInicial
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicial={config.publicacion_inicial_tabla}
                        onGuardado={(nuevo) => setConfig((prev) => (prev ? { ...prev, publicacion_inicial_tabla: nuevo } : prev))}
                    />
                )}

                {tabActiva === "recordatorios" && (
                    <SeccionRecordatorios
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicial={config.recordatorios}
                        onGuardado={(nuevo) => setConfig((prev) => (prev ? { ...prev, recordatorios: nuevo } : prev))}
                    />
                )}

                {tabActiva === "actualizacion" && (
                    <SeccionActualizacion
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicialMensaje={config.mensaje_actualizacion}
                        inicialUmbral={config.umbral_reservas}
                        inicialCooldown={config.cooldown_minutos}
                        onGuardado={(cambios) => setConfig((prev) => (prev ? { ...prev, ...cambios } : prev))}
                    />
                )}

                {tabActiva === "cierre" && (
                    <SeccionCierre
                        usuarioId={usuarioId}
                        grupoId={grupoId}
                        inicial={config.mensaje_cierre}
                        onGuardado={(nuevo) => setConfig((prev) => (prev ? { ...prev, mensaje_cierre: nuevo } : prev))}
                    />
                )}

                {tabActiva === "resultado" && (
                    <SeccionProximamente
                        icon={Trophy}
                        titulo="Resultado"
                        descripcion="Anuncio del número/ganador del sorteo."
                    />
                )}

            </div>

        </div>

    );

}
