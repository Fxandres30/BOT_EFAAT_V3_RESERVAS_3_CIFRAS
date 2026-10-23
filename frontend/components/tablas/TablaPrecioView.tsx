"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, AlertTriangle, Info, Palette, LibraryBig } from "lucide-react";

import { useTablaPrecio } from "@/hooks/useTablaPrecio";
import { useTablaDiseno } from "@/hooks/useTablaDiseno";
import { useSeccionesPanel } from "@/hooks/useSeccionesPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import AccionesTabla from "./AccionesTabla";
import StatsBar from "./StatsBar";
import FiltrosBar from "./FiltrosBar";
import Grid from "./Grid";
import HistorialNumeros from "./HistorialNumeros";
import ReservasRecientes from "./ReservasRecientes";
import GruposPanel from "./GruposPanel";
import ActividadReciente from "./ActividadReciente";
import EditorDisenoModal from "./EditorDisenoModal";
import BibliotecaDisenosModal from "./BibliotecaDisenosModal";
import { contarPorFiltro, type FiltroEstado } from "./estadoVisual";
import { capturarTabla } from "@/services/tablas/capturarTabla";
import type { EventoActivo } from "./types";
import type { TablaDiseno } from "./disenoTypes";

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
        liberar,
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

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<FiltroEstado>("todos");

    const conteosFiltro = useMemo(() => contarPorFiltro(numeros), [numeros]);

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

            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 sm:gap-4">
                <div className="flex-1 min-w-0">
                    <StatsBar stats={stats} />
                </div>
                <div className="lg:shrink-0">
                    <AccionesTabla
                        precio={precio}
                        totalNumeros={stats.total}
                        disponibles={stats.disponibles}
                        usuarioId={usuarioId}
                        onReiniciar={reiniciar}
                        capturarTabla={() => capturarTabla(tablaRef.current)}
                    />
                </div>
            </div>

            <FiltrosBar
                busqueda={busqueda}
                onBusquedaChange={setBusqueda}
                filtro={filtro}
                onFiltroChange={setFiltro}
                conteos={conteosFiltro}
            />

            <div className="flex flex-wrap items-center gap-2">
                {personalizada && <Badge tone="primary" size="sm">Diseño personalizado</Badge>}
                <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Palette size={14} />}
                    onClick={() => setPersonalizarAbierto(true)}
                >
                    Personalizar
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<LibraryBig size={14} />}
                    onClick={() => setBibliotecaAbierta(true)}
                >
                    Diseños
                </Button>
            </div>

            <Grid
                contenedorRef={tablaRef}
                precio={precio}
                numeros={numeros}
                paquetes={paquetes}
                eventoActivo={eventoActivo}
                coincidePrecio={coincidePrecio}
                busqueda={busqueda}
                filtro={filtro}
                accionando={accionando}
                diseno={diseno}
                onReservar={reservar}
                onMarcarPagado={marcarPagado}
                onLiberar={liberar}
            />

            <HistorialNumeros
                filas={historial}
                auditoriaDisponible={auditoriaDisponible}
                expandido={secciones.historial}
                onToggleExpandido={() => alternarSeccion("historial")}
            />

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

                {coincidePrecio ? (
                    <span className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                        🟢 Evento activo
                    </span>
                ) : (
                    <span className="bg-gray-100 text-gray-600 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                        ⚪ Sin evento activo para ${precio.toLocaleString("es-CO")}
                    </span>
                )}

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
