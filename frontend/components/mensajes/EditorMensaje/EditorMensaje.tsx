"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Save, FilePlus2, AlertTriangle } from "lucide-react";

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
import { CATALOGO_VARIABLES, extraerVariablesDesconocidas } from "@/services/mensajes/catalogoVariablesGlobal";
import VariableAutocomplete, { ItemAutocomplete } from "@/components/mensajes/VariableAutocomplete/VariableAutocomplete";
import { calcularPosicionCaret } from "./calcularPosicionCaret";

import styles from "./EditorMensaje.module.css";

// Deriva qué contexto puede razonablemente ofrecer el tipo de mensaje que
// se está editando — solo para el indicador 🟢/⚪ del selector (sección
// 11/R de la auditoría). El catálogo global sigue mostrando TODAS las
// variables sin importar el tipo; esto únicamente decide cuáles ya
// resolverían con datos reales para este tipo en particular.
function construirContextoDisponible(tipo: TipoMensaje): Record<string, boolean> {

    if (tipo.categoria === "Reservas") {
        return { usuario: true, evento: true, reserva: true, consulta: false, estado_pago: false };
    }

    if (tipo.categoria === "Consultas") {
        const esPago = tipo.id === "consulta_pago" || tipo.id === "multiple";
        return { usuario: true, evento: true, reserva: false, consulta: true, estado_pago: esPago };
    }

    return { usuario: false, evento: false, reserva: false, consulta: false, estado_pago: false };

}

// Encuentra, si el cursor está justo después de una racha de "{" (una o
// más, seguidas de cero o más caracteres de palabra), dónde empieza esa
// racha y qué se escribió después — eso es el filtro incremental del
// selector. Reemplazar SIEMPRE desde ese inicio evita dejar "{{{{" o
// llaves sobrantes sin importar cuántas "{" haya tecleado el admin.
function detectarDisparador(texto: string, cursor: number): { inicio: number; filtro: string } | null {

    const antes = texto.slice(0, cursor);
    const coincidencia = /\{+(\w*)$/.exec(antes);

    if (!coincidencia) {
        return null;
    }

    return { inicio: coincidencia.index, filtro: coincidencia[1] };

}

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

    // ---- Autocomplete global de variables ("{" -> catálogo completo) ----
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [autocompleteAbierto, setAutocompleteAbierto] = useState(false);
    const [filtroAutocomplete, setFiltroAutocomplete] = useState("");
    const [posicionApertura, setPosicionApertura] = useState<number | null>(null);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [posicionPopover, setPosicionPopover] = useState({ top: 0, left: 0 });

    const contextoDisponible = useMemo(() => construirContextoDisponible(tipo), [tipo]);

    const itemsAutocomplete: ItemAutocomplete[] = useMemo(() => {

        const filtro = filtroAutocomplete.toLowerCase();

        const coincide = (v: (typeof CATALOGO_VARIABLES)[number]) =>
            !filtro ||
            v.key.toLowerCase().includes(filtro) ||
            v.aliases.some((a) => a.toLowerCase().includes(filtro)) ||
            v.description.toLowerCase().includes(filtro) ||
            v.categoria.toLowerCase().includes(filtro);

        const filtrados = CATALOGO_VARIABLES.filter(coincide).map((definicion) => ({
            definicion,
            disponible: definicion.requires.every((r) => contextoDisponible[r] !== false)
        }));

        // 🟢 disponibles primero, ⚪ requieren contexto después — nunca se
        // eliminan estas últimas del listado (sección 12).
        return [...filtrados.filter((i) => i.disponible), ...filtrados.filter((i) => !i.disponible)];

    }, [filtroAutocomplete, contextoDisponible]);

    // Cero coincidencias -> el selector se comporta como cerrado (nunca se
    // ofrece un popover vacío). Se deriva del render en vez de sincronizar
    // con un efecto: si el admin sigue escribiendo y vuelve a haber
    // coincidencias, reaparece solo, sin estado adicional que mantener.
    const mostrarAutocomplete = autocompleteAbierto && itemsAutocomplete.length > 0;

    useEffect(() => {

        setNombre(plantilla.nombre);
        setEstilo(plantilla.estilo);
        setContenido(plantilla.contenido);
        setVariables(plantilla.variables || valoresPorDefectoVariables());
        setMensaje(null);
        setAutocompleteAbierto(false);

    }, [plantilla.id]);

    function actualizarMostrar(campo: string, valor: boolean) {
        setVariables((prev) => ({ ...prev, [campo]: valor }));
    }

    function manejarCambioContenido(nuevoValor: string, cursor: number) {

        setContenido(nuevoValor);

        const disparador = detectarDisparador(nuevoValor, cursor);

        if (!disparador) {
            setAutocompleteAbierto(false);
            return;
        }

        setPosicionApertura(disparador.inicio);
        setFiltroAutocomplete(disparador.filtro);
        setHighlightIndex(0);
        setAutocompleteAbierto(true);

        const textarea = textareaRef.current;

        if (textarea) {
            setPosicionPopover(calcularPosicionCaret(textarea, cursor));
        }

    }

    // Reemplaza SIEMPRE desde el inicio de la racha de "{" hasta el cursor
    // actual por la variable completa {{clave}} — nunca "agrega" texto, así
    // es estructuralmente imposible dejar "{{{{clave}}}}" o llaves sueltas
    // sin importar qué había escrito el admin (sección J de la auditoría).
    function insertarVariable(item: ItemAutocomplete) {

        const textarea = textareaRef.current;

        if (!textarea || posicionApertura === null) {
            return;
        }

        const cursorActual = textarea.selectionStart;
        const inserto = `{{${item.definicion.key}}}`;
        const nuevoContenido = contenido.slice(0, posicionApertura) + inserto + contenido.slice(cursorActual);
        const nuevaPosicionCursor = posicionApertura + inserto.length;

        setContenido(nuevoContenido);
        setAutocompleteAbierto(false);

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(nuevaPosicionCursor, nuevaPosicionCursor);
        });

    }

    function manejarTeclaTextarea(e: React.KeyboardEvent<HTMLTextAreaElement>) {

        if (!autocompleteAbierto || itemsAutocomplete.length === 0) {
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIndex((i) => (i + 1) % itemsAutocomplete.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIndex((i) => (i - 1 + itemsAutocomplete.length) % itemsAutocomplete.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            insertarVariable(itemsAutocomplete[highlightIndex]);
        } else if (e.key === "Escape") {
            e.preventDefault();
            setAutocompleteAbierto(false);
        }

    }

    const variablesDesconocidas = useMemo(() => extraerVariablesDesconocidas(contenido), [contenido]);

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

            <div className={styles.editorTextoWrapper}>

                <Textarea
                    ref={textareaRef}
                    label="Contenido"
                    rows={4}
                    value={contenido}
                    onChange={(e) => manejarCambioContenido(e.target.value, e.target.selectionStart)}
                    onKeyDown={manejarTeclaTextarea}
                    onBlur={() => setAutocompleteAbierto(false)}
                    placeholder="Ej: ¡Hola {{cliente}}! Tus números para {{evento}}: {{numeros_reservados}} 🎉 — escribe { para ver todas las variables"
                />

                {mostrarAutocomplete && (
                    <VariableAutocomplete
                        items={itemsAutocomplete}
                        highlightIndex={highlightIndex}
                        top={posicionPopover.top}
                        left={posicionPopover.left}
                        onSelect={insertarVariable}
                        onHover={setHighlightIndex}
                    />
                )}

            </div>

            {variablesDesconocidas.length > 0 && (
                <p className={styles.advertencia}>
                    <AlertTriangle size={13} />
                    Variable no reconocida: {variablesDesconocidas.map((v) => `{{${v}}}`).join(", ")}
                </p>
            )}

            <div className={styles.field}>
                <span className={styles.label}>Variables de este tipo</span>
                <div className={styles.vars}>
                    {variablesDisponibles.map((v) => (
                        <span key={v.variable} className={styles.varChip}>{`{{${v.variable}}}`}</span>
                    ))}
                </div>
                <p className={styles.note}>
                    Se sustituyen por datos reales sin usar IA. Escribe <code>{"{"}</code> en el
                    contenido para ver el catálogo completo de variables globales (incluye
                    concordancia gramatical singular/plural y variables de otros tipos que
                    también pueden aplicar aquí).
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
