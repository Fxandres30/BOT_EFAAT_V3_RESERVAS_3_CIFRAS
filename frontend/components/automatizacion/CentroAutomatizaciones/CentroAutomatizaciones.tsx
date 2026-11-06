"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, RefreshCw, Search } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Aviso, avisar } from "@/components/ui/Avisos";
import { useAccion } from "@/hooks/useAccion";

import { getUser } from "@/services/auth/getUser";
import { AutomationConfig, aplicarAVarios, listarConfiguraciones } from "@/services/automatizacion/automationConfigs";
import { listarGruposAutorizados, GrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { cargarSeguimiento, SeguimientoProgramacion } from "@/services/automatizacion/seguimientoProgramacion";
import { contarEnviosRecientes } from "@/services/automatizacion/historialAutomatizacion";
import { formatearMomento, frescuraDatos } from "@/services/automatizacion/estadoProgramacion";
import { FiltrosCentro, filtrarFilas } from "@/services/automatizacion/centroAutomatizaciones";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";
import TarjetaGrupo, { SeccionEditor } from "./TarjetaGrupo";
import EditorAutomatizacion from "./EditorAutomatizacion";
import DuplicarConfiguracion from "./DuplicarConfiguracion";
import HistorialActividad from "./HistorialActividad";
import { FilaGrupo, construirFila } from "./filaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

// Estados de envío cada minuto (el Scheduler revisa cada 30 s). La conexión
// de WhatsApp consulta cada sesión en vivo: solo al entrar y con «Actualizar».
const REFRESCO_MS = 60000;

type Vista = "grupos" | "actividad";

interface CambioActivo {
    grupos: FilaGrupo[];
    activo: boolean;
}

const FILTROS_INICIALES: FiltrosCentro = { texto: "", conexion: "todos", automatizacion: "todos", evento: "todos" };

export default function CentroAutomatizaciones() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [configs, setConfigs] = useState<AutomationConfig[]>([]);
    const [autorizados, setAutorizados] = useState<Set<string> | null>(null);
    const [seguimiento, setSeguimiento] = useState<SeguimientoProgramacion | null>(null);
    const [sesiones, setSesiones] = useState<SesionConGrupos[] | null>(null);
    const [envios24h, setEnvios24h] = useState<number | null>(null);

    const [ultimaCarga, setUltimaCarga] = useState<Date | null>(null);
    const [falloCarga, setFalloCarga] = useState(false);
    const [actualizando, setActualizando] = useState(false);
    const [ahora, setAhora] = useState(() => new Date());

    const [vista, setVista] = useState<Vista>("grupos");
    const [grupoHistorial, setGrupoHistorial] = useState<string | null>(null);
    const [filtros, setFiltros] = useState<FiltrosCentro>(FILTROS_INICIALES);
    const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());

    const [editor, setEditor] = useState<{ grupoId: string; seccion: SeccionEditor } | null>(null);
    const [duplicar, setDuplicar] = useState<{ origen: string; destinos: string[] } | null>(null);
    const [cambioActivo, setCambioActivo] = useState<CambioActivo | null>(null);
    const [cambiando, setCambiando] = useState<Set<string>>(() => new Set());

    const enCurso = useRef(false);

    // ------------------------------------------------------------ carga ---

    const refrescarSeguimiento = useCallback(async (uid: string, grupoIds: string[]) => {

        if (enCurso.current) return;
        enCurso.current = true;
        setActualizando(true);

        try {

            const [res, envios] = await Promise.all([cargarSeguimiento(uid, grupoIds), contarEnviosRecientes(uid, new Date())]);

            setEnvios24h(envios);

            if (res.data) {
                setSeguimiento(res.data);
                setUltimaCarga(new Date());
                setFalloCarga(false);
            } else {
                setFalloCarga(true);
            }

        } catch (err) {

            console.warn("[centro] error actualizando el seguimiento:", err);
            setFalloCarga(true);

        } finally {

            enCurso.current = false;
            setActualizando(false);

        }

    }, []);

    const comprobarConexion = useCallback(async (uid: string) => {
        setSesiones(null);
        setSesiones(await obtenerGruposDisponibles(uid));
    }, []);

    const cargarAutorizados = useCallback(async (uid: string) => {
        const { data, error: errorAut } = await listarGruposAutorizados(uid);
        setAutorizados(errorAut ? null : new Set(((data || []) as GrupoAutorizado[]).filter((g) => g.activo).map((g) => g.grupo_id)));
    }, []);

    const cargarConfigs = useCallback(async (uid: string) => {

        const res = await listarConfiguraciones(uid);

        if (res.error) {
            console.warn("[centro] no se pudo cargar la configuración:", res.error.message);
            return null;
        }

        const lista = (res.data as AutomationConfig[]) || [];
        setConfigs(lista);
        return lista;

    }, []);

    useEffect(() => {

        async function cargar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (!uid) {
                setCargando(false);
                return;
            }

            const lista = await cargarConfigs(uid);

            if (!lista) {
                setError("No pudimos cargar las automatizaciones. Intenta de nuevo en unos minutos.");
                setCargando(false);
                return;
            }

            setCargando(false);

            if (lista.length > 0) {
                refrescarSeguimiento(uid, lista.map((c) => c.grupo_id));
                comprobarConexion(uid);
                cargarAutorizados(uid);
            }

        }

        cargar();

    }, [cargarConfigs, refrescarSeguimiento, comprobarConexion, cargarAutorizados]);

    // Reloj y refresco periódico, solo con la pestaña visible.
    useEffect(() => {

        if (!usuarioId || configs.length === 0) return;

        const grupoIds = configs.map((c) => c.grupo_id);
        let ultimoRefresco = Date.now();

        const reloj = setInterval(() => {

            if (document.visibilityState !== "visible") return;

            setAhora(new Date());

            if (Date.now() - ultimoRefresco >= REFRESCO_MS) {
                ultimoRefresco = Date.now();
                refrescarSeguimiento(usuarioId, grupoIds);
            }

        }, 1000);

        return () => clearInterval(reloj);

    }, [usuarioId, configs, refrescarSeguimiento]);

    const actualizarTodo = useAccion(async () => {

        if (!usuarioId) return;

        const lista = await cargarConfigs(usuarioId);

        if (!lista) throw new Error("No pudimos actualizar la configuración.");

        await Promise.all([
            refrescarSeguimiento(usuarioId, lista.map((c) => c.grupo_id)),
            comprobarConexion(usuarioId),
            cargarAutorizados(usuarioId)
        ]);

    }, { onError: (m) => avisar.error(m) });

    // ----------------------------------------------------------- filas ---

    const filas = useMemo(
        () => configs.map((c) => construirFila(c, seguimiento, sesiones, autorizados, ahora)),
        [configs, seguimiento, sesiones, autorizados, ahora]
    );

    const visibles = filtrarFilas(
        filas.map((f) => ({
            fila: f,
            nombre: f.nombre,
            grupo_id: f.config.grupo_id,
            conectado: f.conexion === "conectado" ? true : f.conexion === "no_visto" || f.conexion === "sin_sesion" ? false : null,
            activo: f.config.activo === true,
            conEvento: !!f.evento
        })),
        filtros
    ).map((x) => x.fila);

    function reemplazarConfigs(nuevas: AutomationConfig[]) {
        const porGrupo = new Map(nuevas.map((c) => [c.grupo_id, c]));
        setConfigs((prev) => prev.map((c) => porGrupo.get(c.grupo_id) || c));
    }

    // ------------------------------------------------- activar/desactivar ---

    async function aplicarActivo(grupos: FilaGrupo[], activo: boolean) {

        if (!usuarioId) return false;

        const ids = grupos.filter((f) => f.config.activo !== activo).map((f) => f.config.grupo_id);

        if (ids.length === 0) return true;
        if (ids.some((id) => cambiando.has(id))) return false;

        setCambiando((prev) => new Set([...prev, ...ids]));

        try {

            const { data, error: errorAplicar } = await aplicarAVarios(usuarioId, ids, { activo });

            if (errorAplicar || !data) {
                avisar.error(`No se cambió ningún grupo (${errorAplicar || "sin respuesta"}).`);
                return false;
            }

            reemplazarConfigs(data);
            avisar.ok(activo
                ? `Automatización activada en ${data.length} grupo${data.length === 1 ? "" : "s"}.`
                : `Automatización desactivada en ${data.length} grupo${data.length === 1 ? "" : "s"}. No saldrán envíos nuevos.`);
            return true;

        } finally {

            setCambiando((prev) => {
                const copia = new Set(prev);
                ids.forEach((id) => copia.delete(id));
                return copia;
            });

        }

    }

    function alternarUno(fila: FilaGrupo) {

        const nuevo = !fila.config.activo;

        // Apagar con un evento en marcha se confirma; lo demás es inmediato.
        if (!nuevo && fila.cicloAbierto) {
            setCambioActivo({ grupos: [fila], activo: false });
            return;
        }

        aplicarActivo([fila], nuevo);

    }

    const confirmarCambio = useAccion(async () => {
        if (!cambioActivo) return false;
        return aplicarActivo(cambioActivo.grupos, cambioActivo.activo);
    });

    async function onConfirmarCambio() {
        const r = await confirmarCambio.ejecutar();
        if (r.ok && r.valor) {
            setCambioActivo(null);
            setSeleccion(new Set());
        }
    }

    // ------------------------------------------------------- selección ---

    function alternarSeleccion(grupoId: string) {
        setSeleccion((prev) => {
            const copia = new Set(prev);
            if (copia.has(grupoId)) copia.delete(grupoId);
            else copia.add(grupoId);
            return copia;
        });
    }

    const seleccionadas = filas.filter((f) => seleccion.has(f.config.grupo_id));
    const todasVisiblesSeleccionadas = visibles.length > 0 && visibles.every((f) => seleccion.has(f.config.grupo_id));

    // ------------------------------------------------------- indicadores ---

    const conexionLista = sesiones !== null;
    const conectados = filas.filter((f) => f.conexion === "conectado").length;
    const activas = filas.filter((f) => f.config.activo).length;
    const programados = filas.reduce((n, f) => n + f.programadosActivos, 0);
    const pendientes = filas.reduce((n, f) => n + f.pendientes, 0);
    const frescura = frescuraDatos(ultimaCarga, falloCarga, ahora);

    const filaEditor = editor ? filas.find((f) => f.config.grupo_id === editor.grupoId) || null : null;
    const filaDuplicar = duplicar ? filas.find((f) => f.config.grupo_id === duplicar.origen) || null : null;

    // ----------------------------------------------------------- render ---

    return (

        <div className={styles.page}>

            <PageHeader
                eyebrow="Automatización"
                title="Centro de automatizaciones"
                description="Administra los grupos, mensajes, horarios y reglas de automatización desde un solo lugar."
            />

            <AutomatizacionNav />

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : !usuarioId ? (

                <div className={styles.state}>Debes iniciar sesión.</div>

            ) : error ? (

                <p className={styles.alertaError}><AlertTriangle size={15} /> {error}</p>

            ) : configs.length === 0 ? (

                <EmptyState
                    title="Todavía no hay grupos con automatización"
                    description="Autoriza un grupo y ábrelo una vez para crear su configuración."
                    action={<Link href="/automatizacion/grupos" prefetch={false} className={styles.accionPrincipal}>Ir a Grupos</Link>}
                />

            ) : (

                <>

                    <div className={styles.kpis}>
                        <StatCard label="Grupos" value={filas.length} />
                        <StatCard label="Conectados" value={conexionLista ? conectados : "…"} tone={conexionLista && conectados < filas.length ? "warning" : "success"} hint={conexionLista ? undefined : "Comprobando"} />
                        <StatCard label="Activas" value={activas} tone="primary" />
                        <StatCard label="Desactivadas" value={filas.length - activas} />
                        <StatCard label="Mensajes programados" value={programados} hint="Activos en grupos activos" />
                        <StatCard label="Pendientes" value={seguimiento ? pendientes : "—"} hint="En el evento actual" />
                        <StatCard label="Envíos 24 h" value={envios24h ?? "—"} tone="success" hint={envios24h === null ? "No disponible" : "Aceptados por WhatsApp"} />
                    </div>

                    <div className={styles.vistas}>
                        <Tabs
                            items={[{ value: "grupos", label: "Grupos" }, { value: "actividad", label: "Actividad" }]}
                            value={vista}
                            onValueChange={(v) => { setVista(v as Vista); if (v === "grupos") setGrupoHistorial(null); }}
                            aria-label="Vista"
                        />
                        <span className={styles.estadoCarga}>
                            {ultimaCarga
                                ? <>Actualizado {formatearMomento(ultimaCarga, ahora)} · cada minuto</>
                                : actualizando ? "Consultando estados…" : "Sin datos de envíos todavía"}
                        </span>
                    </div>

                    {frescura !== "al_dia" && !actualizando && (
                        <p className={styles.alerta} role="status">
                            <AlertTriangle size={15} />
                            {frescura === "sin_respuesta"
                                ? ultimaCarga
                                    ? `No pudimos actualizar. Los estados son de ${formatearMomento(ultimaCarga, ahora)}.`
                                    : "No pudimos consultar el estado de los envíos. No se muestra ningún estado sin confirmar."
                                : "Los estados tienen más de 3 minutos y pueden no estar al día."}
                        </p>
                    )}

                    {vista === "actividad" ? (

                        <HistorialActividad key={grupoHistorial || "todos"} usuarioId={usuarioId} filas={filas} grupoInicial={grupoHistorial} ahora={ahora} />

                    ) : (

                        <>

                            <div className={styles.toolbar}>
                                <label className={styles.buscar}>
                                    <Search size={14} className={styles.buscarIcono} aria-hidden="true" />
                                    <input
                                        type="search"
                                        placeholder="Buscar grupo"
                                        value={filtros.texto}
                                        onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })}
                                        aria-label="Buscar grupo"
                                    />
                                </label>
                                <select className={styles.filtro} value={filtros.conexion} onChange={(e) => setFiltros({ ...filtros, conexion: e.target.value as FiltrosCentro["conexion"] })} aria-label="Conexión">
                                    <option value="todos">Toda conexión</option>
                                    <option value="conectado">Conectados</option>
                                    <option value="desconectado">Desconectados</option>
                                </select>
                                <select className={styles.filtro} value={filtros.automatizacion} onChange={(e) => setFiltros({ ...filtros, automatizacion: e.target.value as FiltrosCentro["automatizacion"] })} aria-label="Automatización">
                                    <option value="todos">Activas y desactivadas</option>
                                    <option value="activa">Activas</option>
                                    <option value="desactivada">Desactivadas</option>
                                </select>
                                <select className={styles.filtro} value={filtros.evento} onChange={(e) => setFiltros({ ...filtros, evento: e.target.value as FiltrosCentro["evento"] })} aria-label="Evento">
                                    <option value="todos">Con y sin evento</option>
                                    <option value="con_evento">Con evento activo</option>
                                    <option value="sin_evento">Sin evento activo</option>
                                </select>
                                <div className={styles.toolbarAcciones}>
                                    <Button size="sm" variant="secondary" onClick={() => actualizarTodo.ejecutar()} loading={actualizarTodo.procesando} disabled={actualizarTodo.procesando}>
                                        <RefreshCw size={13} /> Actualizar
                                    </Button>
                                    <Link href="/automatizacion/grupos" prefetch={false} className={styles.accionPrincipal} title="Autoriza un grupo de tu WhatsApp en Grupos">
                                        <Plus size={13} /> Agregar grupo
                                    </Link>
                                </div>
                            </div>

                            <div className={styles.filaControl}>
                                <label className={styles.seleccionarTodo}>
                                    <input
                                        type="checkbox"
                                        className={styles.check}
                                        checked={todasVisiblesSeleccionadas}
                                        onChange={() => setSeleccion(todasVisiblesSeleccionadas ? new Set() : new Set(visibles.map((f) => f.config.grupo_id)))}
                                    />
                                    Seleccionar {visibles.length === filas.length ? "todos" : `los ${visibles.length} visibles`}
                                </label>
                                <div className={styles.cardAcciones}>
                                    <button type="button" className={styles.accion} onClick={() => setCambioActivo({ grupos: filas, activo: true })} disabled={activas === filas.length}>
                                        Activar todas
                                    </button>
                                    <button type="button" className={`${styles.accion} ${styles.accionPeligro}`} onClick={() => setCambioActivo({ grupos: filas, activo: false })} disabled={activas === 0}>
                                        Desactivar todas
                                    </button>
                                </div>
                            </div>

                            {seleccionadas.length > 0 && (
                                <div className={styles.lote} role="region" aria-label="Acciones sobre los grupos seleccionados">
                                    <span className={styles.loteTexto}>{seleccionadas.length} seleccionado{seleccionadas.length === 1 ? "" : "s"}</span>
                                    <button type="button" className={styles.loteBoton} onClick={() => setCambioActivo({ grupos: seleccionadas, activo: true })}>Activar</button>
                                    <button type="button" className={styles.loteBoton} onClick={() => setCambioActivo({ grupos: seleccionadas, activo: false })}>Desactivar</button>
                                    <select
                                        className={styles.loteBoton}
                                        value=""
                                        onChange={(e) => e.target.value && setDuplicar({ origen: e.target.value, destinos: [...seleccion] })}
                                        aria-label="Copiar la configuración de un grupo a los seleccionados"
                                    >
                                        <option value="">Copiar configuración de…</option>
                                        {filas.map((f) => <option key={f.config.grupo_id} value={f.config.grupo_id} style={{ color: "#0f172a" }}>{f.nombre}</option>)}
                                    </select>
                                    <button type="button" className={styles.loteBoton} onClick={() => setSeleccion(new Set())}>Quitar selección</button>
                                </div>
                            )}

                            {visibles.length === 0 ? (
                                <EmptyState
                                    title="Ningún grupo coincide con los filtros"
                                    action={<Button size="sm" variant="secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar filtros</Button>}
                                />
                            ) : (
                                <div className={styles.grid}>
                                    {visibles.map((f) => (
                                        <TarjetaGrupo
                                            key={f.config.id}
                                            fila={f}
                                            ahora={ahora}
                                            seleccionada={seleccion.has(f.config.grupo_id)}
                                            cambiandoActivo={cambiando.has(f.config.grupo_id)}
                                            onSeleccionar={() => alternarSeleccion(f.config.grupo_id)}
                                            onAlternarActivo={() => alternarUno(f)}
                                            onEditar={(seccion) => setEditor({ grupoId: f.config.grupo_id, seccion })}
                                            onHistorial={() => { setGrupoHistorial(f.config.grupo_id); setVista("actividad"); }}
                                            onDuplicar={() => setDuplicar({ origen: f.config.grupo_id, destinos: [...seleccion] })}
                                        />
                                    ))}
                                </div>
                            )}

                        </>

                    )}

                </>

            )}

            {usuarioId && filaEditor && editor && (
                <EditorAutomatizacion
                    key={editor.grupoId}
                    usuarioId={usuarioId}
                    fila={filaEditor}
                    seccionInicial={editor.seccion}
                    ahora={ahora}
                    onClose={() => setEditor(null)}
                    onGuardado={(config) => reemplazarConfigs([config])}
                    onHistorial={() => { setGrupoHistorial(editor.grupoId); setEditor(null); setVista("actividad"); }}
                />
            )}

            {usuarioId && filaDuplicar && duplicar && (
                <DuplicarConfiguracion
                    usuarioId={usuarioId}
                    origen={filaDuplicar}
                    filas={filas}
                    destinosIniciales={duplicar.destinos}
                    onClose={() => setDuplicar(null)}
                    onAplicado={(nuevas) => { reemplazarConfigs(nuevas); setSeleccion(new Set()); }}
                />
            )}

            {cambioActivo && (() => {

                const afectados = cambioActivo.grupos.filter((f) => f.config.activo !== cambioActivo.activo);
                const conEvento = afectados.filter((f) => f.cicloAbierto);
                const sinAutorizar = afectados.filter((f) => f.autorizado === false);

                return (
                    <Modal
                        open
                        size="sm"
                        onClose={() => setCambioActivo(null)}
                        bloquearCierre={confirmarCambio.procesando}
                        title={cambioActivo.activo ? "Activar automatización" : "Desactivar automatización"}
                        footer={
                            <div className={styles.botonesPie}>
                                <Button variant="ghost" size="sm" onClick={() => setCambioActivo(null)} disabled={confirmarCambio.procesando}>Cancelar</Button>
                                <Button
                                    size="sm"
                                    variant={cambioActivo.activo ? "primary" : "danger"}
                                    onClick={onConfirmarCambio}
                                    loading={confirmarCambio.procesando}
                                    disabled={afectados.length === 0 || confirmarCambio.procesando}
                                >
                                    {cambioActivo.activo ? "Activar" : "Desactivar"} en {afectados.length} grupo{afectados.length === 1 ? "" : "s"}
                                </Button>
                            </div>
                        }
                    >
                        <div className={styles.seccion}>
                            {afectados.length === 0 ? (
                                <p className={styles.nota}>Todos los grupos elegidos ya están {cambioActivo.activo ? "activos" : "desactivados"}.</p>
                            ) : (
                                <ul className={styles.listaGrupos}>{afectados.map((f) => <li key={f.config.grupo_id}>{f.nombre}</li>)}</ul>
                            )}
                            {!cambioActivo.activo && afectados.length > 0 && (
                                <p className={styles.alerta}>
                                    <AlertTriangle size={14} />
                                    No saldrán recordatorios, actualizaciones, tabla inicial ni cierre nuevos en estos grupos. Lo ya enviado se
                                    conserva. {conEvento.length > 0 && `${conEvento.length} tiene${conEvento.length === 1 ? "" : "n"} un evento en marcha: sus recordatorios que venzan durante la pausa quedarán omitidos.`}
                                </p>
                            )}
                            {cambioActivo.activo && sinAutorizar.length > 0 && (
                                <Aviso tono="aviso">
                                    {sinAutorizar.length} grupo{sinAutorizar.length === 1 ? " no está autorizado" : "s no están autorizados"}: no abrirán ciclos hasta autorizarlos en Grupos.
                                </Aviso>
                            )}
                            <p className={styles.nota}>Solo cambia el interruptor de cada grupo; el resto de su configuración no se toca. Se aplica a todos o a ninguno.</p>
                        </div>
                    </Modal>
                );

            })()}

        </div>

    );

}
