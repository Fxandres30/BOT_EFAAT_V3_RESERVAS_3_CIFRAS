"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";

import { formatHora12 } from "@/lib/formatHora";

import { getUser } from "@/services/auth/getUser";
import { AutomationConfig, listarConfiguraciones } from "@/services/automatizacion/automationConfigs";
import { obtenerGruposConversacion, GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";
import { nombreCategoria } from "@/services/automatizacion/tiposCategorias";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";

import styles from "./ProgramacionAutomatizacion.module.css";

// Vista de SOLO LECTURA: la fuente real de la programación sigue siendo
// automation_configs por grupo (sin segunda fuente de verdad) — para
// editarla, este tab enlaza a la misma página de configuración del grupo
// que ya usa la sección "Grupos".
export default function ProgramacionAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [configs, setConfigs] = useState<AutomationConfig[]>([]);
    const [gruposConocidos, setGruposConocidos] = useState<GrupoConversacion[]>([]);

    useEffect(() => {

        async function cargar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (!uid) {
                setCargando(false);
                return;
            }

            const [configsRes, conocidosRes] = await Promise.all([
                listarConfiguraciones(uid),
                obtenerGruposConversacion()
            ]);

            if (configsRes.error) {
                setError(`No se pudo cargar la programación (${configsRes.error.message}).`);
            } else {
                setConfigs((configsRes.data as AutomationConfig[]) || []);
            }

            setGruposConocidos(conocidosRes.data);
            setCargando(false);

        }

        cargar();

    }, []);

    function nombreDeGrupo(grupoId: string) {
        return gruposConocidos.find((g) => g.grupo_id === grupoId)?.grupo_nombre || grupoId;
    }

    function dot(activo?: boolean) {
        return <span className={`${styles.dot} ${activo ? styles.dotOn : ""}`} aria-hidden="true" />;
    }

    return (

        <div className={styles.page}>

            <AutomatizacionHeader />

            <p className={styles.lead}>
                Programación de recordatorios y actualizaciones por grupo. Los offsets se calculan
                siempre sobre la hora de cierre REAL del evento detectado — para editar, entra a
                «Configurar» desde Grupos.
            </p>

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : !usuarioId ? (

                <div className={styles.state}>Debes iniciar sesión.</div>

            ) : error ? (

                <p className={styles.error}>
                    <AlertTriangle size={15} /> {error}
                </p>

            ) : configs.length === 0 ? (

                <EmptyState
                    title="Sin programación guardada"
                    description="Todavía no hay configuración para ningún grupo."
                    action={<Link href="/automatizacion/grupos" className={styles.editLink}>Ir a Grupos</Link>}
                />

            ) : (

                <div className={styles.grid}>

                    {configs.map((c) => {

                        const recordatorios = Object.entries(c.recordatorios || {}).sort((a, b) => Number(a[0]) - Number(b[0]));

                        return (

                            <div key={c.id} className={styles.card}>

                                <div className={styles.cardHeader}>
                                    <span className={styles.cardName}>{nombreDeGrupo(c.grupo_id)}</span>
                                    <Link
                                        href={`/automatizacion/grupos/${encodeURIComponent(c.grupo_id)}`}
                                        className={styles.editLink}
                                    >
                                        Editar
                                    </Link>
                                </div>

                                <div className={styles.section}>

                                    {recordatorios.length === 0 && (
                                        <p className={styles.nota}>Sin recordatorios configurados.</p>
                                    )}

                                    {recordatorios.map(([offset, cfg]) => (
                                        <div key={offset} className={styles.row}>
                                            <span>{offset} min antes</span>
                                            <span className={styles.rowValue}>
                                                {dot(cfg.activo)}
                                                {nombreCategoria(cfg.categoria)}
                                            </span>
                                        </div>
                                    ))}

                                </div>

                                <div className={styles.row}>
                                    <span>Tabla inicial</span>
                                    <span className={styles.rowValue}>
                                        {dot(c.publicacion_inicial_tabla?.activo)}
                                        {c.publicacion_inicial_tabla?.activo
                                            ? formatHora12(c.publicacion_inicial_tabla.hora)
                                            : "desactivada"}
                                    </span>
                                </div>

                                <div className={styles.foot}>
                                    <span>Actualización: {c.mensaje_actualizacion?.activo ? "sí" : "no"}</span>
                                    <span>Umbral: {c.umbral_reservas}</span>
                                    <span>Cooldown: {c.cooldown_minutos} min</span>
                                </div>

                            </div>

                        );

                    })}

                </div>

            )}

        </div>

    );

}
