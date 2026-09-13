"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import {
    ConfiguracionStickerPago,
    obtenerConfiguracionStickerPago,
    activarRegistroStickerPago,
    cancelarRegistroStickerPago,
    desactivarStickerPago,
    MINUTOS_EXPIRACION_REGISTRO
} from "@/services/automatizacion/stickerPago";

export type EstadoStickerPago =
    | "cargando"
    | "sin_configurar"
    | "esperando"
    | "configurado"
    | "error";

// Mismo criterio EXACTO que backend/bot/funciones/pagos/configuracionStickerPago.js
// (registroVigente()) — no hay paquete compartido entre frontend y backend
// en este proyecto (mismo patrón ya usado en
// frontend/components/tablas/estadoVisual.ts para el estado efectivo de
// una reserva), así que se reimplementa aquí la MISMA comparación, nunca
// una regla nueva. Esto es solo presentación: la seguridad real vive en
// backend/bot/funciones/pagos/registrarStickerPago.js, que vuelve a
// comprobar la expiración por su cuenta contra la hora del servidor.
function registroVigente(config: ConfiguracionStickerPago | null, ahora: number): boolean {

    if (!config) return false;
    if (config.esperando_registro !== true) return false;
    if (!config.esperando_registro_expira_en) return false;

    return new Date(config.esperando_registro_expira_en).getTime() > ahora;

}

// Único hook fuente-de-verdad de la sección "Sticker de pago" — la UI
// (ConfiguracionGrupo) solo lee lo que este hook devuelve, nunca vuelve a
// consultar Supabase por su cuenta (mismo criterio que useTablaPrecio.ts).
export function useStickerPago(usuarioId: string | null, grupoId: string) {

    const [config, setConfig] = useState<ConfiguracionStickerPago | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [procesando, setProcesando] = useState(false);

    // Reloj propio para reflejar la expiración SIN depender de que llegue
    // un cambio de fila: el backend solo reevalúa esperando_registro
    // cuando procesa un mensaje real (ver AUDITORÍA) — si el admin nunca
    // llega a enviar el sticker, la fila se quedaría diciendo
    // esperando_registro=true para siempre sin este reloj local.
    const [ahora, setAhora] = useState(() => Date.now());

    const cargar = useCallback(async () => {

        if (!usuarioId || !grupoId) return;

        const { data, error: errorCarga } = await obtenerConfiguracionStickerPago(usuarioId, grupoId);

        if (errorCarga) {
            setError("No se pudo cargar la configuración del sticker de pago.");
            setCargando(false);
            return;
        }

        setConfig((data as ConfiguracionStickerPago | null) ?? null);
        setError(null);
        setCargando(false);

    }, [usuarioId, grupoId]);

    useEffect(() => {

        let vivo = true;

        async function iniciar() {
            setCargando(true);
            await cargar();
            if (!vivo) return;
        }

        iniciar();

        return () => { vivo = false; };

    }, [cargar]);

    // Tiempo real — mismo patrón que frontend/hooks/useTablaPrecio.ts /
    // useSessions.ts.
    useEffect(() => {

        if (!usuarioId || !grupoId) return;

        const canal = supabase
            .channel(`sticker-pago-${usuarioId}-${grupoId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "configuracion_stickers_pago",
                    filter: `usuario_id=eq.${usuarioId}`
                },
                (payload) => {

                    // El filtro de Realtime aquí solo puede expresar una
                    // columna (usuario_id) — un usuario puede tener varios
                    // grupos configurados, así que grupo_id se comprueba
                    // en código antes de recargar (evita una recarga
                    // innecesaria si cambió la config de OTRO grupo).
                    const fila = (payload.new ?? payload.old) as { grupo_id?: string } | null;

                    if (fila?.grupo_id && fila.grupo_id !== grupoId) return;

                    cargar();

                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(canal);
        };

    }, [usuarioId, grupoId, cargar]);

    // El reloj de expiración solo corre mientras de verdad haya algo que
    // vencer — nunca de fondo sin necesidad.
    useEffect(() => {

        if (!config?.esperando_registro) return;

        const intervalo = setInterval(() => setAhora(Date.now()), 1000);

        return () => clearInterval(intervalo);

    }, [config?.esperando_registro]);

    const vigente = registroVigente(config, ahora);

    const estado: EstadoStickerPago = cargando
        ? "cargando"
        : error
            ? "error"
            : vigente
                ? "esperando"
                : config?.sticker_sha256
                    ? "configurado"
                    : "sin_configurar";

    const iniciarRegistro = useCallback(async () => {

        if (!usuarioId) return;

        setProcesando(true);
        setError(null);

        const { data, error: errorActivar } = await activarRegistroStickerPago(usuarioId, grupoId);

        setProcesando(false);

        if (errorActivar || !data) {
            setError("No se pudo iniciar el registro. Intenta nuevamente.");
            return;
        }

        setConfig(data as ConfiguracionStickerPago);
        setAhora(Date.now());

    }, [usuarioId, grupoId]);

    const cancelarRegistro = useCallback(async () => {

        if (!usuarioId) return;

        setProcesando(true);
        setError(null);

        const { data, error: errorCancelar } = await cancelarRegistroStickerPago(usuarioId, grupoId);

        setProcesando(false);

        if (errorCancelar) {
            setError("No se pudo cancelar el registro.");
            return;
        }

        setConfig((data as ConfiguracionStickerPago | null) ?? null);

    }, [usuarioId, grupoId]);

    const desactivar = useCallback(async () => {

        if (!usuarioId) return;

        setProcesando(true);
        setError(null);

        const { data, error: errorDesactivar } = await desactivarStickerPago(usuarioId, grupoId);

        setProcesando(false);

        if (errorDesactivar) {
            setError("No se pudo guardar la configuración.");
            return;
        }

        setConfig((data as ConfiguracionStickerPago | null) ?? null);

    }, [usuarioId, grupoId]);

    return {

        estado,
        config,
        error,
        procesando,
        minutosExpiracion: MINUTOS_EXPIRACION_REGISTRO,

        iniciarRegistro,
        cancelarRegistro,
        desactivar,
        recargar: cargar

    };

}
