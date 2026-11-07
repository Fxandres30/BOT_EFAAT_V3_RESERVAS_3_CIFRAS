"use client";

import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";

import {
    ElementoBiblioteca,
    crearElemento,
    actualizarElemento
} from "@/services/mensajes/bibliotecaAutomatizacionDatos";
import {
    TIPOS_BIBLIOTECA,
    origenDeTipo,
    tiposEditables,
    variablesDeTipo
} from "@/services/mensajes/bibliotecaAutomatizacion";
import { validarTextoMensaje, vistaPreviaMensaje } from "@/services/automatizacion/centroAutomatizaciones";
import { aplicarPlantillaPreview } from "@/services/mensajes/aplicarPlantillaPreview";
import { obtenerTipoMensaje } from "@/services/mensajes/tiposMensaje";
import { valoresPorDefectoVariables } from "@/services/mensajes/plantillas";

import VistaPreviaWhatsApp, { CasoVistaPrevia } from "../VistaPreviaWhatsApp/VistaPreviaWhatsApp";
import styles from "./MensajeModal.module.css";

interface Props {
    usuarioId: string;
    mensaje: ElementoBiblioteca | null; // null = creando uno nuevo
    tipoInicial?: string | null;        // tipo propuesto al crear (el del filtro)
    onClose: () => void;
    onGuardado: (m: ElementoBiblioteca) => void;
}

// Vista previa según el motor que enviará el texto:
//   automatización → mismas variables {x} que automation/variableResolver.js;
//   Inicio del día → catálogo global {{x}}; a esa hora normalmente todavía no
//   hay sorteo, así que se muestran los dos casos (con y sin sorteo).
function casosVistaPrevia(tipo: string, texto: string): CasoVistaPrevia[] {
    if (origenDeTipo(tipo) !== "inicio_dia") {
        return [{ id: "ejemplo", etiqueta: "Ejemplo", texto: vistaPreviaMensaje(texto) }];
    }
    const ejemplo = obtenerTipoMensaje("inicio_dia")?.ejemplo || {};
    const mostrar = valoresPorDefectoVariables() as Record<string, boolean>;
    return [
        { id: "sin_sorteo", etiqueta: "Sin sorteo todavía (lo habitual)", texto: aplicarPlantillaPreview(texto, {}, mostrar) },
        { id: "con_sorteo", etiqueta: "Con sorteo de ejemplo", texto: aplicarPlantillaPreview(texto, ejemplo, mostrar) }
    ];
}

// Editor de un mensaje de automatización (los cinco tipos, Inicio del día
// incluido) con la MISMA experiencia que «Respuestas a clientes»: formulario
// a la izquierda y vista previa de WhatsApp a la derecha. Las variables se
// insertan en la posición del cursor. Sin categorías: el tipo decide.
export default function MensajeModal({ usuarioId, mensaje, tipoInicial, onClose, onGuardado }: Props) {

    const [nombre, setNombre] = useState(mensaje?.nombre || "");
    const [texto, setTexto] = useState(mensaje?.texto || "");
    const [tipo, setTipo] = useState(mensaje?.tipo || (TIPOS_BIBLIOTECA.some((t) => t.id === tipoInicial) ? tipoInicial as string : TIPOS_BIBLIOTECA[1].id));
    const [activo, setActivo] = useState(mensaje?.activo ?? true);

    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const areaRef = useRef<HTMLTextAreaElement | null>(null);

    const esGlobalAjeno = !!mensaje && mensaje.usuario_id !== usuarioId;
    const esInicioDia = origenDeTipo(tipo) === "inicio_dia";
    const avisoTexto = texto.trim() && !esInicioDia ? validarTextoMensaje(texto) : null;
    const tipos = tiposEditables(mensaje?.tipo ?? null);
    const variables = variablesDeTipo(tipo);

    function insertarVariable(variable: string) {

        const area = areaRef.current;
        const inicio = area?.selectionStart ?? texto.length;
        const fin = area?.selectionEnd ?? texto.length;
        const nuevo = texto.slice(0, inicio) + variable + texto.slice(fin);

        setTexto(nuevo);

        requestAnimationFrame(() => {
            if (!area) return;
            area.focus();
            const pos = inicio + variable.length;
            area.setSelectionRange(pos, pos);
        });

    }

    async function guardar() {

        if (!nombre.trim() || !texto.trim()) {
            setError("El nombre y el texto del mensaje son obligatorios.");
            return;
        }

        setGuardando(true);
        setError(null);

        const datos = { nombre: nombre.trim(), texto: texto.trim(), tipo, activo };

        const { data, error: errorGuardar } = mensaje && !esGlobalAjeno
            ? await actualizarElemento(mensaje, datos)
            : await crearElemento(usuarioId, datos);

        setGuardando(false);

        if (errorGuardar || !data) {
            setError("No se pudo guardar el mensaje. Inténtalo de nuevo.");
            return;
        }

        onGuardado(data);

    }

    const titulo = mensaje ? (esGlobalAjeno ? "Mensaje de EFAAT" : "Editar mensaje") : "Nuevo mensaje";

    return (

        <Modal
            open
            onClose={onClose}
            bloquearCierre={guardando}
            title={titulo}
            description="Mensaje que EFAAT envía solo en tus grupos. Cuándo se envía se decide en Automatización."
            size="lg"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>
                        {esGlobalAjeno ? "Cerrar" : "Cancelar"}
                    </Button>
                    {!esGlobalAjeno && (
                        <Button onClick={guardar} loading={guardando}>Guardar</Button>
                    )}
                </>
            }
        >
            <div className={styles.layout}>

                <div className={styles.form}>

                    {esGlobalAjeno && (
                        <p className={styles.aviso}>
                            Este mensaje es de EFAAT y no se puede editar. Usa «Duplicar como propio» en su tarjeta para
                            crear una copia tuya y modificarla.
                        </p>
                    )}

                    <div className={styles.row}>

                        <Input
                            label="Nombre del mensaje"
                            value={nombre}
                            disabled={esGlobalAjeno}
                            onChange={(e) => setNombre(e.target.value)}
                            placeholder={esInicioDia ? "Ej.: Buenos días con energía" : "Ej.: Apertura con premio"}
                        />

                        <Select
                            label="Tipo de envío"
                            value={tipo}
                            disabled={esGlobalAjeno || tipos.length < 2}
                            onChange={(e) => setTipo(e.target.value)}
                        >
                            {tipos.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </Select>

                    </div>

                    <Textarea
                        ref={areaRef}
                        label="Texto"
                        rows={6}
                        value={texto}
                        disabled={esGlobalAjeno}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder={esInicioDia ? "☀️ ¡Buenos días, familia! En unos minutos comenzamos." : "¡Ya arrancamos {nombre_evento}!"}
                    />

                    {!esGlobalAjeno && (
                        <div className={styles.variables}>
                            <span>Insertar dato del sorteo:</span>
                            {variables.map((v) => (
                                <button key={v.variable} type="button" className={styles.variable} title={v.variable} onClick={() => insertarVariable(v.variable)}>
                                    {v.descripcion}
                                </button>
                            ))}
                        </div>
                    )}

                    {esInicioDia && !esGlobalAjeno && (
                        <p className={styles.aviso}>
                            El Inicio del día se envía antes de que empiece el sorteo: normalmente sus datos todavía no existen y
                            esas variables quedan vacías. Revisa el caso «Sin sorteo todavía» en la vista previa.
                        </p>
                    )}

                    {avisoTexto && (
                        <p className={styles.error}><AlertTriangle size={13} /> {avisoTexto}</p>
                    )}

                    <label className={styles.switch}>
                        <input
                            type="checkbox"
                            checked={activo}
                            disabled={esGlobalAjeno}
                            onChange={(e) => setActivo(e.target.checked)}
                        />
                        Usar este mensaje en los envíos automáticos
                    </label>

                    {error && (
                        <p className={styles.error}>
                            <AlertTriangle size={13} /> {error}
                        </p>
                    )}

                </div>

                <div className={styles.vista}>
                    <VistaPreviaWhatsApp
                        key={esInicioDia ? "inicio_dia" : "automatizacion"}
                        casos={casosVistaPrevia(tipo, texto)}
                        vacio={!texto.trim()}
                    />
                </div>

            </div>
        </Modal>

    );

}
