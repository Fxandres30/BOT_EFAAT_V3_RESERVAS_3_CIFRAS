"use client";

import { useEffect, useState } from "react";

import "./CentroMensajes.css";

import { getUser } from "@/services/auth/getUser";
import {
    AutomationMessage,
    FiltrosMensajes,
    listarMensajes,
    alternarActivo,
    duplicarMensaje,
    eliminarMensaje
} from "@/services/automatizacion/mensajesAutomation";
import { TIPOS_AUTOMATIZACION, CATEGORIAS_AUTOMATIZACION } from "@/services/automatizacion/tiposCategorias";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";
import MensajeCard from "../MensajeCard/MensajeCard";
import MensajeModal from "../MensajeModal/MensajeModal";

export default function CentroMensajes() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [mensajes, setMensajes] = useState<AutomationMessage[]>([]);

    const [filtroTipo, setFiltroTipo] = useState("");
    const [filtroCategoria, setFiltroCategoria] = useState("");
    const [filtroEstado, setFiltroEstado] = useState<FiltrosMensajes["estado"]>("todos");

    const [modal, setModal] = useState<"nuevo" | AutomationMessage | null>(null);
    const [procesando, setProcesando] = useState<string | null>(null);

    async function cargar(uid: string) {

        setCargando(true);
        setError(null);

        const { data, error: errorCarga } = await listarMensajes(uid, {
            tipo: filtroTipo || undefined,
            categoria: filtroCategoria || undefined,
            estado: filtroEstado
        });

        if (errorCarga) {
            setError(`No se pudieron cargar los mensajes (${errorCarga.message}).`);
            setMensajes([]);
        } else {
            setMensajes((data as AutomationMessage[]) || []);
        }

        setCargando(false);

    }

    useEffect(() => {

        async function iniciar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (uid) {
                await cargar(uid);
            } else {
                setCargando(false);
            }

        }

        iniciar();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {

        if (usuarioId) {
            cargar(usuarioId);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtroTipo, filtroCategoria, filtroEstado]);

    async function alternar(m: AutomationMessage) {

        if (m.usuario_id !== usuarioId) return; // ajeno/global — sin controles

        setProcesando(m.id);

        const { data, error: errorAlt } = await alternarActivo(m.id, !m.activo);

        setProcesando(null);

        if (!errorAlt && data) {
            setMensajes((prev) => prev.map((x) => (x.id === m.id ? (data as AutomationMessage) : x)));
        }

    }

    async function duplicar(m: AutomationMessage) {

        if (!usuarioId) return;

        setProcesando(m.id);

        const { data, error: errorDup } = await duplicarMensaje(usuarioId, m);

        setProcesando(null);

        if (!errorDup && data) {
            setMensajes((prev) => [data as AutomationMessage, ...prev]);
        }

    }

    async function eliminar(m: AutomationMessage) {

        if (m.usuario_id !== usuarioId) return;

        if (!confirm(`¿Eliminar el mensaje "${m.nombre_interno}"?`)) return;

        setProcesando(m.id);

        const { error: errorDel } = await eliminarMensaje(m.id);

        setProcesando(null);

        if (!errorDel) {
            setMensajes((prev) => prev.filter((x) => x.id !== m.id));
        }

    }

    function alGuardado(m: AutomationMessage) {

        setMensajes((prev) => {

            const existe = prev.some((x) => x.id === m.id);

            if (existe) {
                return prev.map((x) => (x.id === m.id ? m : x));
            }

            return [m, ...prev];

        });

        setModal(null);

    }

    return (

        <div className="centro-mensajes">

            <div>
                <h1 className="automatizacion-titulo">🤖 Automatización</h1>
            </div>

            <AutomatizacionNav />

            {!usuarioId && !cargando ? (

                <div className="centro-mensajes-vacio">Debes iniciar sesión para administrar mensajes.</div>

            ) : (

                <>

                    <div className="centro-mensajes-header">

                        <div>
                            <h2 className="grupos-seccion-titulo">Centro de mensajes</h2>
                            <p className="grupos-seccion-subtitulo">
                                El pool de mensajes que usan REMINDER/UPDATE/CLOSE/OPEN —
                                globales (visibles para todos) y los tuyos propios.
                            </p>
                        </div>

                        <button className="grupos-boton-autorizar" onClick={() => setModal("nuevo")}>
                            + Nuevo mensaje
                        </button>

                    </div>

                    <div className="centro-mensajes-filtros">

                        <label>
                            Tipo
                            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                                <option value="">Todos</option>
                                {TIPOS_AUTOMATIZACION.map((t) => (
                                    <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                            </select>
                        </label>

                        <label>
                            Categoría
                            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
                                <option value="">Todas</option>
                                {CATEGORIAS_AUTOMATIZACION.map((c) => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </label>

                        <label>
                            Estado
                            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as FiltrosMensajes["estado"])}>
                                <option value="todos">Todos</option>
                                <option value="activos">Activos</option>
                                <option value="inactivos">Inactivos</option>
                            </select>
                        </label>

                    </div>

                    {error && <p className="grupos-error">⚠️ {error}</p>}

                    {cargando ? (

                        <div className="centro-mensajes-vacio">Cargando mensajes...</div>

                    ) : mensajes.length === 0 ? (

                        <div className="centro-mensajes-vacio">
                            No hay mensajes con estos filtros. Crea el primero con <strong>+ Nuevo mensaje</strong>.
                        </div>

                    ) : (

                        <div className="centro-mensajes-grid">

                            {mensajes.map((m) => (

                                <MensajeCard
                                    key={m.id}
                                    mensaje={m}
                                    esPropio={m.usuario_id === usuarioId}
                                    procesando={procesando === m.id}
                                    onEditar={() => setModal(m)}
                                    onDuplicar={() => duplicar(m)}
                                    onAlternar={() => alternar(m)}
                                    onEliminar={() => eliminar(m)}
                                />

                            ))}

                        </div>

                    )}

                </>

            )}

            {modal && usuarioId && (

                <MensajeModal
                    usuarioId={usuarioId}
                    mensaje={modal === "nuevo" ? null : modal}
                    onClose={() => setModal(null)}
                    onGuardado={alGuardado}
                />

            )}

        </div>

    );

}
