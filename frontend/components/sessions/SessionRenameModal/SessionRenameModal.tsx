"use client";

import { useEffect, useState } from "react";

import "./SessionRenameModal.css";

import { renameSession } from "../actions/renameSession";

type Props = {
    open: boolean;
    sessionId: string;
    nombreActual: string;
    onClose: () => void;
};

export default function SessionRenameModal({
    open,
    sessionId,
    nombreActual,
    onClose
}: Props) {

    const [nombre, setNombre] = useState(nombreActual);

    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setNombre(nombreActual);
    }, [nombreActual]);

    useEffect(() => {

        function cerrar(e: KeyboardEvent) {

            if (e.key === "Escape") {

                onClose();

            }

        }

        if (open) {

            window.addEventListener("keydown", cerrar);

        }

        return () => {

            window.removeEventListener("keydown", cerrar);

        };

    }, [open, onClose]);

    if (!open) return null;

    async function guardar() {

        if (!nombre.trim()) return;

        setLoading(true);

        try {

            await renameSession(
                sessionId,
                nombre.trim()
            );

            onClose();

        } catch (err) {

            console.error(err);

            alert("No fue posible cambiar el nombre.");

        }

        setLoading(false);

    }

    return (

        <div
            className="rename-overlay"
            onClick={onClose}
        >

            <div
                className="rename-modal"
                onClick={(e) => e.stopPropagation()}
            >

                <h2>

                    Cambiar nombre

                </h2>

                <p>

                    Escribe el nuevo nombre de la sesión.

                </p>

                <input

                    value={nombre}

                    onChange={(e) =>
                        setNombre(e.target.value)
                    }

                    placeholder="Nombre de la sesión"

                    autoFocus

                />

                <div className="rename-buttons">

                    <button
                        className="cancel"
                        onClick={onClose}
                    >

                        Cancelar

                    </button>

                    <button
                        className="save"
                        disabled={loading}
                        onClick={guardar}
                    >

                        {
                            loading
                                ? "Guardando..."
                                : "Guardar"
                        }

                    </button>

                </div>

            </div>

        </div>

    );

}