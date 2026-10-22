"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { TablaConfig } from "@/lib/tablasConfig";
import { obtenerTablaConfigCliente } from "@/services/tablas/tablasCliente";
import { getUser } from "@/services/auth/getUser";
import { obtenerTabla } from "@/services/tablas/obtenerTabla";
import { obtenerEventoActivo } from "@/services/tablas/obtenerEventoActivo";
import { obtenerActividad } from "@/services/tablas/obtenerActividad";
import { reiniciarTabla } from "@/services/tablas/reiniciarTabla";
// Reservar, registrar el pago, liberar y desbloquear pasan por el backend
// (mismas reglas que el bot + auditoría): el navegador ya no escribe en la
// tabla de números.
import {
    reservarNumeroManual,
    pagarNumeroManual,
    liberarNumeroManual,
    type DatosReserva,
    type DatosPago,
    type DatosLiberar,
    type Resultado
} from "@/services/tablas/reservaManual";

import { derivarPaquetes } from "@/components/tablas/derivarPaquetes";
import { estadoEfectivo } from "@/components/tablas/estadoVisual";
import type { NumeroReserva, EventoActivo, ActividadReserva } from "@/components/tablas/types";

// Único hook fuente-de-verdad de la pantalla /tablas/:precio. Todo lo que
// se ve en pantalla (grid, stats, filtros, reservas recientes, grupos,
// actividad) sale de aquí — ningún componente vuelve a consultar Supabase
// por su cuenta ni mantiene su propia copia del estado.
export function useTablaPrecio(precio: number) {

    // Tabla física de este precio SEGÚN EL CLIENTE de la sesión
    // (tablas_cliente); se resuelve al conocer el usuario.
    const [config, setConfig] = useState<TablaConfig | null>(null);

    const [usuarioId, setUsuarioId] = useState<string | null>(null);

    const [numeros, setNumeros] = useState<NumeroReserva[]>([]);
    const [eventoActivo, setEventoActivo] = useState<EventoActivo | null>(null);
    const [actividad, setActividad] = useState<ActividadReserva[]>([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [accionando, setAccionando] = useState<string | null>(null);

    const cargar = useCallback(async (uid: string, config: TablaConfig | null) => {

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

    }, [precio]);

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

            const cfg = await obtenerTablaConfigCliente(precio, data.user.id);

            if (!vivo) return;

            setConfig(cfg);
            setUsuarioId(data.user.id);

            await cargar(data.user.id, cfg);

        }

        iniciar();

        return () => { vivo = false; };

    }, [cargar, precio]);

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
                    () => cargar(usuarioId, config)
                )
                .subscribe(),

            supabase
                .channel(`eventos-${config.tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "eventos_bot", filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId, config)
                )
                .subscribe(),

            supabase
                .channel(`actividad-${config.tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "INSERT", schema: "public", table: "reservas_actividad", filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId, config)
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

    const ejecutar = useCallback(async <T,>(numero: string, accion: () => Promise<T>): Promise<T> => {

        setAccionando(numero);

        try {

            const resultado = await accion();
            // También tras un rechazo: el número pudo cambiar entretanto.
            if (usuarioId) await cargar(usuarioId, config);
            return resultado;

        } finally {

            setAccionando(null);

        }

    }, [usuarioId, config, cargar]);

    // Sin sesión todavía: nada que operar.
    const sinSesion: Resultado = { ok: false, motivo: "sin_sesion", mensaje: "Debes iniciar sesión." };

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
            if (usuarioId) await cargar(usuarioId, config);
        },

        reservar: async (numero: string, datos: DatosReserva): Promise<Resultado> => {
            if (!usuarioId) return sinSesion;
            return ejecutar(numero, () => reservarNumeroManual(precio, numero, datos));
        },

        marcarPagado: async (numero: string, datos?: DatosPago): Promise<Resultado> => {
            if (!usuarioId) return sinSesion;
            return ejecutar(numero, () => pagarNumeroManual(precio, numero, datos));
        },

        // Libera una reserva, anula un pago o desbloquea, según el estado real.
        liberar: async (numero: string, datos?: DatosLiberar): Promise<Resultado> => {
            if (!usuarioId) return sinSesion;
            return ejecutar(numero, () => liberarNumeroManual(precio, numero, datos));
        },

        reiniciar: async () => {
            if (!usuarioId) return;
            await ejecutar("*", () => reiniciarTabla(precio, usuarioId));
        }

    };

}
