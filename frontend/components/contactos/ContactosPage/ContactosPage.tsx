"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, AlertTriangle, Phone, Hash, Loader2, RefreshCw } from "lucide-react";

import "./ContactosPage.css";

import { useContactos } from "@/hooks/useContactos";
import {
    backfillContactos,
    obtenerEstadoBackfillContactos,
    type ResultadoBackfillContactos
} from "@/services/sessions/backfillContactos";
import PerfilContacto from "@/components/contactos/PerfilContacto/PerfilContacto";
import type { Contacto, FiltroContactos } from "@/components/contactos/types";

// Cada cuánto se consulta el estado del escaneo mientras está en curso —
// GET de solo lectura (obtenerEstadoBackfillContactos), nunca vuelve a
// disparar el escaneo.
const INTERVALO_POLL_ESTADO_MS = 4_000;

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

const FILTROS: { valor: FiltroContactos; etiqueta: string }[] = [
    { valor: "todos", etiqueta: "Todos" },
    { valor: "recientes", etiqueta: "Recientes" },
    { valor: "con_telefono", etiqueta: "Con teléfono" },
    { valor: "telefono_pendiente", etiqueta: "Teléfono pendiente" },
    { valor: "con_reservas", etiqueta: "Con reservas" }
];

function coincideBusqueda(c: Contacto, termino: string): boolean {

    if (!termino) return true;

    const t = termino.toLowerCase();

    return (
        (c.nombre || "").toLowerCase().includes(t) ||
        (c.telefono || "").toLowerCase().includes(t) ||
        (c.lid || "").toLowerCase().includes(t)
    );

}

function aplicarFiltro(c: Contacto, filtro: FiltroContactos): boolean {

    switch (filtro) {

        case "recientes":
            return !!c.ultimaActividad && (Date.now() - new Date(c.ultimaActividad).getTime()) <= SIETE_DIAS_MS;

        case "con_telefono":
            return !!c.telefono;

        case "telefono_pendiente":
            return c.telefonoPendiente;

        case "con_reservas":
            return c.cantidadReservas > 0;

        default:
            return true;

    }

}

// "yaEnCurso"/estado scanning-syncing NUNCA se trata como error — pedido
// explícito: pulsar el botón mientras ya hay un escaneo corriendo no es un
// fallo funcional, es el estado esperado (el escaneo de ~2.800
// participantes puede tardar varios minutos).
function claseAvisoEscaneo(r: ResultadoBackfillContactos): string {

    if (!r.success) return "contactos-aviso--error";
    if (r.yaEnCurso || r.estado === "scanning" || r.estado === "syncing") return "contactos-aviso--enCurso";
    if (r.estado === "error") return "contactos-aviso--error";

    return "contactos-aviso--ok";

}

function textoAvisoEscaneo(r: ResultadoBackfillContactos): string {

    if (!r.success) return `⚠️ ${r.error || "No se pudo ejecutar el escaneo."}`;

    if (r.yaEnCurso || r.estado === "scanning" || r.estado === "syncing") {
        return `⏳ ${r.mensaje || "Ya hay un escaneo en curso — puede tardar varios minutos con ~2.800 participantes. Siguiendo el progreso automáticamente..."}`;
    }

    if (r.estado === "error") {
        return "⚠️ El último escaneo terminó con error — revisa los logs del bot.";
    }

    if (r.estadisticas) {
        return `✅ Escaneo completo: ${r.estadisticas.participantesAnalizados} participantes analizados en ${r.estadisticas.gruposEncontrados} grupos — ${r.importado?.nuevos ?? 0} nuevos, ${r.importado?.enriquecidos ?? 0} enriquecidos.`;
    }

    return "✅ Escaneo completo.";

}

function formatearUltimaActividad(iso: string | null): string {

    if (!iso) return "Sin actividad";

    const ms = Date.now() - new Date(iso).getTime();

    const minutos = Math.floor(ms / 60000);
    if (minutos < 1) return "Justo ahora";
    if (minutos < 60) return `Hace ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;

    const dias = Math.floor(horas / 24);
    if (dias < 30) return `Hace ${dias} d`;

    return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

}

export default function ContactosPage() {

    const { usuarioId, contactos, migracionPendiente, loading, error, recargar } = useContactos();

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<FiltroContactos>("todos");
    const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);

    const [escaneando, setEscaneando] = useState(false);
    const [resultadoEscaneo, setResultadoEscaneo] = useState<ResultadoBackfillContactos | null>(null);
    const [siguiendoProgreso, setSiguiendoProgreso] = useState(false);

    // Evita que un poll tardío siga escribiendo estado después de
    // desmontar el componente.
    const vivoRef = useRef(true);
    useEffect(() => () => { vivoRef.current = false; }, []);

    async function ejecutarBackfill() {

        setEscaneando(true);
        setResultadoEscaneo(null);

        const resultado = await backfillContactos();

        setResultadoEscaneo(resultado);
        setEscaneando(false);

        // "yaEnCurso" NO es un error funcional (pedido explícito) — el
        // escaneo anterior sigue corriendo, así que se sigue su progreso
        // en vez de mostrarlo como un fallo. Un escaneo recién completado
        // (estado idle) sí recarga de inmediato.
        if (resultado.success && resultado.estado === "idle") {
            recargar();
        } else if (resultado.success && (resultado.yaEnCurso || resultado.estado === "scanning" || resultado.estado === "syncing")) {
            setSiguiendoProgreso(true);
        }

    }

    // Mientras hay un escaneo en curso (propio o ya en marcha desde antes
    // — arranque del bot, escaneo periódico), se consulta el estado real
    // cada pocos segundos. En cuanto termina (idle) o falla (error), se
    // detiene el seguimiento y se recarga el directorio.
    useEffect(() => {

        if (!siguiendoProgreso) return;

        const id = setInterval(async () => {

            const estado = await obtenerEstadoBackfillContactos();

            if (!vivoRef.current) return;

            if (estado.estado === "scanning" || estado.estado === "syncing") {

                setResultadoEscaneo((prev) => prev ? { ...prev, estado: estado.estado } : prev);
                return;

            }

            setSiguiendoProgreso(false);

            setResultadoEscaneo((prev) => ({
                ...(prev || { success: true }),
                estado: estado.estado,
                yaEnCurso: false
            }));

            if (estado.estado === "idle") recargar();

        }, INTERVALO_POLL_ESTADO_MS);

        return () => clearInterval(id);

    }, [siguiendoProgreso, recargar]);

    const contactosFiltrados = useMemo(() => {

        return contactos
            .filter((c) => aplicarFiltro(c, filtro))
            .filter((c) => coincideBusqueda(c, busqueda.trim()));

    }, [contactos, filtro, busqueda]);

    const seleccionado = useMemo(
        () => contactos.find((c) => c.id === seleccionadoId) || null,
        [contactos, seleccionadoId]
    );

    const conteos = useMemo(() => {

        return {
            todos: contactos.length,
            recientes: contactos.filter((c) => aplicarFiltro(c, "recientes")).length,
            con_telefono: contactos.filter((c) => aplicarFiltro(c, "con_telefono")).length,
            telefono_pendiente: contactos.filter((c) => aplicarFiltro(c, "telefono_pendiente")).length,
            con_reservas: contactos.filter((c) => aplicarFiltro(c, "con_reservas")).length
        } as Record<FiltroContactos, number>;

    }, [contactos]);

    return (

        <div className="contactos-page">

            <div className="contactos-encabezado">

                <div>
                    <h1 className="contactos-titulo">Contactos</h1>
                    <p className="contactos-subtitulo">
                        Directorio central de todos los usuarios que el bot conoce — identidad, reservas, pagos y actividad.
                    </p>
                </div>

                <button
                    type="button"
                    className="contactos-boton-escanear"
                    onClick={ejecutarBackfill}
                    disabled={escaneando || siguiendoProgreso}
                    title="Escanea ahora todos los grupos de la sesión activa (Identity Scanner) y registra cada participante encontrado como contacto"
                >
                    <RefreshCw size={14} className={escaneando || siguiendoProgreso ? "contactos-spin" : ""} />
                    {escaneando || siguiendoProgreso ? "Escaneando grupos..." : "Escanear grupos ahora"}
                </button>

            </div>

            {migracionPendiente && (
                <p className="contactos-aviso">
                    La tabla <code>contactos_tenant</code> todavía no existe en Supabase — aplica
                    <code> supabase_migrations/018_contactos_tenant.sql</code> para poder ver el directorio completo.
                </p>
            )}

            {resultadoEscaneo && (

                <p className={`contactos-aviso ${claseAvisoEscaneo(resultadoEscaneo)}`}>

                    {textoAvisoEscaneo(resultadoEscaneo)}

                </p>

            )}

            <div className="contactos-buscador">

                <Search size={16} className="contactos-buscador-icono" />

                <input
                    type="text"
                    placeholder="Buscar por nombre, teléfono o LID..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                />

            </div>

            <div className="contactos-filtros">

                {FILTROS.map((f) => (

                    <button
                        key={f.valor}
                        type="button"
                        className={`contactos-filtro ${filtro === f.valor ? "activo" : ""}`}
                        onClick={() => setFiltro(f.valor)}
                    >
                        {f.etiqueta}
                        <span className="contactos-filtro-conteo">{conteos[f.valor] ?? 0}</span>
                    </button>

                ))}

            </div>

            <div className="contactos-layout">

                <aside className="contactos-lista">

                    {loading && (
                        <p className="contactos-vacio"><Loader2 size={14} className="contactos-spin" /> Cargando contactos...</p>
                    )}

                    {!loading && error && <p className="contactos-error">{error}</p>}

                    {!loading && !error && contactosFiltrados.length === 0 && (
                        <p className="contactos-vacio">
                            {contactos.length === 0
                                ? "Todavía no hay contactos conocidos."
                                : "Ningún contacto coincide con la búsqueda/filtro."}
                        </p>
                    )}

                    {contactosFiltrados.map((c) => (

                        <button
                            key={c.id}
                            className={`contactos-item ${seleccionadoId === c.id ? "activo" : ""}`}
                            onClick={() => setSeleccionadoId(c.id)}
                        >

                            <div className="contactos-item-avatar">
                                {(c.nombre || "?").charAt(0).toUpperCase()}
                            </div>

                            <div className="contactos-item-info">

                                <div className="contactos-item-nombre">
                                    {c.nombre || "Sin nombre"}
                                    {c.telefonoPendiente && (
                                        <span className="contactos-item-pendiente" title="Teléfono pendiente">
                                            <AlertTriangle size={12} /> Teléfono pendiente
                                        </span>
                                    )}
                                </div>

                                <div className="contactos-item-detalle">

                                    {c.telefono && (
                                        <span><Phone size={11} /> {c.telefono}</span>
                                    )}

                                    {!c.telefono && c.lid && (
                                        <span><Hash size={11} /> {c.lid}</span>
                                    )}

                                    <span>· {c.cantidadReservas} {c.cantidadReservas === 1 ? "reserva" : "reservas"}</span>

                                </div>

                            </div>

                            <div className="contactos-item-actividad">
                                {formatearUltimaActividad(c.ultimaActividad)}
                            </div>

                        </button>

                    ))}

                </aside>

                <div className="contactos-detalle">

                    {!seleccionado && (
                        <p className="contactos-vacio">Selecciona un contacto para ver su perfil completo.</p>
                    )}

                    {seleccionado && usuarioId && (

                        <PerfilContacto
                            contacto={seleccionado}
                            usuarioId={usuarioId}
                            onTelefonoAgregado={recargar}
                        />

                    )}

                </div>

            </div>

        </div>

    );

}
