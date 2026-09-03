"use client";

import "./SessionBody.css";

import { FaWhatsapp } from "react-icons/fa";

import SessionBadge from "../SessionBadge/SessionBadge";
import SessionPhone from "../SessionPhone/SessionPhone";

interface Props {

    id: string;

    nombre: string;

    telefono: string;

    principal: boolean;

}

export default function SessionBody({

    id,

    nombre,

    telefono,

    principal

}: Props) {

    return (

        <div className="session-body">

            <div className="session-logo">

                <FaWhatsapp />

            </div>

            <div className="session-info">

                <h3>{nombre}</h3>

                <SessionBadge principal={principal} />

            </div>

            <SessionPhone telefono={telefono} />

            <div className="session-id" title={id}>

                <span className="session-id-label">🆔 Session ID</span>

                <span className="session-id-value">{id}</span>

            </div>

        </div>

    );

}