"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getUser } from "@/services/auth/getUser";
import { formatearMomento, formatearRestante } from "@/services/automatizacion/estadoProgramacion";
import { apiSorteos, type SorteoActivo } from "@/services/sorteos/apiSorteos";
import { estadoSorteoPrecio, type EntradaEstadoSorteo, type EstadoTarjeta, type ProgramacionTarjeta } from "@/services/tablas/estadoSorteoPrecio";
import { obtenerTablasCliente, type ConfiguracionTabla } from "@/services/tablas/tablasCliente";

// El publicador trabaja en segundo plano: el estado se vuelve a pedir cada
// minuto (la cuenta regresiva corre aparte, cada segundo).
const REFRESCO_MS = 60_000;
const VISIBLES = 2;

interface Fuentes { activos: SorteoActivo[] | null; programados: ProgramacionTarjeta[] | null }

// Precios que ofrece el cliente de la sesión (tablas_cliente; sin
// configuración propia, los precios base de lib/tablasConfig.ts).
export default function IndiceTablas() {

    const [tablas, setTablas] = useState<ConfiguracionTabla[] | null>(null);
    const [fuentes, setFuentes] = useState<Fuentes | null>(null);
    const [ahora, setAhora] = useState(() => new Date());

    useEffect(() => {

        let vivo = true;

        getUser().then(async ({ data }) => {
            const lista = await obtenerTablasCliente(data.user?.id);
            if (vivo) setTablas(lista);
        });

        // Sorteos del usuario del token (el backend nunca recibe un id).
        async function cargarSorteos() {
            const [activos, gestion] = await Promise.all([apiSorteos.activos(), apiSorteos.gestion()]);
            const programados = gestion.ok ? gestion : await apiSorteos.listar();
            if (!vivo) return;
            setFuentes({ activos: activos.ok ? activos.data : null, programados: programados.ok ? programados.data : null });
            setAhora(new Date());
        }

        cargarSorteos();
        const intervalo = setInterval(cargarSorteos, REFRESCO_MS);

        return () => { vivo = false; clearInterval(intervalo); };

    }, []);

    const hayCuenta = Boolean(tablas && fuentes && tablas.some(t =>
        estadoSorteoPrecio({ precio: t.precio, tabla: t.tabla, ...fuentes, ahora })
            .some(e => e.estado === "programado" && e.publicarEn && e.publicarEn > ahora)
    ));

    useEffect(() => {
        if (!hayCuenta) return;
        const reloj = setInterval(() => setAhora(new Date()), 1000);
        return () => clearInterval(reloj);
    }, [hayCuenta]);

    if (!tablas) {
        return <p className="text-gray-500">Cargando tablas...</p>;
    }

    if (tablas.length === 0) {
        return <p className="text-gray-500">Tu cuenta no tiene tablas de números configuradas.</p>;
    }

    return (

        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">

            {tablas.map(({ precio, tabla }) => (

                <Link
                    key={precio}
                    href={`/tablas/${precio}`}
                    className="bg-white border rounded-2xl p-4 sm:p-6 text-center shadow hover:shadow-lg hover:border-blue-500 transition min-w-0 flex flex-col"
                >
                    <div className="text-xl sm:text-2xl font-bold truncate">
                        ${precio.toLocaleString("es-CO")}
                    </div>
                    <EstadoSorteo
                        entradas={fuentes ? estadoSorteoPrecio({ precio, tabla, ...fuentes, ahora }) : null}
                        ahora={ahora}
                    />
                    <div className="text-sm text-gray-500 mt-auto pt-2">
                        Ver tabla
                    </div>
                </Link>

            ))}

        </div>

    );

}

const ETIQUETA: Record<EstadoTarjeta, { texto: string; tono: BadgeTone }> = {
    activo: { texto: "SORTEO ACTIVO", tono: "success" },
    programado: { texto: "PROGRAMADO", tono: "primary" },
    revision: { texto: "REQUIERE REVISIÓN", tono: "warning" },
    sin_sorteo: { texto: "SIN SORTEO ACTIVO NI PROGRAMADO", tono: "neutral" },
    no_disponible: { texto: "ESTADO NO DISPONIBLE", tono: "neutral" }
};

function EstadoSorteo({ entradas, ahora }: { entradas: EntradaEstadoSorteo[] | null; ahora: Date }) {

    if (!entradas) {
        return <p className="text-xs text-gray-400 mt-2" role="status">Consultando sorteo…</p>;
    }

    const restantes = entradas.length - VISIBLES;

    return (
        <div className="mt-2 pt-2 border-t space-y-2 text-xs text-gray-600 min-w-0 [overflow-wrap:anywhere]">
            {entradas.slice(0, VISIBLES).map(e => <Entrada key={e.clave} e={e} ahora={ahora} />)}
            {restantes > 0 && (
                <p className="text-gray-500">+{restantes} sorteo{restantes === 1 ? "" : "s"} más</p>
            )}
        </div>
    );

}

function Entrada({ e, ahora }: { e: EntradaEstadoSorteo; ahora: Date }) {

    const { texto, tono } = ETIQUETA[e.estado];
    const conNombre = e.estado === "activo" || e.estado === "programado" || e.estado === "revision";

    return (
        <div className="min-w-0 space-y-0.5">
            {/* "!": Badge.module.css (sin capa) vence a las utilidades de Tailwind. */}
            <Badge tone={tono} size="sm" className="max-w-full whitespace-normal! leading-snug!">{texto}</Badge>
            {conNombre && (
                <p className="font-medium text-gray-800">
                    {e.nombre || "Sin nombre registrado"}
                </p>
            )}
            {e.estado === "activo" && e.grupos !== undefined && e.grupos > 1 && <p>En {e.grupos} grupos</p>}
            {e.estado === "programado" && <Programacion e={e} ahora={ahora} />}
            {e.motivo && <p className="text-amber-700">{e.motivo}</p>}
        </div>
    );

}

// Cuenta regresiva con la fecha guardada (publicar_en). Vencida: nunca
// negativa; se dice que la publicación está pendiente.
function Programacion({ e, ahora }: { e: EntradaEstadoSorteo; ahora: Date }) {

    if (!e.publicarEn) return <p>Sin fecha de publicación registrada</p>;

    const restante = e.publicarEn.getTime() - ahora.getTime();

    return (
        <>
            <p>Publica {formatearMomento(e.publicarEn, ahora)}</p>
            <p className="font-semibold text-gray-800">
                {e.publicando ? "Publicándose ahora" : restante > 0 ? `Faltan ${formatearRestante(restante)}` : "Publicación pendiente"}
            </p>
        </>
    );

}
