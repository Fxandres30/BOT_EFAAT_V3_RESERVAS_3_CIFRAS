"use client";

import { useState } from "react";
import { Plus, Copy, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    alternarHabilitada,
    duplicarPlantilla,
    eliminarPlantilla,
    crearPlantillaVacia
} from "@/services/mensajes/plantillas";

import styles from "./ListaPlantillas.module.css";

interface Props {
    tipo: TipoMensaje;
    plantillas: PlantillaMensaje[];
    seleccionada: PlantillaMensaje | null;
    usuarioId: string;
    onSeleccionar: (p: PlantillaMensaje) => void;
    onCambiada: (p: PlantillaMensaje) => void;
    onDuplicada: (p: PlantillaMensaje) => void;
    onEliminada: (id: string) => void;
    onCreada: (p: PlantillaMensaje) => void;
}

export default function ListaPlantillas({
    tipo,
    plantillas,
    seleccionada,
    usuarioId,
    onSeleccionar,
    onCambiada,
    onDuplicada,
    onEliminada,
    onCreada
}: Props) {

    const [procesando, setProcesando] = useState<string | null>(null);
    const [creando, setCreando] = useState(false);

    const habilitadasCount = plantillas.filter((p) => p.habilitada).length;

    async function alternar(p: PlantillaMensaje) {

        setProcesando(p.id);

        const { data, error } = await alternarHabilitada(p.id, !p.habilitada);

        setProcesando(null);

        if (!error && data) {
            onCambiada(data as PlantillaMensaje);
        }

    }

    async function duplicar(p: PlantillaMensaje) {

        setProcesando(p.id);

        const { data, error } = await duplicarPlantilla(p);

        setProcesando(null);

        if (!error && data) {
            onDuplicada(data as PlantillaMensaje);
        }

    }

    async function eliminar(p: PlantillaMensaje) {

        if (!confirm(`¿Eliminar la plantilla "${p.nombre}"?`)) return;

        setProcesando(p.id);

        const { error } = await eliminarPlantilla(p.id);

        setProcesando(null);

        if (!error) {
            onEliminada(p.id);
        }

    }

    async function crearNueva() {

        setCreando(true);

        const orden = plantillas.length
            ? Math.max(...plantillas.map((p) => p.orden)) + 1
            : 0;

        const { data, error } = await crearPlantillaVacia(usuarioId, tipo.id, orden);

        setCreando(false);

        if (!error && data) {
            onCreada(data as PlantillaMensaje);
        }

    }

    return (

        <div className={styles.list}>

            <div className={styles.header}>
                <span>{plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}</span>
                <span className={styles.enabled}>
                    {habilitadasCount} habilitada{habilitadasCount === 1 ? "" : "s"}
                </span>
            </div>

            <div className={styles.items}>

                {plantillas.map((p) => (

                    <div
                        key={p.id}
                        className={[
                            styles.item,
                            seleccionada?.id === p.id ? styles.itemSelected : "",
                            !p.habilitada ? styles.itemDisabled : ""
                        ].join(" ")}
                        onClick={() => onSeleccionar(p)}
                    >

                        <input
                            type="checkbox"
                            className={styles.check}
                            checked={p.habilitada}
                            disabled={procesando === p.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => alternar(p)}
                            title={p.habilitada ? "Habilitada" : "Deshabilitada"}
                        />

                        <div className={styles.info}>
                            <span className={styles.name}>{p.nombre}</span>
                            <span className={styles.preview}>
                                {p.contenido || "(sin contenido)"}
                            </span>
                        </div>

                        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>

                            <IconButton
                                label="Duplicar plantilla"
                                variant="ghost"
                                size="sm"
                                disabled={procesando === p.id}
                                onClick={() => duplicar(p)}
                            >
                                <Copy size={14} />
                            </IconButton>

                            <IconButton
                                label="Eliminar plantilla"
                                variant="danger"
                                size="sm"
                                disabled={procesando === p.id}
                                onClick={() => eliminar(p)}
                            >
                                <Trash2 size={14} />
                            </IconButton>

                        </div>

                    </div>

                ))}

            </div>

            <Button
                variant="secondary"
                size="sm"
                fullWidth
                loading={creando}
                leftIcon={<Plus size={14} />}
                onClick={crearNueva}
            >
                Nueva plantilla
            </Button>

        </div>

    );

}
