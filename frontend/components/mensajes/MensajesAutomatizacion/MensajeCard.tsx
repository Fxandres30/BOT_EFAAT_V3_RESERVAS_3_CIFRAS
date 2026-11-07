"use client";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";

import { AutomationMessage } from "@/services/automatizacion/mensajesAutomation";
import { nombreTipo, nombreCategoria } from "@/services/automatizacion/tiposCategorias";

import styles from "./MensajeCard.module.css";

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

        <div className={`${styles.card} ${!mensaje.activo ? styles.inactivo : ""}`}>

            <div className={styles.top}>
                <StatusBadge
                    status={mensaje.activo ? "active" : "inactive"}
                    label={mensaje.activo ? "Activo" : "Inactivo"}
                    size="sm"
                />
            </div>

            <p className={styles.texto}>{mensaje.texto}</p>

            <div className={styles.meta}>
                <span>{nombreTipo(mensaje.tipo)}</span>
                <span>·</span>
                <span>{nombreCategoria(mensaje.categoria)}</span>
                {!esPropio && <span className={styles.global}>· Global</span>}
            </div>

            <div className={styles.acciones}>

                {esPropio ? (

                    <>
                        <Button variant="secondary" size="sm" disabled={procesando} onClick={onEditar}>
                            Editar
                        </Button>
                        <Button variant="secondary" size="sm" disabled={procesando} onClick={onDuplicar}>
                            Duplicar
                        </Button>
                        <Button variant="secondary" size="sm" disabled={procesando} onClick={onAlternar}>
                            {mensaje.activo ? "Desactivar" : "Activar"}
                        </Button>
                        <Button variant="danger" size="sm" disabled={procesando} onClick={onEliminar}>
                            Eliminar
                        </Button>
                    </>

                ) : (

                    <Button variant="secondary" size="sm" disabled={procesando} onClick={onDuplicar}>
                        Duplicar como propio
                    </Button>

                )}

            </div>

        </div>

    );

}
