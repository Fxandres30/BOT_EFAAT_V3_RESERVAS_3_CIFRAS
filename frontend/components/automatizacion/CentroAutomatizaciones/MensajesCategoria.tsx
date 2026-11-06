"use client";

import { useEffect, useId, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { avisar } from "@/components/ui/Avisos";
import { useAccionesPorClave } from "@/hooks/useAccion";

import {
    AutomationMessage,
    actualizarMensaje,
    crearMensaje,
    duplicarMensaje,
    eliminarMensaje,
    listarMensajes
} from "@/services/automatizacion/mensajesAutomation";
import { CATEGORIAS_AUTOMATIZACION, TIPOS_AUTOMATIZACION, nombreCategoria } from "@/services/automatizacion/tiposCategorias";
import { VARIABLES_AUTOMATIZACION, validarTextoMensaje, vistaPreviaMensaje } from "@/services/automatizacion/centroAutomatizaciones";

import styles from "./CentroAutomatizaciones.module.css";

// Textos del pool (automation_messages). El Scheduler elige al azar uno
// ACTIVO del tipo y la categoría de cada programación (messageSelector.js).
// Los textos son de la cuenta, no de un grupo: editar uno cambia lo que
// reciben todos los grupos que usan esa categoría. Los globales (de EFAAT)
// no se pueden editar (RLS de 007): se ofrece crear una copia propia.

interface Props {
    usuarioId: string;
    tipoInicial: string;
    categoriaInicial: string | null;
}

interface Borrador {
    id: string | null; // null = nuevo
    nombre: string;
    texto: string;
}

const TODAS = "__todas__";

export default function MensajesCategoria({ usuarioId, tipoInicial, categoriaInicial }: Props) {

    const [tipo, setTipo] = useState(tipoInicial);
    const [categoria, setCategoria] = useState<string>(categoriaInicial ?? TODAS);

    const [borrador, setBorrador] = useState<Borrador | null>(null);
    const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null);
    const idTexto = useId();

    const acciones = useAccionesPorClave();

    // Recarga por tipo sin setState síncrono en el efecto: la lista vale
    // para el tipo con el que se pidió.
    const [cargada, setCargada] = useState<{ tipo: string; mensajes: AutomationMessage[]; error: string | null } | null>(null);

    useEffect(() => {

        let vigente = true;

        listarMensajes(usuarioId, { tipo }).then(({ data, error: errorLista }) => {
            if (!vigente) return;
            setCargada({ tipo, mensajes: errorLista ? [] : ((data as AutomationMessage[]) || []), error: errorLista ? "No pudimos cargar los mensajes." : null });
        });

        return () => { vigente = false; };

    }, [usuarioId, tipo]);

    const mensajes = cargada?.tipo === tipo ? cargada.mensajes : null;
    const error = cargada?.tipo === tipo ? cargada.error : null;

    function setMensajes(cambio: (prev: AutomationMessage[] | null) => AutomationMessage[]) {
        setCargada((prev) => (prev ? { ...prev, mensajes: cambio(prev.mensajes) } : prev));
    }

    const visibles = (mensajes || []).filter((m) => categoria === TODAS || (m.categoria ?? "") === categoria);
    const activosVisibles = visibles.filter((m) => m.activo).length;

    function reemplazar(m: AutomationMessage) {
        setMensajes((prev) => (prev || []).map((x) => (x.id === m.id ? m : x)));
    }

    async function alternar(m: AutomationMessage) {

        const r = await acciones.ejecutar(m.id, () => actualizarMensaje(m.id, { activo: !m.activo }));

        if (!r) return;

        if (r.valor.error || !r.valor.data) {
            avisar.error("No se pudo cambiar el estado del mensaje.");
            return;
        }

        reemplazar(r.valor.data as AutomationMessage);
        avisar.ok(m.activo ? "Mensaje desactivado: ya no se elegirá para nuevos envíos." : "Mensaje activado.");

    }

    async function copiar(m: AutomationMessage) {

        const r = await acciones.ejecutar(`copia:${m.id}`, () => duplicarMensaje(usuarioId, m));

        if (!r) return;

        if (r.valor.error || !r.valor.data) {
            avisar.error("No se pudo crear la copia.");
            return;
        }

        setMensajes((prev) => [r.valor.data as AutomationMessage, ...(prev || [])]);
        avisar.ok("Copia propia creada. Ya puedes editarla.");

    }

    async function borrar(m: AutomationMessage) {

        const r = await acciones.ejecutar(m.id, () => eliminarMensaje(m.id));

        setConfirmarBorrar(null);

        if (!r) return;

        if (r.valor.error) {
            avisar.error("No se pudo eliminar el mensaje.");
            return;
        }

        setMensajes((prev) => (prev || []).filter((x) => x.id !== m.id));
        avisar.ok("Mensaje eliminado. El historial de envíos se conserva.");

    }

    const errorBorrador = borrador ? (borrador.nombre.trim() ? validarTextoMensaje(borrador.texto) : "Ponle un nombre interno al mensaje.") : null;

    async function guardarBorrador() {

        if (!borrador || errorBorrador) return;

        const datos = { nombre_interno: borrador.nombre.trim(), texto: borrador.texto.trim() };

        const r = await acciones.ejecutar("borrador", () => borrador.id
            ? actualizarMensaje(borrador.id, datos)
            : crearMensaje(usuarioId, { ...datos, tipo, categoria: categoria === TODAS ? null : categoria || null, activo: true }));

        if (!r) return;

        if (r.valor.error || !r.valor.data) {
            avisar.error(`No se pudo guardar el mensaje (${r.valor.error?.message || "sin respuesta"}).`);
            return;
        }

        const guardado = r.valor.data as AutomationMessage;

        if (borrador.id) reemplazar(guardado);
        else setMensajes((prev) => [guardado, ...(prev || [])]);

        setBorrador(null);
        avisar.ok("Mensaje guardado. Se usará en los próximos envíos.");

    }

    function insertarVariable(nombre: string) {

        if (!borrador) return;

        const area = document.getElementById(idTexto) as HTMLTextAreaElement | null;
        const marca = `{${nombre}}`;
        const inicio = area?.selectionStart ?? borrador.texto.length;
        const fin = area?.selectionEnd ?? borrador.texto.length;

        setBorrador({ ...borrador, texto: borrador.texto.slice(0, inicio) + marca + borrador.texto.slice(fin) });

        requestAnimationFrame(() => {
            area?.focus();
            area?.setSelectionRange(inicio + marca.length, inicio + marca.length);
        });

    }

    function editor() {

        if (!borrador) return null;

        const guardando = acciones.activas.has("borrador");

        return (

            <div className={styles.bloque}>

                <span className={styles.etiqueta}>{borrador.id ? "Editar mensaje" : `Nuevo mensaje · ${TIPOS_AUTOMATIZACION.find((t) => t.id === tipo)?.label} · ${categoria === TODAS ? "sin categoría" : nombreCategoria(categoria || null)}`}</span>

                <input
                    className={styles.inputTexto}
                    placeholder="Nombre interno (solo lo ves tú)"
                    value={borrador.nombre}
                    maxLength={120}
                    onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
                />

                <textarea
                    id={idTexto}
                    className={styles.textarea}
                    placeholder="Escribe el mensaje. Puedes usar emojis y variables."
                    value={borrador.texto}
                    onChange={(e) => setBorrador({ ...borrador, texto: e.target.value })}
                />

                <div className={styles.variables} aria-label="Variables disponibles">
                    {VARIABLES_AUTOMATIZACION.map((v) => (
                        <button key={v.nombre} type="button" className={styles.variable} title={v.descripcion} onClick={() => insertarVariable(v.nombre)}>
                            {`{${v.nombre}}`}
                        </button>
                    ))}
                </div>

                {borrador.texto.trim() && (
                    <div className={styles.vistaPrevia}>
                        <span className={styles.vistaPreviaRotulo}>Vista previa con datos de ejemplo</span>
                        {vistaPreviaMensaje(borrador.texto)}
                    </div>
                )}

                {errorBorrador && (borrador.texto || borrador.nombre) && <p className={styles.textoError}>{errorBorrador}</p>}

                <div className={styles.filaControl}>
                    <span className={styles.nota}>Si el sorteo no tiene el dato de una variable, ese mensaje no se envía.</span>
                    <div className={styles.botonesPie}>
                        <Button size="sm" variant="ghost" onClick={() => setBorrador(null)} disabled={guardando}>Cancelar</Button>
                        <Button size="sm" onClick={guardarBorrador} loading={guardando} disabled={guardando || !!errorBorrador}>Guardar mensaje</Button>
                    </div>
                </div>

            </div>

        );

    }

    return (

        <div className={styles.seccion}>

            <p className={styles.alertaInfo}>
                Los textos son de tu cuenta y se comparten entre todos los grupos que usan la misma categoría.
                En cada envío se elige al azar uno activo, sin repetir el último cuando hay alternativa.
            </p>

            <div className={styles.chips} role="group" aria-label="Tipo de mensaje">
                {TIPOS_AUTOMATIZACION.map((t) => (
                    <button key={t.id} type="button" className={`${styles.chip} ${tipo === t.id ? styles.chipOn : ""}`} onClick={() => { setTipo(t.id); setBorrador(null); }}>
                        {t.icono} {t.label}
                    </button>
                ))}
            </div>

            <select className={styles.selectCorto} value={categoria} onChange={(e) => { setCategoria(e.target.value); setBorrador(null); }} aria-label="Categoría">
                <option value={TODAS}>Todas las categorías</option>
                <option value="">Sin categoría</option>
                {CATEGORIAS_AUTOMATIZACION.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>

            {error && <p className={styles.alertaError}>{error}</p>}

            {mensajes === null ? (
                <p className={styles.nota}>Cargando mensajes…</p>
            ) : (
                <>
                    <div className={styles.filaControl}>
                        <span className={styles.nota}>
                            {visibles.length === 0
                                ? "No hay mensajes en esta selección."
                                : `${visibles.length} mensaje${visibles.length === 1 ? "" : "s"} · ${activosVisibles} activo${activosVisibles === 1 ? "" : "s"}`}
                        </span>
                        {!borrador && (
                            <Button size="sm" variant="secondary" onClick={() => setBorrador({ id: null, nombre: "", texto: "" })}>
                                <Plus size={13} /> Nuevo mensaje
                            </Button>
                        )}
                    </div>

                    {categoria !== TODAS && visibles.length > 0 && activosVisibles === 0 && (
                        <p className={styles.alerta}>Ningún mensaje activo en esta categoría: las programaciones que la usan no enviarán nada.</p>
                    )}

                    {borrador && !borrador.id && editor()}

                    {visibles.map((m) => {

                        const propio = m.usuario_id === usuarioId;
                        const ocupado = acciones.activas.has(m.id);

                        if (borrador?.id === m.id) return <div key={m.id}>{editor()}</div>;

                        return (

                            <div key={m.id} className={styles.mensaje}>

                                <div className={styles.mensajeCabecera}>
                                    <span className={styles.mensajeNombre} title={m.nombre_interno}>{m.nombre_interno}</span>
                                    <Badge size="sm" tone={propio ? "primary" : "neutral"}>{propio ? "Propio" : "EFAAT"}</Badge>
                                    <Badge size="sm" tone="neutral">{nombreCategoria(m.categoria)}</Badge>
                                    {propio ? (
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={m.activo}
                                            aria-label={m.activo ? "Desactivar mensaje" : "Activar mensaje"}
                                            className={`${styles.switch} ${m.activo ? styles.switchOn : ""}`}
                                            disabled={ocupado}
                                            onClick={() => alternar(m)}
                                        />
                                    ) : (
                                        <Badge size="sm" tone={m.activo ? "success" : "neutral"}>{m.activo ? "Activo" : "Inactivo"}</Badge>
                                    )}
                                </div>

                                <p className={styles.mensajeTexto}>{m.texto}</p>

                                <div className={styles.cardAcciones}>
                                    {propio ? (
                                        <>
                                            <button type="button" className={styles.accion} onClick={() => setBorrador({ id: m.id, nombre: m.nombre_interno, texto: m.texto })} disabled={ocupado}>
                                                <Pencil size={13} /> Editar
                                            </button>
                                            <button type="button" className={styles.accion} onClick={() => copiar(m)} disabled={acciones.activas.has(`copia:${m.id}`)}>
                                                <Copy size={13} /> Duplicar
                                            </button>
                                            {confirmarBorrar === m.id ? (
                                                <>
                                                    <span className={styles.textoError}>¿Eliminar este mensaje?</span>
                                                    <button type="button" className={`${styles.accion} ${styles.accionPeligro}`} onClick={() => borrar(m)} disabled={ocupado}>Sí, eliminar</button>
                                                    <button type="button" className={styles.accion} onClick={() => setConfirmarBorrar(null)}>No</button>
                                                </>
                                            ) : (
                                                <button type="button" className={`${styles.accion} ${styles.accionPeligro}`} onClick={() => setConfirmarBorrar(m.id)} disabled={ocupado}>
                                                    <Trash2 size={13} /> Eliminar
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <button type="button" className={styles.accion} onClick={() => copiar(m)} disabled={acciones.activas.has(`copia:${m.id}`)}>
                                            <Copy size={13} /> Crear copia propia para editar
                                        </button>
                                    )}
                                </div>

                            </div>

                        );

                    })}
                </>
            )}

        </div>

    );

}
