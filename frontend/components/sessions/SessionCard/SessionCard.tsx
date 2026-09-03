"use client";

import { useState } from "react";

import "./SessionCard.css";

import SessionStatus from "./components/SessionStatus/SessionStatus";
import SessionBotStatus from "./components/SessionBotStatus/SessionBotStatus";
import SessionBody from "./components/SessionBody/SessionBody";
import SessionActions from "./components/SessionActions/SessionActions";
import SessionModals from "./components/SessionModals/SessionModals";

import SessionMenu from "../SessionMenu/SessionMenu";

import { useSession } from "./hooks/useSession";

import { setActiveSession } from "@/services/sessions/setActiveSession";
import { setPreferredSession } from "@/services/sessions/setPreferredSession";
import { connectSession } from "@/services/sessions/connectSession";

interface Props {

    id: string;

    nombre: string;

    telefono: string;

    estado: string;

    principal: boolean;

    activa: boolean;

}

export default function SessionCard({

    id,

    nombre,

    telefono,

    estado,

    principal,

    activa

}: Props) {

    const {

    loading,

    open,

    qr,

    segundos,

    estadoActual,

    accionPrincipal,

    textoBoton,

    cerrarQR

} = useSession(id, estado);

    const conectado =
        estadoActual === "conectado";

    const esperandoQR =
        estadoActual === "esperando_qr";

    const statusClass =
        conectado
            ? "connected"
            : esperandoQR
            ? "waiting"
            : "disconnected";

    const [renameOpen, setRenameOpen] = useState(false);

    const [deleteOpen, setDeleteOpen] = useState(false);

    return (

        <>

            <div className={`session-card ${statusClass}`}>

                <div className="session-header">

                    <SessionStatus
                        conectado={conectado}
                        esperandoQR={esperandoQR}
                    />

                    <SessionMenu
                        sessionId={id}
                        nombre={nombre}
                        principal={principal}
                        conectado={conectado}
                        esperandoQR={esperandoQR}
                        activa={activa}
                        onRename={() => setRenameOpen(true)}
                        onDelete={() => setDeleteOpen(true)}
                        onPrincipal={async () => {

                            try {

                                await setPreferredSession(id);

                            }

                            catch (error) {

                                console.error(error);

                            }

                        }}
                        onReconnect={async () => {

                            try {

                                await connectSession(id);

                            }

                            catch (error) {

                                console.error(error);

                            }

                        }}
                        onUseSession={async () => {

                            const res =
                                await setActiveSession(id);

                            console.log(res);

                        }}
                    />

                </div>

                <SessionBotStatus
                    activa={activa}
                    principal={principal}
                />

                <SessionBody
                    id={id}
                    nombre={nombre}
                    telefono={telefono}
                    principal={principal}
                />

                <SessionActions
    conectado={conectado}
    esperandoQR={esperandoQR}
    loading={loading}
    activa={activa}
    accionPrincipal={accionPrincipal}
    textoBoton={textoBoton}
    seleccionarSesion={async () => {

        try {

            // No hace falta recargar la página: useSessions/useSession ya
            // están suscritos en tiempo real a cambios de la tabla
            // "sesiones" (Supabase Realtime) y reflejan "activa"/
            // "principal" solos en cuanto el backend los actualiza.
            await setActiveSession(id);

        }

        catch (error) {

            console.error(error);

        }

    }}
/>

            </div>

            <SessionModals
    qrOpen={open}
    qr={qr}
    sessionId={id}
    segundos={segundos}
    cerrarQR={cerrarQR}
    renameOpen={renameOpen}
    deleteOpen={deleteOpen}
    nombre={nombre}
    onCloseRename={() => setRenameOpen(false)}
    onCloseDelete={() => setDeleteOpen(false)}
/>

        </>

    );

}