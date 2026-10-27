"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";

import { Modal, Button, Input, Select, Textarea, IconButton } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import {
    apiSorteos,
    describirError,
    esSesionCaducada,
    type ConfigSorteo,
    type CuentaPago,
    type DisenoSorteo,
    type ErrorCampo,
    type GrupoAutorizado,
    type HorarioLoteria,
    type Loteria,
    type Plantilla,
    type ResumenGrupos,
    type Sorteo
} from "@/services/sorteos/apiSorteos";
import { colombiaDesdeIso, isoDesdeColombia } from "./fechas";
import { listarDisenos } from "@/services/tablas/disenos";
import { TABLA_DISENO_PRESETS } from "@/services/tablas/disenoDefaults";
import type { TablaDiseno } from "@/components/tablas/disenoTypes";
import DisenoThumbnail from "@/components/tablas/DisenoThumbnail";
import { esEditable } from "./ListaSorteos";
import styles from "./Sorteos.module.css";

interface Props {
    open: boolean;
    /** Sorteo a editar. El formulario lo pide al backend (que comprueba que
     *  sea del usuario de la sesión); sin él, es un sorteo nuevo. */
    sorteoId?: string | null;
    onClose: () => void;
    onGuardado: (sorteo: Sorteo) => void;
    /** Valor por número precargado al crear un sorteo nuevo (p. ej. desde /tablas/[precio]). */
    valorInicial?: number;
}

export interface PremioForm { nombre: string; premio: string; tipo: string }
interface RecordatorioForm { minutos: string; texto: string }

const VACIO = {
    plantillaId: "",
    modalidad: "dos_cifras",
    nombre: "",
    loteriaId: "",
    horaFin: "",
    horaCierre: "",
    valor: "",
    premios: [{ nombre: "", premio: "", tipo: "otro" }] as PremioForm[],
    grupos: [] as string[],
    cuentas: [] as string[],
    publicarEn: "",
    // Día en que se juega (YYYY-MM-DD). Vacío = el de la publicación.
    fechaSorteo: "",
    // Reinicio de la tabla: nunca por defecto.
    reiniciarTabla: false,
    // Bloqueados a mano: se conservan salvo que se elija liberarlos.
    liberarBloqueados: false,
    // Si a la hora de publicar el grupo sigue con otro sorteo abierto: por
    // defecto se espera a que cierre; marcado, lo sustituye en ese grupo.
    sustituirActivo: false,
    // Estilo: "actual" | "preset:<key>" | "biblioteca:<id>".
    diseno: "actual",
    mensajePublicacion: "",
    avisoCierre: "",
    recordatorios: [] as RecordatorioForm[],
    liberar: false,
    vencimiento: "60",
    guardarPlantilla: "",
};

type Form = typeof VACIO;

const CUENTA_VACIA = { nombre: "", tipo: "nequi", numero: "", titular: "" };

// Elección guardada en el sorteo -> valor del selector. Un estilo que ya no
// está en los predefinidos se conserva tal cual ("guardado"): editar el
// sorteo nunca debe cambiarlo por el diseño actual sin que se elija.
export function disenoAForm(d?: DisenoSorteo | null): string {
    if (!d || d.origen === "actual") return "actual";
    if (d.origen === "biblioteca" && d.diseno_id) return `biblioteca:${d.diseno_id}`;
    const preset = TABLA_DISENO_PRESETS.find(p => p.nombre === d.nombre);
    return preset ? `preset:${preset.key}` : "guardado";
}

// Valor del selector -> elección para el backend (que copia el diseño).
export function formADiseno(valor: string, guardado?: DisenoSorteo | null): DisenoSorteo {
    if (valor === "guardado" && guardado) return guardado;
    if (valor.startsWith("biblioteca:")) return { origen: "biblioteca", diseno_id: valor.slice(11), nombre: null, config: null };
    if (valor.startsWith("preset:")) {
        const p = TABLA_DISENO_PRESETS.find(x => x.key === valor.slice(7));
        if (p) return { origen: "preset", diseno_id: null, nombre: p.nombre, config: p.config };
    }
    return { origen: "actual", diseno_id: null, nombre: null, config: null };
}

type EstadoGrupos =
    | { tipo: "cargando" }
    | { tipo: "ok"; resumen: ResumenGrupos | null }
    | { tipo: "error"; mensaje: string };

// Un fallo nunca se presenta como «no tienes grupos». El detalle técnico
// queda en la consola (describirError), nunca en la pantalla del cliente.
function mensajeErrorGrupos(r: { motivo: string; error?: string; status?: number; migracion?: string }): string {
    if (esSesionCaducada(r)) return "Tu sesión expiró. Vuelve a iniciar sesión para ver tus grupos.";
    describirError(r);
    return "No pudimos cargar tus grupos de WhatsApp. Inténtalo de nuevo.";
}

function desdeConfig(config: ConfigSorteo, extra: Partial<Form> = {}): Form {
    return {
        ...VACIO,
        modalidad: config.modalidad || "dos_cifras",
        nombre: config.nombre || "",
        loteriaId: config.loteria_id || "",
        horaFin: config.hora_fin || "",
        horaCierre: config.hora_cierre || "",
        valor: config.valor ? String(config.valor) : "",
        premios: config.premios?.length
            ? config.premios.map(p => ({ nombre: p.nombre, premio: p.premio ? String(p.premio) : "", tipo: p.tipo || "otro" }))
            : VACIO.premios,
        grupos: config.grupos || [],
        cuentas: config.cuentas || [],
        publicarEn: colombiaDesdeIso(config.publicar_en),
        fechaSorteo: config.fecha_sorteo || colombiaDesdeIso(config.publicar_en).slice(0, 10),
        reiniciarTabla: config.tabla?.reiniciar === true,
        liberarBloqueados: config.tabla?.reiniciar === true && config.tabla?.liberar_bloqueados === true,
        sustituirActivo: config.sustituir_activo === true,
        diseno: disenoAForm(config.diseno),
        mensajePublicacion: config.mensajes?.publicacion || "",
        avisoCierre: config.mensajes?.aviso_cierre || "",
        recordatorios: (config.recordatorios || []).map(r => ({ minutos: String(r.minutos_antes_cierre), texto: r.texto })),
        liberar: !!config.reservas?.liberar_no_pagados,
        vencimiento: config.reservas?.vencimiento_minutos ? String(config.reservas.vencimiento_minutos) : "60",
        ...extra
    };
}

function aConfig(f: Form, disenoGuardado?: DisenoSorteo | null): ConfigSorteo {
    return {
        modalidad: f.modalidad,
        nombre: f.nombre,
        loteria_id: f.loteriaId || null,
        hora_fin: f.horaFin,
        hora_cierre: f.horaCierre || null,
        valor: Number(f.valor) || 0,
        premios: f.premios.filter(p => p.nombre.trim()).map(p => ({ nombre: p.nombre, premio: Number(p.premio) || null, tipo: p.tipo })),
        grupos: f.grupos,
        cuentas: f.cuentas,
        publicar_en: isoDesdeColombia(f.publicarEn),
        fecha_sorteo: f.fechaSorteo || (f.publicarEn ? f.publicarEn.slice(0, 10) : null),
        tabla: { reiniciar: f.reiniciarTabla, liberar_bloqueados: f.reiniciarTabla && f.liberarBloqueados },
        sustituir_activo: f.sustituirActivo,
        diseno: formADiseno(f.diseno, disenoGuardado),
        mensajes: { publicacion: f.mensajePublicacion, aviso_cierre: f.avisoCierre },
        recordatorios: f.recordatorios.map(r => ({ minutos_antes_cierre: Number(r.minutos), texto: r.texto })),
        reservas: { liberar_no_pagados: f.liberar, vencimiento_minutos: f.liberar ? Number(f.vencimiento) : null }
    };
}

type CargaSorteo =
    | { tipo: "nuevo" }
    | { tipo: "cargando" }
    | { tipo: "ok"; sorteo: Sorteo }
    | { tipo: "error"; mensaje: string };

export default function FormularioSorteo({ open, sorteoId = null, onClose, onGuardado, valorInicial }: Props) {

    // Estado inicial al montar: la página remonta este componente (key) cada
    // vez que se abre, así no hay que "reiniciar" estado dentro de un efecto.
    // Al editar, los campos NO se muestran ni se pueden guardar hasta tener
    // el sorteo real del backend: nunca un formulario vacío por un fallo.
    const edicion = Boolean(sorteoId);
    const [carga, setCarga] = useState<CargaSorteo>(edicion ? { tipo: "cargando" } : { tipo: "nuevo" });
    const [intentoCarga, setIntentoCarga] = useState(0);
    const sorteo = carga.tipo === "ok" ? carga.sorteo : null;
    const [form, setForm] = useState<Form>(() => ({ ...VACIO, valor: valorInicial ? String(valorInicial) : "" }));

    useEffect(() => {

        if (!open || !sorteoId) return;

        let vigente = true;

        apiSorteos.obtener(sorteoId).then(r => {
            if (!vigente) return;
            if (!r.ok) {
                setCarga({ tipo: "error", mensaje: r.motivo === "no_encontrado" ? "No encontramos este sorteo en tu cuenta." : describirError(r) });
                return;
            }
            // Mismo criterio que el backend (servicio.editar) y que la lista.
            if (!esEditable(r.data)) {
                setCarga({ tipo: "error", mensaje: "Este sorteo ya se publicó en algún grupo o cambió de estado: no se puede editar. Ábrelo en la vista previa." });
                return;
            }
            setForm(desdeConfig(r.data.config, { plantillaId: r.data.plantilla_id || "" }));
            setCarga({ tipo: "ok", sorteo: r.data });
        });

        return () => { vigente = false; };

    }, [open, sorteoId, intentoCarga]);
    const [grupos, setGrupos] = useState<GrupoAutorizado[]>([]);
    const [estadoGrupos, setEstadoGrupos] = useState<EstadoGrupos>({ tipo: "cargando" });
    const [cuentaSesion, setCuentaSesion] = useState<string | null>(null);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [errorCuentas, setErrorCuentas] = useState(false);
    const [nuevaCuenta, setNuevaCuenta] = useState<typeof CUENTA_VACIA | null>(null);
    const [erroresCuenta, setErroresCuenta] = useState<ErrorCampo[]>([]);
    const [guardandoCuenta, setGuardandoCuenta] = useState(false);
    const [disenos, setDisenos] = useState<TablaDiseno[]>([]);
    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [loterias, setLoterias] = useState<Loteria[]>([]);
    const [avisoLoterias, setAvisoLoterias] = useState<string | null>(null);
    const [horario, setHorario] = useState<HorarioLoteria | null>(null);
    const horaSugerida = useRef<string | null>(null);
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    // Grupos: cada causa de una lista vacía se explica por separado (antes
    // cualquier fallo de la API acababa en «No tienes grupos autorizados»).
    const cargarGrupos = useCallback(async () => {
        const g = await apiSorteos.grupos();
        if (g.ok) {
            setGrupos(g.data);
            setEstadoGrupos({ tipo: "ok", resumen: g.meta || null });
        } else {
            setGrupos([]);
            setEstadoGrupos({ tipo: "error", mensaje: mensajeErrorGrupos(g) });
        }
    }, []);

    useEffect(() => {

        if (!open) return;

        async function cargarCatalogos() {
            const [c, p, l, s] = await Promise.all([apiSorteos.cuentas(), apiSorteos.plantillas(), apiSorteos.loterias(), supabase.auth.getSession()]);
            if (c.ok) setCuentas(c.data.filter(x => x.activa !== false));
            else { describirError(c); setErrorCuentas(true); }
            if (p.ok) setPlantillas(p.data);
            if (l.ok) {
                setLoterias(l.data.filter(x => x.activo));
                // Lotería eliminada del calendario después de crear el sorteo:
                // se conserva el nombre como personalizado.
                setForm(prev => (prev.loteriaId && !l.data.some(x => x.id === prev.loteriaId) ? { ...prev, loteriaId: "" } : prev));
            }
            else { describirError(l); setAvisoLoterias("No pudimos cargar el calendario de loterías. Puedes escribir el nombre de la lotería a mano."); }
            setCuentaSesion(s.data.session?.user?.email || null);
            // Biblioteca de diseños DEL USUARIO (RLS por propietario).
            const uid = s.data.session?.user?.id;
            if (uid) listarDisenos(uid).then(setDisenos).catch(() => setDisenos([]));
        }

        async function cargarTodo() {
            await Promise.all([cargarGrupos(), cargarCatalogos()]);
        }

        cargarTodo();

    }, [open, cargarGrupos]);

    // Horario habitual de la lotería elegida para la FECHA DEL SORTEO (puede
    // ser posterior a la publicación). Solo sugiere: nunca programa nada.
    const fechaSorteo = form.fechaSorteo || (form.publicarEn ? form.publicarEn.slice(0, 10) : "");

    useEffect(() => {

        if (!open || !form.loteriaId || !fechaSorteo) return;

        let vigente = true;

        apiSorteos.horarioLoteria(form.loteriaId, fechaSorteo).then(r => {
            if (!vigente) return;
            if (!r.ok) {
                setHorario(null);
                return;
            }
            setHorario(r.data);
            const sugerida = r.data.hora;
            // Rellena la hora solo si está vacía o si seguía siendo la sugerencia
            // anterior: un cambio manual del usuario nunca se pisa.
            const anterior = horaSugerida.current;
            setForm(prev => (sugerida && (!prev.horaFin || prev.horaFin === anterior) ? { ...prev, horaFin: sugerida } : prev));
            horaSugerida.current = sugerida;
        });

        return () => { vigente = false; };

    }, [open, form.loteriaId, fechaSorteo]);

    const reintentarGrupos = () => {
        setEstadoGrupos({ tipo: "cargando" });
        cargarGrupos();
    };

    const elegirLoteria = (texto: string) => {
        const buscado = texto.trim().toLocaleLowerCase("es");
        const encontrada = loterias.find(l => l.etiqueta.toLocaleLowerCase("es") === buscado);
        if (!encontrada) setHorario(null);
        setForm(prev => ({ ...prev, nombre: texto, loteriaId: encontrada?.id || "" }));
    };

    const horarioVisible = form.loteriaId && fechaSorteo ? horario : null;

    const errorDe = useMemo(() => (campo: string) => errores.filter(e => e.campo === campo || e.campo.startsWith(`${campo}[`)).map(e => e.mensaje).join(" ") || undefined, [errores]);

    const cambiar = <K extends keyof Form>(clave: K, valor: Form[K]) => setForm(prev => ({ ...prev, [clave]: valor }));

    const alternar = (clave: "grupos" | "cuentas", id: string) =>
        setForm(prev => ({ ...prev, [clave]: prev[clave].includes(id) ? prev[clave].filter(x => x !== id) : [...prev[clave], id] }));

    // Al cambiar la publicación, la fecha del sorteo la sigue mientras el
    // usuario no la haya cambiado a mano (o sea anterior a la publicación).
    const cambiarPublicacion = (valor: string) => setForm(prev => {
        const anteriorDia = prev.publicarEn.slice(0, 10);
        const nuevoDia = valor.slice(0, 10);
        const seguia = !prev.fechaSorteo || prev.fechaSorteo === anteriorDia || prev.fechaSorteo < nuevoDia;
        return { ...prev, publicarEn: valor, fechaSorteo: seguia ? nuevoDia : prev.fechaSorteo };
    });

    // Cuenta de pago creada sin salir del formulario (titular = el usuario
    // del token en el backend); queda seleccionada para este sorteo.
    async function crearCuenta() {
        if (!nuevaCuenta) return;
        setGuardandoCuenta(true);
        setErroresCuenta([]);
        const r = await apiSorteos.crearCuenta({
            nombre: nuevaCuenta.nombre,
            tipo: nuevaCuenta.tipo,
            numero: nuevaCuenta.numero,
            titular: nuevaCuenta.titular || null,
            instrucciones: null
        });
        setGuardandoCuenta(false);
        if (!r.ok) {
            setErroresCuenta(r.errores?.length ? r.errores : [{ campo: "*", mensaje: describirError(r) }]);
            return;
        }
        setCuentas(prev => [...prev, r.data]);
        setForm(prev => ({ ...prev, cuentas: [...prev.cuentas, r.data.id] }));
        setNuevaCuenta(null);
    }

    const disenoElegido = form.diseno === "guardado"
        ? sorteo?.config.diseno?.config || null
        : form.diseno.startsWith("preset:")
        ? TABLA_DISENO_PRESETS.find(p => p.key === form.diseno.slice(7))?.config || null
        : form.diseno.startsWith("biblioteca:")
            ? disenos.find(d => d.id === form.diseno.slice(11))?.config || null
            : null;

    const usarPlantilla = (id: string) => {
        const p = plantillas.find(x => x.id === id);
        if (!p) return cambiar("plantillaId", "");
        // La plantilla aporta la configuración; grupos y fecha se eligen aquí.
        setForm(prev => desdeConfig(p.config, { plantillaId: id, grupos: prev.grupos, publicarEn: prev.publicarEn }));
    };

    async function guardar() {

        // Edición sin el sorteo cargado: nunca se envía nada.
        if (edicion && !sorteo) return;

        setGuardando(true);
        setErrores([]);
        setError(null);

        const config = aConfig(form, sorteo?.config.diseno);

        if (!config.publicar_en) {
            setErrores([{ campo: "publicar_en", mensaje: "Indica la fecha y hora de publicación." }]);
            setGuardando(false);
            return;
        }

        // Edición: SIEMPRE actualiza el mismo sorteo (PUT /:id con su versión);
        // nunca crea otro.
        const r = edicion && sorteo
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
            title={edicion ? "Editar sorteo" : "Nuevo sorteo"}
            description={edicion
                ? "Al guardar verás la vista previa y tendrás que confirmarlo otra vez. Nada se publica hasta entonces."
                : "Al guardar verás la vista previa. Nada se publica hasta que la revises y confirmes."}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    {carga.tipo === "error" && (
                        <Button variant="secondary" onClick={() => { setCarga({ tipo: "cargando" }); setIntentoCarga(n => n + 1); }}>Reintentar</Button>
                    )}
                    <Button onClick={guardar} loading={guardando} disabled={edicion && !sorteo}>
                        {edicion ? "Guardar cambios" : "Guardar y ver vista previa"}
                    </Button>
                </>
            }
        >
            {carga.tipo === "cargando" ? (
                <p className={styles.ayuda} role="status">Cargando el sorteo…</p>
            ) : carga.tipo === "error" ? (
                <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudo cargar el sorteo: {carga.mensaje}</p>
            ) : (
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
                    <Input
                        label="Lotería o nombre del sorteo"
                        list="loterias-calendario"
                        autoComplete="off"
                        value={form.nombre}
                        onChange={e => elegirLoteria(e.target.value)}
                        error={errorDe("nombre") || errorDe("loteria_id")}
                        maxLength={80}
                        placeholder="Busca en el calendario o escribe un nombre"
                        hint={form.loteriaId
                            ? "Del calendario de loterías."
                            : form.nombre.trim() ? "Nombre personalizado (no está en el calendario)." : undefined}
                    />
                    <datalist id="loterias-calendario">
                        {loterias.map(l => <option key={l.id} value={l.etiqueta}>{l.categoria === "tradicional" ? "Tradicional" : "Chance"}</option>)}
                    </datalist>
                </div>
                {avisoLoterias && <p className={`${styles.alerta} ${styles.alertaAviso}`}>{avisoLoterias}</p>}

                <div className={styles.fila}>
                    <Input label="Fecha y hora de publicación (hora de Colombia)" type="datetime-local" value={form.publicarEn} onChange={e => cambiarPublicacion(e.target.value)} error={errorDe("publicar_en")} hint="Puede ser el día anterior al sorteo o antes." />
                    <Input label="Fecha del sorteo" type="date" value={fechaSorteo} min={form.publicarEn ? form.publicarEn.slice(0, 10) : undefined} onChange={e => cambiar("fechaSorteo", e.target.value)} error={errorDe("fecha_sorteo")} hint="Día en que se juega. Se publica antes del cierre de reservas de ese día." />
                </div>

                {form.loteriaId && !fechaSorteo && (
                    <p className={styles.ayuda}>Elige la fecha de publicación para ver el horario habitual de esa lotería ese día.</p>
                )}

                {horarioVisible && (
                    <div className={`${styles.alerta} ${horarioVisible.avisos.length ? styles.alertaAviso : styles.alertaInfo}`} role="status" aria-label="Horario de la lotería">
                        <strong>
                            {horarioVisible.loteria} · {horarioVisible.dia_nombre} {horarioVisible.fecha.split("-").reverse().join("/")}
                            {horarioVisible.festivo ? ` · festivo (${horarioVisible.festivo})` : ""}
                        </strong>
                        <p>
                            {horarioVisible.hora
                                ? <>Horario habitual: <b>{horarioVisible.hora}</b>{form.horaFin && form.horaFin !== horarioVisible.hora ? <> · usas {form.horaFin} (cambio manual)</> : null}</>
                                : horarioVisible.hora_del_dia
                                    ? <>Sin hora sugerida. Hora habitual de los {horarioVisible.dia_nombre}: {horarioVisible.hora_del_dia}.</>
                                    : "Sin hora sugerida: escribe la hora del sorteo."}
                        </p>
                        {horarioVisible.avisos.length > 0 && <ul>{horarioVisible.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                        {horarioVisible.hora && form.horaFin !== horarioVisible.hora && (
                            <Button size="sm" variant="secondary" onClick={() => cambiar("horaFin", horarioVisible.hora || "")}>Usar {horarioVisible.hora}</Button>
                        )}
                    </div>
                )}

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
                    {estadoGrupos.tipo === "cargando" && <p className={styles.ayuda}>Cargando tus grupos…</p>}
                    {estadoGrupos.tipo === "error" && (
                        <div className={`${styles.alerta} ${styles.alertaError}`} role="alert">
                            <p>{estadoGrupos.mensaje}</p>
                            <Button size="sm" variant="secondary" onClick={reintentarGrupos}>Reintentar</Button>
                        </div>
                    )}
                    {estadoGrupos.tipo === "ok" && grupos.length === 0 && (
                        <p className={`${styles.alerta} ${styles.alertaAviso}`}>
                            {estadoGrupos.resumen && estadoGrupos.resumen.registrados > 0
                                ? <>Tus {estadoGrupos.resumen.registrados} grupo(s) de WhatsApp están desactivados en EFAAT. Actívalos en <Link href="/automatizacion/grupos">Automatización → Grupos</Link> y aparecerán aquí.</>
                                : <>Todavía no hay grupos de WhatsApp habilitados para {cuentaSesion ? <b>{cuentaSesion}</b> : "tu cuenta"}. Habilítalos una vez en <Link href="/automatizacion/grupos">Automatización → Grupos</Link> y aparecerán aquí. Si los habilitaste con otra cuenta, inicia sesión con ella.</>}
                        </p>
                    )}
                    {form.grupos.some(id => estadoGrupos.tipo === "ok" && !grupos.some(g => g.grupo_id === id)) && (
                        <p className={`${styles.alerta} ${styles.alertaAviso}`}>
                            Este sorteo tiene {form.grupos.filter(id => !grupos.some(g => g.grupo_id === id)).length} grupo(s) que ya no están autorizados: quítalos o vuelve a autorizarlos antes de guardar.
                            {" "}<Button size="sm" variant="ghost" onClick={() => cambiar("grupos", form.grupos.filter(id => grupos.some(g => g.grupo_id === id)))}>Quitar</Button>
                        </p>
                    )}
                    {grupos.length > 0 && <p className={styles.ayuda}>Seleccionados: {form.grupos.filter(id => grupos.some(g => g.grupo_id === id)).length} de {grupos.length}. El mismo sorteo se publica en todos.</p>}
                    {grupos.length > 0 && <div className={styles.checks}>{grupos.map(g => (
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
                        ? <p className={styles.ayuda}>{errorCuentas
                            ? "No pudimos cargar tus cuentas de pago. Cierra y vuelve a abrir el formulario."
                            : "Todavía no tienes cuentas de pago. Agrega al menos una: sin cuenta el sorteo no se puede programar."}</p>
                        : <div className={styles.checks}>{cuentas.map(c => (
                            <label key={c.id} className={styles.check}>
                                <input type="checkbox" checked={form.cuentas.includes(c.id)} onChange={() => alternar("cuentas", c.id)} />
                                {c.nombre} · {c.numero}
                            </label>
                        ))}</div>}
                    {nuevaCuenta ? (
                        <div className={styles.seccion} aria-label="Nueva cuenta de pago">
                            {erroresCuenta.filter(e => e.campo === "*").map((e, i) => <p key={i} className={`${styles.alerta} ${styles.alertaError}`}>{e.mensaje}</p>)}
                            <div className={styles.fila}>
                                <Input label="Nombre de la cuenta" value={nuevaCuenta.nombre} onChange={e => setNuevaCuenta({ ...nuevaCuenta, nombre: e.target.value })} error={erroresCuenta.find(e => e.campo === "nombre")?.mensaje} maxLength={80} placeholder="Ej.: Nequi principal" />
                                <Select label="Tipo" value={nuevaCuenta.tipo} onChange={e => setNuevaCuenta({ ...nuevaCuenta, tipo: e.target.value })}>
                                    <option value="nequi">Nequi</option>
                                    <option value="daviplata">Daviplata</option>
                                    <option value="bancolombia">Bancolombia</option>
                                    <option value="llave">Llave</option>
                                    <option value="otro">Otro</option>
                                </Select>
                            </div>
                            <div className={styles.fila}>
                                <Input label="Número o llave" value={nuevaCuenta.numero} onChange={e => setNuevaCuenta({ ...nuevaCuenta, numero: e.target.value })} error={erroresCuenta.find(e => e.campo === "numero")?.mensaje} maxLength={60} />
                                <Input label="Titular" optional value={nuevaCuenta.titular} onChange={e => setNuevaCuenta({ ...nuevaCuenta, titular: e.target.value })} maxLength={80} />
                            </div>
                            <div>
                                <Button size="sm" onClick={crearCuenta} loading={guardandoCuenta}>Guardar cuenta</Button>
                                {" "}<Button size="sm" variant="ghost" onClick={() => { setNuevaCuenta(null); setErroresCuenta([]); }} disabled={guardandoCuenta}>Cancelar</Button>
                            </div>
                        </div>
                    ) : (
                        <div><Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setNuevaCuenta({ ...CUENTA_VACIA })} disabled={errorCuentas}>Agregar cuenta de pago</Button></div>
                    )}
                    <p className={styles.ayuda}>Solo las cuentas marcadas aparecen en el anuncio. Se copian al sorteo: editarlas después no cambia este sorteo.</p>
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Tabla de números</h3>
                    <Select label="Estilo de la tabla" value={form.diseno} onChange={e => cambiar("diseno", e.target.value)} error={errorDe("diseno")} hint="Es el diseño de la imagen que se comparte por WhatsApp. Lo verás en la vista previa.">
                        {form.diseno === "guardado" && sorteo?.config.diseno && (
                            <option value="guardado">Estilo guardado en este sorteo{sorteo.config.diseno.nombre ? ` (${sorteo.config.diseno.nombre})` : ""}</option>
                        )}
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
                    {disenoElegido && <DisenoThumbnail config={disenoElegido} />}
                    <div className={styles.checks} role="radiogroup" aria-label="Tabla al publicar">
                        <label className={styles.check}>
                            <input type="radio" name="reinicio" checked={!form.reiniciarTabla} onChange={() => cambiar("reiniciarTabla", false)} />
                            Conservar la tabla actual
                        </label>
                        <label className={styles.check}>
                            <input type="radio" name="reinicio" checked={form.reiniciarTabla} onChange={() => cambiar("reiniciarTabla", true)} />
                            Reiniciar la tabla antes de publicar
                        </label>
                    </div>
                    <p className={styles.ayuda}>
                        Si eliges reiniciar, los números se liberarán únicamente cuando llegue el momento de publicar el sorteo, no al programarlo. Antes de hacerlo, el sistema volverá a validar el estado de la tabla.
                    </p>
                    {form.reiniciarTabla && (
                        <>
                            <p className={`${styles.alerta} ${styles.alertaAviso}`}>
                                Al publicar, los números reservados y pagados de sorteos <b>anteriores</b> se archivan (no se borran) y quedan libres. Nunca se tocan los de un sorteo activo, los pagos en proceso ni las reservas que no se puedan atribuir a un sorteo terminado; si en ese momento hay alguno, no se reinicia ni se publica el anuncio. Los números <b>bloqueados a mano</b> se conservan. En la vista previa verás qué se liberaría hoy y tendrás que confirmarlo.
                            </p>
                            <label className={styles.check}>
                                <input type="checkbox" checked={form.liberarBloqueados} onChange={e => cambiar("liberarBloqueados", e.target.checked)} />
                                También liberar los números bloqueados a mano
                            </label>
                        </>
                    )}
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Si el grupo tiene otro sorteo abierto</h3>
                    <label className={styles.check}>
                        <input type="checkbox" checked={form.sustituirActivo} onChange={e => cambiar("sustituirActivo", e.target.checked)} />
                        Sustituir el sorteo activo al publicar
                    </label>
                    <p className={styles.ayuda}>
                        Sin marcar, la publicación espera a que el sorteo actual del grupo cierre (también puedes cerrarlo o desactivarlo desde «Administrar»). Marcado, a la hora de publicar el sorteo actual se cierra solo en ese grupo, sin mensaje de cierre y sin perder sus reservas ni pagos.
                    </p>
                </section>

                <section className={styles.seccion}>
                    <h3 className={styles.seccionTitulo}>Publicación</h3>
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

                {!edicion && (
                    <section className={styles.seccion}>
                        <Input label="Guardar también como plantilla" optional value={form.guardarPlantilla} onChange={e => cambiar("guardarPlantilla", e.target.value)} placeholder="Nombre de la plantilla" maxLength={80} />
                    </section>
                )}

            </div>
            )}
        </Modal>
    );

}
