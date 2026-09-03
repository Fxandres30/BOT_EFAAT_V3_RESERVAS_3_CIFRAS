"use client";

import "./SessionsPage.css";

import { useEffect, useState } from "react";

import { getUser } from "@/services/auth/getUser";
import { createSession } from "@/services/sessions/createSession";

import useSessions from "@/hooks/useSessions";

import SessionCard from "../SessionCard/SessionCard";

export default function SessionsPage() {

    const [usuarioId, setUsuarioId] = useState("");

    useEffect(() => {

        async function cargarUsuario() {

            const { data } = await getUser();

            if (data.user) {

                setUsuarioId(data.user.id);

            }

        }

        cargarUsuario();

    }, []);

    const {

        sessions,

        load

    } = useSessions(usuarioId);

    async function agregarSesion() {

        if (!usuarioId) {

            alert("Usuario no encontrado");

            return;

        }

        const res = await createSession(usuarioId);

        console.log(res);

        load();

    }

    return (

        <>

            <div className="sessions-header">

                <div>

                    <h1>Sesiones WhatsApp</h1>

                    <p>

                        Administra las sesiones del bot.

                    </p>

                </div>

                <button
                    onClick={agregarSesion}
                >
                    + Agregar sesión
                </button>

            </div>

            <div className="sessions-grid">

        {

sessions.map((session:any)=>(

<SessionCard
    key={session.id}
    id={session.id}
    nombre={session.nombre}
    telefono={session.telefono || "Sin conectar"}
    estado={session.estado}
    principal={session.principal}
    activa={session.activa}
/>

))

}

            </div>

        </>

    );

}