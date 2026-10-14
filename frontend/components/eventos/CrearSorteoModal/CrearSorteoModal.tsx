"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

import FormularioSorteo from "@/components/sorteos/FormularioSorteo";
import VistaPreviaModal from "@/components/sorteos/VistaPreviaModal";

import { MODALIDADES, type Modalidad } from "../modalidad";

import styles from "./CrearSorteoModal.module.css";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Modalidad elegida y disponible: continuar al formulario real. */
    onContinuar: () => void;
}

// "Crear sorteo" desde Eventos. CORRECCIÓN: antes este modal era solo
// informativo y no creaba nada. Ahora 2 cifras continúa al flujo REAL de
// sorteos programados (backend /sorteos): borrador -> vista previa real ->
// confirmación expresa -> publicación programada por grupo. Nada se publica
// sin confirmar. Las modalidades de 3 cifras siguen deshabilitadas (ver
// faltantes). Los sorteos que el bot detecta en los grupos siguen igual.
const DETALLE: Record<Modalidad, { disponible: boolean; texto: string; faltantes?: string[] }> = {
    dos: {
        disponible: true,
        texto: "Configura el sorteo (grupos, precio, premios, cuentas de pago, hora y mensajes). Se guarda como borrador: verás la vista previa real y solo se programa cuando lo confirmes. Los sorteos que el bot detecta en los grupos siguen funcionando igual."
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
            "Reglas de participación sin pago (cuántos números por persona, cómo se asignan, requisitos) — decisión de negocio pendiente"
        ]
    }
};

export default function CrearSorteoModal({ open, onClose, onContinuar }: Props) {

    const [modalidad, setModalidad] = useState<Modalidad>("dos");
    const detalle = DETALLE[modalidad];

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Crear sorteo"
            description="Elige la modalidad. Los números se asignan según las reglas del sistema: no se elige un número específico."
            size="md"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                    <Button onClick={onContinuar} disabled={!detalle.disponible}>Configurar sorteo</Button>
                </>
            }
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

type Paso =
    | { tipo: "cerrado" }
    | { tipo: "modalidad" }
    | { tipo: "formulario" }
    | { tipo: "vista_previa"; sorteoId: string }
    | { tipo: "programado"; sorteoId: string };

// Botón "+ Crear sorteo" para la cabecera de la página Eventos: modalidad ->
// formulario real (borrador) -> vista previa real -> confirmación.
export function BotonCrearSorteo() {

    const [paso, setPaso] = useState<Paso>({ tipo: "cerrado" });
    const cerrar = () => setPaso({ tipo: "cerrado" });

    return (
        <>
            <Button leftIcon={<Plus size={16} />} onClick={() => setPaso({ tipo: "modalidad" })}>Crear sorteo</Button>

            <CrearSorteoModal
                open={paso.tipo === "modalidad"}
                onClose={cerrar}
                onContinuar={() => setPaso({ tipo: "formulario" })}
            />

            <FormularioSorteo
                key={paso.tipo === "formulario" ? "form-abierto" : "form-cerrado"}
                open={paso.tipo === "formulario"}
                sorteo={null}
                onClose={cerrar}
                onGuardado={s => setPaso({ tipo: "vista_previa", sorteoId: s.id })}
            />

            <VistaPreviaModal
                key={paso.tipo === "vista_previa" ? paso.sorteoId : "sin-vista"}
                sorteoId={paso.tipo === "vista_previa" ? paso.sorteoId : null}
                onClose={cerrar}
                onConfirmado={() => setPaso(p => (p.tipo === "vista_previa" ? { tipo: "programado", sorteoId: p.sorteoId } : p))}
            />

            <Modal
                open={paso.tipo === "programado"}
                onClose={cerrar}
                title="Sorteo programado"
                description="Se publicará en cada grupo a la hora indicada."
                size="sm"
                footer={<Button variant="secondary" onClick={cerrar}>Cerrar</Button>}
            >
                <p>
                    Sigue el estado de publicación por grupo, edítalo o cancélalo en{" "}
                    <Link href="/sorteos">Sorteos programados</Link>.
                </p>
            </Modal>
        </>
    );

}
