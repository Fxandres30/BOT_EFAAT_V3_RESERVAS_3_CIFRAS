"use client";

import { useEffect, useState } from "react";

import { Modal, Button, Badge } from "@/components/ui";
import TablaImprimible from "@/components/tablas/TablaImprimible";
import { apiSorteos, describirError, type EstadoPublicacion, type VistaPrevia } from "@/services/sorteos/apiSorteos";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

interface Props {
    sorteoId: string | null;
    onClose: () => void;
    onConfirmado: () => void;
}

const fechaLegible = (yyyyMmDd: string) => yyyyMmDd.split("-").reverse().join("/");

// Estado de la publicación EN SU FECHA (no hoy): el backend decide los
// conflictos con la fecha real de publicación y del sorteo existente.
const ESTADO_PUBLICACION: Record<EstadoPublicacion, { texto: string; tono: "success" | "primary" | "error"; detalle: string }> = {
    listo: { texto: "Listo para publicar", tono: "success", detalle: "Nada pendiente: se publicará a la hora indicada." },
    programado: { texto: "Programado", tono: "primary", detalle: "Se publicará a su hora, cuando el sorteo actual ya haya cerrado. El sorteo actual no se modifica." },
    bloqueado: { texto: "Bloqueado por un conflicto real", tono: "error", detalle: "Hay un conflicto que seguirá existiendo en la fecha de publicación (ver abajo)." }
};

// Orden fijo: fecha y hora -> tabla (la MISMA que la imagen de WhatsApp) ->
// anuncio -> cuentas -> grupos -> advertencias y validaciones. Los botones
// van en el pie del modal, que no se desplaza: la tabla tiene su propio
// scroll y nunca los oculta.
export default function VistaPreviaModal({ sorteoId, onClose, onConfirmado }: Props) {

    const [vista, setVista] = useState<VistaPrevia | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revisado, setRevisado] = useState(false);
    const [reinicioConfirmado, setReinicioConfirmado] = useState(false);
    const [confirmando, setConfirmando] = useState(false);

    // La página remonta este modal (key) por cada sorteo: el estado empieza
    // limpio sin reiniciarlo dentro del efecto.
    useEffect(() => {

        if (!sorteoId) return;

        async function cargar(id: string) {
            const r = await apiSorteos.vistaPrevia(id);
            if (r.ok) setVista(r.data);
            else setError(describirError(r));
        }

        cargar(sorteoId);

    }, [sorteoId]);

    // Solo hay algo que confirmar si el reinicio es posible Y libera números.
    const conReinicio = !!vista?.reinicio?.posible && (vista?.reinicio?.liberables || 0) > 0;
    // Reinicio al publicar (el sorteo actual cierra antes): también se confirma.
    const reinicioDiferido = !!vista?.reinicio?.diferido;
    const pideConfirmarReinicio = conReinicio || reinicioDiferido;

    async function confirmar() {

        if (!vista) return;

        setConfirmando(true);
        setError(null);

        const r = await apiSorteos.confirmar(
            vista.id,
            vista.version,
            conReinicio
                ? { confirmado: reinicioConfirmado, huella: vista.reinicio?.huella || null }
                : reinicioDiferido ? { confirmado: reinicioConfirmado, huella: null, diferido: true } : undefined
        );

        setConfirmando(false);

        if (!r.ok) {
            setError([describirError(r), ...(r.bloqueos || []), ...(r.errores || []).map(e => e.mensaje)].join(" "));
            return;
        }

        onConfirmado();

    }

    return (
        <Modal
            open={!!sorteoId}
            onClose={onClose}
            size="lg"
            title="Vista previa"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={confirmando}>Cerrar</Button>
                    {vista?.estado === "borrador" && (
                        <Button onClick={confirmar} loading={confirmando} disabled={!vista.puede_confirmar || !revisado || (pideConfirmarReinicio && !reinicioConfirmado)}>
                            {conReinicio ? "Reiniciar tabla y programar" : "Confirmar y programar"}
                        </Button>
                    )}
                </>
            }
        >
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}
                {!vista && !error && <p className={styles.ayuda}>Cargando vista previa…</p>}

                {vista && (
                    <>
                        <div className={`${styles.alerta} ${vista.estado_publicacion === "bloqueado" ? styles.alertaError : styles.alertaInfo}`} role="status" aria-label="Estado de la publicación">
                            <Badge tone={ESTADO_PUBLICACION[vista.estado_publicacion].tono} dot>{ESTADO_PUBLICACION[vista.estado_publicacion].texto}</Badge>
                            <p>{ESTADO_PUBLICACION[vista.estado_publicacion].detalle}</p>
                        </div>

                        <section className={styles.seccion} aria-label="Fecha y hora">
                            <h3 className={styles.seccionTitulo}>Publicación</h3>
                            <p>
                                Se publica el <b>{mostrarFecha(vista.publicar_en)}</b> (hora de Colombia).
                                {" "}Sorteo: <b>{fechaLegible(vista.fecha_sorteo)} a las {vista.hora_fin}</b>
                                {vista.hora_cierre ? <> · cierre de reservas {vista.hora_cierre}</> : null}.
                            </p>
                        </section>

                        <section className={styles.seccion} aria-label="Tabla de números">
                            <h3 className={styles.seccionTitulo}>
                                Tabla de números · {vista.diseno.config ? (vista.diseno.nombre || "diseño actual de la tabla") : "diseño por defecto"}
                                {conReinicio ? " · como quedará tras el reinicio" : ""}
                            </h3>
                            <div className={styles.tablaVista}>
                                <TablaImprimible
                                    numerosDisponibles={vista.numeros.numerosDisponibles}
                                    numerosOcupados={vista.numeros.numerosOcupados}
                                    diseno={vista.diseno.config}
                                />
                            </div>
                            <p className={styles.ayuda}>Es la misma tabla, con el mismo estilo, que se comparte como imagen en WhatsApp.</p>
                        </section>

                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Anuncio que se publicará</h3>
                            <pre className={styles.mensaje}>{vista.publicacion}</pre>
                        </section>

                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Cuentas de pago de este sorteo</h3>
                            {vista.cuentas.length === 0
                                ? <p className={styles.ayuda}>Ninguna seleccionada.</p>
                                : <ul>{vista.cuentas.map(c => <li key={c.id}>{c.nombre} · {c.numero}{c.titular ? ` · ${c.titular}` : ""}</li>)}</ul>}
                        </section>

                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Grupos</h3>
                            <ul className={styles.grupos}>
                                {vista.grupos.map(g => (
                                    <li key={g.grupo_id} className={styles.grupo}>
                                        <Badge tone={ESTADO_PUBLICACION[g.estado_previo].tono} dot>{ESTADO_PUBLICACION[g.estado_previo].texto}</Badge>
                                        {g.nombre || g.grupo_id}
                                        {g.motivo && <span className={g.bloqueo ? styles.error : styles.ayuda}>{g.motivo}</span>}
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {vista.reinicio && (
                            <section className={styles.seccion} aria-label="Reinicio de la tabla">
                                <h3 className={styles.seccionTitulo}>Reinicio de la tabla</h3>
                                {vista.reinicio.diferido ? (
                                    <p>
                                        Hoy la tabla tiene números del sorteo actual, que cierra el <b>{mostrarFecha(vista.reinicio.cierra_antes || "")}</b>.
                                        {" "}No se tocan ahora: al publicar ({mostrarFecha(vista.publicar_en)}) se archivarán (no se borran) los de sorteos ya terminados y la tabla quedará libre.
                                        {" "}Si en ese momento el sorteo sigue abierto, la publicación espera.
                                    </p>
                                ) : vista.reinicio.posible ? (
                                    vista.reinicio.liberables > 0 ? (
                                        <>
                                            <p>Se archivarán (no se borran) y quedarán libres {vista.reinicio.liberables} número(s):</p>
                                            <ul>{vista.reinicio.se_liberarian.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                        </>
                                    ) : <p className={styles.ayuda}>La tabla ya está libre: el reinicio no modificará nada.</p>
                                ) : (
                                    <p className={styles.ayuda}>No se puede reiniciar (ver los bloqueos de abajo). No se modificará nada.</p>
                                )}
                                {(vista.reinicio.se_conservan || []).map((t, i) => <p key={i} className={styles.ayuda}>{t}</p>)}
                                {vista.reinicio.liberar_bloqueados && <p className={styles.ayuda}>Elegiste liberar también los números bloqueados a mano.</p>}
                                {vista.estado === "borrador" && pideConfirmarReinicio && (
                                    <label className={styles.check}>
                                        <input type="checkbox" checked={reinicioConfirmado} onChange={e => setReinicioConfirmado(e.target.checked)} />
                                        {reinicioDiferido ? "Confirmo que la tabla se reinicie al publicar." : "Confirmo que se archiven y liberen estos números."}
                                    </label>
                                )}
                            </section>
                        )}

                        {vista.bloqueos.length > 0 && (
                            <div className={`${styles.alerta} ${styles.alertaError}`}>
                                <strong>No se puede programar todavía:</strong>
                                <ul>{vista.bloqueos.map((b, i) => <li key={i}>{b}</li>)}</ul>
                            </div>
                        )}

                        {vista.avisos.length > 0 && (
                            <div className={`${styles.alerta} ${styles.alertaAviso}`}>
                                <ul>{vista.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
                            </div>
                        )}

                        {vista.tabla && (
                            <p className={styles.ayuda}>
                                Tabla de números: {vista.tabla.presentes}/{vista.tabla.esperados} números
                                {vista.tabla.retenidos ? ` · ${vista.tabla.retenidos} bloqueados o en proceso` : ""}
                            </p>
                        )}

                        {vista.recordatorios.length > 0 && (
                            <section className={styles.seccion}>
                                <h3 className={styles.seccionTitulo}>Recordatorios</h3>
                                {vista.recordatorios.map((r, i) => (
                                    <div key={i}>
                                        <p className={styles.ayuda}>{r.minutos_antes_cierre} min antes del cierre</p>
                                        <pre className={styles.mensaje}>{r.texto}</pre>
                                    </div>
                                ))}
                            </section>
                        )}

                        {vista.aviso_cierre && (
                            <section className={styles.seccion}>
                                <h3 className={styles.seccionTitulo}>Aviso al cerrar</h3>
                                <pre className={styles.mensaje}>{vista.aviso_cierre}</pre>
                            </section>
                        )}

                        {vista.estado === "borrador" && vista.puede_confirmar && (
                            <label className={styles.check}>
                                <input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} />
                                Revisé la fecha, la tabla, el anuncio, las cuentas, los grupos, los premios y el valor.
                            </label>
                        )}
                    </>
                )}

            </div>
        </Modal>
    );

}
