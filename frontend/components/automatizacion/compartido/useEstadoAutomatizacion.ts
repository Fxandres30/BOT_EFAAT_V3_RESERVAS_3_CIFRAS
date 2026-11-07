"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getUser } from "@/services/auth/getUser";
import { AutomationConfig, listarConfiguraciones } from "@/services/automatizacion/automationConfigs";
import { GrupoAutorizado, listarGruposAutorizados } from "@/services/automatizacion/gruposAutorizados";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { cargarSeguimiento, SeguimientoProgramacion } from "@/services/automatizacion/seguimientoProgramacion";
import { construirGruposVista, GrupoVista } from "@/services/automatizacion/vistaGrupos";

import { FilaGrupo, construirFila } from "../CentroAutomatizaciones/filaGrupo";

// Estado real compartido por Resumen y Grupos: autorizaciones, conexión en
// vivo, configuración y seguimiento de envíos. Solo LEE con los servicios
// existentes (RLS del usuario); las escrituras las hace cada pantalla con
// los mismos servicios de siempre.
//
// La conexión de WhatsApp se consulta en vivo al entrar y con «Actualizar»
// (igual que el Centro de control); el seguimiento de envíos cada minuto
// con la pestaña visible.

const REFRESCO_MS = 60000;
const RELOJ_MS = 15000;

export function useEstadoAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [autorizados, setAutorizados] = useState<GrupoAutorizado[]>([]);
    const [sesiones, setSesiones] = useState<SesionConGrupos[] | null>(null);
    const [configs, setConfigs] = useState<AutomationConfig[]>([]);
    const [seguimiento, setSeguimiento] = useState<SeguimientoProgramacion | null>(null);
    const [seguimientoFallo, setSeguimientoFallo] = useState(false);
    const [ahora, setAhora] = useState(() => new Date());
    const [actualizando, setActualizando] = useState(false);

    const enCurso = useRef(false);

    const refrescarSeguimiento = useCallback(async (uid: string, grupoIds: string[]) => {

        if (enCurso.current || grupoIds.length === 0) return;
        enCurso.current = true;

        try {
            const res = await cargarSeguimiento(uid, grupoIds);
            if (res.data) {
                setSeguimiento(res.data);
                setSeguimientoFallo(false);
            } else {
                setSeguimientoFallo(true);
            }
        } catch (err) {
            console.warn("[automatizacion] no se pudo cargar el seguimiento:", err);
            setSeguimientoFallo(true);
        } finally {
            enCurso.current = false;
        }

    }, []);

    const cargarTodo = useCallback(async (uid: string) => {

        setError(null);

        const [autRes, cfgRes] = await Promise.all([listarGruposAutorizados(uid), listarConfiguraciones(uid)]);

        const errores: string[] = [];

        if (autRes.error) errores.push("las autorizaciones");
        else setAutorizados((autRes.data as GrupoAutorizado[]) || []);

        let lista: AutomationConfig[] = [];
        if (cfgRes.error) errores.push("la configuración");
        else {
            lista = (cfgRes.data as AutomationConfig[]) || [];
            setConfigs(lista);
        }

        if (errores.length > 0) setError(`No pudimos cargar ${errores.join(" ni ")}. Intenta de nuevo en unos minutos.`);

        setCargando(false);

        setSesiones(null);
        await Promise.all([
            obtenerGruposDisponibles(uid).then(setSesiones),
            refrescarSeguimiento(uid, lista.map((c) => c.grupo_id))
        ]);

    }, [refrescarSeguimiento]);

    useEffect(() => {

        let vigente = true;

        getUser().then(({ data }) => {
            if (!vigente) return;
            const uid = data.user?.id || null;
            setUsuarioId(uid);
            if (uid) cargarTodo(uid);
            else setCargando(false);
        });

        return () => { vigente = false; };

    }, [cargarTodo]);

    // Reloj (para «en 12 min») y refresco del seguimiento, solo visible.
    useEffect(() => {

        if (!usuarioId || configs.length === 0) return;

        const grupoIds = configs.map((c) => c.grupo_id);
        let ultimo = Date.now();

        const reloj = setInterval(() => {
            if (document.visibilityState !== "visible") return;
            setAhora(new Date());
            if (Date.now() - ultimo >= REFRESCO_MS) {
                ultimo = Date.now();
                refrescarSeguimiento(usuarioId, grupoIds);
            }
        }, RELOJ_MS);

        return () => clearInterval(reloj);

    }, [usuarioId, configs, refrescarSeguimiento]);

    const recargar = useCallback(async () => {
        if (!usuarioId) return;
        setActualizando(true);
        try {
            await cargarTodo(usuarioId);
        } finally {
            setActualizando(false);
        }
    }, [usuarioId, cargarTodo]);

    const reemplazarConfigs = useCallback((nuevas: AutomationConfig[]) => {
        const porGrupo = new Map(nuevas.map((c) => [c.grupo_id, c]));
        setConfigs((prev) => {
            const existentes = new Set(prev.map((c) => c.grupo_id));
            const agregadas = nuevas.filter((c) => !existentes.has(c.grupo_id));
            return [...prev.map((c) => porGrupo.get(c.grupo_id) || c), ...agregadas];
        });
    }, []);

    const reemplazarAutorizacion = useCallback((nueva: GrupoAutorizado) => {
        setAutorizados((prev) => prev.some((g) => g.id === nueva.id)
            ? prev.map((g) => (g.id === nueva.id ? nueva : g))
            : [nueva, ...prev]);
    }, []);

    const activosSet = useMemo(
        () => new Set(autorizados.filter((g) => g.activo).map((g) => g.grupo_id)),
        [autorizados]
    );

    const filas = useMemo<FilaGrupo[]>(
        () => configs.map((c) => construirFila(c, seguimiento, sesiones, activosSet, ahora)),
        [configs, seguimiento, sesiones, activosSet, ahora]
    );

    const grupos = useMemo<GrupoVista<FilaGrupo>[]>(
        () => construirGruposVista(sesiones, autorizados, filas),
        [sesiones, autorizados, filas]
    );

    return {
        usuarioId,
        cargando,
        error,
        actualizando,
        autorizados,
        sesiones,
        configs,
        seguimiento,
        seguimientoFallo,
        ahora,
        filas,
        grupos,
        recargar,
        reemplazarConfigs,
        reemplazarAutorizacion
    };

}
