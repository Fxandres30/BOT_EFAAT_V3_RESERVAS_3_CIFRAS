"use client";

import { useState } from "react";
import { Plus, Copy, Trash2, ListPlus, Star } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

import { TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    alternarHabilitada,
    duplicarPlantilla,
    eliminarPlantilla,
    crearPlantillaVacia,
    completarPlantillasSugeridas,
    dejarActivasSoloRecomendadas
} from "@/services/mensajes/plantillas";
import { PLANTILLAS_NUMEROS_PAGOS, esPlantillaSugerida, esRecomendada } from "@/services/mensajes/plantillasNumerosPagos";

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
    // Grupo "Números y pagos": lista separada en activas/inactivas y
    // acciones de "Organizar plantillas". onReorganizada recarga el tipo.
    agruparPorEstado?: boolean;
    modoFijo?: boolean;
    onReorganizada?: () => void;
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
    onCreada,
    agruparPorEstado = false,
    modoFijo = false,
    onReorganizada
}: Props) {

    const [procesando, setProcesando] = useState<string | null>(null);
    const [creando, setCreando] = useState(false);
    const [organizando, setOrganizando] = useState(false);
    const [avisoOrganizar, setAvisoOrganizar] = useState<string | null>(null);

    const habilitadasCount = plantillas.filter((p) => p.habilitada).length;

    const sugeridasTotales = (PLANTILLAS_NUMEROS_PAGOS[tipo.id] || []).length;
    const sugeridasPresentes = new Set(plantillas.filter((p) => esPlantillaSugerida(p.estilo)).map((p) => p.estilo)).size;
    const faltanSugeridas = sugeridasTotales - sugeridasPresentes;

    async function completarSugeridas() {

        setOrganizando(true);
        setAvisoOrganizar(null);

        const { creadas, error } = await completarPlantillasSugeridas(usuarioId, tipo.id, plantillas);

        setOrganizando(false);

        if (error) {
            setAvisoOrganizar(`No se pudo completar: ${error.message}`);
            return;
        }

        setAvisoOrganizar(`${creadas} plantilla${creadas === 1 ? "" : "s"} sugerida${creadas === 1 ? "" : "s"} agregada${creadas === 1 ? "" : "s"} (inactiva${creadas === 1 ? "" : "s"}).`);
        onReorganizada?.();

    }

    async function activarSoloRecomendadas() {

        const otras = plantillas.filter((p) => !esRecomendada(p.estilo) && p.habilitada).length;

        const texto = [
            "¿Dejar activas solo las 2 plantillas recomendadas (★)?",
            `${otras} plantilla${otras === 1 ? "" : "s"} activa${otras === 1 ? "" : "s"} pasará${otras === 1 ? "" : "n"} a inactiva${otras === 1 ? "" : "s"}. No se borra ni se cambia el texto de ninguna.`,
            modoFijo ? "El modo de respuesta está en «Fija»: después elige una de las activas en «Plantilla seleccionada»." : ""
        ].filter(Boolean).join("\n\n");

        if (!confirm(texto)) return;

        setOrganizando(true);
        setAvisoOrganizar(null);

        const { error } = await dejarActivasSoloRecomendadas(plantillas);

        setOrganizando(false);

        if (error) {
            setAvisoOrganizar(`No se pudo aplicar: ${error.message}`);
            return;
        }

        setAvisoOrganizar("Listo: solo las 2 recomendadas quedaron activas.");
        onReorganizada?.();

    }

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

    function renderItem(p: PlantillaMensaje) {

        return (

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
                    title={p.habilitada ? "Activa — clic para desactivar" : "Inactiva — clic para activar"}
                    aria-label={`${p.habilitada ? "Desactivar" : "Activar"} plantilla ${p.nombre}`}
                />

                <div className={styles.info}>
                    <span className={styles.nameRow}>
                        <span className={styles.name}>{p.nombre}</span>
                        {agruparPorEstado && esRecomendada(p.estilo) && (
                            <span className={styles.badgeRecomendada}>
                                <Star size={10} aria-hidden="true" /> Recomendada
                            </span>
                        )}
                        {agruparPorEstado && (
                            <span className={p.habilitada ? styles.badgeActiva : styles.badgeInactiva}>
                                {p.habilitada ? "Activa" : "Inactiva"}
                            </span>
                        )}
                    </span>
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

        );

    }

    const activas = plantillas.filter((p) => p.habilitada);
    const inactivas = plantillas.filter((p) => !p.habilitada);

    return (

        <div className={styles.list}>

            <div className={styles.header}>
                <span>{plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}</span>
                <span className={styles.enabled}>
                    {habilitadasCount} activa{habilitadasCount === 1 ? "" : "s"}
                </span>
            </div>

            {agruparPorEstado && sugeridasTotales > 0 && (

                <div className={styles.organizar}>
                    <p className={styles.organizarTexto}>
                        Sugeridas: {sugeridasPresentes} de {sugeridasTotales}.
                        El bot solo usa las plantillas <strong>activas</strong>.
                    </p>
                    <div className={styles.organizarAcciones}>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={organizando}
                            disabled={faltanSugeridas === 0}
                            leftIcon={<ListPlus size={14} />}
                            onClick={completarSugeridas}
                            title="Agrega las sugeridas que falten, inactivas. No cambia ni borra ninguna existente."
                        >
                            {faltanSugeridas > 0 ? `Completar sugeridas (${faltanSugeridas})` : "Sugeridas completas"}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={organizando || sugeridasPresentes === 0}
                            leftIcon={<Star size={14} />}
                            onClick={activarSoloRecomendadas}
                            title="Deja activas solo las 2 recomendadas; las demás quedan guardadas e inactivas."
                        >
                            Activar solo las 2 recomendadas
                        </Button>
                    </div>
                    {avisoOrganizar && <p className={styles.organizarAviso} role="status">{avisoOrganizar}</p>}
                </div>

            )}

            {agruparPorEstado ? (

                <div className={styles.items}>

                    <p className={styles.seccion}>Activas · {activas.length}</p>
                    {activas.length === 0 && (
                        <p className={styles.seccionVacia}>Ninguna activa: el bot usará su mensaje fijo.</p>
                    )}
                    {activas.map(renderItem)}

                    <p className={styles.seccion}>Inactivas · {inactivas.length}</p>
                    {inactivas.length === 0 && (
                        <p className={styles.seccionVacia}>No hay plantillas inactivas.</p>
                    )}
                    {inactivas.map(renderItem)}

                </div>

            ) : (

                <div className={styles.items}>
                    {plantillas.map(renderItem)}
                </div>

            )}

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
