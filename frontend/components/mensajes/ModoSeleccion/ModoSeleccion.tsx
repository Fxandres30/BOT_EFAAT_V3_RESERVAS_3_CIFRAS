"use client";

import { useState } from "react";
import { Pin, Dices, RotateCw } from "lucide-react";

import { Select } from "@/components/ui/Select";

import { PlantillaMensaje } from "@/services/mensajes/plantillas";
import {
    ModoSeleccion as TipoModo,
    guardarModoSeleccion
} from "@/services/mensajes/configuracionSeleccion";

import styles from "./ModoSeleccion.module.css";

const MODOS: { valor: TipoModo; titulo: string; explicacion: string; icono: React.ReactNode }[] = [
    { valor: "fijo", titulo: "Fija", explicacion: "Siempre se enviará esta plantilla.", icono: <Pin size={15} aria-hidden="true" /> },
    { valor: "aleatorio", titulo: "Aleatoria", explicacion: "EFAAT elegirá una de las plantillas habilitadas.", icono: <Dices size={15} aria-hidden="true" /> },
    { valor: "rotacion", titulo: "Rotación", explicacion: "EFAAT alternará entre las plantillas habilitadas.", icono: <RotateCw size={15} aria-hidden="true" /> }
];

interface Props {
    usuarioId: string;
    tipoId: string;
    modoActual: TipoModo;
    plantillaFijaId: string | null;
    plantillas: PlantillaMensaje[];
    onGuardado: (modo: TipoModo, plantillaFijaId: string | null) => void;
}

export default function ModoSeleccion({
    usuarioId,
    tipoId,
    modoActual,
    plantillaFijaId,
    plantillas,
    onGuardado
}: Props) {

    const [modo, setModo] = useState<TipoModo>(modoActual);
    const [fijaId, setFijaId] = useState<string | null>(plantillaFijaId);
    const [guardando, setGuardando] = useState(false);

    const habilitadas = plantillas.filter((p) => p.habilitada);

    async function aplicar(nuevoModo: TipoModo, nuevaFijaId: string | null) {

        setModo(nuevoModo);
        setFijaId(nuevaFijaId);
        setGuardando(true);

        const { data, error } = await guardarModoSeleccion(usuarioId, tipoId, nuevoModo, nuevaFijaId);

        setGuardando(false);

        if (!error && data) {
            onGuardado(data.modo_seleccion, data.plantilla_fija_id);
        }

    }

    function cambiarModo(valor: string) {

        if (valor === "fijo") {
            aplicar("fijo", fijaId || habilitadas[0]?.id || null);
        } else if (valor === "aleatorio") {
            aplicar("aleatorio", null);
        } else {
            aplicar("rotacion", null);
        }

    }

    return (

        <div className={styles.wrap}>

            <span className={styles.label} id={`modo-${tipoId}`}>¿Qué plantilla se envía?</span>

            <div className={styles.opciones} role="radiogroup" aria-labelledby={`modo-${tipoId}`}>
                {MODOS.map((m) => (
                    <button
                        key={m.valor}
                        type="button"
                        role="radio"
                        aria-checked={modo === m.valor}
                        disabled={guardando}
                        className={`${styles.opcion} ${modo === m.valor ? styles.opcionActiva : ""}`}
                        onClick={() => modo !== m.valor && cambiarModo(m.valor)}
                    >
                        <span className={styles.opcionTitulo}>{m.icono} {m.titulo}</span>
                        <span className={styles.opcionTexto}>{m.explicacion}</span>
                    </button>
                ))}
            </div>

            {modo === "fijo" && (

                <div className={styles.detalle}>

                    <Select
                        label="Plantilla seleccionada"
                        value={fijaId || ""}
                        disabled={guardando || habilitadas.length === 0}
                        onChange={(e) => aplicar("fijo", e.target.value)}
                    >
                        {habilitadas.length === 0 && <option value="">(no hay plantillas habilitadas)</option>}
                        {habilitadas.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                    </Select>

                    <p className={styles.nota}>
                        Solo esta plantilla se enviará. Las demás siguen guardadas y no se usan
                        mientras el modo sea «Fija».
                    </p>

                </div>

            )}

            {modo === "aleatorio" && (

                <div className={styles.detalle}>
                    <p className={styles.nota}>
                        Cada respuesta usa al azar una de las plantillas marcadas como activas.
                    </p>
                    <p className={styles.contador}>Plantillas disponibles: {habilitadas.length}</p>
                </div>

            )}

            {modo === "rotacion" && (

                <div className={styles.detalle}>
                    <p className={styles.nota}>
                        Las plantillas activas se usan una por una, en orden.
                    </p>
                    <p className={styles.contador}>Plantillas disponibles: {habilitadas.length}</p>
                </div>

            )}

        </div>

    );

}
