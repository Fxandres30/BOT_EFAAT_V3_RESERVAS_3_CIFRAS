"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./GruposAutomatizacion.css";

import { getUser } from "@/services/auth/getUser";
import { GrupoAutorizado, listarGruposAutorizados, alternarGrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposConversacion, GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";
import AutorizarGrupoModal from "../AutorizarGrupoModal/AutorizarGrupoModal";

export default function GruposAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [grupos, setGrupos] = useState<GrupoAutorizado[]>([]);
    const [gruposConocidos, setGruposConocidos] = useState<GrupoConversacion[]>([]);

    const [modalAbierto, setModalAbierto] = useState(false);
    const [procesando, setProcesando] = useState<string | null>(null);

    async function cargarTodo(uid: string) {

        setCargando(true);
        setError(null);

        const [autorizadosRes, conocidosRes] = await Promise.all([
            listarGruposAutorizados(uid),
            obtenerGruposConversacion()
        ]);

        if (autorizadosRes.error) {
            setError(`No se pudo cargar grupos_autorizados (${autorizadosRes.error.message}).`);
        } else {
            setGrupos(autorizadosRes.data as GrupoAutorizado[]);
        }

        setGruposConocidos(conocidosRes.data);

        setCargando(false);

    }

    useEffect(() => {

        async function iniciar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (uid) {
                await cargarTodo(uid);
            } else {
                setCargando(false);
            }

        }

        iniciar();

    }, []);

    function nombreDeGrupo(grupoId: string) {
        return gruposConocidos.find((g) => g.grupo_id === grupoId)?.grupo_nombre || grupoId;
    }

    async function alternar(g: GrupoAutorizado) {

        setProcesando(g.id);

        const { data, error: errorUpdate } = await alternarGrupoAutorizado(g.id, !g.activo);

        setProcesando(null);

        if (!errorUpdate && data) {
            setGrupos((prev) => prev.map((x) => (x.id === g.id ? (data as GrupoAutorizado) : x)));
        }

    }

    function alAutorizado(nuevo: GrupoAutorizado) {

        setGrupos((prev) => {

            const existe = prev.some((g) => g.id === nuevo.id);

            if (existe) {
                return prev.map((g) => (g.id === nuevo.id ? nuevo : g));
            }

            return [nuevo, ...prev];

        });

        setModalAbierto(false);

    }

    return (

        <div className="grupos-automatizacion">

            <div>
                <h1 className="automatizacion-titulo">🤖 Automatización</h1>
            </div>

            <AutomatizacionNav />

            {cargando ? (

                <div className="grupos-estado-vacio">Cargando grupos...</div>

            ) : !usuarioId ? (

                <div className="grupos-estado-vacio">Debes iniciar sesión para administrar grupos.</div>

            ) : (

                <>

                    <div className="grupos-header">

                        <div>
                            <h2 className="grupos-seccion-titulo">Grupos autorizados</h2>
                            <p className="grupos-seccion-subtitulo">
                                Solo los grupos autorizados aquí pueden recibir automatización —
                                autorizar un grupo no lo activa por sí solo (todavía hace falta
                                horario permitido y un evento real detectado).
                            </p>
                        </div>

                        <button className="grupos-boton-autorizar" onClick={() => setModalAbierto(true)}>
                            + Autorizar grupo
                        </button>

                    </div>

                    {error && <p className="grupos-error">⚠️ {error}</p>}

                    {grupos.length === 0 ? (

                        <div className="grupos-estado-vacio">
                            Todavía no autorizaste ningún grupo. Usa <strong>+ Autorizar grupo</strong> para
                            elegir tu grupo de prueba.
                        </div>

                    ) : (

                        <div className="grupos-grid">

                            {grupos.map((g) => (

                                <div key={g.id} className="grupo-card">

                                    <div className="grupo-card-nombre">{nombreDeGrupo(g.grupo_id)}</div>
                                    <div className="grupo-card-jid">{g.grupo_id}</div>

                                    <div className={`grupo-card-estado ${g.activo ? "on" : "off"}`}>
                                        Automatización {g.activo ? "🟢 ACTIVADA" : "🔴 DESACTIVADA"}
                                    </div>

                                    <div className="grupo-card-acciones">

                                        <Link
                                            href={`/automatizacion/grupos/${encodeURIComponent(g.grupo_id)}`}
                                            className="grupo-card-boton"
                                        >
                                            Configurar
                                        </Link>

                                        <button
                                            className="grupo-card-boton peligro"
                                            disabled={procesando === g.id}
                                            onClick={() => alternar(g)}
                                        >
                                            {g.activo ? "Desactivar" : "Activar"}
                                        </button>

                                    </div>

                                </div>

                            ))}

                        </div>

                    )}

                </>

            )}

            {modalAbierto && usuarioId && (

                <AutorizarGrupoModal
                    usuarioId={usuarioId}
                    gruposConocidos={gruposConocidos}
                    gruposYaAutorizados={grupos.map((g) => g.grupo_id)}
                    onClose={() => setModalAbierto(false)}
                    onAutorizado={alAutorizado}
                />

            )}

        </div>

    );

}
