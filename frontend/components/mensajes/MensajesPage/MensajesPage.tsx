"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

import { getUser } from "@/services/auth/getUser";
import { TIPOS_MENSAJE, TipoMensaje } from "@/services/mensajes/tiposMensaje";
import {
    PlantillaMensaje,
    listarPlantillas,
    sembrarPlantillasIniciales,
    contarTodasLasPlantillas,
    contarHabilitadas,
    sembrarTodosLosTiposIniciales
} from "@/services/mensajes/plantillas";
import {
    ConfiguracionSeleccion,
    obtenerConfiguracionSeleccion,
    obtenerEstadosHabilitados,
    guardarTipoHabilitado,
    ModoSeleccion as TipoModo
} from "@/services/mensajes/configuracionSeleccion";

import ListaPlantillas from "../ListaPlantillas/ListaPlantillas";
import EditorMensaje from "../EditorMensaje/EditorMensaje";
import ModoSeleccion from "../ModoSeleccion/ModoSeleccion";

import styles from "./MensajesPage.module.css";

const CATEGORIAS: TipoMensaje["categoria"][] = ["Reservas", "Consultas", "Futuro"];

export default function MensajesPage() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargandoUsuario, setCargandoUsuario] = useState(true);

    const [tipoSeleccionado, setTipoSeleccionado] = useState<TipoMensaje>(TIPOS_MENSAJE[0]);
    const [plantillas, setPlantillas] = useState<PlantillaMensaje[]>([]);
    const [configSeleccion, setConfigSeleccion] = useState<ConfiguracionSeleccion | null>(null);

    const [cargandoPlantillas, setCargandoPlantillas] = useState(false);
    const [errorCarga, setErrorCarga] = useState<string | null>(null);

    const [plantillaSeleccionada, setPlantillaSeleccionada] = useState<PlantillaMensaje | null>(null);

    // Se vuelve true recién cuando la inicialización global (150 = 10x15)
    // ya se decidió — hasta entonces no se carga ningún tipo individual,
    // para no competir en una carrera con el seed masivo.
    const [inicializacionLista, setInicializacionLista] = useState(false);
    const [errorInicializacion, setErrorInicializacion] = useState<string | null>(null);

    const [resumen, setResumen] = useState<{ total: number; habilitadas: number } | null>(null);

    // Fase 5.5: estado de cada TIPO DE RESPUESTA, independiente de las
    // plantillas y del modo de selección. Un tipo sin entrada aquí todavía
    // se trata como habilitado (mismo DEFAULT SEGURO del backend).
    const [estadosHabilitados, setEstadosHabilitados] = useState<Record<string, boolean>>({});

    function estaHabilitado(tipoId: string) {
        return estadosHabilitados[tipoId] ?? true;
    }

    async function alternarTipoHabilitado(tipoId: string) {

        if (!usuarioId) return;

        const actual = estaHabilitado(tipoId);
        const nuevo = !actual;

        // Optimista: refleja el cambio de inmediato en el panel; revierte
        // si Supabase no confirma el guardado. El comportamiento real del
        // BOT siempre depende de Supabase, nunca de este estado local.
        setEstadosHabilitados((prev) => ({ ...prev, [tipoId]: nuevo }));

        const { error } = await guardarTipoHabilitado(usuarioId, tipoId, nuevo);

        if (error) {
            setEstadosHabilitados((prev) => ({ ...prev, [tipoId]: actual }));
        }

    }

    useEffect(() => {

        async function cargarUsuario() {

            const { data } = await getUser();

            setUsuarioId(data.user?.id || null);
            setCargandoUsuario(false);

        }

        cargarUsuario();

    }, []);

    // Inicialización global: se ejecuta UNA vez por usuario. Si todavía no
    // tiene NINGUNA plantilla en NINGÚN tipo, crea las 15 de cada uno de
    // los 10 tipos soportados (150 en total) sin que haga falta abrir cada
    // tipo manualmente. Si ya tiene al menos una (aunque sea 1 de 150,
    // porque borró el resto), no vuelve a sembrar nada automáticamente.
    useEffect(() => {

        if (!usuarioId) return;

        async function inicializar() {

            const { count, error } = await contarTodasLasPlantillas(usuarioId!);

            if (error) {

                setErrorInicializacion(`No se pudo verificar Supabase (${error.message}). Probablemente la migración todavía no se ejecutó.`);
                setInicializacionLista(true);
                return;

            }

            if (!count || count === 0) {

                const resultadoSeed = await sembrarTodosLosTiposIniciales(usuarioId!);

                if (resultadoSeed.errores.length > 0) {

                    setErrorInicializacion(`No se pudieron crear todas las plantillas iniciales: ${resultadoSeed.errores[0]}`);

                }

            }

            setInicializacionLista(true);

        }

        inicializar();

    }, [usuarioId]);

    // Resumen real (10 tipos / total / habilitadas) — solo se muestra si
    // Supabase realmente devuelve datos, nunca hardcodeado.
    useEffect(() => {

        if (!usuarioId || !inicializacionLista) return;

        async function cargarResumen() {

            const [totalRes, habilitadasRes] = await Promise.all([
                contarTodasLasPlantillas(usuarioId!),
                contarHabilitadas(usuarioId!)
            ]);

            if (totalRes.count != null && habilitadasRes.count != null) {

                setResumen({ total: totalRes.count, habilitadas: habilitadasRes.count });

            }

        }

        cargarResumen();

    }, [usuarioId, inicializacionLista, plantillas.length]);

    // Estado de los interruptores por tipo (Fase 5.5) — se carga una vez,
    // para los 10 tipos a la vez (no requiere abrir cada tipo).
    useEffect(() => {

        if (!usuarioId || !inicializacionLista) return;

        async function cargarEstados() {

            const { data, error } = await obtenerEstadosHabilitados(usuarioId!);

            if (!error && data) {

                const mapa: Record<string, boolean> = {};

                data.forEach((fila: { tipo_respuesta: string; habilitada: boolean }) => {
                    mapa[fila.tipo_respuesta] = fila.habilitada;
                });

                setEstadosHabilitados(mapa);

            }

        }

        cargarEstados();

    }, [usuarioId, inicializacionLista]);

    async function cargarTipo(tipo: TipoMensaje, uid: string) {

        setCargandoPlantillas(true);
        setErrorCarga(null);
        setPlantillaSeleccionada(null);

        if (!tipo.soportado) {

            setPlantillas([]);
            setCargandoPlantillas(false);
            return;

        }

        // 1) Leer lo que ya existe.
        let { data, error } = await listarPlantillas(uid, tipo.id);

        if (error) {

            setErrorCarga(`No se pudo cargar (${error.message}). Verifica que la migración de Supabase esté ejecutada.`);
            setPlantillas([]);
            setCargandoPlantillas(false);
            return;

        }

        // 2) Solo se siembra si el usuario NO tiene ninguna fila todavía
        // para este tipo (condición de inicialización — ver
        // sembrarPlantillasIniciales). Nunca se reinserta si ya hay algo,
        // aunque sean menos de 15.
        if (!data || data.length === 0) {

            const resultado = await sembrarPlantillasIniciales(uid, tipo.id);

            if (resultado.error) {

                setErrorCarga(`No se pudieron crear las plantillas iniciales (${resultado.error}). Verifica que la migración de Supabase esté ejecutada.`);
                setPlantillas([]);
                setCargandoPlantillas(false);
                return;

            }

            const recargado = await listarPlantillas(uid, tipo.id);

            data = recargado.data;

        }

        const lista = data || [];

        setPlantillas(lista);

        setPlantillaSeleccionada(lista[0] || null);

        // 3) Configuración de selección (fijo/aleatorio/rotación).
        const { data: config } = await obtenerConfiguracionSeleccion(uid, tipo.id);

        setConfigSeleccion(config || null);

        setCargandoPlantillas(false);

    }

    useEffect(() => {

        if (!usuarioId || !inicializacionLista) return;

        cargarTipo(tipoSeleccionado, usuarioId);

    }, [tipoSeleccionado.id, usuarioId, inicializacionLista]);

    function actualizarListaLocal(actualizada: PlantillaMensaje) {

        setPlantillas((prev) => prev.map((p) => (p.id === actualizada.id ? actualizada : p)));
        setPlantillaSeleccionada(actualizada);

    }

    function agregarNuevaLocal(nueva: PlantillaMensaje) {

        setPlantillas((prev) => [...prev, nueva]);
        setPlantillaSeleccionada(nueva);

    }

    function quitarLocal(id: string) {

        setPlantillas((prev) => {

            const restantes = prev.filter((p) => p.id !== id);

            setPlantillaSeleccionada((actual) => (actual?.id === id ? restantes[0] || null : actual));

            return restantes;

        });

    }

    if (cargandoUsuario) {
        return <div className={styles.state}>Cargando…</div>;
    }

    if (!usuarioId) {
        return <div className={styles.state}>Debes iniciar sesión para configurar mensajes.</div>;
    }

    if (!inicializacionLista) {
        return <div className={styles.state}>Inicializando plantillas…</div>;
    }

    const tiposSoportados = TIPOS_MENSAJE.filter((t) => t.soportado).length;

    return (

        <div className={styles.page}>

            <PageHeader
                title="Mensajes"
                description="Respuestas que EFAAT puede enviar. Cada tipo de resultado puede tener varias plantillas: fija, aleatoria o por rotación. El BOT calcula reservas y disponibilidad igual; esto solo cambia la redacción."
            />

            {resumen && (
                <p className={styles.summary}>
                    {tiposSoportados} tipos · {resumen.total} plantilla{resumen.total === 1 ? "" : "s"} ·{" "}
                    {resumen.habilitadas} habilitada{resumen.habilitadas === 1 ? "" : "s"}
                </p>
            )}

            {errorInicializacion && (
                <div className={styles.alert}>
                    <AlertTriangle size={15} />
                    <span>{errorInicializacion}</span>
                </div>
            )}

            <div className={styles.layout}>

                <aside className={styles.rail}>

                    {CATEGORIAS.map((categoria) => (

                        <div key={categoria} className={styles.railGroup}>

                            <p className={styles.railGroupTitle}>{categoria}</p>

                            {TIPOS_MENSAJE.filter((t) => t.categoria === categoria).map((tipo) => {

                                const habilitado = estaHabilitado(tipo.id);

                                return (

                                    <button
                                        key={tipo.id}
                                        className={[
                                            styles.railItem,
                                            tipoSeleccionado.id === tipo.id ? styles.railItemActive : "",
                                            !tipo.soportado ? styles.railItemFuturo : ""
                                        ].join(" ")}
                                        onClick={() => setTipoSeleccionado(tipo)}
                                    >
                                        <span className={styles.railItemName}>
                                            {tipo.icono} {tipo.nombre}
                                        </span>

                                        {tipo.soportado && (
                                            <span
                                                className={`${styles.switch} ${habilitado ? styles.switchOn : ""}`}
                                                role="switch"
                                                aria-checked={habilitado}
                                                title={habilitado ? "Respuesta activada — clic para desactivar" : "Respuesta desactivada — clic para activar"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    alternarTipoHabilitado(tipo.id);
                                                }}
                                            />
                                        )}
                                    </button>

                                );

                            })}

                        </div>

                    ))}

                </aside>

                <div className={styles.main}>

                    {!tipoSeleccionado.soportado ? (

                        <EmptyState
                            icon={<Sparkles size={20} />}
                            title={`${tipoSeleccionado.icono} ${tipoSeleccionado.nombre}`}
                            description="Este tipo de respuesta está preparado en la arquitectura, pero el BOT todavía no lo genera — por eso aún no hay plantillas reales que configurar."
                        />

                    ) : errorCarga ? (

                        <div className={styles.errorCard}>
                            <strong>
                                <AlertTriangle size={16} /> No se pudo cargar
                            </strong>
                            {errorCarga}
                        </div>

                    ) : cargandoPlantillas ? (

                        <div className={styles.state}>Cargando plantillas…</div>

                    ) : (

                        <div className={styles.contenido}>

                            <div className={styles.contenidoCol}>

                                <div className={styles.typeHeader}>
                                    <h2 className={styles.typeTitle}>
                                        {tipoSeleccionado.icono} {tipoSeleccionado.nombre}
                                    </h2>
                                    <div className={styles.typeHeaderRight}>
                                        <button
                                            className={`${styles.typeToggle} ${estaHabilitado(tipoSeleccionado.id) ? styles.typeToggleOn : styles.typeToggleOff}`}
                                            onClick={() => alternarTipoHabilitado(tipoSeleccionado.id)}
                                        >
                                            {estaHabilitado(tipoSeleccionado.id) ? "Respuesta activada" : "Respuesta desactivada"}
                                        </button>
                                        <span className={styles.count}>
                                            {plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                </div>

                                {!estaHabilitado(tipoSeleccionado.id) && (
                                    <p className={styles.note}>
                                        El BOT sigue detectando esta intención y (si aplica) ejecutando la
                                        operación real, pero no enviará ningún mensaje de este tipo mientras
                                        esté desactivado. Las {plantillas.length} plantillas siguen existiendo
                                        y son editables.
                                    </p>
                                )}

                                <ModoSeleccion
                                    usuarioId={usuarioId}
                                    tipoId={tipoSeleccionado.id}
                                    modoActual={configSeleccion?.modo_seleccion || "aleatorio"}
                                    plantillaFijaId={configSeleccion?.plantilla_fija_id || null}
                                    plantillas={plantillas}
                                    onGuardado={(modo: TipoModo, plantillaFijaId: string | null) => {

                                        setConfigSeleccion((prev) => ({
                                            ...(prev as ConfiguracionSeleccion),
                                            modo_seleccion: modo,
                                            plantilla_fija_id: plantillaFijaId
                                        }));

                                    }}
                                />

                                <ListaPlantillas
                                    tipo={tipoSeleccionado}
                                    plantillas={plantillas}
                                    seleccionada={plantillaSeleccionada}
                                    usuarioId={usuarioId}
                                    onSeleccionar={setPlantillaSeleccionada}
                                    onCambiada={actualizarListaLocal}
                                    onDuplicada={agregarNuevaLocal}
                                    onEliminada={quitarLocal}
                                    onCreada={agregarNuevaLocal}
                                />

                            </div>

                            {plantillaSeleccionada && (

                                <EditorMensaje
                                    key={plantillaSeleccionada.id}
                                    tipo={tipoSeleccionado}
                                    usuarioId={usuarioId}
                                    plantilla={plantillaSeleccionada}
                                    onGuardada={actualizarListaLocal}
                                    onGuardadaComoNueva={agregarNuevaLocal}
                                />

                            )}

                        </div>

                    )}

                </div>

            </div>

        </div>

    );

}
