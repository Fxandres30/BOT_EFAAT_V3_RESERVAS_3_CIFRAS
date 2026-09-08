"use client";

import { useEffect, useState } from "react";
import { Save, FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    actualizarPlantilla,
    crearPlantilla,
    valoresPorDefectoVariables
} from "@/services/mensajes/plantillas";
import { aplicarPlantillaPreview } from "@/services/mensajes/aplicarPlantillaPreview";

import styles from "./EditorMensaje.module.css";

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

    // Vista previa — SOLO visual. Cuando el tipo puede producir tanto 1
    // como 2+ números reales (tipo.ejemploSingular/ejemploPlural), se
    // muestran ambos casos con datos de ejemplo YA escritos en
    // tiposMensaje.ts (dos diccionarios fijos, ninguna decisión en tiempo
    // de ejecución) — así un admin ve que "tu número"/"reservado" no se
    // rompen con 1, y "tus números"/"reservados" tampoco con varios, sin
    // que este componente calcule ni decida ninguna forma gramatical.
    const tieneEjemploDual = !!(tipo.ejemploSingular && tipo.ejemploPlural);

    const previa = contenido
        ? aplicarPlantillaPreview(contenido, tipo.ejemplo, variables as Record<string, boolean>)
        : "(Escribe un contenido para ver la vista previa.)";

    const previaSingular = contenido && tipo.ejemploSingular
        ? aplicarPlantillaPreview(contenido, tipo.ejemploSingular, variables as Record<string, boolean>)
        : "(Escribe un contenido para ver la vista previa.)";

    const previaPlural = contenido && tipo.ejemploPlural
        ? aplicarPlantillaPreview(contenido, tipo.ejemploPlural, variables as Record<string, boolean>)
        : "(Escribe un contenido para ver la vista previa.)";

    return (

        <div className={styles.editor}>

            <div className={styles.grid2}>
                <Input
                    label="Nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                />
                <Input
                    label="Estilo (etiqueta)"
                    value={estilo}
                    onChange={(e) => setEstilo(e.target.value)}
                />
            </div>

            <Textarea
                label="Contenido"
                rows={4}
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                placeholder="Ej: ¡Hola {{cliente}}! Tus números para {{evento}}: {{numeros_reservados}} 🎉"
            />

            <div className={styles.field}>
                <span className={styles.label}>Variables de este tipo</span>
                <div className={styles.vars}>
                    {variablesDisponibles.map((v) => (
                        <span key={v.variable} className={styles.varChip}>{`{{${v.variable}}}`}</span>
                    ))}
                </div>
                <p className={styles.note}>
                    Se sustituyen por datos reales sin usar IA. El backend admite además variables
                    de concordancia gramatical (singular/plural) de uso general; consulta gramatica.js
                    si necesitas una que no aparezca aquí.
                </p>
            </div>

            <div className={styles.field}>
                <span className={styles.label}>Datos a mostrar</span>
                <div className={styles.checks}>
                    {variablesDisponibles.map((v) => (
                        v.mostrarCampo ? (
                            <label key={v.variable} className={styles.check}>
                                <input
                                    type="checkbox"
                                    checked={!!(variables as Record<string, boolean>)[v.mostrarCampo]}
                                    onChange={(e) => actualizarMostrar(v.mostrarCampo, e.target.checked)}
                                />
                                {v.etiqueta}
                            </label>
                        ) : null
                    ))}
                </div>
            </div>

            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={variables.emojis !== false}
                    onChange={(e) => actualizarMostrar("emojis", e.target.checked)}
                />
                Emojis activados
            </label>

            {tieneEjemploDual ? (

                <div className={styles.preview}>
                    <span className={styles.previewLabel}>Vista previa · 1 número (ejemplo)</span>
                    <div className={styles.bubble}>{previaSingular}</div>

                    <span className={`${styles.previewLabel} ${styles.previewLabelPlural}`}>
                        Vista previa · varios números (ejemplo)
                    </span>
                    <div className={styles.bubble}>{previaPlural}</div>
                </div>

            ) : (

                <div className={styles.preview}>
                    <span className={styles.previewLabel}>Vista previa (datos de ejemplo)</span>
                    <div className={styles.bubble}>{previa}</div>
                </div>

            )}

            <div className={styles.actions}>
                <Button
                    onClick={guardar}
                    loading={guardando}
                    leftIcon={<Save size={14} />}
                >
                    Guardar
                </Button>

                <Button
                    variant="secondary"
                    onClick={guardarComoNueva}
                    disabled={guardando}
                    leftIcon={<FilePlus2 size={14} />}
                >
                    Guardar como nueva
                </Button>

                {mensaje && <span className={styles.status}>{mensaje}</span>}
            </div>

        </div>

    );

}
