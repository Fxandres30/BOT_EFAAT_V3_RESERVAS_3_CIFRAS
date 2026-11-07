"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";

import "./AutorizarGrupoModal.css";

import { GrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { mergearGrupos, normalizarGrupoId } from "@/services/automatizacion/mergeGrupos";

interface Props {
    usuarioId: string;
    // Autorizaciones ACTIVAS (no se pueden volver a elegir).
    gruposYaAutorizados: string[];
    // Autorizaciones PAUSADAS: se pueden elegir para reactivarlas
    // (autorizarGrupo hace upsert con activo=true, igual que siempre).
    gruposPausados?: string[];
    modoInicial?: "reales" | "manual";
    onClose: () => void;
    onAutorizado: (g: GrupoAutorizado) => void;
}

type SeleccionGrupo = { grupoId: string; grupoNombre: string };

// Fuente principal: los grupos REALES de las sesiones de WhatsApp
// conectadas (ver gruposDisponibles.ts). El identificador manual queda como
// respaldo. Autorizar solo da permiso a EFAAT para automatizar el grupo:
// no conecta nada ni envía mensajes por sí solo.
export default function AutorizarGrupoModal({
    usuarioId,
    gruposYaAutorizados,
    gruposPausados = [],
    modoInicial,
    onClose,
    onAutorizado
}: Props) {

    const [cargando, setCargando] = useState(true);
    const [sesiones, setSesiones] = useState<SesionConGrupos[]>([]);

    const gruposReales = mergearGrupos(sesiones, []).disponibles;
    const activos = new Set(gruposYaAutorizados.map(normalizarGrupoId));
    const pausados = new Set(gruposPausados.map(normalizarGrupoId));

    const [modo, setModo] = useState<"reales" | "manual">(modoInicial || "reales");
    const [seleccion, setSeleccion] = useState<SeleccionGrupo | null>(null);
    const [grupoManual, setGrupoManual] = useState("");

    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        let vigente = true;

        obtenerGruposDisponibles(usuarioId).then((data) => {

            if (!vigente) return;

            setSesiones(data);

            const primero = mergearGrupos(data, [])
                .disponibles
                .find((g) => !activos.has(g.grupoId));

            if (!primero) {
                if (!modoInicial) setModo(data.some((s) => s.conectada) ? "reales" : "manual");
            } else if (!modoInicial) {
                setSeleccion({ grupoId: primero.grupoId, grupoNombre: primero.nombre });
            }

            setCargando(false);

        });

        return () => { vigente = false; };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usuarioId]);

    async function confirmar() {

        const grupoId = normalizarGrupoId(modo === "reales" ? seleccion?.grupoId : grupoManual);

        if (!grupoId) {
            setError(modo === "reales" ? "Elige un grupo de la lista." : "Escribe el identificador del grupo.");
            return;
        }

        if (activos.has(grupoId)) {
            setError("Ese grupo ya está autorizado.");
            return;
        }

        setGuardando(true);
        setError(null);

        const { data, error: errorGuardar } = await autorizarGrupo(usuarioId, grupoId);

        setGuardando(false);

        if (errorGuardar || !data) {
            setError("No se pudo autorizar el grupo. Inténtalo de nuevo.");
            return;
        }

        onAutorizado(data as GrupoAutorizado);

    }

    const conectadas = sesiones.filter((s) => s.conectada);
    const desconectadas = sesiones.filter((s) => s.estado === "desconectada");
    const sinVerificar = sesiones.filter((s) => s.estado === "no_verificable");
    const reactivando = (modo === "reales" && seleccion && pausados.has(seleccion.grupoId)) ||
        (modo === "manual" && pausados.has(normalizarGrupoId(grupoManual)));

    return (

        <Modal
            open
            onClose={onClose}
            bloquearCierre={guardando}
            size="md"
            title="Autorizar un grupo"
            description="Autorizar permite que EFAAT envíe mensajes automáticos en ese grupo. No envía nada por sí solo: después decides qué mensajes y cuándo en «Configurar»."
            footer={
                <div className="autorizar-botones">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button size="sm" onClick={confirmar} loading={guardando} disabled={guardando}>
                        {reactivando ? "Reactivar autorización" : "Autorizar"}
                    </Button>
                </div>
            }
        >

            <div className="autorizar-cuerpo">

                <Tabs
                    items={[{ value: "reales", label: "Grupos de mi WhatsApp" }, { value: "manual", label: "Por identificador" }]}
                    value={modo}
                    onValueChange={(v) => { setModo(v as "reales" | "manual"); setError(null); }}
                    aria-label="Cómo elegir el grupo"
                />

                {modo === "reales" ? (

                    cargando ? (

                        <p className="autorizar-nota">Consultando tu WhatsApp…</p>

                    ) : sesiones.length === 0 ? (

                        <p className="autorizar-nota">
                            No tienes ningún WhatsApp vinculado. Vincúlalo en «Sesiones» o autoriza el grupo por su identificador.
                        </p>

                    ) : conectadas.length === 0 ? (

                        <p className="autorizar-nota">
                            {sinVerificar.length > 0
                                ? "No pudimos comprobar tu WhatsApp en este momento. Inténtalo de nuevo en unos minutos o usa el identificador."
                                : "Tu WhatsApp no está conectado ahora, así que no podemos listar tus grupos. Reconéctalo en «Sesiones» o usa el identificador."}
                        </p>

                    ) : gruposReales.length === 0 ? (

                        <p className="autorizar-nota">
                            Tu WhatsApp está conectado, pero no reportó ningún grupo. Puedes autorizarlo por su identificador.
                        </p>

                    ) : (

                        <div className="autorizar-arbol" role="radiogroup" aria-label="Grupos de tu WhatsApp">

                            {gruposReales.map((g) => {

                                const yaAutorizado = activos.has(g.grupoId);
                                const pausado = pausados.has(g.grupoId);
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
                                            onChange={() => { setSeleccion({ grupoId: g.grupoId, grupoNombre: g.nombre }); setError(null); }}
                                        />
                                        <span className="autorizar-grupo-nombre">{g.nombre}</span>
                                        {yaAutorizado && <span className="autorizar-ya">Ya autorizado</span>}
                                        {!yaAutorizado && pausado && <span className="autorizar-ya pausado">Autorización pausada</span>}
                                    </label>

                                );

                            })}

                            {desconectadas.length > 0 && (
                                <p className="autorizar-nota">
                                    {desconectadas.map((s) => s.nombreSesion).join(", ")} no está conectado: sus grupos no aparecen en esta lista.
                                </p>
                            )}

                        </div>

                    )

                ) : (

                    <>
                        <label className="autorizar-campo">
                            Identificador del grupo
                            <input
                                type="text"
                                placeholder="120363421290339105@g.us"
                                value={grupoManual}
                                onChange={(e) => { setGrupoManual(e.target.value); setError(null); }}
                            />
                        </label>
                        <p className="autorizar-nota">
                            <Info size={13} aria-hidden="true" /> Úsalo solo si el grupo no aparece en la lista. Si tu número no está en ese grupo,
                            la autorización queda guardada pero EFAAT no podrá enviarle mensajes hasta que lo esté.
                        </p>
                    </>

                )}

                {reactivando && (
                    <p className="autorizar-nota">Este grupo tenía la autorización pausada: se reactivará con su configuración de siempre.</p>
                )}

                {error && <p className="autorizar-error" role="alert">{error}</p>}

            </div>

        </Modal>

    );

}
