"use client";

import { Copy, Pencil, Trash2, Eye } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";

import type { ElementoBiblioteca } from "@/services/mensajes/bibliotecaAutomatizacionDatos";
import { nombreTipoBiblioteca } from "@/services/mensajes/bibliotecaAutomatizacion";

import styles from "./MensajeCard.module.css";

interface Props {
    mensaje: ElementoBiblioteca;
    esPropio: boolean;
    procesando: boolean;
    onEditar: () => void;
    onDuplicar: () => void;
    onAlternar: () => void;
    onEliminar: () => void;
}

// Tarjeta de un mensaje de automatización (incluido Inicio del día): nombre,
// estado, texto y TIPO de envío. Las categorías ya no se muestran (los datos
// se conservan). Eliminar es una acción secundaria y siempre pide confirmación.
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
                <span className={styles.nombre} title={mensaje.nombre}>{mensaje.nombre || "Mensaje sin nombre"}</span>
                <StatusBadge
                    status={mensaje.activo ? "active" : "inactive"}
                    label={mensaje.activo ? "Activo" : "Inactivo"}
                    size="sm"
                />
            </div>

            <p className={styles.texto}>{mensaje.texto}</p>

            <div className={styles.meta}>
                <span>{nombreTipoBiblioteca(mensaje.tipo)}</span>
                {!esPropio && <span className={styles.global}>· De EFAAT</span>}
            </div>

            <div className={styles.acciones}>

                {esPropio ? (

                    <>
                        <Button variant="secondary" size="sm" leftIcon={<Pencil size={13} />} disabled={procesando} onClick={onEditar}>
                            Editar
                        </Button>
                        <Button variant="ghost" size="sm" leftIcon={<Copy size={13} />} disabled={procesando} onClick={onDuplicar}>
                            Duplicar
                        </Button>
                        <Button variant="ghost" size="sm" disabled={procesando} onClick={onAlternar}>
                            {mensaje.activo ? "Desactivar" : "Activar"}
                        </Button>
                        <button type="button" className={styles.eliminar} disabled={procesando} onClick={onEliminar} aria-label={`Eliminar «${mensaje.nombre}»`}>
                            <Trash2 size={13} aria-hidden="true" /> Eliminar
                        </button>
                    </>

                ) : (

                    <>
                        <Button variant="secondary" size="sm" leftIcon={<Eye size={13} />} disabled={procesando} onClick={onEditar}>
                            Ver
                        </Button>
                        <Button variant="ghost" size="sm" leftIcon={<Copy size={13} />} disabled={procesando} onClick={onDuplicar}>
                            Duplicar como propio
                        </Button>
                    </>

                )}

            </div>

        </div>

    );

}
