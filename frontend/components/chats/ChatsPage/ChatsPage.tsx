"use client";

import { useEffect, useState } from "react";

import "./ChatsPage.css";

import { obtenerGruposConversacion, GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";
import { obtenerMensajesGrupo } from "@/services/chats/obtenerMensajesGrupo";

interface Mensaje {
    id: string;
    texto: string | null;
    nombre: string | null;
    push_name: string | null;
    from_me: boolean;
    tipo_mensaje: string;
    timestamp_whatsapp: number | null;
    accion: string | null;
    estado: string | null;
}

function formatearHora(ts: number | null) {

    if (!ts) return "";

    const fecha = new Date(ts * 1000);

    return fecha.toLocaleString("es-CO", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

}

export default function ChatsPage() {

    const [grupos, setGrupos] = useState<GrupoConversacion[]>([]);
    const [grupoSeleccionado, setGrupoSeleccionado] = useState<GrupoConversacion | null>(null);
    const [mensajes, setMensajes] = useState<Mensaje[]>([]);
    const [cargandoGrupos, setCargandoGrupos] = useState(true);
    const [cargandoMensajes, setCargandoMensajes] = useState(false);

    useEffect(() => {

        async function cargar() {

            setCargandoGrupos(true);

            const { data } = await obtenerGruposConversacion();

            setGrupos(data);

            setCargandoGrupos(false);

        }

        cargar();

    }, []);

    useEffect(() => {

        if (!grupoSeleccionado) return;

        async function cargarMensajes() {

            setCargandoMensajes(true);

            const { data, error } = await obtenerMensajesGrupo(grupoSeleccionado!.grupo_id);

            if (!error && data) {

                setMensajes([...data].reverse());

            }

            setCargandoMensajes(false);

        }

        cargarMensajes();

    }, [grupoSeleccionado]);

    return (

        <div className="chats-page">

            <div>
                <h1 className="chats-titulo">Chats</h1>
                <p className="chats-subtitulo">
                    Mensajes reales registrados por el BOT en cada grupo
                    ({"mensajes_grupos_sorteos"}). Solo lectura.
                </p>
            </div>

            <div className="chats-layout">

                <aside className="chats-lista-grupos">

                    {cargandoGrupos && <p className="chats-vacio">Cargando grupos...</p>}

                    {!cargandoGrupos && grupos.length === 0 && (
                        <p className="chats-vacio">
                            Todavía no hay mensajes registrados en ningún grupo.
                        </p>
                    )}

                    {grupos.map((g) => (

                        <button
                            key={g.grupo_id}
                            className={`chats-grupo-item ${grupoSeleccionado?.grupo_id === g.grupo_id ? "activo" : ""}`}
                            onClick={() => setGrupoSeleccionado(g)}
                        >
                            {g.grupo_nombre || g.grupo_id}
                        </button>

                    ))}

                </aside>

                <div className="chats-mensajes">

                    {!grupoSeleccionado && (
                        <p className="chats-vacio">Selecciona un grupo para ver la conversación real.</p>
                    )}

                    {grupoSeleccionado && cargandoMensajes && (
                        <p className="chats-vacio">Cargando mensajes...</p>
                    )}

                    {grupoSeleccionado && !cargandoMensajes && mensajes.length === 0 && (
                        <p className="chats-vacio">No hay mensajes registrados para este grupo.</p>
                    )}

                    {mensajes.map((m) => (

                        <div
                            key={m.id}
                            className={`chats-burbuja ${m.from_me ? "propia" : ""}`}
                        >
                            {!m.from_me && (
                                <div className="chats-burbuja-autor">
                                    {m.nombre || m.push_name || "Desconocido"}
                                </div>
                            )}

                            <div className="chats-burbuja-texto">
                                {m.texto || `(${m.tipo_mensaje})`}
                            </div>

                            <div className="chats-burbuja-hora">
                                {formatearHora(m.timestamp_whatsapp)}
                                {m.accion && m.accion !== "ninguna" ? ` · ${m.accion}` : ""}
                            </div>

                        </div>

                    ))}

                </div>

            </div>

        </div>

    );

}
