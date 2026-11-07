"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Sunrise, Rocket, TableProperties, Bell, RefreshCw, Lock, AlertTriangle, Info } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { avisar } from "@/components/ui/Avisos";

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
import { normalizarGrupoId } from "@/services/automatizacion/mergeGrupos";
import { conexionVista, estadoAutorizacion, ConexionVista } from "@/services/automatizacion/vistaGrupos";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import { AUTORIZACION, CONEXION, horaLegible } from "../compartido/estados";
import StickerPagoSection from "./StickerPagoSection";
import { Switch } from "./secciones/compartido";
import SeccionInicioDia from "./secciones/SeccionInicioDia";
import SeccionApertura from "./secciones/SeccionApertura";
import SeccionTablaInicial from "./secciones/SeccionTablaInicial";
import SeccionRecordatorios from "./secciones/SeccionRecordatorios";
import SeccionActualizacion from "./secciones/SeccionActualizacion";
import SeccionCierre from "./secciones/SeccionCierre";

import styles from "./ConfiguracionGrupo.module.css";

interface Props {
    grupoId: string;
}

type Estado = "cargando" | "sin-sesion" | "listo" | "error" | "no-encontrado";

type TipoConfig = Omit<AutomationConfig, "id" | "creado_en" | "actualizado_en">;

// Cada tipo de mensaje es su propia sección, con su propio guardado. Solo
// se muestran las que tienen funcionalidad real (las «Próximamente» se
// retiraron de la navegación). Navegación en cuadrícula: todas visibles,
// también en móvil.
const SECCIONES = [
    { value: "apertura", label: "Apertura", icon: Rocket },
    { value: "recordatorios", label: "Recordatorios", icon: Bell },
    { value: "actualizacion", label: "Actualizaciones", icon: RefreshCw },
    { value: "cierre", label: "Cierre", icon: Lock },
    { value: "tabla_inicial", label: "Tabla inicial", icon: TableProperties },
    { value: "inicio_dia", label: "Inicio del día", icon: Sunrise }
] as const;

type Seccion = typeof SECCIONES[number]["value"];

export default function ConfiguracionGrupo({ grupoId }: Props) {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [estado, setEstado] = useState<Estado>("cargando");
    const [error, setError] = useState<string | null>(null);

    const [nombreGrupo, setNombreGrupo] = useState<string | null>(null);
    const [autorizacion, setAutorizacion] = useState<GrupoAutorizado | null>(null);
    const [conexion, setConexion] = useState<ConexionVista>("comprobando");

    const [config, setConfig] = useState<TipoConfig | null>(null);
    // false = el grupo todavía no tiene automatización guardada. Se crea en
    // el primer guardado que confirme el usuario (guardarConfiguracion).
    const [guardada, setGuardada] = useState(true);
    const [seccion, setSeccion] = useState<Seccion>("apertura");
    const [guardandoActivo, setGuardandoActivo] = useState(false);
    const [autorizando, setAutorizando] = useState(false);

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
                setError("No pudimos cargar la configuración de este grupo. Intenta de nuevo en unos minutos.");
                setEstado("error");
                return;
            }

            const propia = (autorizadosRes.data || []).find((g: GrupoAutorizado) => normalizarGrupoId(g.grupo_id) === grupoId) || null;

            // Prioridad del nombre: WhatsApp en vivo > último nombre registrado.
            const real = disponiblesRes.flatMap((s) => s.grupos).find((g) => normalizarGrupoId(g.id) === grupoId);
            const conocido = conocidosRes.data.find((g) => g.grupo_id === grupoId);
            const existente = configRes.data as AutomationConfig | null;

            if (!propia && !real && !conocido && !existente) {
                setEstado("no-encontrado");
                return;
            }

            setAutorizacion(propia);
            setNombreGrupo(real?.nombre || conocido?.grupo_nombre || null);
            setConexion(conexionVista(!!real, disponiblesRes));

            // Sin fila todavía: se muestran los valores por defecto SIN
            // guardarlos. Nada se escribe hasta que el usuario guarda.
            const base: TipoConfig = existente ? { ...existente } : configuracionPorDefecto(uid, grupoId);
            setGuardada(!!existente);

            // Filas viejas pueden traer estos campos como "{}".
            base.publicacion_inicial_tabla = normalizarPublicacionInicialTabla(base.publicacion_inicial_tabla);
            base.mensaje_inicio_dia = normalizarInicioDia(base.mensaje_inicio_dia);

            setConfig(base);
            setEstado("listo");

        }

        cargar();

    }, [grupoId]);

    async function autorizar() {

        if (!usuarioId) return;

        setAutorizando(true);
        const { data, error: errorAutorizar } = await autorizarGrupo(usuarioId, grupoId);
        setAutorizando(false);

        if (errorAutorizar || !data) {
            avisar.error("No se pudo autorizar el grupo. Intenta de nuevo.");
            return;
        }

        setAutorizacion(data as GrupoAutorizado);
        avisar.ok("Grupo autorizado.");

    }

    // Interruptor general del grupo: pausa o reactiva todos sus mensajes
    // automáticos. Se guarda al instante (acción confirmada por el usuario).
    async function alternarActivo() {

        if (!usuarioId || !config) return;

        const nuevo = !config.activo;

        setGuardandoActivo(true);
        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, { activo: nuevo });
        setGuardandoActivo(false);

        if (errorGuardar || !data) {
            avisar.error("No se pudo cambiar la automatización. Intenta de nuevo.");
            return;
        }

        setConfig((prev) => (prev ? { ...prev, activo: nuevo } : prev));
        setGuardada(true);
        avisar.ok(nuevo ? "Automatización activada." : "Automatización pausada. No saldrán mensajes automáticos nuevos.");

    }

    // Cualquier sección que guarda crea la configuración si no existía.
    function alGuardar<K extends keyof TipoConfig>(cambios: Pick<TipoConfig, K> | Partial<TipoConfig>) {
        setConfig((prev) => (prev ? { ...prev, ...cambios } : prev));
        setGuardada(true);
    }

    if (estado === "cargando") {
        return <div className={styles.state}>Cargando configuración…</div>;
    }

    if (estado === "sin-sesion") {
        return <div className={styles.state}>Debes iniciar sesión.</div>;
    }

    if (estado === "no-encontrado") {
        return (
            <div className={styles.page}>
                <AutomatizacionHeader title="Grupo no encontrado" description="Este grupo no aparece en tu WhatsApp ni tiene autorización o configuración guardada." />
                <Link href="/automatizacion/grupos" className={styles.back}>
                    <ChevronLeft size={13} /> Volver a Grupos
                </Link>
            </div>
        );
    }

    if (estado === "error" || !config || !usuarioId) {
        return <div className={styles.state}>{error}</div>;
    }

    const estadoAut = estadoAutorizacion(autorizacion);
    const conexionInfo = CONEXION[conexion];
    const autorizacionInfo = AUTORIZACION[estadoAut];
    const algunRecordatorioActivo = Object.values(config.recordatorios || {}).some((c) => c?.activo);

    const resumen: { seccion: Seccion; texto: string; valor: string; on: boolean }[] = [
        { seccion: "apertura", texto: "Apertura", valor: config.mensaje_apertura?.activo !== false ? "Activa" : "Pausada", on: config.mensaje_apertura?.activo !== false },
        { seccion: "recordatorios", texto: "Recordatorios", valor: algunRecordatorioActivo ? "Activos" : "Pausados", on: algunRecordatorioActivo },
        { seccion: "actualizacion", texto: "Actualizaciones", valor: config.mensaje_actualizacion?.activo ? "Activas" : "Pausadas", on: config.mensaje_actualizacion?.activo === true },
        { seccion: "cierre", texto: "Cierre", valor: config.mensaje_cierre?.activo ? "Activo" : "Pausado", on: config.mensaje_cierre?.activo === true },
        { seccion: "tabla_inicial", texto: "Tabla inicial", valor: config.publicacion_inicial_tabla.activo ? horaLegible(config.publicacion_inicial_tabla.hora) : "Pausada", on: config.publicacion_inicial_tabla.activo },
        { seccion: "inicio_dia", texto: "Inicio del día", valor: config.mensaje_inicio_dia.activo ? horaLegible(config.mensaje_inicio_dia.hora) : "Pausado", on: config.mensaje_inicio_dia.activo }
    ];

    return (

        <div className={styles.page}>

            <AutomatizacionHeader
                title={nombreGrupo || "Nombre desconocido"}
                description="Configura qué mensajes automáticos recibe este grupo y cuándo. Los textos se eligen de la biblioteca de Mensajes; los datos del sorteo salen del anuncio detectado en el grupo."
            />

            <div className={styles.header}>
                <Link href="/automatizacion/grupos" className={styles.back}>
                    <ChevronLeft size={13} /> Volver a Grupos
                </Link>
                <div className={styles.estadoGrupo}>
                    <Badge size="sm" tone={conexionInfo.tono} dot title={conexionInfo.explicacion}>{conexionInfo.texto}</Badge>
                    <Badge size="sm" tone={autorizacionInfo.tono} title={autorizacionInfo.explicacion}>{autorizacionInfo.texto}</Badge>
                    <Badge size="sm" tone={!guardada ? "neutral" : config.activo ? "primary" : "neutral"}>
                        {!guardada ? "Sin configurar" : config.activo ? "Automatización activa" : "Automatización pausada"}
                    </Badge>
                </div>
            </div>

            <details className={styles.avanzado}>
                <summary>Detalles avanzados</summary>
                <p>ID de WhatsApp: <span className={styles.jid}>{grupoId}</span></p>
            </details>

            {estadoAut !== "autorizado" && (
                <div className={styles.aviso}>
                    <span>
                        {estadoAut === "pausada"
                            ? "La autorización de este grupo está pausada: EFAAT no le enviará mensajes automáticos hasta que la reactives."
                            : "Este grupo no está autorizado: EFAAT no le enviará mensajes automáticos hasta que lo autorices. Puedes preparar su configuración desde ya."}
                        {(conexion === "no_visto" || conexion === "sin_sesion") && " Además, ahora no aparece en tu WhatsApp: autorizarlo no lo conecta."}
                    </span>
                    <Button size="sm" variant="secondary" onClick={autorizar} loading={autorizando} disabled={autorizando}>
                        {estadoAut === "pausada" ? "Reactivar autorización" : "Autorizar"}
                    </Button>
                </div>
            )}

            {!guardada && (
                <p className={styles.notaInfo}>
                    <Info size={14} aria-hidden="true" />
                    Este grupo todavía no tiene automatización guardada. Ves los valores iniciales; se guardará cuando pulses «Guardar» en una sección o actives la automatización.
                </p>
            )}

            {error && (
                <p className={styles.noteError}>
                    <AlertTriangle size={13} /> {error}
                </p>
            )}

            <section className={styles.section}>

                <div className={styles.actionRow} style={{ borderTop: "none" }}>
                    <span className={styles.actionLabel}>
                        Mensajes automáticos de este grupo
                        <span className={styles.actionHint}>
                            {config.activo && guardada
                                ? "Activos: cada tipo de mensaje sale según su propia configuración."
                                : "En pausa: no sale ningún mensaje automático. La configuración de cada tipo se conserva."}
                            {guardandoActivo && " Guardando…"}
                        </span>
                    </span>
                    <span className={styles.switchConTexto}>
                        {config.activo && guardada ? "Activa" : "Pausada"}
                        <Switch on={config.activo && guardada} label="Mensajes automáticos de este grupo" onClick={alternarActivo} />
                    </span>
                </div>

                <div className={styles.resumenTipos}>
                    {resumen.map((r) => (
                        <button
                            key={r.seccion}
                            type="button"
                            className={`${styles.resumenTipo} ${seccion === r.seccion ? styles.resumenTipoActivo : ""}`}
                            onClick={() => setSeccion(r.seccion)}
                        >
                            <span className={styles.resumenLabel}>{r.texto}</span>
                            <span className={`${styles.resumenEstado} ${r.on ? styles.resumenEstadoOn : ""}`}>{r.valor}</span>
                        </button>
                    ))}
                </div>

            </section>

            <nav className={styles.secciones} aria-label="Tipos de mensaje">
                {SECCIONES.map((s) => {
                    const Icono = s.icon;
                    return (
                        <button
                            key={s.value}
                            type="button"
                            aria-current={seccion === s.value ? "true" : undefined}
                            className={`${styles.seccionBoton} ${seccion === s.value ? styles.seccionBotonActivo : ""}`}
                            onClick={() => setSeccion(s.value)}
                        >
                            <Icono size={14} aria-hidden="true" /> {s.label}
                        </button>
                    );
                })}
            </nav>

            <div>

                {seccion === "inicio_dia" && (
                    <SeccionInicioDia usuarioId={usuarioId} grupoId={grupoId} inicial={config.mensaje_inicio_dia}
                        onGuardado={(nuevo) => alGuardar({ mensaje_inicio_dia: nuevo })} />
                )}

                {seccion === "apertura" && (
                    <SeccionApertura usuarioId={usuarioId} grupoId={grupoId} inicial={config.mensaje_apertura}
                        onGuardado={(nuevo) => alGuardar({ mensaje_apertura: nuevo })} />
                )}

                {seccion === "tabla_inicial" && (
                    <SeccionTablaInicial usuarioId={usuarioId} grupoId={grupoId} inicial={config.publicacion_inicial_tabla}
                        onGuardado={(nuevo) => alGuardar({ publicacion_inicial_tabla: nuevo })} />
                )}

                {seccion === "recordatorios" && (
                    <SeccionRecordatorios usuarioId={usuarioId} grupoId={grupoId} inicial={config.recordatorios}
                        onGuardado={(nuevo) => alGuardar({ recordatorios: nuevo })} />
                )}

                {seccion === "actualizacion" && (
                    <SeccionActualizacion usuarioId={usuarioId} grupoId={grupoId}
                        inicialMensaje={config.mensaje_actualizacion}
                        inicialUmbral={config.umbral_reservas}
                        inicialCooldown={config.cooldown_minutos}
                        onGuardado={(cambios) => alGuardar(cambios)} />
                )}

                {seccion === "cierre" && (
                    <SeccionCierre usuarioId={usuarioId} grupoId={grupoId} inicial={config.mensaje_cierre}
                        onGuardado={(nuevo) => alGuardar({ mensaje_cierre: nuevo })} />
                )}

            </div>

            <StickerPagoSection usuarioId={usuarioId} grupoId={grupoId} />

        </div>

    );

}
