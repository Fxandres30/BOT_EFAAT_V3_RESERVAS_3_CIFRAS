"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Search } from "lucide-react";

import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import {
    apiSorteos,
    describirError,
    type ErrorCampo,
    type Loteria,
    type LoteriaEntrada,
    type ReglaFestivo
} from "@/services/sorteos/apiSorteos";

import styles from "./CalendarioLoterias.module.css";

const DIAS: { n: number; corto: string; largo: string }[] = [
    { n: 1, corto: "L", largo: "Lunes" },
    { n: 2, corto: "M", largo: "Martes" },
    { n: 3, corto: "X", largo: "Miércoles" },
    { n: 4, corto: "J", largo: "Jueves" },
    { n: 5, corto: "V", largo: "Viernes" },
    { n: 6, corto: "S", largo: "Sábado" },
    { n: 7, corto: "D", largo: "Domingo" }
];

const REGLAS: Record<ReglaFestivo, string> = {
    sin_regla: "Sin regla (se avisa al programar)",
    no_se_juega: "No se juega en festivos",
    hora_habitual: "Se juega a la hora habitual del día",
    hora_especial: "Se juega a una hora especial"
};

const SECCIONES = [
    { categoria: "chance" as const, titulo: "Chances" },
    { categoria: "tradicional" as const, titulo: "Sorteos tradicionales" }
];

const VACIA: LoteriaEntrada = {
    nombre: "",
    modalidad: "",
    categoria: "chance",
    dias: [],
    hora: null,
    horas_por_dia: {},
    regla_festivo: "sin_regla",
    hora_festivo: null,
    notas: null,
    activo: true
};

const sinHorario = (l: Loteria) => !l.hora && !Object.keys(l.horas_por_dia).length;

function resumenDias(dias: number[]) {
    if (!dias.length) return "Días sin configurar";
    if (dias.length === 7) return "Todos los días";
    return DIAS.filter(d => dias.includes(d.n)).map(d => d.largo.slice(0, 3)).join(", ");
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CalendarioLoteriasPage() {

    const [loterias, setLoterias] = useState<Loteria[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [editando, setEditando] = useState<{ abierta: boolean; loteria: Loteria | null }>({ abierta: false, loteria: null });

    const cargar = useCallback(async () => {
        const r = await apiSorteos.loterias();
        setCargando(false);
        if (r.ok) { setLoterias(r.data); setError(null); }
        else setError(describirError(r));
    }, []);

    useEffect(() => {
        async function inicio() { await cargar(); }
        inicio();
    }, [cargar]);

    const filtradas = useMemo(() => {
        const q = normalizar(busqueda.trim());
        return q ? loterias.filter(l => normalizar(`${l.etiqueta} ${l.notas || ""}`).includes(q)) : loterias;
    }, [loterias, busqueda]);

    const pendientes = loterias.filter(sinHorario).length;

    return (
        <div className={styles.page}>

            <PageHeader
                title="Calendario de loterías"
                description="Catálogo de loterías con su horario habitual en hora de Colombia. Lo usan todos tus sorteos: al crear uno, eliges la lotería y se sugiere la hora del día. Nada se programa solo."
                actions={<Button leftIcon={<Plus size={16} />} onClick={() => setEditando({ abierta: true, loteria: null })}>Nueva lotería</Button>}
            />

            {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

            {pendientes > 0 && (
                <p className={`${styles.alerta} ${styles.alertaAviso}`}>
                    {pendientes} lotería(s) sin horario configurado. Edítalas para indicar días, hora y regla de festivos: el sistema no inventa horarios.
                </p>
            )}

            <Input
                aria-label="Buscar lotería"
                placeholder="Buscar por nombre…"
                leftIcon={<Search size={16} />}
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
            />

            {cargando && <p className={styles.ayuda}>Cargando calendario…</p>}

            {!cargando && !error && SECCIONES.map(({ categoria, titulo }) => {
                const lista = filtradas.filter(l => l.categoria === categoria);
                return (
                    <section key={categoria} className={styles.seccion} aria-label={titulo}>
                        <h2 className={styles.seccionTitulo}>{titulo} <span className={styles.contador}>{lista.length}</span></h2>
                        {lista.length === 0
                            ? <EmptyState icon={<CalendarDays size={24} />} title={busqueda ? "Sin resultados" : "Sin loterías"} description={busqueda ? "Prueba con otro nombre." : "Agrégalas con «Nueva lotería»."} />
                            : <div className={styles.lista}>{lista.map(l => (
                                <Card key={l.id} padding="md" className={styles.tarjeta}>
                                    <div className={styles.cabecera}>
                                        <h3 className={styles.nombre}>{l.etiqueta}</h3>
                                        {!l.activo && <Badge tone="neutral" size="sm">Inactiva</Badge>}
                                        {sinHorario(l) && <Badge tone="warning" size="sm">Horario pendiente</Badge>}
                                    </div>
                                    <div className={styles.meta}>
                                        <span>{resumenDias(l.dias)}</span>
                                        <span>Hora habitual: {l.hora || "—"}</span>
                                        {Object.entries(l.horas_por_dia).map(([d, h]) => (
                                            <span key={d}>{DIAS[Number(d) - 1]?.largo}: {h}</span>
                                        ))}
                                        <span>Festivos: {REGLAS[l.regla_festivo]}{l.regla_festivo === "hora_especial" && l.hora_festivo ? ` (${l.hora_festivo})` : ""}</span>
                                    </div>
                                    {l.notas && <p className={styles.notas}>{l.notas}</p>}
                                    <div>
                                        <Button size="sm" variant="secondary" onClick={() => setEditando({ abierta: true, loteria: l })}>Editar</Button>
                                    </div>
                                </Card>
                            ))}</div>}
                    </section>
                );
            })}

            <FormularioLoteria
                key={editando.abierta ? `loteria-${editando.loteria?.id || "nueva"}` : "cerrado"}
                abierta={editando.abierta}
                loteria={editando.loteria}
                onClose={() => setEditando({ abierta: false, loteria: null })}
                onGuardada={() => { setEditando({ abierta: false, loteria: null }); cargar(); }}
            />

        </div>
    );

}

interface PropsFormulario {
    abierta: boolean;
    loteria: Loteria | null;
    onClose: () => void;
    onGuardada: () => void;
}

function FormularioLoteria({ abierta, loteria, onClose, onGuardada }: PropsFormulario) {

    const [datos, setDatos] = useState<LoteriaEntrada>(() => {
        if (!loteria) return VACIA;
        const { id, etiqueta, ...resto } = loteria;
        void id; void etiqueta;
        return resto;
    });
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const cambiar = <K extends keyof LoteriaEntrada>(k: K, v: LoteriaEntrada[K]) => setDatos(prev => ({ ...prev, [k]: v }));
    const errorDe = (campo: string) => errores.filter(e => e.campo === campo).map(e => e.mensaje).join(" ") || undefined;

    const alternarDia = (n: number) => setDatos(prev => {
        const dias = prev.dias.includes(n) ? prev.dias.filter(d => d !== n) : [...prev.dias, n].sort();
        const horas = { ...prev.horas_por_dia };
        if (!dias.includes(n)) delete horas[String(n)];
        return { ...prev, dias, horas_por_dia: horas };
    });

    const horaDia = (n: number, valor: string) => setDatos(prev => {
        const horas = { ...prev.horas_por_dia };
        if (valor) horas[String(n)] = valor; else delete horas[String(n)];
        return { ...prev, horas_por_dia: horas };
    });

    async function guardar() {
        setGuardando(true);
        setErrores([]);
        setError(null);
        const cuerpo = { ...datos, hora: datos.hora || null, hora_festivo: datos.hora_festivo || null, notas: datos.notas || null };
        const r = loteria ? await apiSorteos.actualizarLoteria(loteria.id, cuerpo) : await apiSorteos.crearLoteria(cuerpo);
        setGuardando(false);
        if (!r.ok) {
            setErrores(r.errores || []);
            setError(r.motivo === "nombre_duplicado" ? "Ya existe una lotería con ese nombre y modalidad." : describirError(r));
            return;
        }
        onGuardada();
    }

    return (
        <Modal
            open={abierta}
            onClose={onClose}
            size="lg"
            title={loteria ? `Editar ${loteria.etiqueta}` : "Nueva lotería"}
            description="Horas en hora de Colombia (America/Bogota). Deja vacío lo que no sepas: al programar se avisará."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} loading={guardando}>Guardar</Button>
                </>
            }
        >
            <div className={styles.formulario}>

                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

                <div className={styles.fila}>
                    <Input label="Nombre" value={datos.nombre} onChange={e => cambiar("nombre", e.target.value)} error={errorDe("nombre")} maxLength={60} placeholder="Ej.: Sinuano" />
                    <Input label="Modalidad o sorteo" optional value={datos.modalidad} onChange={e => cambiar("modalidad", e.target.value)} maxLength={30} placeholder="Ej.: Día, Noche" />
                    <Select label="Tipo" value={datos.categoria} onChange={e => cambiar("categoria", e.target.value as LoteriaEntrada["categoria"])}>
                        <option value="chance">Chance</option>
                        <option value="tradicional">Sorteo tradicional</option>
                    </Select>
                </div>

                <fieldset className={styles.dias}>
                    <legend>Días en que se juega</legend>
                    {DIAS.map(d => (
                        <label key={d.n} className={styles.check}>
                            <input type="checkbox" checked={datos.dias.includes(d.n)} onChange={() => alternarDia(d.n)} />
                            {d.largo}
                        </label>
                    ))}
                    {errorDe("dias") && <span className={styles.error}>{errorDe("dias")}</span>}
                </fieldset>

                <div className={styles.fila}>
                    <Input label="Hora habitual" optional type="time" value={datos.hora || ""} onChange={e => cambiar("hora", e.target.value || null)} error={errorDe("hora")} />
                </div>

                {datos.dias.length > 0 && (
                    <fieldset className={styles.dias}>
                        <legend>Hora distinta algún día (opcional)</legend>
                        {datos.dias.map(n => (
                            <Input key={n} label={DIAS[n - 1].largo} optional type="time" value={datos.horas_por_dia[String(n)] || ""} onChange={e => horaDia(n, e.target.value)} />
                        ))}
                        {errorDe("horas_por_dia") && <span className={styles.error}>{errorDe("horas_por_dia")}</span>}
                    </fieldset>
                )}

                <div className={styles.fila}>
                    <Select label="Festivos" value={datos.regla_festivo} onChange={e => cambiar("regla_festivo", e.target.value as ReglaFestivo)} error={errorDe("regla_festivo")}>
                        {Object.entries(REGLAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </Select>
                    {datos.regla_festivo === "hora_especial" && (
                        <Input label="Hora en festivos" type="time" value={datos.hora_festivo || ""} onChange={e => cambiar("hora_festivo", e.target.value || null)} error={errorDe("hora_festivo")} />
                    )}
                </div>

                <Textarea label="Condiciones y notas" optional rows={3} value={datos.notas || ""} onChange={e => cambiar("notas", e.target.value)} maxLength={500} hint="Condiciones especiales tal como las conoces (domingos, festivos, cambios de horario)." />

                <label className={styles.check}>
                    <input type="checkbox" checked={datos.activo} onChange={e => cambiar("activo", e.target.checked)} />
                    Activa (aparece al crear sorteos)
                </label>

            </div>
        </Modal>
    );

}
