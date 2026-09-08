"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./GruposAutomatizacion.css";

import { getUser } from "@/services/auth/getUser";
import { GrupoAutorizado, listarGruposAutorizados, alternarGrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposConversacion, GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { mergearGrupos, GrupoMergeado } from "@/services/automatizacion/mergeGrupos";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";
import AutorizarGrupoModal from "../AutorizarGrupoModal/AutorizarGrupoModal";

export default function GruposAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [autorizados, setAutorizados] = useState<GrupoAutorizado[]>([]);
    const [sesiones, setSesiones] = useState<SesionConGrupos[]>([]);
    const [gruposConocidos, setGruposConocidos] = useState<GrupoConversacion[]>([]);

    const [modalAbierto, setModalAbierto] = useState(false);
    const [procesando, setProcesando] = useState<string | null>(null);

    async function cargarTodo(uid: string) {

        setCargando(true);
        setError(null);

        const [autorizadosRes, conocidosRes, sesionesRes] = await Promise.all([
            listarGruposAutorizados(uid),
            obtenerGruposConversacion(),
            obtenerGruposDisponibles(uid)
        ]);

        if (autorizadosRes.error) {
            setError(`No se pudo cargar grupos_autorizados (${autorizadosRes.error.message}).`);
        } else {
            setAutorizados(autorizadosRes.data as GrupoAutorizado[]);
        }

        setGruposConocidos(conocidosRes.data);
        setSesiones(sesionesRes);

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

    // grupo_id/JID es la ÚNICA identidad de un grupo — esta es la ÚNICA
    // fuente de la regla de fusión (ver mergeGrupos.ts): sesiones
    // conectadas primero (fuente primaria, en vivo), grupos_autorizados
    // solo adjunta el estado de autorización a una tarjeta ya existente,
    // nunca crea una tarjeta nueva ni duplica por venir de otra fuente.
    const { disponibles, historicos } = mergearGrupos(sesiones, autorizados);

    // Último nombre conocido (mensajes_grupos_sorteos) SOLO para mostrar
    // algo mejor que el JID crudo en la sección histórica — nunca decide
    // identidad ni hace que un grupo histórico se confunda con uno
    // conectado (mergearGrupos ya garantiza esa separación).
    function ultimoNombreConocido(grupoId: string) {
        return gruposConocidos.find((g) => g.grupo_id === grupoId)?.grupo_nombre || grupoId;
    }

    async function autorizarDirecto(grupoId: string) {

        if (!usuarioId) return;

        setProcesando(grupoId);

        const { data, error: errorAutorizar } = await autorizarGrupo(usuarioId, grupoId);

        setProcesando(null);

        if (!errorAutorizar && data) {
            alAutorizado(data as GrupoAutorizado);
        }

    }

    async function alternar(g: GrupoAutorizado) {

        setProcesando(g.id);

        const { data, error: errorUpdate } = await alternarGrupoAutorizado(g.id, !g.activo);

        setProcesando(null);

        if (!errorUpdate && data) {
            setAutorizados((prev) => prev.map((x) => (x.id === g.id ? (data as GrupoAutorizado) : x)));
        }

    }

    function alAutorizado(nuevo: GrupoAutorizado) {

        setAutorizados((prev) => {

            const existe = prev.some((g) => g.id === nuevo.id);

            if (existe) {
                return prev.map((g) => (g.id === nuevo.id ? nuevo : g));
            }

            return [nuevo, ...prev];

        });

        setModalAbierto(false);

    }

    const hayAlgunaSesion = sesiones.length > 0;

    function tituloSesiones(g: GrupoMergeado) {
        return g.sesiones.map((s) => s.nombreSesion).join(", ");
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
                            <h2 className="grupos-seccion-titulo">Grupos disponibles</h2>
                            <p className="grupos-seccion-subtitulo">
                                Grupos reales de tus sesiones de WhatsApp conectadas — un grupo con el
                                mismo JID nunca aparece más de una vez, sin importar cuántas sesiones o
                                fuentes lo reporten. Autoriza uno para poder configurarlo.
                            </p>
                        </div>

                        <button className="grupos-boton-autorizar" onClick={() => setModalAbierto(true)}>
                            + Agregar por JID
                        </button>

                    </div>

                    {error && <p className="grupos-error">⚠️ {error}</p>}

                    {!hayAlgunaSesion ? (

                        <div className="grupos-estado-vacio">
                            No tienes ninguna sesión de WhatsApp conectada ahora mismo. Conéctala en
                            &quot;Sesiones&quot; para ver aquí sus grupos, o usa <strong>+ Agregar por JID</strong>.
                        </div>

                    ) : disponibles.length === 0 ? (

                        <div className="grupos-estado-vacio">
                            Tus sesiones conectadas no reportaron ningún grupo (o falló la consulta).
                            Prueba <strong>+ Agregar por JID</strong> mientras tanto.
                        </div>

                    ) : (

                        <div className="grupos-grid">

                            {disponibles.map((g) => (

                                <div key={g.grupoId} className="grupo-card">

                                    <div className="grupo-card-nombre">{g.nombre}</div>
                                    <div className="grupo-card-jid">{g.grupoId}</div>
                                    <div className="grupo-card-sesion">📱 {tituloSesiones(g)}</div>

                                    <div className={`grupo-card-estado ${g.autorizacion ? (g.autorizacion.activo ? "on" : "pausado") : "off"}`}>
                                        {g.autorizacion
                                            ? (g.autorizacion.activo ? "🟢 Autorizado" : "🟡 Autorizado (inactivo)")
                                            : "⚪ No autorizado"}
                                    </div>

                                    <div className="grupo-card-acciones">

                                        {g.autorizacion ? (

                                            <Link
                                                href={`/automatizacion/grupos/${encodeURIComponent(g.grupoId)}`}
                                                className="grupo-card-boton"
                                            >
                                                Configurar
                                            </Link>

                                        ) : (

                                            <button
                                                className="grupo-card-boton principal"
                                                disabled={procesando === g.grupoId}
                                                onClick={() => autorizarDirecto(g.grupoId)}
                                            >
                                                {procesando === g.grupoId ? "Autorizando..." : "Autorizar"}
                                            </button>

                                        )}

                                    </div>

                                </div>

                            ))}

                        </div>

                    )}

                    {historicos.length > 0 && (

                        <div className="grupos-otros">

                            <h3 className="grupos-otros-titulo">
                                Autorizados anteriormente (sesión no conectada ahora)
                            </h3>

                            <div className="grupos-grid">

                                {historicos.map((g) => (

                                    <div key={g.grupoId} className="grupo-card">

                                        <div className="grupo-card-nombre">{ultimoNombreConocido(g.grupoId)}</div>
                                        <div className="grupo-card-jid">{g.grupoId}</div>

                                        <div className={`grupo-card-estado ${g.autorizacion?.activo ? "on" : "off"}`}>
                                            Automatización {g.autorizacion?.activo ? "🟢 ACTIVADA" : "🔴 DESACTIVADA"}
                                        </div>

                                        <div className="grupo-card-acciones">

                                            <Link
                                                href={`/automatizacion/grupos/${encodeURIComponent(g.grupoId)}`}
                                                className="grupo-card-boton"
                                            >
                                                Configurar
                                            </Link>

                                            {g.autorizacion && (

                                                <button
                                                    className="grupo-card-boton peligro"
                                                    disabled={procesando === g.autorizacion.id}
                                                    onClick={() => alternar(g.autorizacion as GrupoAutorizado)}
                                                >
                                                    {g.autorizacion.activo ? "Desactivar" : "Activar"}
                                                </button>

                                            )}

                                        </div>

                                    </div>

                                ))}

                            </div>

                        </div>

                    )}

                </>

            )}

            {modalAbierto && usuarioId && (

                <AutorizarGrupoModal
                    usuarioId={usuarioId}
                    gruposYaAutorizados={autorizados.map((g) => g.grupo_id)}
                    modoInicial="manual"
                    onClose={() => setModalAbierto(false)}
                    onAutorizado={alAutorizado}
                />

            )}

        </div>

    );

}
