"use client";

import "./DeleteSessionModal.css";

import { FaTrash } from "react-icons/fa";

import { deleteSession } from "../actions/deleteSession";

import { useState } from "react";

type Props = {

    open: boolean;

    sessionId: string;

    nombre: string;

    onClose: () => void;

    onDeleted?: () => void;

};

export default function DeleteSessionModal({

    open,

    sessionId,

    nombre,

    onClose,

    onDeleted

}: Props) {

    const [loading,setLoading]=
        useState(false);

    if(!open)
        return null;

    async function eliminar(){

        setLoading(true);

        try{

            await deleteSession(sessionId);

            // No dependemos solo de Supabase Realtime (el evento DELETE
            // puede no llegar, p.ej. si la tabla no tiene REPLICA IDENTITY
            // FULL): refrescamos la lista explícitamente para que la card
            // desaparezca de inmediato, aquí mismo.
            onDeleted?.();

            onClose();

        }

        catch(err){

            console.error(err);

            alert("No fue posible eliminar la sesión.");

        }

        setLoading(false);

    }

    return(

        <div

            className="delete-overlay"

            onClick={onClose}

        >

            <div

                className="delete-modal"

                onClick={(e)=>e.stopPropagation()}

            >

                <div className="delete-icon">

                    <FaTrash/>

                </div>

                <h2>

                    Eliminar sesión

                </h2>

                <p>

                    Vas a eliminar la sesión

                    <strong>

                        {" "}{nombre}

                    </strong>

                </p>

                <p className="warning">

                    Esta acción eliminará la sesión y sus archivos de autenticación.

                    <br/>

                    No podrá deshacerse.

                </p>

                <div className="delete-buttons">

                    <button

                        className="cancel"

                        onClick={onClose}

                    >

                        Cancelar

                    </button>

                    <button

                        className="delete"

                        disabled={loading}

                        onClick={eliminar}

                    >

                        {

                            loading

                            ? "Eliminando..."

                            : "Eliminar"

                        }

                    </button>

                </div>

            </div>

        </div>

    );

}