"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";

import { getUser } from "@/services/auth/getUser";
import { AutomationConfig, listarConfiguraciones } from "@/services/automatizacion/automationConfigs";
import { obtenerGruposDisponibles, SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { cargarSeguimiento, SeguimientoProgramacion } from "@/services/automatizacion/seguimientoProgramacion";
import { conexionDeGrupo, formatearMomento, frescuraDatos, resolverNombreGrupo } from "@/services/automatizacion/estadoProgramacion";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import TarjetaProgramacion from "./TarjetaProgramacion";

import styles from "./ProgramacionAutomatizacion.module.css";

// Estados de envío: cada minuto (el Scheduler revisa cada 30 s). La
// conexión a WhatsApp consulta cada sesión en vivo, así que solo se pide
// al entrar y con «Actualizar».
const REFRESCO_MS = 60000;

// La programación se edita en la página de cada grupo (automation_configs,
// sin segunda fuente de verdad); aquí se muestra su estado real.
export default function ProgramacionAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [configs, setConfigs] = useState<AutomationConfig[]>([]);

    const [seguimiento, setSeguimiento] = useState<SeguimientoProgramacion | null>(null);
    const [ultimaCarga, setUltimaCarga] = useState<Date | null>(null);
    const [falloCarga, setFalloCarga] = useState(false);
    const [actualizando, setActualizando] = useState(false);

    // null = todavía comprobando
    const [sesiones, setSesiones] = useState<SesionConGrupos[] | null>(null);

    const [ahora, setAhora] = useState(() => new Date());

    const enCurso = useRef(false);

    const refrescarSeguimiento = useCallback(async (uid: string, grupoIds: string[]) => {

        if (enCurso.current) return;

        enCurso.current = true;
        setActualizando(true);

        try {

            const res = await cargarSeguimiento(uid, grupoIds);

            if (res.data) {
                setSeguimiento(res.data);
                setUltimaCarga(new Date());
                setFalloCarga(false);
            } else {
                setFalloCarga(true);
            }

        } catch (err) {

            console.warn("[programacion] error actualizando el seguimiento:", err);
            setFalloCarga(true);

        } finally {

            enCurso.current = false;
            setActualizando(false);

        }

    }, []);

    const comprobarConexion = useCallback(async (uid: string) => {

        setSesiones(null);
        setSesiones(await obtenerGruposDisponibles(uid));

    }, []);

    useEffect(() => {

        async function cargar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (!uid) {
                setCargando(false);
                return;
            }

            const configsRes = await listarConfiguraciones(uid);

            if (configsRes.error) {
                console.warn("[programacion] no se pudo cargar la programación:", configsRes.error.message);
                setError("No pudimos cargar la programación. Intenta de nuevo en unos minutos.");
                setCargando(false);
                return;
            }

            const lista = (configsRes.data as AutomationConfig[]) || [];

            setConfigs(lista);
            setCargando(false);

            if (lista.length > 0) {
                refrescarSeguimiento(uid, lista.map((c) => c.grupo_id));
                comprobarConexion(uid);
            }

        }

        cargar();

    }, [refrescarSeguimiento, comprobarConexion]);

    // Reloj de las cuentas regresivas y refresco periódico, solo con la
    // pestaña visible (sin solicitudes en segundo plano).
    useEffect(() => {

        if (!usuarioId || configs.length === 0) return;

        const grupoIds = configs.map((c) => c.grupo_id);
        let ultimoRefresco = Date.now();

        const reloj = setInterval(() => {

            if (document.visibilityState !== "visible") return;

            setAhora(new Date());

            if (Date.now() - ultimoRefresco >= REFRESCO_MS) {
                ultimoRefresco = Date.now();
                refrescarSeguimiento(usuarioId, grupoIds);
            }

        }, 1000);

        function alVolver() {
            if (document.visibilityState === "visible" && Date.now() - ultimoRefresco >= REFRESCO_MS) {
                ultimoRefresco = Date.now();
                refrescarSeguimiento(usuarioId as string, grupoIds);
            }
        }

        document.addEventListener("visibilitychange", alVolver);

        return () => {
            clearInterval(reloj);
            document.removeEventListener("visibilitychange", alVolver);
        };

    }, [usuarioId, configs, refrescarSeguimiento]);

    function actualizarAhora() {

        if (!usuarioId) return;

        refrescarSeguimiento(usuarioId, configs.map((c) => c.grupo_id));
        comprobarConexion(usuarioId);

    }

    const frescura = frescuraDatos(ultimaCarga, falloCarga, ahora);

    function nombreEnVivo(grupoId: string) {
        for (const sesion of sesiones || []) {
            const grupo = sesion.grupos.find((g) => g.id === grupoId);
            if (grupo?.nombre) return grupo.nombre;
        }
        return null;
    }

    return (

        <div className={styles.page}>

            <AutomatizacionHeader />

            <p className={styles.lead}>
                Estado real de los recordatorios de cada grupo. Las horas se calculan sobre el cierre
                real del evento detectado. Para cambiar la programación, usa «Editar» en cada grupo.
            </p>

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : !usuarioId ? (

                <div className={styles.state}>Debes iniciar sesión.</div>

            ) : error ? (

                <p className={styles.error}>
                    <AlertTriangle size={15} /> {error}
                </p>

            ) : configs.length === 0 ? (

                <EmptyState
                    title="Sin programación guardada"
                    description="Todavía no hay configuración para ningún grupo."
                    action={<Link href="/automatizacion/grupos" className={styles.editLink}>Ir a Grupos</Link>}
                />

            ) : (

                <>

                    <div className={styles.barraEstado}>

                        <span className={styles.barraTexto}>
                            {ultimaCarga
                                ? <>Actualizado {formatearMomento(ultimaCarga, ahora)} · se actualiza cada minuto</>
                                : actualizando ? "Consultando el estado de los envíos…" : "Sin datos de envíos todavía"}
                        </span>

                        <button
                            type="button"
                            className={styles.botonActualizar}
                            onClick={actualizarAhora}
                            disabled={actualizando}
                        >
                            <RefreshCw size={13} className={actualizando ? styles.girando : undefined} />
                            Actualizar
                        </button>

                    </div>

                    {frescura !== "al_dia" && !actualizando && (
                        <p className={styles.error} role="status">
                            <AlertTriangle size={15} />
                            {frescura === "sin_respuesta"
                                ? ultimaCarga
                                    ? `No pudimos actualizar. Los estados son de ${formatearMomento(ultimaCarga, ahora)} y pueden no estar al día.`
                                    : "No pudimos consultar el estado de los envíos. Los recordatorios se muestran sin confirmar."
                                : "Los estados tienen más de 3 minutos y pueden no estar al día."}
                        </p>
                    )}

                    <div className={styles.grid}>

                        {configs.map((c) => {

                            const evento = seguimiento?.eventos[c.grupo_id] || null;
                            const cicloGrupo = seguimiento?.ciclos[c.grupo_id] || null;
                            const ciclo = cicloGrupo && evento && (!cicloGrupo.evento_id || cicloGrupo.evento_id === evento.id) ? cicloGrupo : null;

                            return (

                                <TarjetaProgramacion
                                    key={c.id}
                                    config={c}
                                    nombre={resolverNombreGrupo(
                                        nombreEnVivo(c.grupo_id),
                                        evento?.grupo_nombre,
                                        seguimiento?.nombres[c.grupo_id],
                                        cicloGrupo?.datos_evento_snapshot?.grupo_nombre
                                    )}
                                    conexion={sesiones ? conexionDeGrupo(c.grupo_id, sesiones) : "comprobando"}
                                    evento={evento}
                                    ciclo={ciclo}
                                    acciones={ciclo ? seguimiento?.acciones[ciclo.id] || [] : []}
                                    datosDisponibles={!!seguimiento}
                                    sesionesActivas={seguimiento ? seguimiento.sesionesActivas : null}
                                    ahora={ahora}
                                />

                            );

                        })}

                    </div>

                </>

            )}

        </div>

    );

}
