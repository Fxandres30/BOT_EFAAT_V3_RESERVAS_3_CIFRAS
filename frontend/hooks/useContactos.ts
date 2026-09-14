"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { getUser } from "@/services/auth/getUser";
import { obtenerContactos } from "@/services/contactos/obtenerContactos";
import { obtenerTablasConocidas } from "@/lib/tablasConfig";
import type { Contacto } from "@/components/contactos/types";

// Cada cuánto se refresca el directorio SI ningún cambio en tiempo real lo
// disparó antes. Respaldo defensivo: contactos_tenant SÍ tiene usuario_id
// real (a diferencia de "usuarios", que es global), así que el canal de
// abajo debería cubrir todo, pero un intervalo corto es barato y evita
// depender 100% de que Realtime esté siempre entregando.
const INTERVALO_RESPALDO_MS = 45_000;

// Único hook fuente-de-verdad de /contactos. Mismo patrón que
// hooks/useTablaPrecio.ts: un solo lugar que carga, expone tiempo real y
// nadie más vuelve a consultar Supabase/el backend por su cuenta.
export function useContactos() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [contactos, setContactos] = useState<Contacto[]>([]);
    const [migracionPendiente, setMigracionPendiente] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Evita solapar dos cargas si un cambio en tiempo real llega mientras
    // ya hay una petición en vuelo.
    const cargandoRef = useRef(false);

    const cargar = useCallback(async (uid: string) => {

        if (cargandoRef.current) return;
        cargandoRef.current = true;

        try {

            const data = await obtenerContactos(uid);
            setContactos(data.contactos);
            setMigracionPendiente(data.migracionPendiente);
            setError(null);

        } catch (e) {

            setError(e instanceof Error ? e.message : "No se pudieron cargar los contactos.");

        } finally {

            setLoading(false);
            cargandoRef.current = false;

        }

    }, []);

    useEffect(() => {

        let vivo = true;

        async function iniciar() {

            const { data } = await getUser();

            if (!vivo) return;

            if (!data.user) {
                setError("Debes iniciar sesión para ver los contactos.");
                setLoading(false);
                return;
            }

            setUsuarioId(data.user.id);
            await cargar(data.user.id);

        }

        iniciar();

        return () => { vivo = false; };

    }, [cargar]);

    // Tiempo real: nuevas reservas/pagos en CUALQUIER tabla dinámica del
    // tenant recargan el directorio de inmediato (pedido explícito: "las
    // nuevas reservas deben aparecer automáticamente en la lista de
    // recientes"). Se suscribe a las dos tablas físicas reales (ver
    // lib/tablasConfig.ts), mismo patrón que useTablaPrecio.ts.
    useEffect(() => {

        if (!usuarioId) return;

        const tablas = obtenerTablasConocidas();

        const canales = tablas.map((tabla) =>

            supabase
                .channel(`contactos-${tabla}-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: tabla, filter: `usuario_id=eq.${usuarioId}` },
                    () => cargar(usuarioId)
                )
                .subscribe()

        );

        // contactos_tenant (migración 018) SÍ tiene usuario_id real de
        // tenant — a diferencia de "usuarios" (global). Cualquier
        // descubrimiento nuevo (escaneo de grupo) o actividad (mensaje,
        // reserva) que pase por obtenerUsuarioGlobal.js::registrarContactoTenant
        // toca esta tabla, así que este único canal cubre tanto "nuevo
        // contacto apareció" como "un contacto ya conocido volvió a tener
        // actividad" (incluye el caso "el Identity Resolver ya consiguió el
        // teléfono", porque esa resolución también actualiza
        // ultimo_visto_en).
        const canalContactosTenant = supabase
            .channel(`contactos-tenant-${usuarioId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "contactos_tenant", filter: `usuario_id=eq.${usuarioId}` },
                () => cargar(usuarioId)
            )
            .subscribe();

        return () => {
            [...canales, canalContactosTenant].forEach((canal) => supabase.removeChannel(canal));
        };

    }, [usuarioId, cargar]);

    // Respaldo por intervalo — cubre el caso en que el canal de "usuarios"
    // no entregue eventos (ver comentario arriba).
    useEffect(() => {

        if (!usuarioId) return;

        const id = setInterval(() => cargar(usuarioId), INTERVALO_RESPALDO_MS);

        return () => clearInterval(id);

    }, [usuarioId, cargar]);

    return {
        usuarioId,
        contactos,
        migracionPendiente,
        loading,
        error,
        recargar: () => usuarioId && cargar(usuarioId)
    };

}
