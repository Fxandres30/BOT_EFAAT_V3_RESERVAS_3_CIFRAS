"use client";

import { useEffect, useState } from "react";

import "./EditorMensaje.css";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    actualizarPlantilla,
    crearPlantilla,
    valoresPorDefectoVariables
} from "@/services/mensajes/plantillas";
import { aplicarPlantillaPreview } from "@/services/mensajes/aplicarPlantillaPreview";

interface Props {
    tipo: TipoMensaje;
    usuarioId: string;
    plantilla: PlantillaMensaje;
    onGuardada: (p: PlantillaMensaje) => void;
    onGuardadaComoNueva: (p: PlantillaMensaje) => void;
}

// Editor reutilizable: la misma UI sirve para cualquier plantilla de
// cualquier tipo — nunca se crea un formulario distinto por plantilla.
export default function EditorMensaje({ tipo, usuarioId, plantilla, onGuardada, onGuardadaComoNueva }: Props) {

    const [nombre, setNombre] = useState(plantilla.nombre);
    const [estilo, setEstilo] = useState(plantilla.estilo);
    const [contenido, setContenido] = useState(plantilla.contenido);
    const [variables, setVariables] = useState(plantilla.variables || valoresPorDefectoVariables());

    const [guardando, setGuardando] = useState(false);
    const [mensaje, setMensaje] = useState<string | null>(null);

    useEffect(() => {

        setNombre(plantilla.nombre);
        setEstilo(plantilla.estilo);
        setContenido(plantilla.contenido);
        setVariables(plantilla.variables || valoresPorDefectoVariables());
        setMensaje(null);

    }, [plantilla.id]);

    function actualizarMostrar(campo: string, valor: boolean) {
        setVariables((prev) => ({ ...prev, [campo]: valor }));
    }

    async function guardar() {

        setGuardando(true);
        setMensaje(null);

        const { data, error } = await actualizarPlantilla(plantilla.id, {
            nombre,
            estilo,
            contenido,
            variables
        });

        setGuardando(false);

        if (error) {
            setMensaje(`Error guardando: ${error.message}`);
            return;
        }

        if (data) {
            onGuardada(data as PlantillaMensaje);
        }

        setMensaje("Guardado.");

    }

    async function guardarComoNueva() {

        setGuardando(true);
        setMensaje(null);

        const { data, error } = await crearPlantilla({
            usuario_id: usuarioId,
            tipo_respuesta: tipo.id,
            nombre: nombre.endsWith(" (copia)") ? nombre : `${nombre} (copia)`,
            estilo,
            contenido,
            variables,
            habilitada: true,
            orden: plantilla.orden + 1
        });

        setGuardando(false);

        if (error) {
            setMensaje(`Error creando: ${error.message}`);
            return;
        }

        if (data) {
            onGuardadaComoNueva(data as PlantillaMensaje);
        }

        setMensaje("Creada como nueva plantilla.");

    }

    const variablesDisponibles = tipo.variables;

    const previa = contenido
        ? aplicarPlantillaPreview(contenido, tipo.ejemplo, variables as Record<string, boolean>)
        : "(Escribe un contenido para ver la vista previa.)";

    return (

        <div className="editor-mensaje">

            <div className="editor-header">

                <div className="editor-campo editor-nombre">
                    <label>Nombre</label>
                    <input
                        type="text"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                </div>

                <div className="editor-campo editor-estilo">
                    <label>Estilo (etiqueta)</label>
                    <input
                        type="text"
                        value={estilo}
                        onChange={(e) => setEstilo(e.target.value)}
                    />
                </div>

            </div>

            <div className="editor-campo">

                <label>Contenido</label>

                <textarea
                    rows={4}
                    value={contenido}
                    onChange={(e) => setContenido(e.target.value)}
                    placeholder="Ej: ¡Hola {{cliente}}! Tus números para {{evento}}: {{numeros_reservados}} 🎉"
                />

                <p className="editor-nota">
                    Variables disponibles para este tipo:{" "}
                    {variablesDisponibles.map((v) => `{{${v.variable}}}`).join(", ")}.
                    Se sustituyen por datos reales sin usar IA — ninguna variable
                    fuera de esta lista tendrá dato real aquí.
                </p>

            </div>

            <div className="editor-campo">

                <label>Datos a mostrar</label>

                <div className="editor-checks">

                    {variablesDisponibles.map((v) => (

                        v.mostrarCampo ? (

                            <label key={v.variable} className="editor-check">
                                <input
                                    type="checkbox"
                                    checked={!!(variables as any)[v.mostrarCampo]}
                                    onChange={(e) => actualizarMostrar(v.mostrarCampo, e.target.checked)}
                                />
                                {v.etiqueta}
                            </label>

                        ) : null

                    ))}

                </div>

            </div>

            <label className="editor-check">
                <input
                    type="checkbox"
                    checked={variables.emojis !== false}
                    onChange={(e) => actualizarMostrar("emojis", e.target.checked)}
                />
                Emojis activados
            </label>

            <div className="editor-preview">

                <p className="editor-preview-titulo">
                    Vista previa (datos de ejemplo, no reales)
                </p>

                <div className="editor-preview-burbuja">
                    {previa}
                </div>

            </div>

            <div className="editor-acciones">

                <button
                    className="editor-guardar"
                    disabled={guardando}
                    onClick={guardar}
                >
                    {guardando ? "Guardando..." : "Guardar"}
                </button>

                <button
                    className="editor-guardar-nueva"
                    disabled={guardando}
                    onClick={guardarComoNueva}
                >
                    Guardar como nueva
                </button>

                {mensaje && <span className="editor-mensaje-estado">{mensaje}</span>}

            </div>

        </div>

    );

}
