"use client";

import "./SessionActions.css";

import {
    FaPowerOff,
    FaPlug,
    FaQrcode,
    FaStar,
    FaCheck
} from "react-icons/fa";

interface Props {

    conectado: boolean;

    esperandoQR: boolean;

    loading: boolean;

    activa: boolean;

    accionPrincipal: () => void;

    seleccionarSesion: () => void;

    textoBoton: () => string;

}

export default function SessionActions({

    conectado,

    esperandoQR,

    loading,

    activa,

    accionPrincipal,

    seleccionarSesion,

    textoBoton

}: Props) {

    const buttonClass =
        conectado
            ? "danger"
            : esperandoQR
            ? "warning"
            : "success";

    return (

        <div className="session-actions">

            <button

                className={`primary-btn ${buttonClass}`}

                disabled={loading}

                onClick={accionPrincipal}

            >

                {

                    conectado

                        ?

                        <>

                            <FaPowerOff />

                            {textoBoton()}

                        </>

                        :

                        esperandoQR

                        ?

                        <>

                            <FaQrcode />

                            {textoBoton()}

                        </>

                        :

                        <>

                            <FaPlug />

                            {textoBoton()}

                        </>

                }

            </button>

            {

                conectado && (

                    <button

                        className={`secondary-btn ${activa ? "active-session" : ""}`}

                        disabled={loading || activa}

                        onClick={() => {

                            if (!activa) {

                                seleccionarSesion();

                            }

                        }}

                    >

                        {

                            activa

                                ?

                                <>

                                    <FaCheck />

                                    Sesión en uso

                                </>

                                :

                                <>

                                    <FaStar />

                                    Usar esta sesión

                                </>

                        }

                    </button>

                )

            }

        </div>

    );

}