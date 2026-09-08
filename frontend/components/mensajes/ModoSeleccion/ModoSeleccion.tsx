"use client";

import { useState } from "react";
import { Pin, Dices, RotateCw } from "lucide-react";

import { Tabs } from "@/components/ui/Tabs";
import { Select } from "@/components/ui/Select";

import { PlantillaMensaje } from "@/services/mensajes/plantillas";
import {
    ModoSeleccion as TipoModo,
    guardarModoSeleccion
} from "@/services/mensajes/configuracionSeleccion";

import styles from "./ModoSeleccion.module.css";

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

            <span className={styles.label}>Modo de respuesta</span>

            <Tabs
                aria-label="Modo de respuesta"
                value={modo}
                onValueChange={cambiarModo}
                items={[
                    { value: "fijo", label: "Fija", icon: <Pin size={13} />, disabled: guardando },
                    { value: "aleatorio", label: "Aleatoria", icon: <Dices size={13} />, disabled: guardando },
                    { value: "rotacion", label: "Rotación", icon: <RotateCw size={13} />, disabled: guardando }
                ]}
            />

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
                        Solo esta plantilla se usará mientras el modo sea fijo. Las demás pueden
                        seguir habilitadas, pero no se usarán.
                    </p>

                </div>

            )}

            {modo === "aleatorio" && (

                <div className={styles.detalle}>
                    <p className={styles.nota}>
                        Se elegirá aleatoriamente entre las plantillas habilitadas.
                    </p>
                    <p className={styles.contador}>Plantillas disponibles: {habilitadas.length}</p>
                </div>

            )}

            {modo === "rotacion" && (

                <div className={styles.detalle}>
                    <p className={styles.nota}>
                        Las plantillas habilitadas se utilizarán una por una, en orden.
                    </p>
                    <p className={styles.contador}>Plantillas disponibles: {habilitadas.length}</p>
                </div>

            )}

        </div>

    );

}
