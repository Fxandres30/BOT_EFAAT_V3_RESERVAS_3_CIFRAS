"use client";

import "./QRModal.css";

type Props = {
    open: boolean;
    qr: string;
    sessionId: string;
    segundos: number;
    onClose: () => void;
};

export default function QRModal({

    open,
    qr,
    sessionId,
    segundos,
    onClose

}: Props) {

    if (!open)
        return null;

    async function copiarEnlace() {

        const enlace =
            `${window.location.origin}/conectar/${sessionId}`;

        await navigator.clipboard.writeText(enlace);

        alert("✅ Enlace copiado correctamente.");

    }

    const minutos =
        String(Math.floor(segundos / 60)).padStart(2, "0");

    const segundosTexto =
        String(segundos % 60).padStart(2, "0");

    return (

        <div className="qr-overlay">

            <div className="qr-modal">

                <div className="logo">

                    📱

                </div>

                <h2>

                    Conectar WhatsApp

                </h2>

                <p className="subtitle">

                    Escanea este código desde

                    <br />

                    <strong>

                        WhatsApp → Dispositivos vinculados

                    </strong>

                </p>

                <div className="qr-box">

                    <img

                        src={qr}

                        alt="QR"

                    />

                </div>

                <div className="status">

                    <span className="pulse"></span>

                    Esperando conexión...

                </div>

                <div className="qr-timer">

                    ⏱ Tiempo restante

                    <strong>

                        {minutos}:{segundosTexto}

                    </strong>

                </div>

                <p className="warning">

                    El código QR cambia automáticamente cada pocos segundos.

                    <br />

                    Si expira, se actualizará sin necesidad de recargar la página.

                </p>

                <div className="buttons">

                    <button

                        className="share"

                        onClick={copiarEnlace}

                    >

                        📤 Compartir enlace

                    </button>

                    <button

                        className="close"

                        onClick={onClose}

                    >

                        ✖ Cerrar

                    </button>

                </div>

            </div>

        </div>

    );

}