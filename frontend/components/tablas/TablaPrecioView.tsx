"use client";

import { useMemo, useRef, useState } from "react";
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
        auditoriaDisponible,
        accionando,
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
    const [seleccionDe, setSeleccionDe] = useState<{ precio: number; activo: boolean; numeros: string[] }>({ precio, activo: false, numeros: [] });
    const modoSeleccion = seleccionDe.precio === precio ? seleccionDe : { precio, activo: false, numeros: [] as string[] };
    const conjuntoSeleccion = useMemo(() => new Set(modoSeleccion.numeros), [modoSeleccion.numeros]);
    const cambiarSeleccion = (cambio: Partial<{ activo: boolean; numeros: string[] }>) =>
        setSeleccionDe(prev => ({ ...(prev.precio === precio ? prev : { precio, activo: false, numeros: [] }), ...cambio }));
    const alternarSeleccion = (numero: string) => {
        if (seleccionBloqueada) return;
        cambiarSeleccion({ numeros: conjuntoSeleccion.has(numero) ? modoSeleccion.numeros.filter(n => n !== numero) : [...modoSeleccion.numeros, numero] });
    };

    // Estado efectivo de cada número: lo que clasifican la selección y las
    // acciones rápidas (el servidor vuelve a comprobarlo al operar).
    // otroSorteo: ocupado por un sorteo que no es el activo (por identidad);
    // en un lote solo entra si el administrador lo incluye expresamente.
    const seleccionables = useMemo(() => numeros.map(n => {
        const estado = estadoEfectivo(n);
        return { numero: n.numero, estado, ...(esDeOtroSorteo({ ...n, estado }, coincidePrecio ? eventoActivo : null) ? { otroSorteo: true } : {}) };
    }), [numeros, eventoActivo, coincidePrecio]);

    // Resumen de la tabla (estados reales y recaudo del sorteo activo de
    // este precio): mismo estado efectivo que la cuadrícula.
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

            <SeleccionPagos
                precio={precio}
                activo={modoSeleccion.activo}
                bloqueado={seleccionBloqueada}
                numeros={seleccionables}
                seleccion={modoSeleccion.numeros}
                onActivar={() => cambiarSeleccion({ activo: true, numeros: [] })}
                onSalir={() => cambiarSeleccion({ activo: false, numeros: [] })}
                onLimpiar={() => cambiarSeleccion({ numeros: [] })}
                onCambiarSeleccion={(lista) => cambiarSeleccion({ numeros: lista })}
                onQuitar={(numero) => cambiarSeleccion({ numeros: modoSeleccion.numeros.filter(n => n !== numero) })}
                onProcesar={procesarLote}
            />

            <Grid
                contenedorRef={tablaRef}
                seleccion={modoSeleccion.activo && !capturando ? conjuntoSeleccion : null}
                onAlternarSeleccion={alternarSeleccion}
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

            <HistorialNumeros
                filas={historial}
                auditoriaDisponible={auditoriaDisponible}
                filtros={filtros}
                onFiltrosChange={setFiltros}
                expandido={secciones.historial}
                onToggleExpandido={() => alternarSeccion("historial")}
                ocupado={accionando.size > 0}
                onAccion={(numero, accion) => (accion === "detalle" ? setDetalle(numero) : setAccionRapida({ operacion: accion, numero }))}
                seleccion={modoSeleccion.activo ? conjuntoSeleccion : null}
                onAlternarSeleccion={alternarSeleccion}
            />

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
