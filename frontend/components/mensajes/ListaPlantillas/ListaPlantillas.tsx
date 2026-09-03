"use client";

import { useState } from "react";

import "./ListaPlantillas.css";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    alternarHabilitada,
    duplicarPlantilla,
    eliminarPlantilla,
    crearPlantillaVacia
} from "@/services/mensajes/plantillas";

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

        <div className="lista-plantillas">

            <div className="lista-plantillas-header">
                <span>{plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}</span>
                <span className="lista-plantillas-habilitadas">{habilitadasCount} habilitada{habilitadasCount === 1 ? "" : "s"}</span>
            </div>

            <div className="lista-plantillas-items">

                {plantillas.map((p) => (

                    <div
                        key={p.id}
                        className={`plantilla-item ${seleccionada?.id === p.id ? "seleccionada" : ""} ${!p.habilitada ? "deshabilitada" : ""}`}
                        onClick={() => onSeleccionar(p)}
                    >

                        <input
                            type="checkbox"
                            checked={p.habilitada}
                            disabled={procesando === p.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => alternar(p)}
                            title={p.habilitada ? "Habilitada" : "Deshabilitada"}
                        />

                        <div className="plantilla-item-info">

                            <span className="plantilla-item-nombre">
                                {p.nombre}
                            </span>

                            <span className="plantilla-item-texto">
                                {p.contenido || "(sin contenido)"}
                            </span>

                        </div>

                        <div className="plantilla-item-acciones" onClick={(e) => e.stopPropagation()}>

                            <button
                                disabled={procesando === p.id}
                                onClick={() => duplicar(p)}
                                title="Duplicar"
                            >
                                📄
                            </button>

                            <button
                                disabled={procesando === p.id}
                                onClick={() => eliminar(p)}
                                title="Eliminar"
                                className="danger"
                            >
                                🗑️
                            </button>

                        </div>

                    </div>

                ))}

            </div>

            <button
                className="lista-plantillas-nueva"
                disabled={creando}
                onClick={crearNueva}
            >
                {creando ? "Creando..." : "+ Nueva plantilla"}
            </button>

        </div>

    );

}
