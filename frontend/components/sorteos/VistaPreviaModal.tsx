"use client";

import { useEffect, useRef, useState } from "react";

import { Modal, Button, Badge } from "@/components/ui";
import TablaImprimible from "@/components/tablas/TablaImprimible";
import { apiSorteos, describirError, type EstadoPublicacion, type ResultadoPublicacionInmediata, type VistaPrevia } from "@/services/sorteos/apiSorteos";
import { motivoNoPublicable, resumenDesdeSorteo, textoResultado, type PruebaImagen } from "@/services/sorteos/sorteoInstantaneo";
import { ESTADO_GRUPO } from "@/services/sorteos/estadosSorteo";
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

// «Sorteo instantáneo»: se publica al confirmar, no «a su hora».
const ESTADO_INMEDIATO: Record<EstadoPublicacion, { texto: string; tono: "success" | "primary" | "error"; detalle: string }> = {
    listo: { texto: "Listo para publicar ahora", tono: "success", detalle: "Se publicará en los grupos en el momento en que pulses «Publicar ahora»." },
    programado: { texto: "No se puede publicar ahora", tono: "error", detalle: "Algún grupo tiene otro sorteo abierto. Marca «Sustituir el sorteo activo» en el formulario, ciérralo desde «Administrar» o prográmalo para después." },
    bloqueado: { texto: "Bloqueado por un conflicto real", tono: "error", detalle: "Hay un conflicto que impide publicar (ver abajo)." }
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
    // Sorteo instantáneo: imagen generada por el SERVIDOR y resultado real.
    const [imagen, setImagen] = useState<PruebaImagen>({ tipo: "probando" });
    const [intentoImagen, setIntentoImagen] = useState(0);
    const [resultado, setResultado] = useState<ResultadoPublicacionInmediata | null>(null);
    // Bloqueo síncrono: dos clics seguidos no lanzan dos publicaciones.
    const publicandoRef = useRef(false);

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

    const inmediato = vista?.publicacion_inmediata === true;
    const idInmediato = inmediato && vista?.estado === "borrador" ? vista.id : null;

    // La imagen que se enviará, generada en el servidor con la misma función
    // que la publicación: si falla aquí, fallaría al publicar.
    useEffect(() => {
        if (!idInmediato) return;
        let vigente = true;
        apiSorteos.imagenPrueba(idInmediato).then(r => {
            if (!vigente) return;
            setImagen(r.ok ? { tipo: "ok", imagen: r.data.imagen } : { tipo: "error", mensaje: r.mensaje || describirError(r) });
        });
        return () => { vigente = false; };
    }, [idInmediato, intentoImagen]);

    async function publicarAhora() {

        if (!vista || publicandoRef.current) return;
        publicandoRef.current = true;
        setConfirmando(true);
        setError(null);

        const r = await apiSorteos.publicarAhora(vista.id, vista.version, vista.reinicio?.al_publicar ? { confirmado: reinicioConfirmado } : undefined);

        if (r.ok) {
            setResultado(r.data);
        } else if (r.motivo === "tiempo_agotado" || r.motivo === "backend_no_disponible") {
            // Sin respuesta: pudo publicarse. Se lee el estado real.
            const s = await apiSorteos.obtener(vista.id);
            if (s.ok && s.data.estado !== "borrador") setResultado(resumenDesdeSorteo(s.data));
            else setError(describirError(r));
        } else {
            setError([r.mensaje || describirError(r), ...(r.bloqueos || []), ...(r.errores || []).map(e => e.mensaje)].join(" "));
        }

        setConfirmando(false);
        publicandoRef.current = false;

    }

    // Estado del sorteo en la cabecera: «a su hora» o «ahora» (instantáneo).
    const estadoVista = vista
        ? inmediato ? ESTADO_INMEDIATO[vista.estado_publicacion] : ESTADO_PUBLICACION[vista.estado_publicacion]
        : null;

    // «Reiniciar la tabla antes de publicar»: programar nunca toca la tabla;
    // se confirma que el publicador la reinicie al publicar (revalidándola).
    const pideConfirmarReinicio = !!vista?.reinicio?.al_publicar;

    async function confirmar() {

        if (!vista) return;

        setConfirmando(true);
        setError(null);

        const r = await apiSorteos.confirmar(
            vista.id,
            vista.version,
            pideConfirmarReinicio ? { confirmado: reinicioConfirmado } : undefined
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
            title={inmediato ? "Sorteo instantáneo · vista previa" : "Vista previa"}
            footer={
                <>
                    <Button variant="secondary" onClick={resultado ? onConfirmado : onClose} disabled={confirmando}>Cerrar</Button>
                    {inmediato && vista?.estado === "borrador" && !resultado && (
                        <Button onClick={publicarAhora} loading={confirmando} disabled={!!motivoNoPublicable(vista, { revisado, reinicioConfirmado, imagen })} title={motivoNoPublicable(vista, { revisado, reinicioConfirmado, imagen }) || undefined}>
                            {confirmando ? "Enviando…" : "Publicar ahora"}
                        </Button>
                    )}
                    {!inmediato && vista?.estado === "borrador" && (
                        <Button onClick={confirmar} loading={confirmando} disabled={!vista.puede_confirmar || !revisado || (pideConfirmarReinicio && !reinicioConfirmado)}>
                            Confirmar y programar
                        </Button>
                    )}
                </>
            }
        >
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}
                {!vista && !error && <p className={styles.ayuda}>Cargando vista previa…</p>}

                {resultado && (
                    <section className={styles.seccion} aria-label="Resultado de la publicación">
                        <h3 className={styles.seccionTitulo}>Resultado</h3>
                        <p className={`${styles.alerta} ${resultado.publicados === resultado.grupos.length ? styles.alertaInfo : styles.alertaAviso}`} role="status">{textoResultado(resultado)}</p>
                        <ul className={styles.grupos}>
                            {resultado.grupos.map(g => (
                                <li key={g.grupo_id} className={styles.grupo}>
                                    <Badge tone={ESTADO_GRUPO[g.estado].tono} dot>{ESTADO_GRUPO[g.estado].texto}</Badge>
                                    {g.nombre || g.grupo_id}
                                    {g.error && g.estado !== "publicado" && <span className={g.estado === "fallido" ? styles.error : styles.ayuda}>{g.error}</span>}
                                </li>
                            ))}
                        </ul>
                        <p className={styles.ayuda}>Sigue su estado y adminístralo en Sorteos (pestañas «Programados» y «Administrar»).</p>
                    </section>
                )}

                {vista && !resultado && (
                    <>
                        <div className={`${styles.alerta} ${vista.estado_publicacion === "listo" || (!inmediato && vista.estado_publicacion === "programado") ? styles.alertaInfo : styles.alertaError}`} role="status" aria-label="Estado de la publicación">
                            <Badge tone={estadoVista!.tono} dot>{estadoVista!.texto}</Badge>
                            <p>{estadoVista!.detalle}</p>
                        </div>

                        <section className={styles.seccion} aria-label="Fecha y hora">
                            <h3 className={styles.seccionTitulo}>Publicación</h3>
                            <p>
                                {inmediato
                                    ? <>Se publica <b>en el momento en que pulses «Publicar ahora»</b>.</>
                                    : <>Se publica el <b>{mostrarFecha(vista.publicar_en)}</b> (hora de Colombia).</>}
                                {" "}Sorteo: <b>{fechaLegible(vista.fecha_sorteo)} a las {vista.hora_fin}</b>
                                {vista.hora_cierre ? <> · cierre de reservas {vista.hora_cierre}</> : null}.
                            </p>
                        </section>

                        <section className={styles.seccion} aria-label="Tabla de números">
                            <h3 className={styles.seccionTitulo}>
                                Tabla de números · {vista.diseno.config ? (vista.diseno.nombre || "diseño actual de la tabla") : "diseño por defecto"}
                                {pideConfirmarReinicio ? " · como quedará al publicar" : ""}
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

                        {inmediato && vista.estado === "borrador" && (
                            <section className={styles.seccion} aria-label="Imagen que se enviará">
                                <h3 className={styles.seccionTitulo}>Imagen que se enviará (generada por el servidor)</h3>
                                {imagen.tipo === "probando" && <p className={styles.ayuda} role="status">Generando la imagen en el servidor… puede tardar unos segundos.</p>}
                                {imagen.tipo === "ok" && (
                                    <div className={styles.tablaVista}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={imagen.imagen} alt="Imagen de la tabla que se enviará por WhatsApp" className={styles.imagenServidor} />
                                    </div>
                                )}
                                {imagen.tipo === "error" && (
                                    <div className={`${styles.alerta} ${styles.alertaError}`} role="alert">
                                        <p>{imagen.mensaje}</p>
                                        <p>Sin imagen no se publica (no se envía el texto solo).</p>
                                        <Button size="sm" variant="secondary" onClick={() => { setImagen({ tipo: "probando" }); setIntentoImagen(n => n + 1); }}>Volver a probar</Button>
                                    </div>
                                )}
                            </section>
                        )}

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

                        {vista.tabla_al_publicar && !vista.tabla_al_publicar.reiniciar && (
                            <section className={styles.seccion} aria-label="Tabla al publicar">
                                <h3 className={styles.seccionTitulo}>Tabla al publicar</h3>
                                <p><b>Conservar la tabla actual.</b> No se reiniciará ni al programar ni al publicar.</p>
                            </section>
                        )}

                        {vista.reinicio && (
                            <section className={styles.seccion} aria-label="Tabla al publicar">
                                <h3 className={styles.seccionTitulo}>Tabla al publicar</h3>
                                <p>
                                    <b>Reiniciar la tabla antes de publicar.</b>
                                    {vista.tabla_al_publicar?.reiniciado_en
                                        ? <> Ya se reinició el {mostrarFecha(vista.tabla_al_publicar.reiniciado_en)}.</>
                                        : <> Programar no modifica ningún número: el reinicio se hace al publicar ({mostrarFecha(vista.publicar_en)}), después de volver a validar la tabla. Si en ese momento hay reservas nuevas, pagos en proceso o un sorteo activo, no se reinicia ni se publica el anuncio.</>}
                                </p>
                                {vista.reinicio.diferido ? (
                                    <p>
                                        Hoy la tabla tiene números del sorteo actual, que cierra el <b>{mostrarFecha(vista.reinicio.cierra_antes || "")}</b>.
                                        {" "}Al publicar se archivarán (no se borran) los de sorteos ya terminados y la tabla quedará libre.
                                        {" "}Si en ese momento el sorteo sigue abierto, la publicación espera.
                                    </p>
                                ) : vista.reinicio.posible ? (
                                    vista.reinicio.liberables > 0 ? (
                                        <>
                                            <p>Con la tabla de hoy, al publicar se archivarían (no se borran) y quedarían libres {vista.reinicio.liberables} número(s):</p>
                                            <ul>{vista.reinicio.se_liberarian.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                        </>
                                    ) : <p className={styles.ayuda}>Hoy la tabla ya está libre; al publicar se volverá a revisar.</p>
                                ) : (
                                    <p className={styles.ayuda}>No se puede reiniciar (ver los bloqueos de abajo). No se modificará nada.</p>
                                )}
                                {(vista.reinicio.se_conservan || []).map((t, i) => <p key={i} className={styles.ayuda}>{t}</p>)}
                                {vista.reinicio.liberar_bloqueados && <p className={styles.ayuda}>Elegiste liberar también los números bloqueados a mano.</p>}
                                {vista.estado === "borrador" && pideConfirmarReinicio && (
                                    <label className={styles.check}>
                                        <input type="checkbox" checked={reinicioConfirmado} onChange={e => setReinicioConfirmado(e.target.checked)} />
                                        Confirmo que la tabla se reinicie al publicar, si en ese momento sigue siendo seguro.
                                    </label>
                                )}
                            </section>
                        )}

                        {vista.bloqueos.length > 0 && (
                            <div className={`${styles.alerta} ${styles.alertaError}`}>
                                <strong>{inmediato ? "No se puede publicar:" : "No se puede programar todavía:"}</strong>
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
