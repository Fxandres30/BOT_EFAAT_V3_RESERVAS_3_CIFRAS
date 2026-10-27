"use client";

import { useEffect, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";

import { Modal, Button, Input, Select, Textarea, IconButton, Badge } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { apiSorteos, describirError, type CuentaPago, type ErrorCampo, type SorteoActivo, type SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import { BotonesSorteo, ConfirmarAccionSorteo, type AccionPendiente } from "./AccionesSorteo";
import { listarDisenos } from "@/services/tablas/disenos";
import { TABLA_DISENO_PRESETS } from "@/services/tablas/disenoDefaults";
import type { TablaDiseno } from "@/components/tablas/disenoTypes";
import { disenoAForm, formADiseno, type PremioForm } from "./FormularioSorteo";
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
    const [publicacion, setPublicacion] = useState("");
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [disenos, setDisenos] = useState<TablaDiseno[]>([]);
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    // Cerrar, desactivar, cancelar o eliminar desde aquí (AccionesSorteo).
    const [accion, setAccion] = useState<AccionPendiente | null>(null);
    const [accionHecha, setAccionHecha] = useState<string | null>(null);

    const sorteo = carga.tipo === "ok" ? carga.sorteo : null;

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
            setPublicacion(s.publicacion || "");
            setCarga({ tipo: "ok", sorteo: s });
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
            ...(sorteo.campos.publicacion?.editable ? { publicacion } : {}),
            base: { premios: sorteo.premios, hora_cierre: sorteo.hora_cierre, ...(sorteo.campos.publicacion ? { publicacion: sorteo.publicacion } : {}) }
        });

        setGuardando(false);

        if (!r.ok) {
            setErrores(r.errores || []);
            setError(r.mensaje || describirError(r));
            return;
        }

        if (r.aviso) { setAviso(r.aviso); return; }
        onGuardado?.(r.data);

    }

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
                    <Button onClick={guardar} loading={guardando} disabled={!sorteo || Boolean(accionHecha)}>Guardar cambios</Button>
                </>
            }
        >
            {carga.tipo === "cargando" ? (
                <p className={styles.ayuda} role="status">Cargando el sorteo activo…</p>
            ) : carga.tipo === "error" ? (
                <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudo cargar el sorteo: {carga.mensaje}</p>
            ) : accionHecha ? (
                <p className={`${styles.alerta} ${styles.alertaInfo}`} role="status">{accionHecha}</p>
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
                        <p>En curso: <b>{sorteo.reservados}</b> reservado(s) y <b>{sorteo.pagados}</b> pagado(s). Guardar no los modifica.</p>
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
                                        Confirmo la corrección: las {sorteo.reservados} reserva(s) y {sorteo.pagados} pago(s) pasan al sorteo corregido en sus {sorteo.grupos.length} grupo(s)
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
                        <Fijo etiqueta="Grupos" valor={sorteo.grupos.map(g => g.grupo_nombre || g.grupo_id).join(" · ") || "—"} motivo={sorteo.campos.grupos.motivo} />
                    </section>

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
                            <Textarea label="Mensaje de publicación" optional rows={8} value={publicacion} onChange={e => setPublicacion(e.target.value)} error={errorDe("publicacion")}
                                hint={sorteo.origen === "panel"
                                    ? `${sorteo.campos.publicacion.motivo} Variables: {{nombre}} {{hora}} {{hora_cierre}} {{valor}} {{premios}} {{cuentas}} {{cantidad}} {{fecha}}`
                                    : sorteo.campos.publicacion.motivo} />
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

function Fijo({ etiqueta, valor, motivo }: { etiqueta: string; valor: string; motivo?: string }) {
    return (
        <div className={styles.fijo}>
            <p><span className={styles.ayuda}>{etiqueta}</span><br /><b>{valor}</b> <Lock size={12} aria-label="No editable" /></p>
            {motivo && <p className={styles.ayuda}>{motivo}</p>}
        </div>
    );
}
