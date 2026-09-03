"use client";

import { useState } from "react";

import "./ModoSeleccion.css";

import { PlantillaMensaje } from "@/services/mensajes/plantillas";
import {
    ModoSeleccion as TipoModo,
    guardarModoSeleccion
} from "@/services/mensajes/configuracionSeleccion";

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

    return (

        <div className="modo-seleccion">

            <p className="modo-seleccion-titulo">Modo de respuesta</p>

            <div className="modo-opciones">

                <label className={`modo-opcion ${modo === "fijo" ? "seleccionada" : ""}`}>
                    <input
                        type="radio"
                        name={`modo-${tipoId}`}
                        checked={modo === "fijo"}
                        disabled={guardando}
                        onChange={() => aplicar("fijo", fijaId || habilitadas[0]?.id || null)}
                    />
                    ⭐ Fija
                </label>

                <label className={`modo-opcion ${modo === "aleatorio" ? "seleccionada" : ""}`}>
                    <input
                        type="radio"
                        name={`modo-${tipoId}`}
                        checked={modo === "aleatorio"}
                        disabled={guardando}
                        onChange={() => aplicar("aleatorio", null)}
                    />
                    🎲 Aleatoria
                </label>

                <label className={`modo-opcion ${modo === "rotacion" ? "seleccionada" : ""}`}>
                    <input
                        type="radio"
                        name={`modo-${tipoId}`}
                        checked={modo === "rotacion"}
                        disabled={guardando}
                        onChange={() => aplicar("rotacion", null)}
                    />
                    🔄 Rotación
                </label>

            </div>

            {modo === "fijo" && (

                <div className="modo-detalle">

                    <label>Plantilla seleccionada:</label>

                    <select
                        value={fijaId || ""}
                        disabled={guardando || habilitadas.length === 0}
                        onChange={(e) => aplicar("fijo", e.target.value)}
                    >
                        {habilitadas.length === 0 && <option value="">(no hay plantillas habilitadas)</option>}
                        {habilitadas.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                    </select>

                    <p className="modo-nota">
                        Solo esta plantilla se usará mientras el modo sea fijo.
                        Las demás pueden seguir habilitadas, pero no se usarán.
                    </p>

                </div>

            )}

            {modo === "aleatorio" && (

                <div className="modo-detalle">
                    <p className="modo-nota">
                        Se elegirá aleatoriamente entre las plantillas habilitadas.
                    </p>
                    <p className="modo-contador">
                        Plantillas disponibles: {habilitadas.length}
                    </p>
                </div>

            )}

            {modo === "rotacion" && (

                <div className="modo-detalle">
                    <p className="modo-nota">
                        Las plantillas habilitadas se utilizarán una por una, en orden.
                    </p>
                    <p className="modo-contador">
                        Plantillas disponibles: {habilitadas.length}
                    </p>
                </div>

            )}

        </div>

    );

}
