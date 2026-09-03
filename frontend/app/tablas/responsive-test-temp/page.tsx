"use client";

// ARNES TEMPORAL SOLO PARA VERIFICACIÓN VISUAL RESPONSIVE. No es una ruta
// real de la app, no usa Supabase ni datos reales, y se borra antes de
// terminar la tarea de auditoría responsive. Renderiza los mismos
// componentes de producción con datos de ejemplo (incluyendo casos límite:
// nombres largos, muchos números en un grupo, etc.) para poder revisar
// cada breakpoint sin depender de una sesión real.

import { useState } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import AccionesTabla from "@/components/tablas/AccionesTabla";
import StatsBar from "@/components/tablas/StatsBar";
import FiltrosBar from "@/components/tablas/FiltrosBar";
import Grid from "@/components/tablas/Grid";
import ReservasRecientes from "@/components/tablas/ReservasRecientes";
import GruposPanel from "@/components/tablas/GruposPanel";
import ActividadReciente from "@/components/tablas/ActividadReciente";
import { derivarPaquetes } from "@/components/tablas/derivarPaquetes";
import type { NumeroReserva, EventoActivo, ActividadReserva } from "@/components/tablas/types";
import type { FiltroEstado } from "@/components/tablas/estadoVisual";

const PRECIO = 5000;
const EVENTO_ID = "evt-demo-1";

function construirNumero(overrides: Partial<NumeroReserva>): NumeroReserva {
    return {
        id: 0,
        numero: "00",
        estado: "libre",
        comprador: null,
        contacto: null,
        nombre: null,
        telefono: null,
        lib: null,
        grupo_id: null,
        grupo_nombre: null,
        evento_id: null,
        nombre_evento: null,
        usuario_id: "demo",
        usuario_global_id: null,
        telefono_bot: null,
        fecha_reserva: null,
        hora_reserva: null,
        fecha_pago: null,
        hora_pago: null,
        temporal_por: null,
        bloqueado_hasta: null,
        ip_reserva: null,
        contacto_lower: null,
        creado_en: "2026-09-03T10:00:00.000Z",
        ...overrides
    };
}

function generarNumeros(): NumeroReserva[] {

    const numeros: NumeroReserva[] = [];

    for (let i = 0; i < 100; i++) {
        numeros.push(construirNumero({ id: i, numero: i.toString().padStart(2, "0") }));
    }

    // Grupo grande (paquete) para probar el "+N más"
    const grupoGrande = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    grupoGrande.forEach((n) => {
        numeros[n] = construirNumero({
            id: n,
            numero: n.toString().padStart(2, "0"),
            estado: "reservado",
            comprador: "Familia Pérez González de la Torre Larguísimo",
            contacto: "3001234567",
            grupo_nombre: "ZONA PRIVADA DINÁMICAS 🎲",
            evento_id: EVENTO_ID,
            nombre_evento: "Lotería De Manizales",
            fecha_reserva: "2026-09-03",
            hora_reserva: "10:15:00"
        });
    });

    // Paquete pequeño
    [20, 21, 22].forEach((n) => {
        numeros[n] = construirNumero({
            id: n,
            numero: n.toString().padStart(2, "0"),
            estado: "pagado",
            comprador: "Luz Marina",
            contacto: "3009876543",
            grupo_nombre: "Grupo Amigos",
            evento_id: EVENTO_ID,
            nombre_evento: "Lotería De Manizales",
            fecha_reserva: "2026-09-02",
            hora_reserva: "18:40:00",
            fecha_pago: "2026-09-02",
            hora_pago: "19:00:00"
        });
    });

    // Reservas individuales con nombre largo / emoji (casos reales observados)
    [30, 31, 32, 33, 34].forEach((n, idx) => {
        numeros[n] = construirNumero({
            id: n,
            numero: n.toString().padStart(2, "0"),
            estado: "reservado",
            comprador: idx === 0 ? "💜🦢𝑻𝒓𝒊𝒍𝒂𝒕𝒉 𝑵𝒂𝒊𝒍𝒔🪄💅 (nombre con emojis largo de verdad)" : `Cliente ${idx}`,
            contacto: "3111111111",
            grupo_nombre: "𝑨𝒏𝒅𝒓𝒆𝒔 𝑴𝒆𝒓𝒄𝒂𝒅𝒐 ☘️🧃",
            evento_id: EVENTO_ID,
            nombre_evento: "Lotería De Manizales",
            fecha_reserva: "2026-09-03",
            hora_reserva: `0${idx + 1}:22:10`
        });
    });

    // En proceso
    [40, 41].forEach((n) => {
        numeros[n] = construirNumero({
            id: n,
            numero: n.toString().padStart(2, "0"),
            estado: "en_proceso",
            temporal_por: "panel",
            bloqueado_hasta: "2026-09-03T10:05:00.000Z"
        });
    });

    // Bloqueado
    [50, 51, 52].forEach((n) => {
        numeros[n] = construirNumero({
            id: n,
            numero: n.toString().padStart(2, "0"),
            estado: "bloqueado",
            temporal_por: "Apartado por el organizador"
        });
    });

    return numeros;

}

function generarActividad(): ActividadReserva[] {

    const tipos: ActividadReserva["tipo"][] = [
        "reservado", "pagado", "liberado", "bloqueado", "cancelado", "reservado", "tabla_reiniciada"
    ];

    return tipos.map((tipo, i) => ({
        id: `act-${i}`,
        usuario_id: "demo",
        tabla: "5k_15k_reservas_2_cifras",
        numero: tipo === "tabla_reiniciada" ? null : (10 + i).toString().padStart(2, "0"),
        evento_id: EVENTO_ID,
        tipo,
        detalle: { comprador: i % 2 === 0 ? "Un Cliente Con Nombre Bastante Largo Para Probar" : null },
        realizado_por: i % 2 === 0 ? "bot" : "admin@efaat.com",
        // Fecha fija (no Date.now()) para que el render de servidor y
        // cliente coincidan exactamente — esto es solo un arnés de
        // prueba desechable, no debe reventar la hidratación.
        creado_en: new Date(Date.UTC(2026, 8, 3, 10, 0, 0) - i * 9 * 60 * 1000).toISOString()
    }));

}

export default function PruebaResponsivePage() {

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<FiltroEstado>("todos");

    const numeros = generarNumeros();
    const paquetes = derivarPaquetes(numeros);
    const actividad = generarActividad();

    const recientes = [...numeros]
        .filter((n) => n.estado !== "libre" && n.fecha_reserva)
        .sort((a, b) => `${b.fecha_reserva}T${b.hora_reserva}`.localeCompare(`${a.fecha_reserva}T${a.hora_reserva}`))
        .slice(0, 10);

    const eventoActivo: EventoActivo = {
        id: EVENTO_ID,
        nombre_evento: "Lotería De Manizales",
        valor: String(PRECIO),
        tabla: "5k_15k_reservas_2_cifras",
        estado: "abierto",
        activo: true,
        abierto: true,
        reservados: numeros.filter(n => n.estado === "reservado").length,
        pagados: numeros.filter(n => n.estado === "pagado").length,
        pendientes: 0,
        libres: numeros.filter(n => n.estado === "libre").length,
        cantidad_numeros: 100,
        grupo_nombre: "ZONA PRIVADA DINÁMICAS 🎲",
        hora_fin: "22:00",
        hora_cierre: "21:30",
        fecha_evento: "2026-09-03"
    };

    const stats = {
        total: numeros.length,
        disponibles: numeros.filter(n => n.estado === "libre").length,
        reservados: numeros.filter(n => n.estado === "reservado").length,
        pagados: numeros.filter(n => n.estado === "pagado").length,
        enProceso: numeros.filter(n => n.estado === "en_proceso").length,
        bloqueados: numeros.filter(n => n.estado === "bloqueado").length,
        ocupacion: Math.round(((numeros.length - numeros.filter(n => n.estado === "libre").length) / numeros.length) * 100)
    };

    return (

        <DashboardLayout>

            <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

                <div className="bg-white border rounded-2xl shadow-sm p-4 sm:p-6 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="font-bold text-gray-900 text-[clamp(1.5rem,5vw,2.25rem)] leading-tight">
                                Tabla ${PRECIO.toLocaleString("es-CO")} (prueba responsive)
                            </h1>
                            <p className="text-gray-500 mt-1 break-words">{eventoActivo.nombre_evento}</p>
                        </div>
                        <span className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full font-semibold text-sm w-fit shrink-0">
                            🟢 Evento activo
                        </span>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0">
                        <StatsBar stats={stats} />
                    </div>
                    <div className="lg:shrink-0">
                        <AccionesTabla precio={PRECIO} totalNumeros={stats.total} disponibles={stats.disponibles} onReiniciar={async () => {}} />
                    </div>
                </div>

                <FiltrosBar busqueda={busqueda} onBusquedaChange={setBusqueda} filtro={filtro} onFiltroChange={setFiltro} />

                <Grid
                    numeros={numeros}
                    paquetes={paquetes}
                    eventoActivo={eventoActivo}
                    coincidePrecio={true}
                    busqueda={busqueda}
                    filtro={filtro}
                    accionando={null}
                    onMarcarPagado={() => {}}
                    onLiberar={() => {}}
                    onBloquear={() => {}}
                    onMarcarEnProceso={() => {}}
                />

                <ReservasRecientes precio={PRECIO} numeros={recientes} accionando={null} onMarcarPagado={() => {}} onLiberar={() => {}} />

                <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                    <GruposPanel paquetes={paquetes} precio={PRECIO} />
                    <ActividadReciente actividad={actividad} />
                </div>

            </div>

        </DashboardLayout>

    );

}
