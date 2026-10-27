"use client";

import { useState } from "react";

import { Badge, Button, Input, type BadgeTone } from "@/components/ui";
import { apiSorteos, describirError, type AccionEvento, type EstadoEventoGrupo, type SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import styles from "./Sorteos.module.css";

// Acciones de estado de un sorteo que ya está en los grupos (cerrar,
// reabrir, desactivar en un grupo o en todos, cancelar, eliminar). Las
// usan la pestaña Sorteos → «Administrar» y el editor del sorteo activo
// (Eventos → «Administrar» → Tablas → «Editar»). Toda acción la decide y
// valida el backend (sorteos/gestionEventos.js); aquí solo se confirma.

export const fechaLegible = (f: string | null) => (f ? f.split("-").reverse().join("/") : "sin fecha");

export const ESTADO_SORTEO: Record<EstadoEventoGrupo, { texto: string; tono: BadgeTone }> = {
    en_curso: { texto: "En curso", tono: "success" },
    cerrado: { texto: "Cerrado", tono: "neutral" },
    desactivado: { texto: "Desactivado", tono: "warning" },
    cancelado: { texto: "Cancelado", tono: "error" },
    sustituido: { texto: "Sustituido", tono: "neutral" }
};

// Qué hace cada acción, dicho antes de confirmar.
const EXPLICACION: Record<AccionEvento, string> = {
    cerrar: "Deja de aceptar reservas, como el cierre por hora. Si hay sesión de WhatsApp, se cierra el grupo (salvo que tenga otro sorteo activo). Se envían los avisos de cierre configurados.",
    desactivar: "Lo apaga sin enviar ningún mensaje: sin reservas, recordatorios ni aviso de cierre. Los pagos pendientes de los clientes se siguen informando. Se detienen sus publicaciones programadas pendientes.",
    reabrir: "Vuelve a aceptar reservas. El cierre de reservas debe estar en el futuro. EFAAT abrirá el grupo de WhatsApp en el próximo ciclo.",
    cancelar: "El sorteo no se juega: se detiene en todos sus grupos y sus publicaciones pendientes. Sus reservas y pagos se conservan, pero las reservas ya no se cobran a los clientes.",
    eliminar: "Lo oculta del panel y de las consultas en todos sus grupos. No se borra nada: reservas, pagos e historial se conservan."
};

export const TITULO_ACCION: Record<AccionEvento, string> = {
    cerrar: "Cerrar sorteo",
    desactivar: "Desactivar sorteo",
    reabrir: "Reabrir sorteo",
    cancelar: "Cancelar sorteo",
    eliminar: "Eliminar sorteo"
};

export interface AccionPendiente {
    sorteo: SorteoEnGrupos;
    eventoId: string;
    grupoNombre: string | null;
    accion: AccionEvento;
    alcance: "grupo" | "todos";
}

interface BotonesProps {
    sorteo: SorteoEnGrupos;
    onAccion: (p: AccionPendiente) => void;
    onEditar?: (eventoId: string) => void;
}

// Una fila por grupo (con su estado y sus acciones) y las acciones de todo
// el sorteo.
export function BotonesSorteo({ sorteo: s, onAccion, onEditar }: BotonesProps) {

    const enCurso = s.grupos.filter(g => g.estado === "en_curso");
    const representante = enCurso[0]?.evento_id || s.id;
    const pedir = (eventoId: string, grupoNombre: string | null, accion: AccionEvento, alcance: "grupo" | "todos") =>
        onAccion({ sorteo: s, eventoId, grupoNombre, accion, alcance });

    return (
        <>
            {s.grupos.map(g => (
                <div key={g.evento_id} className={styles.acciones}>
                    <span className={styles.ayuda}>{g.grupo_nombre || g.grupo_id}</span>
                    <Badge tone={ESTADO_SORTEO[g.estado]?.tono || "neutral"}>{ESTADO_SORTEO[g.estado]?.texto || g.estado}</Badge>
                    {g.estado === "en_curso" ? (
                        <>
                            <Button size="sm" variant="ghost" onClick={() => pedir(g.evento_id, g.grupo_nombre, "cerrar", "grupo")}>Cerrar aquí</Button>
                            <Button size="sm" variant="ghost" onClick={() => pedir(g.evento_id, g.grupo_nombre, "desactivar", "grupo")}>Desactivar aquí</Button>
                        </>
                    ) : g.estado !== "cancelado" && (
                        <Button size="sm" variant="ghost" onClick={() => pedir(g.evento_id, g.grupo_nombre, "reabrir", "grupo")}>Reabrir aquí</Button>
                    )}
                </div>
            ))}

            <div className={styles.acciones}>
                {onEditar && enCurso.length > 0 && <Button size="sm" variant="secondary" onClick={() => onEditar(representante)}>Editar</Button>}
                {enCurso.length > 1 && <Button size="sm" variant="secondary" onClick={() => pedir(representante, null, "desactivar", "todos")}>Desactivar en todos</Button>}
                {enCurso.length > 1 && <Button size="sm" variant="secondary" onClick={() => pedir(representante, null, "cerrar", "todos")}>Cerrar en todos</Button>}
                {s.estado !== "cancelado" && <Button size="sm" variant="danger" onClick={() => pedir(representante, null, "cancelar", "todos")}>Cancelar sorteo</Button>}
                <Button size="sm" variant="ghost" onClick={() => pedir(representante, null, "eliminar", "todos")}>Eliminar</Button>
            </div>
        </>
    );

}

interface ConfirmarProps {
    pendiente: AccionPendiente;
    onVolver: () => void;
    onHecho: (mensaje: string) => void;
}

// Confirmación de UNA acción: explica qué hace, pide la hora de cierre al
// reabrir y, si el grupo tiene otro sorteo activo, si este lo sustituye.
export function ConfirmarAccionSorteo({ pendiente, onVolver, onHecho }: ConfirmarProps) {

    const [horaCierre, setHoraCierre] = useState(pendiente.sorteo.hora_cierre ? pendiente.sorteo.hora_cierre.slice(0, 5) : "");
    const [sustituir, setSustituir] = useState(false);
    const [conflicto, setConflicto] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [enviando, setEnviando] = useState(false);

    async function confirmar() {

        setEnviando(true);
        setError(null);

        const r = await apiSorteos.accionEvento(pendiente.eventoId, {
            accion: pendiente.accion,
            alcance: pendiente.alcance,
            ...(pendiente.accion === "reabrir" ? { hora_cierre: horaCierre, sustituir } : {})
        });

        setEnviando(false);

        if (!r.ok) {
            if (r.motivo === "conflicto") setConflicto(r.mensaje || "El grupo tiene otro sorteo activo.");
            // Backend sin las rutas nuevas (proxy 404 «respuesta_invalida»).
            setError(r.status === 404 && r.motivo === "respuesta_invalida"
                ? "El servidor del bot todavía no tiene esta función: hay que reiniciar el backend con la versión nueva."
                : r.errores?.map(e => e.mensaje).join(" ") || r.mensaje || describirError(r));
            return;
        }

        const wa = r.data.whatsapp.filter(w => w.whatsapp !== "cerrado");
        const avisoWa = wa.length ? ` WhatsApp: ${wa.map(w => w.whatsapp === "sin_sesion" ? "sin sesión conectada, el grupo no se cerró" : w.whatsapp === "omitido_otro_sorteo_activo" ? "el grupo sigue abierto porque tiene otro sorteo activo" : "no confirmó el cierre del grupo").join("; ")}.` : "";
        const detenidas = r.data.publicaciones_detenidas ? ` Publicaciones pendientes detenidas: ${r.data.publicaciones_detenidas}.` : "";

        onHecho(`${TITULO_ACCION[pendiente.accion]}: hecho en ${r.data.grupos.length} grupo(s).${detenidas}${avisoWa}`);

    }

    return (
        <div className={styles.stack}>
            <p><b>{TITULO_ACCION[pendiente.accion]}</b> · {pendiente.sorteo.nombre || "Sorteo"} · {pendiente.alcance === "grupo" ? `solo en ${pendiente.grupoNombre || "este grupo"}` : "en todos sus grupos"}</p>
            <p className={styles.ayuda}>{EXPLICACION[pendiente.accion]}</p>
            {pendiente.alcance === "grupo" && pendiente.accion !== "reabrir" && (
                <p className={styles.ayuda}>Los demás grupos de este sorteo siguen como están.</p>
            )}
            {pendiente.accion === "reabrir" && (
                <>
                    <Input label="Cierre de reservas" type="time" value={horaCierre} onChange={e => setHoraCierre(e.target.value)} hint={`Día del sorteo: ${fechaLegible(pendiente.sorteo.fecha_evento)}. Debe ser una hora futura y no posterior a la del sorteo.`} />
                    {conflicto && (
                        <label className={styles.check}>
                            <input type="checkbox" checked={sustituir} onChange={e => setSustituir(e.target.checked)} />
                            Sustituir el sorteo activo de ese grupo (se cierra solo allí, sin perder sus reservas ni pagos)
                        </label>
                    )}
                </>
            )}
            {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}
            <div className={styles.acciones}>
                <Button variant="secondary" onClick={onVolver} disabled={enviando}>Volver</Button>
                <Button variant={pendiente.accion === "cancelar" || pendiente.accion === "eliminar" ? "danger" : "primary"} onClick={confirmar} loading={enviando}>Confirmar</Button>
            </div>
        </div>
    );

}
