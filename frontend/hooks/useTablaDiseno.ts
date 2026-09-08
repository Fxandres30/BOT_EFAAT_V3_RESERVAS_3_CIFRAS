"use client";

import { useCallback, useEffect, useState } from "react";

import { getUser } from "@/services/auth/getUser";
import {
    obtenerConfiguracionVisual,
    guardarConfiguracionVisual
} from "@/services/tablas/configuracionVisual";
import {
    listarDisenos,
    crearDiseno,
    actualizarDiseno,
    duplicarDiseno,
    eliminarDiseno
} from "@/services/tablas/disenos";
import { DEFAULT_TABLA_DISENO_CONFIG, clonarConfig } from "@/services/tablas/disenoDefaults";
import type { TablaDiseno, TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// Único hook fuente-de-verdad del DISEÑO VISUAL de una tabla (usuario +
// precio). Independiente de useTablaPrecio (que sigue siendo la única
// fuente de verdad de los NÚMEROS/reservas reales) — este hook nunca
// toca esa tabla física ni sus datos.
export function useTablaDiseno(precio: number) {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);

    const [config, setConfig] = useState<TablaDisenoConfig>(DEFAULT_TABLA_DISENO_CONFIG);
    const [disenoOrigenId, setDisenoOrigenId] = useState<string | null>(null);
    const [personalizada, setPersonalizada] = useState(false);

    const [disenos, setDisenos] = useState<TablaDiseno[]>([]);

    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = useCallback(async (uid: string) => {

        setCargando(true);
        setError(null);

        try {

            const [visual, lista] = await Promise.all([
                obtenerConfiguracionVisual(uid, precio),
                listarDisenos(uid)
            ]);

            if (visual) {
                setConfig(visual.config);
                setDisenoOrigenId(visual.diseno_origen_id);
                setPersonalizada(true);
            } else {
                setConfig(DEFAULT_TABLA_DISENO_CONFIG);
                setDisenoOrigenId(null);
                setPersonalizada(false);
            }

            setDisenos(lista);

        } catch (e) {

            setError(e instanceof Error ? e.message : "No se pudo cargar el diseño de la tabla.");

        } finally {

            setCargando(false);

        }

    }, [precio]);

    useEffect(() => {

        let vivo = true;

        async function iniciar() {

            const { data } = await getUser();

            if (!vivo) return;

            if (!data.user) {
                setCargando(false);
                return;
            }

            setUsuarioId(data.user.id);
            await cargar(data.user.id);

        }

        iniciar();

        return () => { vivo = false; };

    }, [cargar]);

    // "Guardar cambios": persiste esta configuración SOLO para esta tabla
    // (usuario + precio). Nunca toca tabla_disenos ni otra fila de
    // tabla_configuracion_visual.
    const guardarComoConfigDeTabla = useCallback(async (
        nuevaConfig: TablaDisenoConfig,
        origenId: string | null = disenoOrigenId
    ) => {

        if (!usuarioId) return;

        setGuardando(true);

        try {

            await guardarConfiguracionVisual(usuarioId, precio, nuevaConfig, origenId);
            setConfig(nuevaConfig);
            setDisenoOrigenId(origenId);
            setPersonalizada(true);

        } finally {

            setGuardando(false);

        }

    }, [usuarioId, precio, disenoOrigenId]);

    // "Guardar como diseño": crea una fila NUEVA e independiente en la
    // biblioteca (tabla_disenos) — nunca sobrescribe un diseño existente.
    const guardarComoDisenoNuevo = useCallback(async (nombre: string, nuevaConfig: TablaDisenoConfig) => {

        if (!usuarioId) return null;

        const creado = await crearDiseno(usuarioId, nombre, clonarConfig(nuevaConfig));
        setDisenos((prev) => [creado, ...prev]);
        return creado;

    }, [usuarioId]);

    // Aplicar un diseño (predeterminado o de la biblioteca) a ESTA tabla:
    // copia su configuración de forma independiente — la biblioteca queda
    // intacta y ninguna otra tabla se ve afectada.
    const aplicarDiseno = useCallback(async (origenId: string | null, configOrigen: TablaDisenoConfig) => {
        await guardarComoConfigDeTabla(clonarConfig(configOrigen), origenId);
    }, [guardarComoConfigDeTabla]);

    const editarDisenoBiblioteca = useCallback(async (id: string, cambios: { nombre?: string; config?: TablaDisenoConfig }) => {
        const actualizado = await actualizarDiseno(id, cambios);
        setDisenos((prev) => prev.map((d) => (d.id === id ? actualizado : d)));
        return actualizado;
    }, []);

    const duplicarDisenoBiblioteca = useCallback(async (diseno: TablaDiseno) => {
        const copia = await duplicarDiseno(diseno);
        setDisenos((prev) => [copia, ...prev]);
        return copia;
    }, []);

    const eliminarDisenoBiblioteca = useCallback(async (id: string) => {
        await eliminarDiseno(id);
        setDisenos((prev) => prev.filter((d) => d.id !== id));
        if (disenoOrigenId === id) setDisenoOrigenId(null);
    }, [disenoOrigenId]);

    return {

        usuarioId,
        cargando,
        guardando,
        error,

        config,
        disenoOrigenId,
        personalizada,
        disenos,

        guardarComoConfigDeTabla,
        guardarComoDisenoNuevo,
        aplicarDiseno,
        editarDisenoBiblioteca,
        duplicarDisenoBiblioteca,
        eliminarDisenoBiblioteca,

        recargar: () => usuarioId && cargar(usuarioId)

    };

}
