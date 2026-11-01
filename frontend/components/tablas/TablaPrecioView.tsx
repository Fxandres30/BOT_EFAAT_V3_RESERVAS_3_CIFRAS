"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Loader2, AlertTriangle, ArrowLeft, Palette, LibraryBig, Filter } from "lucide-react";

import { useTablaPrecio } from "@/hooks/useTablaPrecio";
import { useTablaDiseno } from "@/hooks/useTablaDiseno";
import { useSeccionesPanel } from "@/hooks/useSeccionesPanel";
import { Aviso, avisar } from "@/components/ui/Avisos";
import { nuevaSolicitudId } from "@/services/tablas/reservaManual";
import AccionesTabla, { BotonIcono } from "./AccionesTabla";
import StatsBar from "./StatsBar";
import Grid from "./Grid";
import SeleccionPagos, { DialogoOperacion } from "./SeleccionPagos";
import HistorialNumeros from "./HistorialNumeros";
import AyudaContextual from "@/components/aprende/AyudaContextual";
import ReservasRecientes from "./ReservasRecientes";
import GruposPanel from "./GruposPanel";
import ActividadReciente from "./ActividadReciente";
import EditorDisenoModal from "./EditorDisenoModal";
import BibliotecaDisenosModal from "./BibliotecaDisenosModal";
import { estadoEfectivo } from "./estadoVisual";
import { FILTROS_HISTORIAL_VACIOS, numerosCoincidentes, type FiltrosHistorial } from "./historialDatos";
import { capturarTabla } from "@/services/tablas/capturarTabla";
import type { EventoActivo } from "./types";
import type { TablaDiseno } from "./disenoTypes";
import type { OperacionLote } from "@/services/tablas/pagoLote";
import { esDeOtroSorteo } from "@/services/tablas/seleccionTabla";
import { calcularResumenTabla } from "@/services/tablas/resumenTabla";
import { crearSeleccion, type EstadoSeleccion, type Seleccion } from "@/services/tablas/estadoSeleccion";

import styles from "./TablaPrecioView.module.css";

interface Props {
    precio: number;
}

export default function TablaPrecioView({ precio }: Props) {

    const {
        config,
        loading,
        error,
        diagnostico,
        usuarioId,
        numeros,
        eventoActivo,
        coincidePrecio,
        stats,
        paquetes,
        recientes,
        actividad,
        historial,
        historialCargado,
        auditoriaDisponible,
        desactualizada,
        accionando,
        cargarHistorial,
        recargar,
        reservar,
        marcarPagado,
        procesarLote,
        liberar,
        revisarReinicio,
        reiniciar
    } = useTablaPrecio(precio);

    // «Reservas recientes»: mismas operaciones del backend. El resultado se
    // avisa con un aviso flotante: éxito solo con la confirmación del
    // servidor, y el error explicado, sin ventanas del navegador.
    async function avisarResultado(numero: string, accion: () => Promise<{ ok: true } | { ok: false; mensaje: string }>, textoOk: string) {
        try {
            const r = await accion();
            if (r.ok) avisar.ok(textoOk);
            else avisar.error(`${numero}: ${r.mensaje}`);
        } catch {
            avisar.error(`${numero}: no se pudo completar la operación. Revisa el número antes de reintentar.`);
        }
    }

    function pagarDesdeLista(numero: string) {
        // Una solicitud por clic: el servidor no duplica un reintento de la misma.
        return avisarResultado(numero, () => marcarPagado(numero, { solicitudId: nuevaSolicitudId() }), `Pago del ${numero} registrado.`);
    }

    function liberarDesdeLista(numero: string) {
        const pagado = numeros.find(n => n.numero === numero)?.estado === "pagado";
        const motivo = pagado ? window.prompt(`Motivo para anular el pago del ${numero}:`) : undefined;
        if (pagado && !motivo?.trim()) return;
        return avisarResultado(numero, () => liberar(numero, { motivo: motivo?.trim() || undefined, solicitudId: nuevaSolicitudId() }), `Número ${numero} liberado.`);
    }

    // Tras un lote de pagos la tabla se recarga en segundo plano: hasta que
    // termine, la selección no cambia (no se elige sobre estados viejos).
    const seleccionBloqueada = accionando.has("lote");

    // ÚNICA búsqueda del panel: el buscador y los filtros viven en «Historial
    // de números» y filtran a la vez el historial y la cuadrícula, con la
    // misma regla (historialDatos.aplicarFiltros).
    const [filtros, setFiltros] = useState<FiltrosHistorial>(FILTROS_HISTORIAL_VACIOS);

    const coincidentes = useMemo(
        () => numerosCoincidentes(numeros, historial, filtros, estadoEfectivo),
        [numeros, historial, filtros]
    );

    // Secciones contraídas/abiertas: preferencia visual recordada por usuario.
    const { secciones, alternar: alternarSeccion } = useSeccionesPanel(usuarioId);

    // Diseño visual de ESTA tabla ($precio) — independiente de cualquier
    // otro precio. No toca números/reservas reales (useTablaPrecio, arriba).
    const {
        config: diseno,
        disenoOrigenId,
        personalizada,
        disenos,
        guardando: guardandoDiseno,
        guardarComoConfigDeTabla,
        guardarComoDisenoNuevo,
        aplicarDiseno,
        editarDisenoBiblioteca,
        duplicarDisenoBiblioteca,
        eliminarDisenoBiblioteca
    } = useTablaDiseno(precio);

    const [personalizarAbierto, setPersonalizarAbierto] = useState(false);
    const [bibliotecaAbierta, setBibliotecaAbierta] = useState(false);

    // El `div` de la tabla visible: «Compartir» lo captura tal cual.
    const tablaRef = useRef<HTMLDivElement>(null);
    const [disenoEnEdicion, setDisenoEnEdicion] = useState<TablaDiseno | null>(null);

    // «Seleccionar» (pago por lote). Ligada al precio: al cambiar de tabla
    // la selección no se arrastra. Se conserva al filtrar la cuadrícula.
    // Vive fuera del estado de esta vista: un clic solo vuelve a dibujar a
    // quien la muestra (<ConSeleccion>), no la pantalla entera.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una selección nueva por cada tabla
    const seleccion = useMemo(() => crearSeleccion(), [precio]);
    useEffect(() => { seleccion.bloquear(seleccionBloqueada); }, [seleccion, seleccionBloqueada]);

    // Estado efectivo de cada número: lo que clasifican la selección y las
    // acciones rápidas (el servidor vuelve a comprobarlo al operar).
    // otroSorteo: ocupado sin sorteo activo de este precio (con uno activo,
    // toda la tabla es suya: seleccionTabla.esDeOtroSorteo); en un lote solo
    // entra si el administrador lo incluye expresamente.
    const seleccionables = useMemo(() => numeros.map(n => {
        const estado = estadoEfectivo(n);
        return { numero: n.numero, estado, ...(esDeOtroSorteo({ ...n, estado }, coincidePrecio ? eventoActivo : null) ? { otroSorteo: true } : {}) };
    }), [numeros, eventoActivo, coincidePrecio]);

    // Resumen de la tabla (estados reales y recaudo del sorteo activo de
    // este precio, con TODOS los pagados de la tabla): mismo estado
    // efectivo que la cuadrícula.
    const resumen = useMemo(
        () => calcularResumenTabla(numeros.map(n => ({ ...n, estado: estadoEfectivo(n) })), precio, coincidePrecio ? eventoActivo : null),
        [numeros, precio, eventoActivo, coincidePrecio]
    );

    // Acciones rápidas de «Historial de números»: una operación sobre un
    // solo número (mismo diálogo y misma ruta que el lote) o su detalle.
    const [accionRapida, setAccionRapida] = useState<{ operacion: Exclude<OperacionLote, "reservar">; numero: string } | null>(null);
    const [detalle, setDetalle] = useState<string | null>(null);

    // Mientras «Compartir» captura la tabla, sin marcas de selección: la
    // imagen que reciben los grupos es siempre la cuadrícula limpia.
    const [capturando, setCapturando] = useState(false);
    async function capturarSinSeleccion() {
        flushSync(() => setCapturando(true));
        try {
            return await capturarTabla(tablaRef.current);
        } finally {
            setCapturando(false);
        }
    }

    // Auditoría, archivo y movimientos completos: al abrir «Historial de
    // números» y tenerlo a la vista (no al entrar a la cuadrícula).
    const historialRef = useRef<HTMLDivElement>(null);
    const hayNumeros = numeros.length > 0;
    useEffect(() => {
        if (!secciones.historial || historialCargado || loading || !hayNumeros) return;
        const el = historialRef.current;
        if (!el || typeof IntersectionObserver === "undefined") { cargarHistorial(); return; }
        const observador = new IntersectionObserver((entradas) => {
            if (entradas.some(e => e.isIntersecting)) { observador.disconnect(); cargarHistorial(); }
        }, { rootMargin: "400px 0px" });
        observador.observe(el);
        return () => observador.disconnect();
    }, [secciones.historial, historialCargado, loading, hayNumeros, cargarHistorial]);

    const verDetalleOAccion = useCallback((numero: string, accion: "detalle" | Exclude<OperacionLote, "reservar">) => (
        accion === "detalle" ? setDetalle(numero) : setAccionRapida({ operacion: accion, numero })
    ), []);

    if (loading) {

        return (
            <EstadoMensaje
                icon={Loader2}
                titulo="Cargando tabla..."
                descripcion="Obteniendo el estado real de las reservas."
                animarIcono
            />
        );

    }

    // Tras cargar: la configuración del cliente puede no ofrecer este precio
    // (sin sesión, se muestra el error de sesión de abajo).
    if (!config && usuarioId) {

        return (
            <EstadoMensaje
                icon={AlertTriangle}
                titulo="Precio no válido"
                descripcion={`No existe una tabla configurada para $${precio}.`}
            />
        );

    }

    if (error) {

        return (
            <EstadoMensaje
                icon={AlertTriangle}
                titulo="No se pudo cargar la tabla"
                descripcion={error}
                tono="error"
            />
        );

    }

    // Sin filas visibles: el estado real lo da el backend (useTablaPrecio).
    // Nunca se sugiere reiniciar: no crearía la cuadrícula si la base no lo
    // permite y no hace falta borrar nada.
    if (numeros.length === 0) {

        return (

            <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

                <Cabecera precio={precio} eventoActivo={eventoActivo} coincidePrecio={coincidePrecio} />

                <div className={styles.diagnostico}>
                    <span className={`${styles.estadoMensajeIcono} ${styles.estadoMensajeError}`}>
                        <AlertTriangle size={24} />
                    </span>
                    <h2 className={styles.estadoMensajeTitulo}>
                        {diagnostico?.titulo || "No se encontraron los números de esta tabla"}
                    </h2>
                    <p className={styles.estadoMensajeTexto}>
                        {diagnostico?.mensaje || "No se pudo confirmar el estado de tu cuadrícula. No reinicies la tabla; vuelve a cargar la página o avisa al administrador."}
                    </p>
                </div>

            </div>

        );

    }

    return (

        <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

            <Cabecera precio={precio} eventoActivo={eventoActivo} coincidePrecio={coincidePrecio} />

            {desactualizada && (
                <Aviso tono="aviso">
                    Sin conexión en tiempo real: lo que ves puede no estar al día. Se actualizará solo al recuperar la conexión; cada operación la sigue comprobando el servidor.
                </Aviso>
            )}

            <StatsBar resumen={resumen} precio={precio} />

            <AccionesTabla
                precio={precio}
                totalNumeros={stats.total}
                disponibles={stats.disponibles}
                usuarioId={usuarioId}
                onRevisarReinicio={revisarReinicio}
                onReiniciar={reiniciar}
                capturarTabla={capturarSinSeleccion}
                onActualizar={recargar}
                segundaFila={
                    <>
                        <BotonIcono
                            icon={Palette}
                            label="Personalizar"
                            color="text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                            mostrarTexto
                            onClick={() => setPersonalizarAbierto(true)}
                        />
                        <BotonIcono
                            icon={LibraryBig}
                            label="Diseños"
                            color="text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                            mostrarTexto
                            subtitulo={personalizada ? "Diseño personalizado" : undefined}
                            onClick={() => setBibliotecaAbierta(true)}
                        />
                    </>
                }
            />

            {coincidentes && (
                <div className={styles.filtro}>
                    <span className="flex items-center gap-2 min-w-0">
                        <Filter size={14} className="shrink-0" />
                        Cuadrícula filtrada desde «Historial de números»: {coincidentes.size} de {numeros.length} números.
                    </span>
                    <button
                        type="button"
                        onClick={() => setFiltros(FILTROS_HISTORIAL_VACIOS)}
                        className={styles.filtroBoton}
                    >
                        Mostrar todos
                    </button>
                </div>
            )}

            <ConSeleccion seleccion={seleccion}>{(sel) => (
                <SeleccionPagos
                    precio={precio}
                    activo={sel.activo}
                    bloqueado={seleccionBloqueada}
                    numeros={seleccionables}
                    seleccion={sel.numeros}
                    onActivar={seleccion.activar}
                    onSalir={seleccion.salir}
                    onLimpiar={seleccion.limpiar}
                    onCambiarSeleccion={seleccion.cambiar}
                    onQuitar={seleccion.quitar}
                    onProcesar={procesarLote}
                />
            )}</ConSeleccion>

            <ConSeleccion seleccion={seleccion}>{(sel) => (
            <Grid
                contenedorRef={tablaRef}
                seleccion={sel.activo && !capturando ? sel.conjunto : null}
                onAlternarSeleccion={seleccion.alternar}
                detalle={detalle}
                onDetalleChange={setDetalle}
                precio={precio}
                numeros={numeros}
                paquetes={paquetes}
                eventoActivo={eventoActivo}
                coincidePrecio={coincidePrecio}
                coincidentes={coincidentes}
                accionando={accionando}
                diseno={diseno}
                onReservar={reservar}
                onMarcarPagado={marcarPagado}
                onLiberar={liberar}
            />
            )}</ConSeleccion>

            <div ref={historialRef}>
            <ConSeleccion seleccion={seleccion}>{(sel) => (
            <HistorialNumeros
                filas={historial}
                auditoriaDisponible={auditoriaDisponible}
                filtros={filtros}
                onFiltrosChange={setFiltros}
                expandido={secciones.historial}
                onToggleExpandido={() => alternarSeccion("historial")}
                ocupado={accionando.size > 0}
                onAccion={verDetalleOAccion}
                seleccion={sel.activo ? sel.conjunto : null}
                onAlternarSeleccion={seleccion.alternar}
                cargando={secciones.historial && !historialCargado}
            />
            )}</ConSeleccion>
            </div>

            {accionRapida && (
                <DialogoOperacion
                    key={`${accionRapida.operacion}:${accionRapida.numero}`}
                    operacion={accionRapida.operacion}
                    numeros={seleccionables}
                    seleccion={[accionRapida.numero]}
                    onProcesar={procesarLote}
                    // Acción sobre UN número elegido a mano: ya es la decisión expresa.
                    incluirOtroSorteoInicial
                    onClose={() => setAccionRapida(null)}
                />
            )}

            <ReservasRecientes
                precio={precio}
                numeros={recientes}
                accionando={accionando}
                onMarcarPagado={pagarDesdeLista}
                onLiberar={liberarDesdeLista}
                expandido={secciones.reservas}
                onToggleExpandido={() => alternarSeccion("reservas")}
            />

            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                <GruposPanel
                    paquetes={paquetes}
                    precio={precio}
                    expandido={secciones.grupos}
                    onToggleExpandido={() => alternarSeccion("grupos")}
                />
                <ActividadReciente
                    actividad={actividad}
                    expandido={secciones.actividad}
                    onToggleExpandido={() => alternarSeccion("actividad")}
                />
            </div>

            <EditorDisenoModal
                open={personalizarAbierto}
                onClose={() => setPersonalizarAbierto(false)}
                titulo={`Personalizar tabla $${precio.toLocaleString("es-CO")}`}
                descripcion="Los cambios solo afectan a esta tabla."
                initialConfig={diseno}
                guardando={guardandoDiseno}
                onGuardar={(nuevaConfig) => guardarComoConfigDeTabla(nuevaConfig, disenoOrigenId)}
                onGuardarComoNuevo={async (nombre, nuevaConfig) => { await guardarComoDisenoNuevo(nombre, nuevaConfig); }}
            />

            <BibliotecaDisenosModal
                open={bibliotecaAbierta}
                onClose={() => setBibliotecaAbierta(false)}
                disenos={disenos}
                disenoActualId={disenoOrigenId}
                onAplicar={async (origenId, configOrigen) => {
                    await aplicarDiseno(origenId, configOrigen);
                    setBibliotecaAbierta(false);
                }}
                onEditar={(d) => {
                    setDisenoEnEdicion(d);
                    setBibliotecaAbierta(false);
                }}
                onDuplicar={async (d) => { await duplicarDisenoBiblioteca(d); }}
                onEliminar={(d) => eliminarDisenoBiblioteca(d.id)}
            />

            {disenoEnEdicion && (
                <EditorDisenoModal
                    open
                    onClose={() => setDisenoEnEdicion(null)}
                    titulo={`Editar diseño «${disenoEnEdicion.nombre}»`}
                    descripcion="Actualiza este diseño de tu biblioteca. Las tablas que ya lo aplicaron conservan su propia copia."
                    initialConfig={disenoEnEdicion.config}
                    textoGuardar="Guardar diseño"
                    onGuardar={async (nuevaConfig) => {
                        await editarDisenoBiblioteca(disenoEnEdicion.id, { config: nuevaConfig });
                        setDisenoEnEdicion(null);
                    }}
                />
            )}

        </div>

    );

}

// Suscripción a la selección: solo quien la muestra se vuelve a dibujar al
// marcar un número.
function ConSeleccion({ seleccion, children }: { seleccion: Seleccion; children: (estado: EstadoSeleccion) => ReactNode }) {
    const estado = useSyncExternalStore(seleccion.suscribir, seleccion.obtener, seleccion.obtener);
    return children(estado);
}

// Exportada solo para la página de revisión visual (app/ui-preview).
export function Cabecera({
    precio,
    eventoActivo,
    coincidePrecio
}: {
    precio: number;
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
}) {

    const precioTexto = `$${precio.toLocaleString("es-CO")}`;

    return (

        <div className="space-y-3 min-w-0">

            <header className={styles.cabecera}>

                <Link href="/tablas" prefetch={false} className={styles.volver}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    Reservas
                </Link>

                <div className={styles.cabeceraFila}>

                    <div className="min-w-0">
                        <h1 className={styles.titulo}>
                            <span className={styles.tituloRotulo}>Tabla</span>
                            <span className={styles.tituloPrecio}>{precioTexto}</span>
                        </h1>
                        <p className={styles.subtitulo}>
                            {eventoActivo?.nombre_evento || "Administra las reservas de esta dinámica."}
                        </p>
                    </div>

                    <div className={styles.cabeceraAcciones}>
                        {coincidePrecio ? (
                            <span className={`${styles.estadoEvento} ${styles.estadoActivo}`}>
                                <span className={styles.pulso} aria-hidden="true" />
                                Evento activo
                            </span>
                        ) : (
                            <span className={styles.estadoEvento}>
                                <span className={styles.punto} aria-hidden="true" />
                                Sin evento activo para {precioTexto}
                            </span>
                        )}
                        <span className={styles.ayuda}>
                            <AyudaContextual slug="tablas-de-precio" />
                        </span>
                    </div>

                </div>

            </header>

            {!coincidePrecio && (

                <Aviso tono="aviso">
                    {eventoActivo
                        ? `El evento activo en esta tabla física ahora mismo es "${eventoActivo.nombre_evento}" por $${Number(eventoActivo.valor).toLocaleString("es-CO")}, no por ${precioTexto}. Los números ocupados por ese evento se ven como reservados o pagados en esta tabla.`
                        : `No hay ningún evento activo en esta tabla ahora mismo. Las celdas muestran su último estado real, pero no se pueden reservar hasta abrir un evento de ${precioTexto}.`}
                </Aviso>

            )}

        </div>

    );

}

function EstadoMensaje({
    icon: Icon,
    titulo,
    descripcion,
    tono = "normal",
    animarIcono = false
}: {
    icon: typeof Loader2;
    titulo: string;
    descripcion: string;
    tono?: "normal" | "error";
    animarIcono?: boolean;
}) {

    return (

        <div className={styles.estadoMensaje}>
            <span className={`${styles.estadoMensajeIcono} ${tono === "error" ? styles.estadoMensajeError : ""}`}>
                <Icon size={24} className={animarIcono ? "animate-spin" : undefined} />
            </span>
            <h2 className={styles.estadoMensajeTitulo}>{titulo}</h2>
            <p className={styles.estadoMensajeTexto}>{descripcion}</p>
        </div>

    );

}
