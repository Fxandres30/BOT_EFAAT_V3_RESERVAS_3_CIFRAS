"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

import { MODALIDADES, type Modalidad } from "../modalidad";

import styles from "./CrearSorteoModal.module.css";

interface Props {
    open: boolean;
    onClose: () => void;
}

// Estructura de "Crear sorteo". NO escribe nada en la base: hoy los
// sorteos de 2 cifras los crea el bot al detectar el anuncio en un grupo
// (guardarEvento.js), y las modalidades de 3 cifras todavía no tienen
// tabla de reservas ni configuración. El administrador nunca elige un
// número: el sistema los asigna según sus reglas existentes.
const DETALLE: Record<Modalidad, { disponible: boolean; texto: string; faltantes?: string[] }> = {
    dos: {
        disponible: true,
        texto: "Los sorteos de 2 cifras se crean automáticamente cuando el bot detecta el anuncio del sorteo en un grupo autorizado de WhatsApp. Aparecerán en Activos en cuanto el bot lo registre."
    },
    tres_pago: {
        disponible: false,
        texto: "Todavía no disponible. Para crear sorteos de 3 cifras de pago falta:",
        faltantes: [
            "Tabla de reservas con números 000–999",
            "Configuración de precio → tabla (configEvento)",
            "Detección de sorteos de 3 cifras en el bot",
            "Tipos de premio de 3 cifras",
            "Registro del número ganador (resultados)"
        ]
    },
    tres_gratis: {
        disponible: false,
        texto: "Todavía no disponible. Además de lo que falta para 3 cifras de pago, falta:",
        faltantes: [
            "Marcar el sorteo como gratuito (sin valor)",
            "Reglas de participación sin pago"
        ]
    }
};

export default function CrearSorteoModal({ open, onClose }: Props) {

    const [modalidad, setModalidad] = useState<Modalidad>("dos");
    const detalle = DETALLE[modalidad];

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Crear sorteo"
            description="Elige la modalidad. Los números se asignan según las reglas del sistema: no se elige un número específico."
            size="md"
            footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
        >
            <fieldset className={styles.opciones}>
                <legend className={styles.legend}>Modalidad</legend>
                {MODALIDADES.map((m) => (
                    <label key={m.id} className={`${styles.opcion} ${modalidad === m.id ? styles.opcionActiva : ""}`}>
                        <input
                            type="radio"
                            name="modalidad"
                            value={m.id}
                            checked={modalidad === m.id}
                            onChange={() => setModalidad(m.id)}
                        />
                        <span className={styles.opcionTexto}>
                            <strong>{m.id === "dos" ? "2 CIFRAS — PAGO" : m.id === "tres_pago" ? "3 CIFRAS — PAGO" : "3 CIFRAS — GRATIS"}</strong>
                            <span>{m.rango} · {m.cantidad} números</span>
                        </span>
                    </label>
                ))}
            </fieldset>

            <div className={detalle.disponible ? styles.info : styles.aviso} role="status">
                <p>{detalle.texto}</p>
                {detalle.faltantes && (
                    <ul>
                        {detalle.faltantes.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                )}
            </div>
        </Modal>
    );

}

// Botón "+ Crear sorteo" para la cabecera de la página Eventos.
export function BotonCrearSorteo() {

    const [abierto, setAbierto] = useState(false);

    return (
        <>
            <Button leftIcon={<Plus size={16} />} onClick={() => setAbierto(true)}>Crear sorteo</Button>
            <CrearSorteoModal open={abierto} onClose={() => setAbierto(false)} />
        </>
    );

}
