"use client";

import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Loader2, AlertTriangle, Info, Palette, LibraryBig, Filter } from "lucide-react";

import { useTablaPrecio } from "@/hooks/useTablaPrecio";
import { useTablaDiseno } from "@/hooks/useTablaDiseno";
import { useSeccionesPanel } from "@/hooks/useSeccionesPanel";
import { Badge } from "@/components/ui/Badge";
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
        reservar,
        marcarPagado,
        procesarLote,
        liberar,
        revisarReinicio,
        reiniciar
    } = useTablaPrecio(precio);

    // «Reservas recientes»: mismas operaciones del backend; un rechazo se
    // avisa (antes el error se perdía en una promesa sin capturar).
    async function pagarDesdeLista(numero: string) {
        const r = await marcarPagado(numero);
        if (!r.ok) alert(r.mensaje);
    }

    async function liberarDesdeLista(numero: string) {
        const pagado = numeros.find(n => n.numero === numero)?.estado === "pagado";
        const motivo = pagado ? window.prompt(`Motivo para anular el pago del ${numero}:`) : undefined;
        if (pagado && !motivo?.trim()) return;
        const r = await liberar(numero, { motivo: motivo?.trim() || undefined });
        if (!r.ok) alert(r.mensaje);
    }

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
    const alternarSeleccion = (numero: string) =>
        cambiarSeleccion({ numeros: conjuntoSeleccion.has(numero) ? modoSeleccion.numeros.filter(n => n !== numero) : [...modoSeleccion.numeros, numero] });

    // Estado efectivo de cada número: lo que clasifican la selección y las
    // acciones rápidas (el servidor vuelve a comprobarlo al operar).
    // otroSorteo: ocupado por un sorteo que no es el activo (por identidad);
    // en un lote solo entra si el administrador lo incluye expresamente.
    const seleccionables = useMemo(() => numeros.map(n => {
        const estado = estadoEfectivo(n);
        return { numero: n.numero, estado, ...(esDeOtroSorteo({ ...n, estado }, eventoActivo) ? { otroSorteo: true } : {}) };
    }), [numeros, eventoActivo]);

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

                <div className="border border-red-200 rounded-2xl p-6 sm:p-10 text-center bg-white">
                    <AlertTriangle size={28} className="mx-auto mb-3 text-red-500" />
                    <h2 className="text-xl font-bold mb-2">
                        {diagnostico?.titulo || "No se encontraron los números de esta tabla"}
                    </h2>
                    <p className="text-gray-500 max-w-xl mx-auto">
                        {diagnostico?.mensaje || "No se pudo confirmar el estado de tu cuadrícula. No reinicies la tabla; vuelve a cargar la página o avisa al administrador."}
                    </p>
                </div>

            </div>

        );

    }

    return (

        <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

            <Cabecera precio={precio} eventoActivo={eventoActivo} coincidePrecio={coincidePrecio} />

            <StatsBar stats={stats} />

            <AccionesTabla
                precio={precio}
                totalNumeros={stats.total}
                disponibles={stats.disponibles}
                usuarioId={usuarioId}
                onRevisarReinicio={revisarReinicio}
                onReiniciar={reiniciar}
                capturarTabla={capturarSinSeleccion}
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
                            onClick={() => setBibliotecaAbierta(true)}
                        />
                        {personalizada && <Badge tone="primary" size="sm">Diseño personalizado</Badge>}
                    </>
                }
            />

            {coincidentes && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 border border-blue-100 text-blue-800 text-sm rounded-xl px-3 py-2 min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                        <Filter size={14} className="shrink-0" />
                        Cuadrícula filtrada desde «Historial de números»: {coincidentes.size} de {numeros.length} números.
                    </span>
                    <button
                        type="button"
                        onClick={() => setFiltros(FILTROS_HISTORIAL_VACIOS)}
                        className="text-blue-700 font-medium hover:underline"
                    >
                        Mostrar todos
                    </button>
                </div>
            )}

            <SeleccionPagos
                precio={precio}
                activo={modoSeleccion.activo}
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
                ocupado={accionando !== null}
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
                aplicando={guardandoDiseno}
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

function Cabecera({
    precio,
    eventoActivo,
    coincidePrecio
}: {
    precio: number;
    eventoActivo: EventoActivo | null;
    coincidePrecio: boolean;
}) {

    return (

        <div className="bg-white border rounded-2xl shadow-sm p-4 sm:p-6 min-w-0">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                <div className="min-w-0">
                    <h1 className="font-bold text-gray-900 text-[clamp(1.5rem,5vw,2.25rem)] leading-tight">
                        Tabla ${precio.toLocaleString("es-CO")}
                    </h1>
                    <p className="text-gray-500 mt-1 break-words">
                        {eventoActivo?.nombre_evento || "Administra las reservas de esta dinámica."}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {coincidePrecio ? (
                        <span className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                            🟢 Evento activo
                        </span>
                    ) : (
                        <span className="bg-gray-100 text-gray-600 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                            ⚪ Sin evento activo para ${precio.toLocaleString("es-CO")}
                        </span>
                    )}
                    <AyudaContextual slug="tablas-de-precio" />
                </div>

            </div>

            {!coincidePrecio && (

                <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 min-w-0">
                    <Info size={16} className="shrink-0 mt-0.5" />
                    <span>
                        {eventoActivo
                            ? `El evento activo en esta tabla física ahora mismo es "${eventoActivo.nombre_evento}" por $${Number(eventoActivo.valor).toLocaleString("es-CO")}, no por $${precio.toLocaleString("es-CO")}. Los números ocupados por ese evento se ven como reservados o pagados en esta tabla.`
                            : `No hay ningún evento activo en esta tabla ahora mismo. Las celdas muestran su último estado real, pero no se pueden reservar hasta abrir un evento de $${precio.toLocaleString("es-CO")}.`}
                    </span>
                </div>

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

        <div className="flex flex-col items-center justify-center text-center py-12 sm:py-24 px-4 gap-3">
            <Icon
                size={32}
                className={`${tono === "error" ? "text-red-500" : "text-gray-400"} ${animarIcono ? "animate-spin" : ""}`}
            />
            <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
            <p className="text-gray-500 max-w-sm break-words">{descripcion}</p>
        </div>

    );

}
