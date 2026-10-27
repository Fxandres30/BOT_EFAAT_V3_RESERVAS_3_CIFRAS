"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Badge, Button, Card, EmptyState, Input, Modal, type BadgeTone } from "@/components/ui";
import { apiSorteos, describirError, type AccionEvento, type EstadoEventoGrupo, type SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import styles from "./Sorteos.module.css";

interface Props {
    sorteos: SorteoEnGrupos[];
    error: string | null;
    onEditar: (eventoId: string) => void;
    onActualizado: () => void;
}

const fechaLegible = (f: string | null) => (f ? f.split("-").reverse().join("/") : "sin fecha");

const ESTADO: Record<EstadoEventoGrupo, { texto: string; tono: BadgeTone }> = {
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

const TITULO: Record<AccionEvento, string> = {
    cerrar: "Cerrar sorteo",
    desactivar: "Desactivar sorteo",
    reabrir: "Reabrir sorteo",
    cancelar: "Cancelar sorteo",
    eliminar: "Eliminar sorteo"
};

interface Pendiente {
    sorteo: SorteoEnGrupos;
    eventoId: string;
    grupoNombre: string | null;
    accion: AccionEvento;
    alcance: "grupo" | "todos";
}

// Sorteos que ya están en los grupos (detectados o publicados), activos y
// recientes, con acciones por grupo o para todo el sorteo. Toda acción la
// decide y valida el backend (gestionEventos.js); aquí solo se confirma.
export default function AdministrarSorteos({ sorteos, error, onEditar, onActualizado }: Props) {

    const [pendiente, setPendiente] = useState<Pendiente | null>(null);
    const [horaCierre, setHoraCierre] = useState("");
    const [sustituir, setSustituir] = useState(false);
    const [conflicto, setConflicto] = useState<string | null>(null);
    const [errorAccion, setErrorAccion] = useState<string | null>(null);
    const [resultado, setResultado] = useState<string | null>(null);
    const [enviando, setEnviando] = useState(false);

    function abrir(p: Pendiente) {
        setPendiente(p);
        setHoraCierre(p.sorteo.hora_cierre ? p.sorteo.hora_cierre.slice(0, 5) : "");
        setSustituir(false);
        setConflicto(null);
        setErrorAccion(null);
    }

    async function confirmar() {

        if (!pendiente) return;

        setEnviando(true);
        setErrorAccion(null);

        const r = await apiSorteos.accionEvento(pendiente.eventoId, {
            accion: pendiente.accion,
            alcance: pendiente.alcance,
            ...(pendiente.accion === "reabrir" ? { hora_cierre: horaCierre, sustituir } : {})
        });

        setEnviando(false);

        if (!r.ok) {
            if (r.motivo === "conflicto") setConflicto(r.mensaje || "El grupo tiene otro sorteo activo.");
            setErrorAccion(r.errores?.map(e => e.mensaje).join(" ") || r.mensaje || describirError(r));
            return;
        }

        const wa = r.data.whatsapp.filter(w => w.whatsapp !== "cerrado");
        const avisoWa = wa.length ? ` WhatsApp: ${wa.map(w => w.whatsapp === "sin_sesion" ? "sin sesión conectada, el grupo no se cerró" : w.whatsapp === "omitido_otro_sorteo_activo" ? "el grupo sigue abierto porque tiene otro sorteo activo" : "no confirmó el cierre del grupo").join("; ")}.` : "";
        const detenidas = r.data.publicaciones_detenidas ? ` Publicaciones pendientes detenidas: ${r.data.publicaciones_detenidas}.` : "";

        setResultado(`${TITULO[pendiente.accion]}: hecho en ${r.data.grupos.length} grupo(s).${detenidas}${avisoWa}`);
        setPendiente(null);
        onActualizado();

    }

    if (error) return <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudieron cargar los sorteos: {error}</p>;

    if (!sorteos.length) {
        return <EmptyState icon={<Settings2 size={28} />} title="No hay sorteos para administrar" description="Aquí aparecen los sorteos de tus grupos (en curso y de los últimos 30 días), los detecte EFAAT o los publiques desde el panel." />;
    }

    return (
        <div className={styles.lista}>

            {resultado && <p className={`${styles.alerta} ${styles.alertaInfo}`} role="status">{resultado}</p>}

            {sorteos.map(s => {

                const enCurso = s.grupos.filter(g => g.estado === "en_curso");
                const representante = enCurso[0]?.evento_id || s.id;

                return (
                    <Card key={s.identidad || s.id} padding="md" className={styles.tarjeta}>
                        <div className={styles.tarjetaCabecera}>
                            <h3 className={styles.tarjetaTitulo}>{s.nombre || "Sorteo sin nombre"}</h3>
                            <Badge tone={ESTADO[s.estado]?.tono || "neutral"} dot>{ESTADO[s.estado]?.texto || s.estado}</Badge>
                        </div>
                        <div className={styles.meta}>
                            <span>Sorteo: {fechaLegible(s.fecha_evento)} {s.hora_fin || ""}{s.hora_cierre ? ` · cierre ${s.hora_cierre.slice(0, 5)}` : ""}</span>
                            <span>{s.valor ? `$${s.valor.toLocaleString("es-CO")} por número` : "Sin valor"} · {s.reservados} reservado(s) · {s.pagados} pagado(s)</span>
                        </div>

                        {s.grupos.map(g => (
                            <div key={g.evento_id} className={styles.acciones}>
                                <span className={styles.ayuda}>{g.grupo_nombre || g.grupo_id}</span>
                                <Badge tone={ESTADO[g.estado]?.tono || "neutral"}>{ESTADO[g.estado]?.texto || g.estado}</Badge>
                                {g.estado === "en_curso" ? (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={() => abrir({ sorteo: s, eventoId: g.evento_id, grupoNombre: g.grupo_nombre, accion: "cerrar", alcance: "grupo" })}>Cerrar aquí</Button>
                                        <Button size="sm" variant="ghost" onClick={() => abrir({ sorteo: s, eventoId: g.evento_id, grupoNombre: g.grupo_nombre, accion: "desactivar", alcance: "grupo" })}>Desactivar aquí</Button>
                                    </>
                                ) : g.estado !== "cancelado" && (
                                    <Button size="sm" variant="ghost" onClick={() => abrir({ sorteo: s, eventoId: g.evento_id, grupoNombre: g.grupo_nombre, accion: "reabrir", alcance: "grupo" })}>Reabrir aquí</Button>
                                )}
                            </div>
                        ))}

                        <div className={styles.acciones}>
                            {enCurso.length > 0 && <Button size="sm" variant="secondary" onClick={() => onEditar(representante)}>Editar</Button>}
                            {enCurso.length > 1 && <Button size="sm" variant="secondary" onClick={() => abrir({ sorteo: s, eventoId: representante, grupoNombre: null, accion: "desactivar", alcance: "todos" })}>Desactivar en todos</Button>}
                            {enCurso.length > 1 && <Button size="sm" variant="secondary" onClick={() => abrir({ sorteo: s, eventoId: representante, grupoNombre: null, accion: "cerrar", alcance: "todos" })}>Cerrar en todos</Button>}
                            {s.estado !== "cancelado" && <Button size="sm" variant="danger" onClick={() => abrir({ sorteo: s, eventoId: representante, grupoNombre: null, accion: "cancelar", alcance: "todos" })}>Cancelar sorteo</Button>}
                            <Button size="sm" variant="ghost" onClick={() => abrir({ sorteo: s, eventoId: representante, grupoNombre: null, accion: "eliminar", alcance: "todos" })}>Eliminar</Button>
                        </div>
                    </Card>
                );

            })}

            {pendiente && (
                <Modal
                    open
                    onClose={() => setPendiente(null)}
                    title={TITULO[pendiente.accion]}
                    description={`${pendiente.sorteo.nombre || "Sorteo"} · ${pendiente.alcance === "grupo" ? `solo en ${pendiente.grupoNombre || "este grupo"}` : "en todos sus grupos"}`}
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setPendiente(null)} disabled={enviando}>Volver</Button>
                            <Button variant={pendiente.accion === "cancelar" || pendiente.accion === "eliminar" ? "danger" : "primary"} onClick={confirmar} loading={enviando}>Confirmar</Button>
                        </>
                    }
                >
                    <div className={styles.stack}>
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
                        {errorAccion && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{errorAccion}</p>}
                    </div>
                </Modal>
            )}

        </div>
    );

}
