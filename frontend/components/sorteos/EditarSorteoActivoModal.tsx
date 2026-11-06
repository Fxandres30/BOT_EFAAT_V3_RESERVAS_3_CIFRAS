"use client";

import { useEffect, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";

import { Modal, Button, Input, Select, IconButton, Badge } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { apiSorteos, describirError, type CambiosGrupos, type CuentaPago, type ErrorCampo, type GrupoAutorizado, type ResultadoGruposNuevos, type SorteoActivo, type SorteoEnGrupos, type VistaPrevia } from "@/services/sorteos/apiSorteos";
import { useCapturaSorteo } from "./capturaSorteo";
import { BotonesSorteo, ConfirmarAccionSorteo, type AccionPendiente } from "./AccionesSorteo";
import { listarDisenos } from "@/services/tablas/disenos";
import { TABLA_DISENO_PRESETS } from "@/services/tablas/disenoDefaults";
import type { TablaDiseno } from "@/components/tablas/disenoTypes";
import { disenoAForm, formADiseno, type PremioForm } from "./FormularioSorteo";
import SelectorMensaje, { type ValorMensaje } from "./SelectorMensaje";
import styles from "./Sorteos.module.css";

interface Props {
    /** Evento (eventos_bot.id) del sorteo activo: se abre y se guarda por él. */
    eventoId: string;
    onClose: () => void;
    onGuardado?: (sorteo: SorteoActivo) => void;
}

type Carga =
    | { tipo: "cargando" }
    | { tipo: "error"; mensaje: string }
    | { tipo: "ok"; sorteo: SorteoActivo };

const fechaLegible = (f: string | null) => (f ? f.split("-").reverse().join("/") : "—");

// Edición del sorteo ACTIVO de una tabla, lo haya detectado el bot o creado
// el panel. Se piden al backend sus datos reales (solo si son del usuario de
// la sesión) y se guarda sobre el MISMO evento y sus grupos. Los campos que
// no se pueden cambiar con el sorteo en curso se muestran bloqueados con el
// motivo; nada de esto toca reservas, pagos ni envía mensajes.
export default function EditarSorteoActivoModal({ eventoId, onClose, onGuardado }: Props) {

    const [carga, setCarga] = useState<Carga>({ tipo: "cargando" });
    const [intento, setIntento] = useState(0);
    const [premios, setPremios] = useState<PremioForm[]>([]);
    const [horaCierre, setHoraCierre] = useState("");
    // Identidad del sorteo (lotería, fecha, hora, valor): corregible con
    // confirmación expresa; sus reservas y pagos siguen al sorteo corregido.
    const [nombre, setNombre] = useState("");
    const [fecha, setFecha] = useState("");
    const [horaFin, setHoraFin] = useState("");
    const [valor, setValor] = useState("");
    const [confirmarIdentidad, setConfirmarIdentidad] = useState(false);
    const [cuentasSel, setCuentasSel] = useState<string[]>([]);
    const [diseno, setDiseno] = useState("guardado");
    // Mensaje de publicación tal como está guardado (inicial) y el editado:
    // solo se envía si cambió.
    const [mensaje, setMensaje] = useState<ValorMensaje>({ texto: "", estilo: "", activo: true });
    const [mensajeInicial, setMensajeInicial] = useState<ValorMensaje | null>(null);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [disenos, setDisenos] = useState<TablaDiseno[]>([]);
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    // Cerrar, desactivar, cancelar o eliminar desde aquí (AccionesSorteo).
    const [accion, setAccion] = useState<AccionPendiente | null>(null);
    const [accionHecha, setAccionHecha] = useState<string | null>(null);
    // Grupos (solo sorteos del panel): la MISMA asociación que «Cambiar
    // grupos» de Tablas. Guardar no publica; los nuevos se publican aparte.
    const [gruposSel, setGruposSel] = useState<string[]>([]);
    const [gruposDisponibles, setGruposDisponibles] = useState<GrupoAutorizado[]>([]);
    const [cambiosGrupos, setCambiosGrupos] = useState<{ sorteo: SorteoActivo; cambios: CambiosGrupos } | null>(null);
    const [publicandoNuevos, setPublicandoNuevos] = useState(false);
    const [publicacionNuevos, setPublicacionNuevos] = useState<ResultadoGruposNuevos | null>(null);
    // Imagen para los grupos nuevos: la captura única de un sorteo
    // (capturaSorteo.tsx), con la tabla de este momento.
    const [vistaCaptura, setVistaCaptura] = useState<VistaPrevia | null>(null);
    const capturaNuevos = useCapturaSorteo(vistaCaptura);
    // Sorteo detectado en WhatsApp: pasarlo a gestionarse desde el panel
    // (misma identidad, tabla y reservas) para poder agregar grupos.
    const [vincular, setVincular] = useState<{ cuentas: CuentaPago[]; sel: string[]; enviando: boolean; error: string | null } | null>(null);

    const sorteo = carga.tipo === "ok" ? carga.sorteo : null;

    async function abrirVincular() {
        setVincular({ cuentas: [], sel: [], enviando: false, error: null });
        const c = await apiSorteos.cuentas();
        const activas = c.ok ? c.data.filter(x => x.activa !== false) : [];
        setVincular({ cuentas: activas, sel: activas.map(x => x.id), enviando: false, error: c.ok ? null : describirError(c) });
    }

    async function confirmarVincular() {
        if (!sorteo || !vincular || vincular.enviando) return;
        setVincular({ ...vincular, enviando: true, error: null });
        const r = await apiSorteos.vincularDetectado(sorteo.id, vincular.sel);
        if (!r.ok) {
            setVincular({ ...vincular, enviando: false, error: r.mensaje || r.errores?.map(e => e.mensaje).join(" ") || describirError(r) });
            return;
        }
        // Se vuelve a cargar: ahora es un sorteo del panel con grupos editables.
        setVincular(null);
        setCarga({ tipo: "cargando" });
        setIntento(n => n + 1);
    }

    // El sorteo activo con la forma que usan las acciones de estado: todos
    // sus grupos están en curso (si no, no sería un sorteo activo).
    const enGrupos: SorteoEnGrupos | null = sorteo ? {
        id: sorteo.id,
        identidad: sorteo.identidad ?? null,
        nombre: sorteo.nombre,
        fecha_evento: sorteo.fecha_evento,
        hora_fin: sorteo.hora_fin,
        hora_cierre: sorteo.hora_cierre,
        valor: sorteo.valor,
        estado: "en_curso",
        reservados: sorteo.reservados,
        pagados: sorteo.pagados,
        grupos: sorteo.grupos.map(g => ({ evento_id: g.evento_id, grupo_id: g.grupo_id, grupo_nombre: g.grupo_nombre, estado: "en_curso", abierto_whatsapp: g.abierto }))
    } : null;

    useEffect(() => {

        let vigente = true;

        apiSorteos.obtenerActivo(eventoId).then(async r => {
            if (!vigente) return;
            if (!r.ok) {
                setCarga({ tipo: "error", mensaje: r.mensaje || (r.motivo === "no_encontrado" ? "No encontramos este sorteo activo en tu cuenta (puede que ya haya cerrado)." : describirError(r)) });
                return;
            }
            const s = r.data;
            setPremios(s.premios.length ? s.premios.map(p => ({ nombre: p.nombre, premio: p.premio ? String(p.premio) : "", tipo: p.tipo || "otro" })) : [{ nombre: "", premio: "", tipo: "otro" }]);
            setHoraCierre(s.hora_cierre ? s.hora_cierre.slice(0, 5) : "");
            setNombre(s.nombre || "");
            setFecha(s.fecha_evento || "");
            setHoraFin(s.hora_fin ? s.hora_fin.slice(0, 5) : "");
            setValor(s.valor ? String(s.valor) : "");
            setConfirmarIdentidad(false);
            setCuentasSel(s.cuentas_ids || []);
            setDiseno(s.diseno ? disenoAForm(s.diseno) : "guardado");
            // Panel: el texto que de verdad se publica (en un sorteo antiguo
            // sin texto, la plantilla de su diseño). Detectado: lo escrito.
            const inicial = {
                texto: s.publicacion_texto ?? s.publicacion ?? "",
                estilo: s.publicacion_meta?.estilo || "",
                activo: s.publicacion_meta?.activo !== false
            };
            setMensaje(inicial);
            setMensajeInicial(inicial);
            setGruposSel((s.destinos || []).map(g => g.grupo_id));
            setCarga({ tipo: "ok", sorteo: s });
            if (s.campos.grupos.editable) {
                const g = await apiSorteos.grupos();
                if (vigente && g.ok) setGruposDisponibles(g.data);
            }
            if (s.campos.cuentas.editable) {
                const c = await apiSorteos.cuentas();
                if (vigente && c.ok) setCuentas(c.data.filter(x => x.activa !== false));
            }
            if (s.campos.diseno.editable) {
                const { data } = await supabase.auth.getSession();
                const uid = data.session?.user?.id;
                if (uid) listarDisenos(uid).then(d => { if (vigente) setDisenos(d); }).catch(() => {});
            }
        });

        return () => { vigente = false; };

    }, [eventoId, intento]);

    const errorDe = (campo: string) => errores.filter(e => e.campo === campo).map(e => e.mensaje).join(" ") || undefined;

    // Campos de identidad que el usuario cambió (solo esos se envían).
    const identidadCambiada = sorteo ? {
        ...(nombre.trim() !== (sorteo.nombre || "") ? { nombre: nombre.trim() } : {}),
        ...(fecha !== (sorteo.fecha_evento || "") ? { fecha_evento: fecha } : {}),
        ...(horaFin !== (sorteo.hora_fin ? sorteo.hora_fin.slice(0, 5) : "") ? { hora_fin: horaFin } : {}),
        ...(Number(valor) !== (sorteo.valor || 0) ? { valor: Number(valor) } : {})
    } : {};
    const cambiaIdentidad = Object.keys(identidadCambiada).length > 0;

    const gruposEditables = Boolean(sorteo?.campos.grupos.editable && sorteo.destinos);
    const gruposIniciales = (sorteo?.destinos || []).map(g => g.grupo_id);
    const gruposCambiados = gruposEditables && [...gruposSel].sort().join(",") !== [...gruposIniciales].sort().join(",");
    // Grupos donde el sorteo YA está activo y se van a quitar: se desactivará ahí.
    const seDesactivan = (sorteo?.destinos || []).filter(g => g.estado === "publicado" && !gruposSel.includes(g.grupo_id));

    const mensajeCambiado = Boolean(mensajeInicial) && (mensaje.texto !== mensajeInicial!.texto || mensaje.estilo !== mensajeInicial!.estilo || mensaje.activo !== mensajeInicial!.activo);

    async function guardar() {

        if (!sorteo) return;

        setGuardando(true);
        setErrores([]);
        setError(null);
        setAviso(null);

        const r = await apiSorteos.editarActivo(sorteo.id, {
            ...(cambiaIdentidad ? { ...identidadCambiada, confirmar_identidad: confirmarIdentidad } : {}),
            premios: premios.filter(p => p.nombre.trim()).map(p => ({ nombre: p.nombre, premio: Number(p.premio) || null, tipo: p.tipo })),
            hora_cierre: horaCierre,
            ...(sorteo.campos.cuentas.editable ? { cuentas: cuentasSel } : {}),
            ...(sorteo.campos.diseno.editable && diseno !== "guardado" ? { diseno: formADiseno(diseno, sorteo.diseno) } : {}),
            ...(sorteo.campos.publicacion?.editable && mensajeCambiado ? {
                publicacion: mensaje.texto,
                publicacion_meta: { ...(mensaje.estilo ? { estilo: mensaje.estilo } : {}), ...(sorteo.origen === "panel" ? { activo: mensaje.activo } : {}) }
            } : {}),
            ...(gruposCambiados ? { grupos: gruposSel } : {}),
            base: { premios: sorteo.premios, hora_cierre: sorteo.hora_cierre, ...(sorteo.campos.publicacion ? { publicacion: sorteo.publicacion } : {}) }
        });

        setGuardando(false);

        if (!r.ok) {
            setErrores(r.errores || []);
            setError(r.mensaje || describirError(r));
            return;
        }

        if (r.aviso) { setAviso(r.aviso); return; }
        // Grupos cambiados: se muestra qué pasó y, si hay grupos nuevos de un
        // sorteo ya publicado, «Publicar en los grupos nuevos».
        if (r.data.cambios_grupos) { setCambiosGrupos({ sorteo: r.data, cambios: r.data.cambios_grupos }); return; }
        onGuardado?.(r.data);

    }

    // Con grupos por publicar se prepara la imagen (vista previa del sorteo).
    const programacionId = cambiosGrupos && cambiosGrupos.cambios.por_publicar > 0 ? sorteo?.sorteo_programado_id || null : null;
    useEffect(() => {
        if (!programacionId) return;
        let vigente = true;
        apiSorteos.vistaPrevia(programacionId).then(r => {
            if (!vigente) return;
            if (r.ok) setVistaCaptura(r.data);
            else setError(`No se pudo preparar la imagen de la tabla: ${describirError(r)}`);
        });
        return () => { vigente = false; };
    }, [programacionId]);

    async function publicarNuevos() {
        if (!cambiosGrupos || !sorteo?.sorteo_programado_id || publicandoNuevos || !capturaNuevos.captura) return;
        setPublicandoNuevos(true);
        setError(null);
        const r = await apiSorteos.publicarGruposNuevos(sorteo.sorteo_programado_id, capturaNuevos.captura);
        setPublicandoNuevos(false);
        if (!r.ok) { setError(r.mensaje || describirError(r)); return; }
        setPublicacionNuevos(r.data);
    }

    const nombreGrupo = (id: string) => gruposDisponibles.find(g => g.grupo_id === id)?.nombre || sorteo?.destinos?.find(g => g.grupo_id === id)?.grupo_nombre || id;

    return (
        <Modal
            open
            onClose={onClose}
            size="lg"
            title="Editar sorteo activo"
            description="Cambia lo que se puede cambiar con el sorteo en curso. Las reservas y los pagos conservan sus números, estados e importes, y no se envía ningún mensaje."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    {carga.tipo === "error" && <Button variant="secondary" onClick={() => { setCarga({ tipo: "cargando" }); setIntento(n => n + 1); }}>Reintentar</Button>}
                    {cambiosGrupos ? (
                        <>
                            {cambiosGrupos.cambios.por_publicar > 0 && !publicacionNuevos && (
                                <Button onClick={publicarNuevos} loading={publicandoNuevos} loadingText="Publicando…" disabled={!capturaNuevos.captura}
                                    title={capturaNuevos.imagen.tipo === "error" ? capturaNuevos.imagen.mensaje : capturaNuevos.captura ? undefined : "Preparando la imagen de la tabla…"}>
                                    Publicar en los grupos nuevos
                                </Button>
                            )}
                            <Button variant={cambiosGrupos.cambios.por_publicar > 0 && !publicacionNuevos ? "secondary" : "primary"} disabled={publicandoNuevos} onClick={() => onGuardado?.(cambiosGrupos.sorteo)}>Listo</Button>
                        </>
                    ) : (
                        <Button onClick={guardar} loading={guardando} disabled={!sorteo || Boolean(accionHecha)}>Guardar cambios</Button>
                    )}
                </>
            }
        >
            {/* Copia oculta de la tabla para la imagen de los grupos nuevos. */}
            {capturaNuevos.copiaOculta}
            {capturaNuevos.imagen.tipo === "error" && programacionId && !publicacionNuevos && (
                <p className={styles.error} role="alert">
                    {capturaNuevos.imagen.mensaje} Sin imagen no se publica.{" "}
                    <Button size="sm" variant="secondary" onClick={capturaNuevos.reintentar}>Volver a probar</Button>
                </p>
            )}
            {carga.tipo === "cargando" ? (
                <p className={styles.ayuda} role="status">Cargando el sorteo activo…</p>
            ) : carga.tipo === "error" ? (
                <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudo cargar el sorteo: {carga.mensaje}</p>
            ) : accionHecha ? (
                <p className={`${styles.alerta} ${styles.alertaInfo}`} role="status">{accionHecha}</p>
            ) : cambiosGrupos ? (
                <ResumenGrupos cambios={cambiosGrupos.cambios} publicacion={publicacionNuevos} error={error} nombreGrupo={nombreGrupo} />
            ) : sorteo && (
                <div className={styles.stack}>

                    {enGrupos && (
                        <section className={styles.seccion} aria-label="Estado del sorteo">
                            <h3 className={styles.seccionTitulo}>Estado del sorteo</h3>
                            <p className={styles.ayuda}>Cerrar, desactivar (en un grupo o en todos), cancelar o eliminar. Las reservas y los pagos se conservan.</p>
                            {accion ? (
                                <ConfirmarAccionSorteo
                                    key={`${accion.eventoId}-${accion.accion}-${accion.alcance}`}
                                    pendiente={accion}
                                    onVolver={() => setAccion(null)}
                                    onHecho={m => { setAccion(null); setAccionHecha(m); }}
                                />
                            ) : (
                                <BotonesSorteo sorteo={enGrupos} onAccion={setAccion} />
                            )}
                        </section>
                    )}

                    {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}
                    {aviso && <p className={`${styles.alerta} ${styles.alertaInfo}`}>{aviso}</p>}

                    <div className={`${styles.alerta} ${styles.alertaInfo}`}>
                        <Badge tone={sorteo.origen === "panel" ? "primary" : "neutral"} dot>{sorteo.origen === "panel" ? "Creado desde el panel" : "Detectado en el grupo"}</Badge>
                        {sorteo.reservados === null || sorteo.pagados === null
                            ? <p>No pudimos contar las reservas y pagos en este momento. Guardar no los modifica.</p>
                            : <p>En curso: <b>{sorteo.reservados}</b> reservado(s) y <b>{sorteo.pagados}</b> pagado(s). Guardar no los modifica.</p>}
                    </div>

                    <section className={styles.seccion} aria-label="Datos del sorteo en curso">
                        <h3 className={styles.seccionTitulo}>Datos del sorteo</h3>
                        {sorteo.campos.nombre.editable ? (
                            <>
                                <Input label="Lotería o nombre del sorteo" value={nombre} onChange={e => setNombre(e.target.value)} error={errorDe("nombre")} />
                                <Input label="Fecha del sorteo" type="date" value={fecha} onChange={e => setFecha(e.target.value)} error={errorDe("fecha_evento")} />
                                <Input label="Hora del sorteo" type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} error={errorDe("hora_fin")} />
                                <Input label="Valor por número (COP)" type="number" min={0} value={valor} onChange={e => setValor(e.target.value)} error={errorDe("valor")} />
                                <p className={styles.ayuda}>{sorteo.campos.nombre.motivo}</p>
                                {cambiaIdentidad && (
                                    <label className={styles.check}>
                                        <input type="checkbox" checked={confirmarIdentidad} onChange={e => setConfirmarIdentidad(e.target.checked)} />
                                        Confirmo la corrección: {sorteo.reservados === null || sorteo.pagados === null ? "todas las reservas y pagos" : `las ${sorteo.reservados} reserva(s) y ${sorteo.pagados} pago(s)`} pasan al sorteo corregido en sus {sorteo.grupos.length} grupo(s)
                                    </label>
                                )}
                            </>
                        ) : (
                            <>
                                <Fijo etiqueta="Lotería o nombre del sorteo" valor={sorteo.nombre || "—"} motivo={sorteo.campos.nombre.motivo} />
                                <Fijo etiqueta="Fecha del sorteo" valor={fechaLegible(sorteo.fecha_evento)} motivo={sorteo.campos.fecha_evento.motivo} />
                                <Fijo etiqueta="Hora del sorteo" valor={sorteo.hora_fin || "—"} motivo={sorteo.campos.hora_fin.motivo} />
                                <Fijo etiqueta="Valor por número" valor={sorteo.valor ? `$${sorteo.valor.toLocaleString("es-CO")}` : "—"} motivo={sorteo.campos.valor.motivo} />
                            </>
                        )}
                        <Fijo etiqueta="Tabla de números" valor={`${sorteo.cantidad_numeros || "—"} números`} motivo={sorteo.campos.tabla.motivo} />
                        {!gruposEditables && <Fijo etiqueta="Grupos" valor={sorteo.grupos.map(g => g.grupo_nombre || g.grupo_id).join(" · ") || "—"} motivo={sorteo.campos.grupos.motivo} />}
                    </section>

                    {sorteo.origen === "detectado" && (
                        <section className={styles.seccion} aria-label="Agregar a otros grupos">
                            <h3 className={styles.seccionTitulo}>Agregar este sorteo a otros grupos</h3>
                            <p className={styles.ayuda}>
                                Este sorteo se detectó en WhatsApp. Para llevarlo a otros grupos, pásalo a gestionarse desde el panel: conserva su identidad, su tabla, sus reservas, sus pagos y su historial, y sus grupos actuales no reciben nada. En WhatsApp se sigue comportando igual.
                            </p>
                            {!vincular ? (
                                <div><Button size="sm" variant="secondary" onClick={abrirVincular}>Gestionar desde el panel</Button></div>
                            ) : (
                                <div className={styles.stack}>
                                    <p className={styles.ayuda}>Cuentas de pago que irán en el anuncio de los grupos nuevos:</p>
                                    {vincular.cuentas.map(c => (
                                        <label key={c.id} className={styles.grupo}>
                                            <input type="checkbox" checked={vincular.sel.includes(c.id)} onChange={() => setVincular(v => v && ({ ...v, sel: v.sel.includes(c.id) ? v.sel.filter(x => x !== c.id) : [...v.sel, c.id] }))} />
                                            {c.nombre}
                                        </label>
                                    ))}
                                    {vincular.error && <p className={styles.error} role="alert">{vincular.error}</p>}
                                    <div className={styles.acciones}>
                                        <Button size="sm" variant="ghost" onClick={() => setVincular(null)} disabled={vincular.enviando}>Volver</Button>
                                        <Button size="sm" onClick={confirmarVincular} loading={vincular.enviando} disabled={!vincular.sel.length}>Confirmar: gestionar desde el panel</Button>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {gruposEditables && (
                        <section className={styles.seccion} aria-label="Grupos del sorteo">
                            <h3 className={styles.seccionTitulo}>Grupos</h3>
                            <p className={styles.ayuda}>{sorteo.campos.grupos.motivo}</p>
                            {(gruposDisponibles.length ? gruposDisponibles : (sorteo.destinos || []).map(g => ({ grupo_id: g.grupo_id, nombre: g.grupo_nombre }))).map(g => {
                                const destino = sorteo.destinos?.find(x => x.grupo_id === g.grupo_id);
                                const marcado = gruposSel.includes(g.grupo_id);
                                return (
                                    <label key={g.grupo_id} className={styles.grupo}>
                                        <input type="checkbox" checked={marcado} onChange={() => setGruposSel(sel => sel.includes(g.grupo_id) ? sel.filter(x => x !== g.grupo_id) : [...sel, g.grupo_id])} />
                                        {g.nombre || g.grupo_id}
                                        {destino ? <Badge tone={ESTADO_DESTINO[destino.estado].tono} size="sm">{ESTADO_DESTINO[destino.estado].texto}</Badge>
                                            : marcado ? <Badge tone="primary" size="sm">Nuevo: se publicará al confirmar</Badge> : null}
                                    </label>
                                );
                            })}
                            {errorDe("grupos") && <p className={styles.error} role="alert">{errorDe("grupos")}</p>}
                            {seDesactivan.length > 0 && (
                                <p className={`${styles.alerta} ${styles.alertaAviso}`} role="alert">
                                    Al guardar, el sorteo se DESACTIVA en {seDesactivan.map(g => g.grupo_nombre || g.grupo_id).join(", ")}: ahí deja de recibir reservas y mensajes del sorteo. Sus reservas y pagos se conservan.
                                </p>
                            )}
                        </section>
                    )}

                    <Input
                        label="Cierre de reservas"
                        type="time"
                        value={horaCierre}
                        onChange={e => setHoraCierre(e.target.value)}
                        error={errorDe("hora_cierre")}
                        hint={sorteo.campos.hora_cierre.motivo}
                    />

                    <section className={styles.seccion}>
                        <h3 className={styles.seccionTitulo}>Premios</h3>
                        {errorDe("premios") && <span className={styles.error}>{errorDe("premios")}</span>}
                        {premios.map((p, i) => (
                            <div key={i} className={styles.itemDinamico}>
                                <Input label={i === 0 ? "Premio" : undefined} aria-label="Premio" value={p.nombre} onChange={e => setPremios(premios.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                                <Input label={i === 0 ? "Valor (COP)" : undefined} aria-label="Valor del premio" type="number" min={0} value={p.premio} onChange={e => setPremios(premios.map((x, j) => j === i ? { ...x, premio: e.target.value } : x))} />
                                <IconButton label="Quitar premio" variant="ghost" onClick={() => setPremios(premios.filter((_, j) => j !== i))} disabled={premios.length === 1}><Trash2 size={16} /></IconButton>
                            </div>
                        ))}
                        <div><Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setPremios([...premios, { nombre: "", premio: "", tipo: "otro" }])}>Agregar premio</Button></div>
                    </section>

                    <section className={styles.seccion}>
                        <h3 className={styles.seccionTitulo}>Cuentas de pago</h3>
                        {errorDe("cuentas") && <span className={styles.error}>{errorDe("cuentas")}</span>}
                        {sorteo.campos.cuentas.editable ? (
                            <>
                                {cuentas.map(c => (
                                    <label key={c.id} className={styles.check}>
                                        <input type="checkbox" checked={cuentasSel.includes(c.id)} onChange={() => setCuentasSel(cuentasSel.includes(c.id) ? cuentasSel.filter(x => x !== c.id) : [...cuentasSel, c.id])} />
                                        {c.nombre} · {c.numero}
                                    </label>
                                ))}
                                <p className={styles.ayuda}>{sorteo.campos.cuentas.motivo}</p>
                            </>
                        ) : <p className={styles.ayuda}><Lock size={12} /> {sorteo.campos.cuentas.motivo}</p>}
                    </section>

                    <section className={styles.seccion}>
                        <h3 className={styles.seccionTitulo}>Estilo de la tabla</h3>
                        {sorteo.campos.diseno.editable ? (
                            <Select label="Estilo de la tabla" value={diseno} onChange={e => setDiseno(e.target.value)} error={errorDe("diseno")} hint={sorteo.campos.diseno.motivo}>
                                <option value="guardado">Sin cambios{sorteo.diseno?.nombre ? ` (${sorteo.diseno.nombre})` : ""}</option>
                                <option value="actual">Diseño actual de esta tabla</option>
                                <optgroup label="Predefinidos">
                                    {TABLA_DISENO_PRESETS.map(p => <option key={p.key} value={`preset:${p.key}`}>{p.nombre}</option>)}
                                </optgroup>
                                {disenos.length > 0 && (
                                    <optgroup label="Mis diseños">
                                        {disenos.map(d => <option key={d.id} value={`biblioteca:${d.id}`}>{d.nombre}</option>)}
                                    </optgroup>
                                )}
                            </Select>
                        ) : <p className={styles.ayuda}><Lock size={12} /> {sorteo.campos.diseno.motivo}</p>}
                    </section>

                    {sorteo.campos.publicacion?.editable && (
                        <section className={styles.seccion}>
                            <h3 className={styles.seccionTitulo}>Publicación</h3>
                            <SelectorMensaje
                                valor={mensaje}
                                onChange={setMensaje}
                                error={errorDe("publicacion")}
                                nota={sorteo.campos.publicacion.motivo}
                                // Detectado: el texto es solo informativo (EFAAT no lo publica).
                                permitirActivar={sorteo.origen === "panel"}
                                rellenarVacio={sorteo.origen === "panel"}
                                datos={{
                                    nombre,
                                    hora_fin: horaFin,
                                    hora_cierre: horaCierre || null,
                                    valor: Number(valor) || 0,
                                    premios: premios.filter(p => p.nombre.trim()).map(p => ({ nombre: p.nombre, premio: Number(p.premio) || null, tipo: p.tipo })),
                                    fecha_sorteo: fecha || null,
                                    cuentas: sorteo.campos.cuentas.editable ? cuentasSel : (sorteo.cuentas || []),
                                    cantidad_numeros: sorteo.cantidad_numeros
                                }}
                            />
                        </section>
                    )}

                    <section className={styles.seccion}>
                        <h3 className={styles.seccionTitulo}>Mensajes y recordatorios</h3>
                        {!sorteo.campos.publicacion && sorteo.mensajes?.publicacion && <pre className={styles.mensaje}>{sorteo.mensajes.publicacion}</pre>}
                        {(sorteo.recordatorios || []).map((r, i) => <p key={i} className={styles.ayuda}>{r.minutos_antes_cierre} min antes del cierre: {r.texto}</p>)}
                        <p className={styles.ayuda}><Lock size={12} /> {sorteo.campos.mensajes.motivo}</p>
                    </section>

                </div>
            )}
        </Modal>
    );

}

const ESTADO_DESTINO: Record<string, { texto: string; tono: "neutral" | "primary" | "success" | "warning" | "error" }> = {
    pendiente: { texto: "Por publicar", tono: "warning" },
    publicando: { texto: "Publicando", tono: "warning" },
    publicado: { texto: "Activo", tono: "success" },
    fallido: { texto: "Error", tono: "error" },
    requiere_revision: { texto: "Error", tono: "error" },
    cancelado: { texto: "Quitado", tono: "neutral" }
};

// Qué cambió en los grupos al guardar y, si se publicó en los nuevos, cómo fue cada uno.
function ResumenGrupos({ cambios, publicacion, error, nombreGrupo }: { cambios: CambiosGrupos; publicacion: ResultadoGruposNuevos | null; error: string | null; nombreGrupo: (id: string) => string }) {
    return (
        <div className={styles.stack} role="status">
            <p className={`${styles.alerta} ${styles.alertaInfo}`}>Cambios guardados. Guardar no envió nada a WhatsApp.</p>
            {cambios.agregados.length > 0 && <p>Grupos agregados: <b>{cambios.agregados.map(g => g.nombre || g.grupo_id).join(", ")}</b>.</p>}
            {cambios.quitados.length > 0 && <p>Grupos quitados: <b>{cambios.quitados.map(g => g.nombre || g.grupo_id).join(", ")}</b>{cambios.desactivados.length ? ` (el sorteo se desactivó en ${cambios.desactivados.map(g => g.nombre || g.grupo_id).join(", ")}; reservas y pagos se conservan)` : ""}.</p>}
            {cambios.avisos.map(a => <p key={a} className={`${styles.alerta} ${styles.alertaAviso}`}>{a}</p>)}
            {cambios.por_publicar > 0 && !publicacion && (
                <p>{cambios.por_publicar} grupo(s) nuevo(s) todavía no tienen el sorteo. Pulsa «Publicar en los grupos nuevos» para activarlo ahí con el anuncio (los grupos que ya lo tienen no reciben nada).</p>
            )}
            {publicacion && (
                <ul className={styles.grupos} aria-label="Publicación en los grupos nuevos">
                    {publicacion.grupos.filter(g => cambios.agregados.some(a => a.grupo_id === g.grupo_id)).map(g => (
                        <li key={g.grupo_id} className={styles.grupo}>
                            <Badge tone={g.estado === "publicado" ? "success" : "error"} size="sm">{g.estado === "publicado" ? "Activo" : "Error"}</Badge>
                            {g.nombre || nombreGrupo(g.grupo_id)}
                            {g.estado !== "publicado" && g.error && <span className={styles.error}>{g.error}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}
        </div>
    );
}

function Fijo({ etiqueta, valor, motivo }: { etiqueta: string; valor: string; motivo?: string }) {
    return (
        <div className={styles.fijo}>
            <p><span className={styles.ayuda}>{etiqueta}</span><br /><b>{valor}</b> <Lock size={12} aria-label="No editable" /></p>
            {motivo && <p className={styles.ayuda}>{motivo}</p>}
        </div>
    );
}
