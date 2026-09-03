"use client";

import { useState } from "react";

import "./SessionMenu.css";

import { FaEllipsisVertical } from "react-icons/fa6";

import { shareSession } from "../actions/shareSession";

import {
    FaPen,
    FaStar,
    FaSync,
    FaTrash,
    FaLink
} from "react-icons/fa";

type Props = {

    sessionId: string;

    nombre: string;

    principal: boolean;

    conectado: boolean;

    esperandoQR: boolean;

    activa: boolean;

    onRename: () => void;

    onDelete: () => void;

    onPrincipal: () => void;

    onReconnect: () => void;

    onUseSession: () => void;

};

export default function SessionMenu({

    sessionId,
    principal,
    activa,

    onRename,
    onDelete,
    onPrincipal,
    onReconnect,
    onUseSession

}: Props) {

    const [open, setOpen] = useState(false);

    return (

        <div className="session-menu">

            <button

                className="menu-btn"

                onClick={() => setOpen(!open)}

            >

                <FaEllipsisVertical />

            </button>

            {

                open && (

                    <div className="menu-dropdown">

                        <button

                            onClick={() => {

                                setOpen(false);

                                onRename();

                            }}

                        >

                            <FaPen />

                            Cambiar nombre

                        </button>

                        {

    !principal && (

        <button

            onClick={() => {

                setOpen(false);

                onPrincipal();

            }}

        >

            <FaStar />

            Hacer preferida

        </button>

    )

}

{

    !activa && (

        <button

            onClick={() => {

                setOpen(false);

                onUseSession();

            }}

        >

            <FaStar />

            Usar esta sesión

        </button>

    )

}


                        <button

                            onClick={async () => {

                                setOpen(false);

                                await shareSession(sessionId);

                            }}

                        >

                            <FaLink />

                            Compartir enlace

                        </button>

                        <button

                            onClick={() => {

                                setOpen(false);

                                onReconnect();

                            }}

                        >

                            <FaSync />

                            Reconectar

                        </button>

                        <button

                            className="danger"

                            onClick={() => {

                                setOpen(false);

                                onDelete();

                            }}

                        >

                            <FaTrash />

                            Eliminar

                        </button>

                    </div>

                )

            }

        </div>

    );

}