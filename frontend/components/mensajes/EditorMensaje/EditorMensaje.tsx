"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Save, FilePlus2, AlertTriangle, Bold, Italic, Strikethrough, Smile, ChevronDown, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    actualizarPlantilla,
    crearPlantilla
} from "@/services/mensajes/plantillas";
import { aplicarPlantillaPreview, datoVisible } from "@/services/mensajes/aplicarPlantillaPreview";
import { listarCatalogo, extraerVariablesDesconocidas, normalizarVariableDinamica, VariableGlobal } from "@/services/mensajes/catalogoVariablesGlobal";
import {
    construirBiblioteca,
    construirContextoDisponible,
    envolverSeleccion,
    insertarEnTexto,
    variablesUsadas
} from "@/services/mensajes/bibliotecaVariables";
import { listarVariablesActivas } from "@/services/variables/variablesGlobales";
import VariableAutocomplete, { ItemAutocomplete } from "@/components/mensajes/VariableAutocomplete/VariableAutocomplete";
import BibliotecaVariables from "@/components/mensajes/BibliotecaVariables/BibliotecaVariables";
import VistaPreviaWhatsApp, { CasoVistaPrevia } from "@/components/mensajes/VistaPreviaWhatsApp/VistaPreviaWhatsApp";
import { calcularPosicionCaret } from "./calcularPosicionCaret";

import styles from "./EditorMensaje.module.css";

const EMOJIS_RAPIDOS = ["😊", "👋", "🎉", "✅", "🍀", "🎟️", "💰", "📅", "⏰", "🔥", "🙏", "📌"];

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

// Compara el JSON «variables» sin depender del orden de las claves (jsonb
// las reordena al guardar).
function mismasVariables(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {

    const ea = Object.entries(a || {}).sort(([x], [y]) => x.localeCompare(y));
    const eb = Object.entries(b || {}).sort(([x], [y]) => x.localeCompare(y));

    return JSON.stringify(ea) === JSON.stringify(eb);

}

interface Props {
    tipo: TipoMensaje;
    usuarioId: string;
    plantilla: PlantillaMensaje;
    onGuardada: (p: PlantillaMensaje) => void;
    onGuardadaComoNueva: (p: PlantillaMensaje) => void;
    // Avisa a la página si hay cambios sin guardar, para no perderlos al
    // cambiar de plantilla o de tipo sin confirmación.
    onCambiosPendientes?: (hay: boolean) => void;
}

// Editor reutilizable: la misma UI sirve para cualquier plantilla de
// cualquier tipo — nunca se crea un formulario distinto por plantilla.
export default function EditorMensaje({ tipo, usuarioId, plantilla, onGuardada, onGuardadaComoNueva, onCambiosPendientes }: Props) {

    const [nombre, setNombre] = useState(plantilla.nombre);
    const [estilo, setEstilo] = useState(plantilla.estilo);
    const [contenido, setContenido] = useState(plantilla.contenido);
    // Lo guardado tal cual. Sin configuración el bot muestra todo, y el
    // editor también: guardar sin tocar las casillas no cambia el mensaje.
    const [variables, setVariables] = useState(plantilla.variables || {});

    const [guardando, setGuardando] = useState(false);
    const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);
    const [emojisAbierto, setEmojisAbierto] = useState(false);
    const [avanzadasAbiertas, setAvanzadasAbiertas] = useState(false);

    // ---- Autocomplete global de variables ("{" -> catálogo completo) ----
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [autocompleteAbierto, setAutocompleteAbierto] = useState(false);
    const [filtroAutocomplete, setFiltroAutocomplete] = useState("");
    const [posicionApertura, setPosicionApertura] = useState<number | null>(null);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [posicionPopover, setPosicionPopover] = useState({ top: 0, left: 0 });

    // ---- Catálogo GLOBAL unificado (estático + variables_globales) ----
    // Se carga una vez por usuario; una variable creada/editada/eliminada
    // desde el panel "Variables globales" aparece aquí en el próximo
    // montaje de este editor (no hace falta recargar toda la página).
    const [variablesDinamicas, setVariablesDinamicas] = useState<VariableGlobal[]>([]);

    useEffect(() => {

        let cancelado = false;

        async function cargar() {

            const { data, error } = await listarVariablesActivas(usuarioId);

            if (!cancelado && !error && data) {
                setVariablesDinamicas(data.map(normalizarVariableDinamica));
            }

        }

        cargar();

        return () => { cancelado = true; };

    }, [usuarioId]);

    const catalogoUnificado = useMemo(() => listarCatalogo(variablesDinamicas), [variablesDinamicas]);

    const contextoDisponible = useMemo(() => construirContextoDisponible(tipo), [tipo]);

    const biblioteca = useMemo(() => construirBiblioteca(tipo, variablesDinamicas), [tipo, variablesDinamicas]);

    const itemsAutocomplete: ItemAutocomplete[] = useMemo(() => {

        const filtro = filtroAutocomplete.toLowerCase();

        const coincide = (v: (typeof catalogoUnificado)[number]) =>
            !filtro ||
            v.key.toLowerCase().includes(filtro) ||
            v.aliases.some((a) => a.toLowerCase().includes(filtro)) ||
            v.description.toLowerCase().includes(filtro) ||
            v.categoria.toLowerCase().includes(filtro);

        const filtrados = catalogoUnificado.filter(coincide).map((definicion) => ({
            definicion,
            // Una variable global sin requires[] (todas las dinámicas de
            // esta fase) siempre se muestra disponible — nunca se bloquea
            // artificialmente por el tipo de plantilla actual.
            disponible: definicion.requires.every((r) => contextoDisponible[r] !== false)
        }));

        // 🟢 disponibles primero, ⚪ requieren contexto después — nunca se
        // eliminan estas últimas del listado (sección 12).
        return [...filtrados.filter((i) => i.disponible), ...filtrados.filter((i) => !i.disponible)];

    }, [filtroAutocomplete, contextoDisponible, catalogoUnificado]);

    // Cero coincidencias -> el selector se comporta como cerrado (nunca se
    // ofrece un popover vacío).
    const mostrarAutocomplete = autocompleteAbierto && itemsAutocomplete.length > 0;

    // MensajesPage monta este editor con key={plantilla.id}: cada plantilla
    // abre un editor nuevo, así que el estado local nunca arrastra datos de
    // otra plantilla. Plantilla recién creada (vacía): foco en el mensaje.
    const contenidoInicialVacio = useRef(!plantilla.contenido);

    useEffect(() => {
        if (contenidoInicialVacio.current) textareaRef.current?.focus();
    }, []);

    const hayCambios =
        nombre !== plantilla.nombre ||
        estilo !== plantilla.estilo ||
        contenido !== plantilla.contenido ||
        !mismasVariables(variables as Record<string, unknown>, plantilla.variables as Record<string, unknown>);

    useEffect(() => {
        onCambiosPendientes?.(hayCambios);
    }, [hayCambios, onCambiosPendientes]);

    // Al desmontar (cambio de plantilla/tipo ya confirmado) no quedan
    // cambios pendientes de este editor.
    useEffect(() => () => onCambiosPendientes?.(false), [onCambiosPendientes]);

    function actualizarMostrar(campo: string, valor: boolean) {
        setVariables((prev) => ({ ...prev, [campo]: valor }));
    }

    function moverCursor(inicio: number, fin = inicio) {

        const textarea = textareaRef.current;

        requestAnimationFrame(() => {
            textarea?.focus();
            textarea?.setSelectionRange(inicio, fin);
        });

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
    // es estructuralmente imposible dejar "{{{{clave}}}}" o llaves sueltas.
    function insertarVariable(item: ItemAutocomplete) {

        const textarea = textareaRef.current;

        if (!textarea || posicionApertura === null) {
            return;
        }

        const cursorActual = textarea.selectionStart;
        const inserto = `{{${item.definicion.key}}}`;
        const nuevoContenido = contenido.slice(0, posicionApertura) + inserto + contenido.slice(cursorActual);

        setContenido(nuevoContenido);
        setAutocompleteAbierto(false);
        moverCursor(posicionApertura + inserto.length);

    }

    // Inserción desde un botón: en la posición del cursor (o reemplazando
    // la selección); al final si el campo todavía no tuvo foco.
    function insertarEnCursor(inserto: string, separarDePalabra: boolean) {

        const textarea = textareaRef.current;
        const inicio = textarea ? textarea.selectionStart : contenido.length;
        const fin = textarea ? textarea.selectionEnd : contenido.length;

        const resultado = insertarEnTexto(contenido, inicio, fin, inserto, separarDePalabra);

        setContenido(resultado.texto);
        setAutocompleteAbierto(false);
        moverCursor(resultado.cursor);

    }

    function insertarClave(clave: string) {
        insertarEnCursor(`{{${clave}}}`, true);
    }

    function aplicarFormato(marca: string) {

        const textarea = textareaRef.current;
        const inicio = textarea ? textarea.selectionStart : contenido.length;
        const fin = textarea ? textarea.selectionEnd : contenido.length;

        const resultado = envolverSeleccion(contenido, inicio, fin, marca);

        setContenido(resultado.texto);
        moverCursor(resultado.inicio, resultado.fin);

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

    const variablesDesconocidas = useMemo(
        () => extraerVariablesDesconocidas(contenido, variablesDinamicas),
        [contenido, variablesDinamicas]
    );

    const usadas = useMemo(
        () => variablesUsadas(contenido, variablesDinamicas, tipo).filter((v) => v.conocida),
        [contenido, variablesDinamicas, tipo]
    );

    async function guardar() {

        setGuardando(true);
        setMensaje(null);

        // Siempre por el id de ESTA plantilla: nunca toca otra.
        const { data, error } = await actualizarPlantilla(plantilla.id, {
            nombre,
            estilo,
            contenido,
            variables
        });

        setGuardando(false);

        if (error) {
            setMensaje({ texto: `No se pudo guardar: ${error.message}`, error: true });
            return;
        }

        if (data) {
            onGuardada(data as PlantillaMensaje);
        }

        setMensaje({ texto: "Cambios guardados.", error: false });

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
            setMensaje({ texto: `No se pudo crear: ${error.message}`, error: true });
            return;
        }

        if (data) {
            onGuardadaComoNueva(data as PlantillaMensaje);
        }

    }

    // ---- Vista previa: el MISMO motor (aplicarPlantillaPreview) que
    // replica al backend, con los datos de ejemplo de tiposMensaje.ts.
    // Cuando el tipo puede producir 1 o varios números se ofrecen ambos
    // casos (ejemploSingular / ejemploPlural).
    const casosVistaPrevia: CasoVistaPrevia[] = useMemo(() => {

        const aplicar = (ejemplo: Record<string, string>) =>
            aplicarPlantillaPreview(contenido, ejemplo, variables as Record<string, boolean>, variablesDinamicas);

        if (tipo.ejemploSingular && tipo.ejemploPlural) {
            return [
                { id: "uno", etiqueta: "Con 1 número", texto: aplicar(tipo.ejemploSingular) },
                { id: "varios", etiqueta: "Con varios números", texto: aplicar(tipo.ejemploPlural) }
            ];
        }

        return [{ id: "ejemplo", etiqueta: "Ejemplo", texto: aplicar(tipo.ejemplo) }];

    }, [contenido, variables, variablesDinamicas, tipo]);

    const datosConCasilla = tipo.variables.filter((v) => v.mostrarCampo);
    const datosOcultos = datosConCasilla.filter((v) => !datoVisible(variables as Record<string, boolean>, v.mostrarCampo)).length;
    const emojisDesactivados = variables.emojis === false;

    return (

        <div className={styles.editor}>
        <div className={styles.rejilla}>

            <div className={styles.areaNombre}>
                <Input
                    label="Nombre de la plantilla"
                    hint="Solo lo ves tú, para reconocerla en la lista."
                    value={nombre}
                    maxLength={120}
                    onChange={(e) => setNombre(e.target.value)}
                />
            </div>

            <div className={styles.areaTexto}>

                <div className={styles.cabeceraTexto}>
                    <span className={styles.tituloBloque}>Escribe tu mensaje</span>
                    <div className={styles.herramientas} role="toolbar" aria-label="Formato del mensaje">
                        <button type="button" className={styles.herramienta} title="Negrita (*texto*)" aria-label="Negrita" onMouseDown={(e) => e.preventDefault()} onClick={() => aplicarFormato("*")}>
                            <Bold size={14} />
                        </button>
                        <button type="button" className={styles.herramienta} title="Cursiva (_texto_)" aria-label="Cursiva" onMouseDown={(e) => e.preventDefault()} onClick={() => aplicarFormato("_")}>
                            <Italic size={14} />
                        </button>
                        <button type="button" className={styles.herramienta} title="Tachado (~texto~)" aria-label="Tachado" onMouseDown={(e) => e.preventDefault()} onClick={() => aplicarFormato("~")}>
                            <Strikethrough size={14} />
                        </button>
                        <div className={styles.emojisWrap}>
                            <button
                                type="button"
                                className={styles.herramienta}
                                title="Insertar emoji"
                                aria-label="Insertar emoji"
                                aria-expanded={emojisAbierto}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setEmojisAbierto((v) => !v)}
                            >
                                <Smile size={14} />
                            </button>
                            {emojisAbierto && (
                                <div className={styles.emojis} role="menu" aria-label="Emojis">
                                    {EMOJIS_RAPIDOS.map((emoji) => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            role="menuitem"
                                            className={styles.emoji}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => { insertarEnCursor(emoji, false); setEmojisAbierto(false); }}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.editorTextoWrapper}>

                    <Textarea
                        ref={textareaRef}
                        aria-label="Mensaje"
                        rows={7}
                        className={styles.textarea}
                        value={contenido}
                        onChange={(e) => manejarCambioContenido(e.target.value, e.target.selectionStart)}
                        onKeyDown={manejarTeclaTextarea}
                        onBlur={() => setAutocompleteAbierto(false)}
                        placeholder="Ej.: ¡Hola! 🎉 Quedaron reservados tus números. Usa los botones de abajo para agregar el nombre del cliente o sus números."
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

                {usadas.length > 0 && (
                    <p className={styles.usadas}>
                        <span className={styles.usadasTitulo}>Información automática en este mensaje:</span>{" "}
                        {usadas.map((v, i) => (
                            <span key={v.clave}>
                                <span className={styles.usada} title={`{{${v.clave}}}`}>{v.nombre}</span>
                                {i < usadas.length - 1 ? " " : ""}
                            </span>
                        ))}
                    </p>
                )}

                {variablesDesconocidas.length > 0 && (
                    <p className={styles.advertencia} role="alert">
                        <AlertTriangle size={13} />
                        <span>
                            EFAAT no reconoce {variablesDesconocidas.length === 1 ? "este código" : "estos códigos"}:{" "}
                            {variablesDesconocidas.map((v) => `{{${v}}}`).join(", ")}. Se enviará vacío. Usa los botones de información automática.
                        </span>
                    </p>
                )}

            </div>

            <div className={styles.areaPrevia}>
                <VistaPreviaWhatsApp
                    casos={casosVistaPrevia}
                    vacio={!contenido.trim()}
                    datosOcultos={datosOcultos}
                />
            </div>

            <div className={styles.areaVariables}>
                <BibliotecaVariables biblioteca={biblioteca} onInsertar={insertarClave} />
            </div>

            <div className={styles.areaAvanzadas}>

                <button
                    type="button"
                    className={styles.avanzadasToggle}
                    aria-expanded={avanzadasAbiertas}
                    aria-controls="opciones-avanzadas"
                    onClick={() => setAvanzadasAbiertas((v) => !v)}
                >
                    <Settings2 size={14} aria-hidden="true" />
                    Opciones avanzadas
                    {(datosOcultos > 0 || emojisDesactivados) && (
                        <span className={styles.avanzadasResumen}>
                            {[
                                datosOcultos > 0 ? `${datosOcultos} dato${datosOcultos === 1 ? "" : "s"} oculto${datosOcultos === 1 ? "" : "s"}` : "",
                                emojisDesactivados ? "emojis desactivados" : ""
                            ].filter(Boolean).join(" · ")}
                        </span>
                    )}
                    <ChevronDown size={14} className={avanzadasAbiertas ? styles.girado : ""} aria-hidden="true" />
                </button>

                {avanzadasAbiertas && (

                    <div id="opciones-avanzadas" className={styles.avanzadas}>

                        <Input
                            label="Etiqueta (estilo)"
                            hint="Clasificación interna de la plantilla. Las sugeridas y recomendadas se reconocen por esta etiqueta."
                            value={estilo}
                            onChange={(e) => setEstilo(e.target.value)}
                        />

                        {datosConCasilla.length > 0 && (
                            <div className={styles.field}>
                                <span className={styles.label}>Datos a mostrar</span>
                                <p className={styles.note}>Un dato desmarcado se envía vacío aunque esté en el mensaje.</p>
                                <div className={styles.checks}>
                                    {datosConCasilla.map((v) => (
                                        <label key={v.variable} className={styles.check}>
                                            <input
                                                type="checkbox"
                                                checked={datoVisible(variables as Record<string, boolean>, v.mostrarCampo)}
                                                onChange={(e) => actualizarMostrar(v.mostrarCampo, e.target.checked)}
                                            />
                                            {v.etiqueta}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <label className={styles.check}>
                            <input
                                type="checkbox"
                                checked={variables.emojis !== false}
                                onChange={(e) => actualizarMostrar("emojis", e.target.checked)}
                            />
                            Enviar los emojis escritos en el mensaje
                        </label>

                    </div>

                )}

            </div>

            <div className={styles.areaAcciones}>

                <Button
                    onClick={guardar}
                    loading={guardando}
                    disabled={!hayCambios && !guardando}
                    leftIcon={<Save size={14} />}
                >
                    Guardar cambios
                </Button>

                <Button
                    variant="secondary"
                    onClick={guardarComoNueva}
                    disabled={guardando}
                    leftIcon={<FilePlus2 size={14} />}
                    title="Crea otra plantilla con este contenido y deja esta sin cambios."
                >
                    Guardar como nueva
                </Button>

                {hayCambios && !guardando && <span className={styles.pendiente}>Cambios sin guardar</span>}
                {!hayCambios && mensaje && (
                    <span className={mensaje.error ? styles.statusError : styles.status} role="status">{mensaje.texto}</span>
                )}
                {hayCambios && mensaje?.error && (
                    <span className={styles.statusError} role="alert">{mensaje.texto}</span>
                )}

            </div>

        </div>
        </div>

    );

}
