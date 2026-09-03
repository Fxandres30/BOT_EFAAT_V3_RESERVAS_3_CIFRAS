"use client";

import { useEffect, useState } from "react";

import "./MensajesPage.css";

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

const CATEGORIAS: Array<{ nombre: TipoMensaje["categoria"]; icono: string }> = [
    { nombre: "Reservas", icono: "🎟️" },
    { nombre: "Consultas", icono: "🔎" },
    { nombre: "Futuro", icono: "🧪" }
];

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

    // Fase 5.5: estado (🟢/🔴) de cada TIPO DE RESPUESTA, independiente de
    // las plantillas y del modo de selección. Un tipo sin entrada aquí
    // todavía se trata como habilitado (mismo DEFAULT SEGURO del backend).
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
        return <div className="mensajes-loading">Cargando...</div>;
    }

    if (!usuarioId) {
        return <div className="mensajes-loading">Debes iniciar sesión para configurar mensajes.</div>;
    }

    if (!inicializacionLista) {
        return <div className="mensajes-loading">Inicializando plantillas...</div>;
    }

    return (

        <div className="mensajes-page">

            <div>

                <h1 className="mensajes-titulo">Mensajes</h1>

                <p className="mensajes-subtitulo">
                    Administra las respuestas que EFAAT puede enviar. Cada tipo
                    de resultado puede tener muchas plantillas habilitadas — tú
                    decides si el BOT usa siempre la misma, rota entre ellas, o
                    elige al azar. El BOT sigue calculando reservas y
                    disponibilidad exactamente igual; esto solo cambia cómo se
                    redacta el mensaje final.
                </p>

                {resumen && (

                    <p className="mensajes-resumen-global">
                        {TIPOS_MENSAJE.filter((t) => t.soportado).length} tipos ·{" "}
                        {resumen.total} plantilla{resumen.total === 1 ? "" : "s"} ·{" "}
                        {resumen.habilitadas} habilitada{resumen.habilitadas === 1 ? "" : "s"}
                    </p>

                )}

                {errorInicializacion && (

                    <p className="mensajes-resumen-error">
                        ⚠️ {errorInicializacion}
                    </p>

                )}

            </div>

            <div className="mensajes-layout">

                <aside className="mensajes-lista-tipos">

                    {CATEGORIAS.map((cat) => (

                        <div key={cat.nombre} className="mensajes-categoria">

                            <p className="mensajes-categoria-titulo">
                                {cat.icono} {cat.nombre}
                            </p>

                            {TIPOS_MENSAJE.filter((t) => t.categoria === cat.nombre).map((tipo) => {

                                const habilitado = estaHabilitado(tipo.id);

                                return (

                                    <button
                                        key={tipo.id}
                                        className={`mensajes-item ${tipoSeleccionado.id === tipo.id ? "activo" : ""} ${!tipo.soportado ? "futuro" : ""}`}
                                        onClick={() => setTipoSeleccionado(tipo)}
                                    >
                                        <span>{tipo.icono} {tipo.nombre}</span>

                                        {tipo.soportado && (

                                            <span
                                                className={`tipo-interruptor ${habilitado ? "on" : "off"}`}
                                                role="switch"
                                                aria-checked={habilitado}
                                                title={habilitado ? "Respuesta activada — clic para desactivar" : "Respuesta desactivada — clic para activar"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    alternarTipoHabilitado(tipo.id);
                                                }}
                                            >
                                                {habilitado ? "🟢" : "🔴"}
                                            </span>

                                        )}
                                    </button>

                                );

                            })}

                        </div>

                    ))}

                </aside>

                {!tipoSeleccionado.soportado ? (

                    <div className="mensajes-futuro">

                        <h2>{tipoSeleccionado.icono} {tipoSeleccionado.nombre}</h2>

                        <p>
                            Este tipo de respuesta está preparado en la
                            arquitectura, pero el BOT todavía no genera este
                            resultado — por eso no hay plantillas reales que
                            configurar aquí todavía.
                        </p>

                    </div>

                ) : errorCarga ? (

                    <div className="mensajes-error">

                        <h2>⚠️ No se pudo cargar</h2>
                        <p>{errorCarga}</p>

                    </div>

                ) : cargandoPlantillas ? (

                    <div className="mensajes-cargando-tipo">Cargando plantillas...</div>

                ) : (

                    <div className="mensajes-contenido-tipo">

                        <div>

                            <div className="mensajes-tipo-header">
                                <h2>{tipoSeleccionado.icono} {tipoSeleccionado.nombre}</h2>
                                <div className="mensajes-tipo-header-derecha">
                                    <button
                                        className={`tipo-interruptor-grande ${estaHabilitado(tipoSeleccionado.id) ? "on" : "off"}`}
                                        onClick={() => alternarTipoHabilitado(tipoSeleccionado.id)}
                                    >
                                        {estaHabilitado(tipoSeleccionado.id) ? "🟢 Respuesta activada" : "🔴 Respuesta desactivada"}
                                    </button>
                                    <span className="mensajes-tipo-contador">
                                        {plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}
                                    </span>
                                </div>
                            </div>

                            {!estaHabilitado(tipoSeleccionado.id) && (

                                <p className="mensajes-tipo-nota-desactivado">
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

    );

}
