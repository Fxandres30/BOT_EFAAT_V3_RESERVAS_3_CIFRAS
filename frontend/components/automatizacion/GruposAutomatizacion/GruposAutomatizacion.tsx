"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import "./GruposAutomatizacion.css";

import { getUser } from "@/services/auth/getUser";
import { GrupoAutorizado, listarGruposAutorizados, alternarGrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
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

    const [modalAbierto, setModalAbierto] = useState(false);
    const [procesando, setProcesando] = useState<string | null>(null);

    async function cargarTodo(uid: string) {

        setCargando(true);
        setError(null);

        const [autorizadosRes, sesionesRes] = await Promise.all([
            listarGruposAutorizados(uid),
            obtenerGruposDisponibles(uid)
        ]);

        if (autorizadosRes.error) {
            setError(`No se pudo cargar grupos_autorizados (${autorizadosRes.error.message}).`);
        } else {
            setAutorizados(autorizadosRes.data as GrupoAutorizado[]);
        }

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

    // grupo_id/JID es la ÚNICA identidad de un grupo. "disponibles" viene
    // EXCLUSIVAMENTE de sesiones con socket real vivo AHORA MISMO (ver
    // gruposDisponibles.ts — ya no se decide por sesiones.estado).
    // grupos_autorizados nunca fabrica un grupo "actual": solo puede
    // adjuntar su estado a un grupo que ya vino de una sesión conectada
    // (ver mergeGrupos.ts); si no hay con qué asociarlo, queda en
    // "historicos" — separado, nunca mezclado con lo actual.
    const { disponibles, historicos } = mergearGrupos(sesiones, autorizados);

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

    function tituloSesiones(g: GrupoMergeado) {
        return g.sesiones.map((s) => s.nombreSesion).join(", ");
    }

    const hayAlgunaSesion = sesiones.length > 0;
    const sesionesConectadas = sesiones.filter((s) => s.conectada);
    const sesionesDesconectadas = sesiones.filter((s) => !s.conectada);
    const hayAlgunaSesionConectada = sesionesConectadas.length > 0;

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
                                Grupos reales que tu sesión de WhatsApp reporta AHORA MISMO — nunca a
                                partir de autorizaciones o mensajes históricos. Un grupo con el mismo JID
                                nunca aparece más de una vez, sin importar cuántas sesiones lo reporten.
                            </p>
                        </div>

                        <button className="grupos-boton-autorizar" onClick={() => setModalAbierto(true)}>
                            + Agregar por JID
                        </button>

                    </div>

                    {error && <p className="grupos-error">⚠️ {error}</p>}

                    {hayAlgunaSesion && (

                        <div className="grupos-sesiones-estado">

                            {sesionesConectadas.map((s) => (
                                <span key={s.sessionId} className="grupos-sesion-badge on">
                                    🟢 {s.nombreSesion} — conectada
                                </span>
                            ))}

                            {sesionesDesconectadas.map((s) => (
                                <span key={s.sessionId} className="grupos-sesion-badge off" title={s.error || undefined}>
                                    🔌 {s.nombreSesion} — desconectada ahora mismo
                                </span>
                            ))}

                        </div>

                    )}

                    {!hayAlgunaSesion ? (

                        <div className="grupos-estado-vacio">
                            No tienes ninguna sesión de WhatsApp registrada. Créala en
                            &quot;Sesiones&quot;, o usa <strong>+ Agregar por JID</strong>.
                        </div>

                    ) : !hayAlgunaSesionConectada ? (

                        <div className="grupos-estado-vacio">
                            Ninguna de tus sesiones tiene un socket de WhatsApp conectado ahora mismo —
                            no se puede confirmar qué grupos existen actualmente. Conéctala en
                            &quot;Sesiones&quot; para volver a verlos, o usa <strong>+ Agregar por JID</strong>.
                        </div>

                    ) : disponibles.length === 0 ? (

                        <div className="grupos-estado-vacio">
                            Tu sesión está conectada, pero WhatsApp no reportó ningún grupo para esa
                            cuenta ahora mismo. Prueba <strong>+ Agregar por JID</strong> mientras tanto.
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
                                No disponibles actualmente
                            </h3>

                            <p className="grupos-otros-nota">
                                Tienen una autorización guardada, pero WhatsApp no los reportó en la
                                consulta más reciente — pueden haber sido eliminados o el bot fue
                                removido. No se muestra un nombre actual porque no hay confirmación de
                                que el grupo siga existiendo.
                            </p>

                            <div className="grupos-grid">

                                {historicos.map((g) => (

                                    <div key={g.grupoId} className="grupo-card historico">

                                        <div className="grupo-card-nombre">JID: {g.grupoId}</div>

                                        <div className="grupo-card-estado off">
                                            🚫 No disponible actualmente
                                        </div>

                                        <div className="grupo-card-acciones">

                                            <Link
                                                href={`/automatizacion/grupos/${encodeURIComponent(g.grupoId)}`}
                                                className="grupo-card-boton"
                                            >
                                                Ver configuración
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
