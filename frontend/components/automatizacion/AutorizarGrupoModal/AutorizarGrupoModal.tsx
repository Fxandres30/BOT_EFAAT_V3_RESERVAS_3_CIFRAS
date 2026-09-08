"use client";

import { useEffect, useState } from "react";

import "./AutorizarGrupoModal.css";

import { GrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { mergearGrupos } from "@/services/automatizacion/mergeGrupos";

interface Props {
    usuarioId: string;
    gruposYaAutorizados: string[];
    modoInicial?: "reales" | "manual";
    onClose: () => void;
    onAutorizado: (g: GrupoAutorizado) => void;
}

type SeleccionGrupo = { grupoId: string; grupoNombre: string };

// Fase 4D: la fuente principal ahora son los grupos REALES de las
// sesiones de WhatsApp conectadas (socket Baileys real de cada sesión,
// vía el backend — nunca mensajes_grupos_sorteos como única fuente, ver
// services/automatizacion/gruposDisponibles.ts). El modo manual queda
// como respaldo, por si una sesión no responde o el grupo todavía no
// aparece por algún motivo puntual.
export default function AutorizarGrupoModal({
    usuarioId,
    gruposYaAutorizados,
    modoInicial,
    onClose,
    onAutorizado
}: Props) {

    const [cargando, setCargando] = useState(true);
    const [sesiones, setSesiones] = useState<SesionConGrupos[]>([]);

    // grupo_id/JID es la única identidad — mismo criterio de fusión que
    // GruposAutomatizacion.tsx (ver mergeGrupos.ts): si el mismo grupo
    // aparece en dos sesiones conectadas, se muestra UNA sola opción, no
    // dos radios idénticos.
    const gruposReales = mergearGrupos(sesiones, []).disponibles;

    const [modo, setModo] = useState<"reales" | "manual">(modoInicial || "reales");
    const [seleccion, setSeleccion] = useState<SeleccionGrupo | null>(null);
    const [grupoManual, setGrupoManual] = useState("");

    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        async function cargar() {

            setCargando(true);
            const data = await obtenerGruposDisponibles(usuarioId);
            setSesiones(data);

            const primerGrupoDisponible = mergearGrupos(data, [])
                .disponibles
                .map((g) => ({ grupoId: g.grupoId, grupoNombre: g.nombre }))
                .find((g) => !gruposYaAutorizados.includes(g.grupoId));

            if (!primerGrupoDisponible) {
                setModo("manual");
            } else if (!modoInicial) {
                setSeleccion(primerGrupoDisponible);
            }

            setCargando(false);

        }

        cargar();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usuarioId]);

    async function confirmar() {

        const grupoId = modo === "reales" ? seleccion?.grupoId : grupoManual.trim();

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

    const hayGruposReales = gruposReales.length > 0;

    return (

        <div className="autorizar-overlay" onClick={onClose}>

            <div className="autorizar-modal" onClick={(e) => e.stopPropagation()}>

                <h2>Autorizar grupo de prueba</h2>

                <p className="autorizar-nota">
                    Autoriza <strong>un solo grupo</strong> para probar la automatización.
                    Autorizar no lo activa de inmediato para abrir grupos reales — todavía
                    hace falta configurar horario y crear/activar mensajes.
                </p>

                <div className="autorizar-modo-toggle">
                    <button className={modo === "reales" ? "activo" : ""} onClick={() => setModo("reales")}>
                        Grupos de mis sesiones
                    </button>
                    <button className={modo === "manual" ? "activo" : ""} onClick={() => setModo("manual")}>
                        Escribir el JID
                    </button>
                </div>

                {modo === "reales" ? (

                    cargando ? (

                        <p className="autorizar-cargando">Consultando sesiones conectadas...</p>

                    ) : sesiones.length === 0 ? (

                        <p className="autorizar-cargando">
                            No tienes ninguna sesión de WhatsApp registrada. Créala en
                            &quot;Sesiones&quot; o usa &quot;Escribir el JID&quot;.
                        </p>

                    ) : !sesiones.some((s) => s.conectada) ? (

                        <p className="autorizar-cargando">
                            Ninguna de tus sesiones tiene un socket de WhatsApp conectado ahora mismo.
                            Conéctala en &quot;Sesiones&quot; o usa &quot;Escribir el JID&quot;.
                        </p>

                    ) : !hayGruposReales ? (

                        <p className="autorizar-cargando">
                            Tu sesión está conectada, pero WhatsApp no reportó ningún grupo ahora mismo.
                            Prueba &quot;Escribir el JID&quot; mientras tanto.
                        </p>

                    ) : (

                        <div className="autorizar-arbol">

                            {sesiones.filter((s) => s.error).map((s) => (
                                <p key={s.sessionId} className="autorizar-sesion-error">
                                    ⚠️ {s.nombreSesion}: {s.error}
                                </p>
                            ))}

                            {/* grupo_id/JID es la única identidad — un mismo grupo reportado
                                por varias sesiones aparece UNA sola vez (ver mergeGrupos.ts). */}
                            {gruposReales.map((g) => {

                                const yaAutorizado = gruposYaAutorizados.includes(g.grupoId);
                                const marcado = seleccion?.grupoId === g.grupoId;

                                return (

                                    <label
                                        key={g.grupoId}
                                        className={`autorizar-grupo-item ${marcado ? "marcado" : ""} ${yaAutorizado ? "deshabilitado" : ""}`}
                                    >
                                        <input
                                            type="radio"
                                            name="grupo-real"
                                            disabled={yaAutorizado}
                                            checked={marcado}
                                            onChange={() => setSeleccion({ grupoId: g.grupoId, grupoNombre: g.nombre })}
                                        />
                                        <span>
                                            {g.nombre}
                                            <span className="autorizar-grupo-sesion"> — 📱 {g.sesiones.map((s) => s.nombreSesion).join(", ")}</span>
                                        </span>
                                        {yaAutorizado && <span className="autorizar-ya">ya autorizado</span>}
                                    </label>

                                );

                            })}

                        </div>

                    )

                ) : (

                    <label className="autorizar-campo">
                        Identificador del grupo (JID de WhatsApp)
                        <input
                            type="text"
                            placeholder="120363421290339105@g.us"
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
