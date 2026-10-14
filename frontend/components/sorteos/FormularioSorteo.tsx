"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Modal, Button, Input, Select, Textarea, IconButton } from "@/components/ui";
import {
    apiSorteos,
    describirError,
    type ConfigSorteo,
    type CuentaPago,
    type ErrorCampo,
    type GrupoAutorizado,
    type Plantilla,
    type Sorteo
} from "@/services/sorteos/apiSorteos";
import { colombiaDesdeIso, isoDesdeColombia } from "./fechas";
import styles from "./Sorteos.module.css";

interface Props {
    open: boolean;
    sorteo?: Sorteo | null;
    onClose: () => void;
    onGuardado: (sorteo: Sorteo) => void;
}

interface PremioForm { nombre: string; premio: string; tipo: string }
interface RecordatorioForm { minutos: string; texto: string }

const VACIO = {
    plantillaId: "",
    modalidad: "dos_cifras",
    nombre: "",
    horaFin: "",
    horaCierre: "",
    valor: "",
    premios: [{ nombre: "", premio: "", tipo: "otro" }] as PremioForm[],
    grupos: [] as string[],
    cuentas: [] as string[],
    publicarEn: "",
    mensajePublicacion: "",
    avisoCierre: "",
    recordatorios: [] as RecordatorioForm[],
    liberar: false,
    vencimiento: "60",
    guardarPlantilla: "",
};

type Form = typeof VACIO;

function desdeConfig(config: ConfigSorteo, extra: Partial<Form> = {}): Form {
    return {
        ...VACIO,
        modalidad: config.modalidad || "dos_cifras",
        nombre: config.nombre || "",
        horaFin: config.hora_fin || "",
        horaCierre: config.hora_cierre || "",
        valor: config.valor ? String(config.valor) : "",
        premios: config.premios?.length
            ? config.premios.map(p => ({ nombre: p.nombre, premio: p.premio ? String(p.premio) : "", tipo: p.tipo || "otro" }))
            : VACIO.premios,
        grupos: config.grupos || [],
        cuentas: config.cuentas || [],
        publicarEn: colombiaDesdeIso(config.publicar_en),
        mensajePublicacion: config.mensajes?.publicacion || "",
        avisoCierre: config.mensajes?.aviso_cierre || "",
        recordatorios: (config.recordatorios || []).map(r => ({ minutos: String(r.minutos_antes_cierre), texto: r.texto })),
        liberar: !!config.reservas?.liberar_no_pagados,
        vencimiento: config.reservas?.vencimiento_minutos ? String(config.reservas.vencimiento_minutos) : "60",
        ...extra
    };
}

function aConfig(f: Form): ConfigSorteo {
    return {
        modalidad: f.modalidad,
        nombre: f.nombre,
        hora_fin: f.horaFin,
        hora_cierre: f.horaCierre || null,
        valor: Number(f.valor) || 0,
        premios: f.premios.filter(p => p.nombre.trim()).map(p => ({ nombre: p.nombre, premio: Number(p.premio) || null, tipo: p.tipo })),
        grupos: f.grupos,
        cuentas: f.cuentas,
        publicar_en: isoDesdeColombia(f.publicarEn),
        mensajes: { publicacion: f.mensajePublicacion, aviso_cierre: f.avisoCierre },
        recordatorios: f.recordatorios.map(r => ({ minutos_antes_cierre: Number(r.minutos), texto: r.texto })),
        reservas: { liberar_no_pagados: f.liberar, vencimiento_minutos: f.liberar ? Number(f.vencimiento) : null }
    };
}

export default function FormularioSorteo({ open, sorteo, onClose, onGuardado }: Props) {

    // Estado inicial al montar: la página remonta este componente (key) cada
    // vez que se abre, así no hay que "reiniciar" estado dentro de un efecto.
    const [form, setForm] = useState<Form>(() => (sorteo ? desdeConfig(sorteo.config, { plantillaId: sorteo.plantilla_id || "" }) : VACIO));
    const [grupos, setGrupos] = useState<GrupoAutorizado[]>([]);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {

        if (!open) return;

        async function cargarCatalogos() {
            const [g, c, p] = await Promise.all([apiSorteos.grupos(), apiSorteos.cuentas(), apiSorteos.plantillas()]);
            if (g.ok) setGrupos(g.data); else setError(describirError(g));
            if (c.ok) setCuentas(c.data.filter(x => x.activa !== false));
            if (p.ok) setPlantillas(p.data);
        }

        cargarCatalogos();

    }, [open]);

    const errorDe = useMemo(() => (campo: string) => errores.filter(e => e.campo === campo || e.campo.startsWith(`${campo}[`)).map(e => e.mensaje).join(" ") || undefined, [errores]);

    const cambiar = <K extends keyof Form>(clave: K, valor: Form[K]) => setForm(prev => ({ ...prev, [clave]: valor }));

    const alternar = (clave: "grupos" | "cuentas", id: string) =>
        setForm(prev => ({ ...prev, [clave]: prev[clave].includes(id) ? prev[clave].filter(x => x !== id) : [...prev[clave], id] }));

    const usarPlantilla = (id: string) => {
        const p = plantillas.find(x => x.id === id);
        if (!p) return cambiar("plantillaId", "");
        // La plantilla aporta la configuración; grupos y fecha se eligen aquí.
        setForm(prev => desdeConfig(p.config, { plantillaId: id, grupos: prev.grupos, publicarEn: prev.publicarEn }));
    };

    async function guardar() {

        setGuardando(true);
        setErrores([]);
        setError(null);

        const config = aConfig(form);

        if (!config.publicar_en) {
            setErrores([{ campo: "publicar_en", mensaje: "Indica la fecha y hora de publicación." }]);
            setGuardando(false);
            return;
        }

        const r = sorteo
            ? await apiSorteos.editar(sorteo.id, { ...config, version: sorteo.version, plantilla_id: form.plantillaId || null })
            : await apiSorteos.crear({ ...config, plantilla_id: form.plantillaId || null });

        if (!r.ok) {
            setErrores(r.errores || []);
            setError(describirError(r));
            setGuardando(false);
            return;
        }

        // "Guardar también como plantilla" es opcional y nunca bloquea el sorteo.
        if (form.guardarPlantilla.trim()) {
            const p = await apiSorteos.crearPlantilla(form.guardarPlantilla.trim(), config);
            if (!p.ok) setError(`El sorteo se guardó, pero la plantilla no: ${describirError(p)}`);
        }

        setGuardando(false);
        onGuardado(r.data);

    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={sorteo ? "Editar sorteo programado" : "Nuevo sorteo"}
            description="Al guardar verás la vista previa. Nada se publica hasta que la revises y confirmes."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} loading={guardando}>Guardar y ver vista previa</Button>
                </>
            }
        >
            <div className={styles.stack}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

                {plantillas.length > 0 && (
                    <Select label="Usar plantilla" optional value={form.plantillaId} onChange={e => usarPlantilla(e.target.value)}>
                        <option value="">Sin plantilla</option>
                        {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </Select>
                )}

                <div className={styles.fila}>
                    <Select label="Modalidad" value={form.modalidad} onChange={e => cambiar("modalidad", e.target.value)} error={errorDe("modalidad")}>
                        <option value="dos_cifras">2 cifras (00–99)</option>
                        <option value="tres_cifras_pago" disabled>3 cifras de pago (no disponible)</option>
                        <option value="tres_cifras_gratis" disabled>3 cifras gratis (no disponible)</option>
                    </Select>
                    <Input label="Lotería o nombre del sorteo" value={form.nombre} onChange={e => cambiar("nombre", e.target.value)} error={errorDe("nombre")} maxLength={80} />
                </div>

                <div className={styles.fila}>
                    <Input label="Hora del sorteo" type="time" value={form.horaFin} onChange={e => cambiar("horaFin", e.target.value)} error={errorDe("hora_fin")} />
                    <Input label="Cierre de reservas" optional type="time" value={form.horaCierre} onChange={e => cambiar("horaCierre", e.target.value)} error={errorDe("hora_cierre")} hint="Si lo dejas vacío: 4 minutos antes del sorteo." />
                    <Input label="Valor por número (COP)" type="number" min={0} value={form.valor} onChange={e => cambiar("valor", e.target.value)} error={errorDe("valor")} />
                </div>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Premios</h3>
                    {errorDe("premios") && <span className={styles.error}>{errorDe("premios")}</span>}
                    {form.premios.map((p, i) => (
                        <div key={i} className={styles.itemDinamico}>
                            <Input label={i === 0 ? "Premio" : undefined} aria-label="Premio" value={p.nombre} onChange={e => cambiar("premios", form.premios.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} placeholder="Ej.: Premio mayor" />
                            <Input label={i === 0 ? "Valor (COP)" : undefined} aria-label="Valor del premio" type="number" min={0} value={p.premio} onChange={e => cambiar("premios", form.premios.map((x, j) => j === i ? { ...x, premio: e.target.value } : x))} />
                            <IconButton label="Quitar premio" variant="ghost" onClick={() => cambiar("premios", form.premios.filter((_, j) => j !== i))} disabled={form.premios.length === 1}><Trash2 size={16} /></IconButton>
                        </div>
                    ))}
                    <div><Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => cambiar("premios", [...form.premios, { nombre: "", premio: "", tipo: "otro" }])}>Agregar premio</Button></div>
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Grupos donde se publica</h3>
                    {errorDe("grupos") && <span className={styles.error}>{errorDe("grupos")}</span>}
                    {grupos.length === 0
                        ? <p className={styles.ayuda}>No tienes grupos autorizados. Autorízalos en Automatización → Grupos.</p>
                        : <div className={styles.checks}>{grupos.map(g => (
                            <label key={g.grupo_id} className={styles.check}>
                                <input type="checkbox" checked={form.grupos.includes(g.grupo_id)} onChange={() => alternar("grupos", g.grupo_id)} />
                                {g.nombre || g.grupo_id}
                            </label>
                        ))}</div>}
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Cuentas de pago</h3>
                    {errorDe("cuentas") && <span className={styles.error}>{errorDe("cuentas")}</span>}
                    {cuentas.length === 0
                        ? <p className={styles.ayuda}>No tienes cuentas activas. Créalas en la pestaña Cuentas de pago.</p>
                        : <div className={styles.checks}>{cuentas.map(c => (
                            <label key={c.id} className={styles.check}>
                                <input type="checkbox" checked={form.cuentas.includes(c.id)} onChange={() => alternar("cuentas", c.id)} />
                                {c.nombre}
                            </label>
                        ))}</div>}
                    <p className={styles.ayuda}>Se copian al sorteo: editarlas después no cambia este sorteo.</p>
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Publicación</h3>
                    <Input label="Fecha y hora de publicación (hora de Colombia)" type="datetime-local" value={form.publicarEn} onChange={e => cambiar("publicarEn", e.target.value)} error={errorDe("publicar_en")} />
                    <Textarea label="Mensaje de publicación" optional rows={8} value={form.mensajePublicacion} onChange={e => cambiar("mensajePublicacion", e.target.value)} error={errorDe("mensajes")}
                        hint="Vacío = plantilla por defecto. Variables: {{nombre}} {{hora}} {{hora_cierre}} {{valor}} {{premios}} {{cuentas}} {{cantidad}} {{fecha}}" />
                    <Textarea label="Aviso al cerrar" optional rows={3} value={form.avisoCierre} onChange={e => cambiar("avisoCierre", e.target.value)} hint="Se envía una vez cuando el sorteo se cierra. Vacío = no se envía." />
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Recordatorios</h3>
                    {errorDe("recordatorios") && <span className={styles.error}>{errorDe("recordatorios")}</span>}
                    {form.recordatorios.map((r, i) => (
                        <div key={i} className={styles.itemDinamico}>
                            <Textarea aria-label="Texto del recordatorio" rows={2} value={r.texto} onChange={e => cambiar("recordatorios", form.recordatorios.map((x, j) => j === i ? { ...x, texto: e.target.value } : x))} placeholder="⏰ Falta poco para {{nombre}}" />
                            <Input aria-label="Minutos antes del cierre" type="number" min={5} max={720} value={r.minutos} onChange={e => cambiar("recordatorios", form.recordatorios.map((x, j) => j === i ? { ...x, minutos: e.target.value } : x))} hint="min antes del cierre" />
                            <IconButton label="Quitar recordatorio" variant="ghost" onClick={() => cambiar("recordatorios", form.recordatorios.filter((_, j) => j !== i))}><Trash2 size={16} /></IconButton>
                        </div>
                    ))}
                    <div><Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => cambiar("recordatorios", [...form.recordatorios, { minutos: "60", texto: "" }])} disabled={form.recordatorios.length >= 6}>Agregar recordatorio</Button></div>
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Reservas no pagadas</h3>
                    <label className={styles.check}>
                        <input type="checkbox" checked={form.liberar} onChange={e => cambiar("liberar", e.target.checked)} />
                        Liberar automáticamente las reservas no pagadas
                    </label>
                    {form.liberar && (
                        <>
                            <Input label="Minutos hasta liberar una reserva" type="number" min={10} max={1440} value={form.vencimiento} onChange={e => cambiar("vencimiento", e.target.value)} error={errorDe("reservas.vencimiento_minutos")} />
                            <p className={`${styles.alerta} ${styles.alertaAviso}`}>Un cliente que ya transfirió pero cuyo pago todavía no confirmaste podría perder su número. Los números pagados nunca se liberan.</p>
                        </>
                    )}
                </section>

                {!sorteo && (
                    <section className={styles.seccion}>
                        <Input label="Guardar también como plantilla" optional value={form.guardarPlantilla} onChange={e => cambiar("guardarPlantilla", e.target.value)} placeholder="Nombre de la plantilla" maxLength={80} />
                    </section>
                )}

            </div>
        </Modal>
    );

}
