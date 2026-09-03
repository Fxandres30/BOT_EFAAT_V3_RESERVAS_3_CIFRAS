"use client";

import "./SessionHeader.css";

import SessionStatus from "../SessionStatus/SessionStatus";
import SessionMenu from "../../../SessionMenu/SessionMenu";

import { setActiveSession } from "@/services/sessions/setActiveSession";

interface Props {

    sessionId: string;

    nombre: string;

    principal: boolean;

    conectado: boolean;

    esperandoQR: boolean;

    activa: boolean;

    onRename: () => void;

    onDelete: () => void;

}

export default function SessionHeader({

    sessionId,

    nombre,

    principal,

    conectado,

    esperandoQR,

    activa,

    onRename,

    onDelete

}: Props) {

    const statusClass =
        conectado
            ? "connected"
            : esperandoQR
            ? "waiting"
            : "disconnected";

    return (

        <div className={`session-header ${statusClass}`}>

            <SessionStatus

                conectado={conectado}

                esperandoQR={esperandoQR}

            />

            <SessionMenu

                sessionId={sessionId}

                nombre={nombre}

                principal={principal}

                conectado={conectado}

                esperandoQR={esperandoQR}

                activa={activa}

                onRename={onRename}

                onDelete={onDelete}

                onPrincipal={() => {}}

                onReconnect={() => {}}

                onUseSession={async () => {

                    const res = await setActiveSession(sessionId);

                    console.log(res);

                }}

            />

        </div>

    );

}