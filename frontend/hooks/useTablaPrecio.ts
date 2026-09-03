"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { getUser } from "@/services/auth/getUser";
import { obtenerTabla } from "@/services/tablas/obtenerTabla";
import { obtenerEventoActivo } from "@/services/tablas/obtenerEventoActivo";
import { obtenerActividad } from "@/services/tablas/obtenerActividad";
import { reiniciarTabla } from "@/services/tablas/reiniciarTabla";
import { marcarPagado as marcarPagadoService } from "@/services/tablas/marcarPagado";
import { liberarNumero as liberarNumeroService } from "@/services/tablas/liberarNumero";
import { bloquearNumero as bloquearNumeroService } from "@/services/tablas/bloquearNumero";
import { marcarEnProceso as marcarEnProcesoService } from "@/services/tablas/marcarEnProceso";

import { derivarPaquetes } from "@/components/tablas/derivarPaquetes";
import { estadoEfectivo } from "@/components/tablas/estadoVisual";
import type { NumeroReserva, EventoActivo, ActividadReserva } from "@/components/tablas/types";

// Único hook fuente-de-verdad de la pantalla /tablas/:precio. Todo lo que
// se ve en pantalla (grid, stats, filtros, reservas recientes, grupos,
// actividad) sale de aquí — ningún componente vuelve a consultar Supabase
// por su cuenta ni mantiene su propia copia del estado.
export function useTablaPrecio(precio: number) {

    const config = useMemo(() => obtenerTablaConfig(precio), [precio]);

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [realizadoPor, setRealizadoPor] = useState<string | null>(null);

    const [numeros, setNumeros] = useState<NumeroReserva[]>([]);
    const [eventoActivo, setEventoActivo] = useState<EventoActivo | null>(null);
    const [actividad, setActividad] = useState<ActividadReserva[]>([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [accionando, setAccionando] = useState<string | null>(null);

    const cargar = useCallback(async (uid: string) => {

        if (!config) {
            setError("No existe una tabla configurada para este precio.");
            setLoading(false);
            return;
        }

        try {

            const [nums, evt, act] = await Promise.all([
                obtenerTabla(precio, uid),
                obtenerEventoActivo(config.tabla, uid),
                obtenerActividad(config.tabla, uid)
            ]);

            setNumeros(nums);
            setEventoActivo(evt);
            setActividad(act);
            setError(null);

        } catch (e) {

            setError(e instanceof Error ? e.message : "No se pudo cargar la tabla.");

        } finally {

            setLoading(false);

        }

    }, [precio, config]);

    useEffect(() => {

        let vivo = true;

        async function iniciar() {

            const { data } = await getUser();

            if (!vivo) return;

            if (!data.user) {
                setError("Debes iniciar sesión para ver esta tabla.");
                setLoading(false);
                return;
            }

            setUsuarioId(data.user.id);
            setRealizadoPor(data.user.email || data.user.id);

            await cargar(data.user.id);

        }

        iniciar();

        return () => { vivo = false; };

    }, [cargar]);

    // Tiempo real: cualquier cambio en la tabla física del usuario, en su
    // evento activo o en su actividad recarga los datos. Mismo patrón que
    // frontend/hooks/useSessions.ts.
    useEffect(() => {

        if (!usuarioId || !config) return;

        const canales = [

            supabase
                .channel(`tabla-${config.tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: config.tabla, filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId)
                )
                .subscribe(),

            supabase
                .channel(`eventos-${config.tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "eventos_bot", filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId)
                )
                .subscribe(),

            supabase
                .channel(`actividad-${config.tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "INSERT", schema: "public", table: "reservas_actividad", filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId)
                )
                .subscribe()

        ];

        return () => {
            canales.forEach(canal => supabase.removeChannel(canal));
        };

    }, [usuarioId, config, cargar]);

    const coincidePrecio = Boolean(
        eventoActivo && Number(eventoActivo.valor) === precio
    );

    const stats = useMemo(() => {

        const efectivos = numeros.map(estadoEfectivo);

        const contar = (estado: string) => efectivos.filter(e => e === estado).length;

        const total = numeros.length;
        const disponibles = contar("libre");
        const reservados = contar("reservado");
        const pagados = contar("pagado");
        const enProceso = contar("en_proceso");
        const bloqueados = contar("bloqueado");

        const ocupacion = total > 0
            ? Math.round(((total - disponibles) / total) * 100)
            : 0;

        return { total, disponibles, reservados, pagados, enProceso, bloqueados, ocupacion };

    }, [numeros]);

    const paquetes = useMemo(() => derivarPaquetes(numeros), [numeros]);

    const recientes = useMemo(() => {

        return [...numeros]
            .filter(n => n.estado !== "libre" && n.fecha_reserva)
            .sort((a, b) => {
                const fa = `${a.fecha_reserva}T${a.hora_reserva || "00:00:00"}`;
                const fb = `${b.fecha_reserva}T${b.hora_reserva || "00:00:00"}`;
                return fb.localeCompare(fa);
            })
            .slice(0, 10);

    }, [numeros]);

    const ejecutar = useCallback(async (numero: string, accion: () => Promise<unknown>) => {

        if (!usuarioId) return;

        setAccionando(numero);

        try {

            await accion();
            await cargar(usuarioId);

        } finally {

            setAccionando(null);

        }

    }, [usuarioId, cargar]);

    return {

        config,
        loading,
        error,
        usuarioId,
        numeros,
        eventoActivo,
        coincidePrecio,
        stats,
        paquetes,
        recientes,
        actividad,
        accionando,

        recargar: async () => {
            if (usuarioId) await cargar(usuarioId);
        },

        marcarPagado: async (numero: string) => {
            if (!usuarioId) return;
            await ejecutar(numero, () => marcarPagadoService({ precio, numero, usuarioId, realizadoPor }));
        },

        liberar: async (numero: string) => {
            if (!usuarioId) return;
            await ejecutar(numero, () => liberarNumeroService({ precio, numero, usuarioId, realizadoPor }));
        },

        bloquear: async (numero: string, motivo?: string) => {
            if (!usuarioId) return;
            await ejecutar(numero, () => bloquearNumeroService({ precio, numero, usuarioId, motivo, realizadoPor }));
        },

        marcarEnProceso: async (numero: string, minutos?: number) => {
            if (!usuarioId) return;
            await ejecutar(numero, () => marcarEnProcesoService({ precio, numero, usuarioId, minutos, realizadoPor }));
        },

        reiniciar: async () => {
            if (!usuarioId) return;
            await ejecutar("*", () => reiniciarTabla(precio, usuarioId));
        }

    };

}
