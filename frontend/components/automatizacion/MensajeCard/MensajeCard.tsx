"use client";

import "./MensajeCard.css";

import { AutomationMessage } from "@/services/automatizacion/mensajesAutomation";
import { nombreTipo, nombreCategoria } from "@/services/automatizacion/tiposCategorias";

interface Props {
    mensaje: AutomationMessage;
    esPropio: boolean;
    procesando: boolean;
    onEditar: () => void;
    onDuplicar: () => void;
    onAlternar: () => void;
    onEliminar: () => void;
}

export default function MensajeCard({
    mensaje,
    esPropio,
    procesando,
    onEditar,
    onDuplicar,
    onAlternar,
    onEliminar
}: Props) {

    return (

        <div className={`mensaje-card ${!mensaje.activo ? "inactivo" : ""}`}>

            <p className="mensaje-card-texto">{mensaje.texto}</p>

            <div className="mensaje-card-meta">
                {nombreTipo(mensaje.tipo)} · {nombreCategoria(mensaje.categoria)}
                {!esPropio && <span className="mensaje-card-global"> · Global</span>}
            </div>

            <div className={`mensaje-card-estado ${mensaje.activo ? "on" : "off"}`}>
                {mensaje.activo ? "🟢 ACTIVO" : "🔴 INACTIVO"}
            </div>

            <div className="mensaje-card-acciones">

                {esPropio ? (

                    <>
                        <button disabled={procesando} onClick={onEditar}>Editar</button>
                        <button disabled={procesando} onClick={onDuplicar}>Duplicar</button>
                        <button disabled={procesando} onClick={onAlternar}>
                            {mensaje.activo ? "Desactivar" : "Activar"}
                        </button>
                        <button disabled={procesando} onClick={onEliminar} className="peligro">Eliminar</button>
                    </>

                ) : (

                    <button disabled={procesando} onClick={onDuplicar}>Duplicar como propio</button>

                )}

            </div>

        </div>

    );

}
