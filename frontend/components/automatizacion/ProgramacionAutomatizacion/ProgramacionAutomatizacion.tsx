"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./ProgramacionAutomatizacion.css";

import { getUser } from "@/services/auth/getUser";
import { AutomationConfig, listarConfiguraciones } from "@/services/automatizacion/automationConfigs";
import { obtenerGruposConversacion, GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";
import { nombreCategoria } from "@/services/automatizacion/tiposCategorias";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";

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

    return (

        <div className="programacion-automatizacion">

            <div>
                <h1 className="automatizacion-titulo">🤖 Automatización</h1>
            </div>

            <AutomatizacionNav />

            <p className="grupos-seccion-subtitulo">
                Programación de recordatorios y actualizaciones por grupo. Los offsets se
                calculan siempre sobre la hora de cierre REAL del evento detectado — para
                editar, entra a &quot;Configurar&quot; desde Grupos.
            </p>

            {cargando ? (

                <div className="programacion-vacio">Cargando...</div>

            ) : !usuarioId ? (

                <div className="programacion-vacio">Debes iniciar sesión.</div>

            ) : error ? (

                <p className="grupos-error">⚠️ {error}</p>

            ) : configs.length === 0 ? (

                <div className="programacion-vacio">
                    Todavía no hay configuración guardada para ningún grupo. Entra a
                    <Link href="/automatizacion/grupos"> Grupos</Link> para crear la primera.
                </div>

            ) : (

                <div className="programacion-grid">

                    {configs.map((c) => {

                        const recordatorios = Object.entries(c.recordatorios || {}).sort((a, b) => Number(a[0]) - Number(b[0]));

                        return (

                            <div key={c.id} className="programacion-card">

                                <div className="programacion-card-header">
                                    <span className="programacion-card-nombre">{nombreDeGrupo(c.grupo_id)}</span>
                                    <Link href={`/automatizacion/grupos/${encodeURIComponent(c.grupo_id)}`}>Editar</Link>
                                </div>

                                <div className="programacion-lista">

                                    {recordatorios.length === 0 && (
                                        <span className="programacion-nota">Sin recordatorios configurados.</span>
                                    )}

                                    {recordatorios.map(([offset, cfg]) => (
                                        <div key={offset} className="programacion-item">
                                            <span>{offset} min antes</span>
                                            <span>{cfg.activo ? "🟢" : "⚪"} {nombreCategoria(cfg.categoria)}</span>
                                        </div>
                                    ))}

                                </div>

                                <div className="programacion-actualizacion">
                                    <span>Actualización: {c.mensaje_actualizacion?.activo ? "🟢" : "⚪"}</span>
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
