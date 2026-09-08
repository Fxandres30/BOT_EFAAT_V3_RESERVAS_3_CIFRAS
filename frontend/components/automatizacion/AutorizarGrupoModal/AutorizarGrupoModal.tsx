"use client";

import { useState } from "react";

import "./AutorizarGrupoModal.css";

import { GrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
import { GrupoConversacion } from "@/services/chats/obtenerGruposConversacion";

interface Props {
    usuarioId: string;
    gruposConocidos: GrupoConversacion[];
    gruposYaAutorizados: string[];
    onClose: () => void;
    onAutorizado: (g: GrupoAutorizado) => void;
}

// Paso 5 de Fase 4C: elegir explícitamente UN grupo de prueba y
// autorizarlo — nunca "autorizar todos". El modo manual (pegar un JID)
// existe porque no todos los grupos tienen todavía actividad detectada en
// mensajes_grupos_sorteos (fuente de gruposConocidos).
export default function AutorizarGrupoModal({
    usuarioId,
    gruposConocidos,
    gruposYaAutorizados,
    onClose,
    onAutorizado
}: Props) {

    const disponibles = gruposConocidos.filter((g) => !gruposYaAutorizados.includes(g.grupo_id));

    const [modo, setModo] = useState<"lista" | "manual">(disponibles.length > 0 ? "lista" : "manual");
    const [grupoSeleccionado, setGrupoSeleccionado] = useState(disponibles[0]?.grupo_id || "");
    const [grupoManual, setGrupoManual] = useState("");

    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function confirmar() {

        const grupoId = (modo === "lista" ? grupoSeleccionado : grupoManual).trim();

        if (!grupoId) {
            setError("Selecciona o escribe un grupo.");
            return;
        }

        if (gruposYaAutorizados.includes(grupoId)) {
            setError("Ese grupo ya está autorizado.");
            return;
        }

        setGuardando(true);
        setError(null);

        const { data, error: errorGuardar } = await autorizarGrupo(usuarioId, grupoId);

        setGuardando(false);

        if (errorGuardar || !data) {
            setError(`No se pudo autorizar (${errorGuardar?.message || "error desconocido"}).`);
            return;
        }

        onAutorizado(data as GrupoAutorizado);

    }

    return (

        <div className="autorizar-overlay" onClick={onClose}>

            <div className="autorizar-modal" onClick={(e) => e.stopPropagation()}>

                <h2>Autorizar grupo de prueba</h2>

                <p className="autorizar-nota">
                    Autoriza <strong>un solo grupo</strong> para probar la automatización.
                    Autorizar no lo activa de inmediato para abrir grupos reales — todavía
                    hace falta configurar horario y crear/activar mensajes.
                </p>

                {disponibles.length > 0 && (

                    <div className="autorizar-modo-toggle">
                        <button
                            className={modo === "lista" ? "activo" : ""}
                            onClick={() => setModo("lista")}
                        >
                            Elegir de la lista
                        </button>
                        <button
                            className={modo === "manual" ? "activo" : ""}
                            onClick={() => setModo("manual")}
                        >
                            Escribir el JID
                        </button>
                    </div>

                )}

                {modo === "lista" && disponibles.length > 0 ? (

                    <label className="autorizar-campo">
                        Grupo
                        <select
                            value={grupoSeleccionado}
                            onChange={(e) => setGrupoSeleccionado(e.target.value)}
                        >
                            {disponibles.map((g) => (
                                <option key={g.grupo_id} value={g.grupo_id}>
                                    {g.grupo_nombre || g.grupo_id}
                                </option>
                            ))}
                        </select>
                    </label>

                ) : (

                    <label className="autorizar-campo">
                        Identificador del grupo (JID de WhatsApp)
                        <input
                            type="text"
                            placeholder="573000000000-1111@g.us"
                            value={grupoManual}
                            onChange={(e) => setGrupoManual(e.target.value)}
                        />
                    </label>

                )}

                {error && <p className="autorizar-error">⚠️ {error}</p>}

                <div className="autorizar-botones">
                    <button className="cancelar" onClick={onClose} disabled={guardando}>
                        Cancelar
                    </button>
                    <button className="confirmar" onClick={confirmar} disabled={guardando}>
                        {guardando ? "Guardando..." : "Autorizar"}
                    </button>
                </div>

            </div>

        </div>

    );

}
