"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Power, Users, Mail, CalendarClock, Clock } from "lucide-react";

import { StatCard } from "@/components/ui/StatCard";

import { getUser } from "@/services/auth/getUser";
import { obtenerResumenAutomatizacion, ResumenAutomatizacion as ResumenData } from "@/services/automatizacion/estadisticas";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";

import styles from "./ResumenAutomatizacion.module.css";

export default function ResumenAutomatizacion() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [resumen, setResumen] = useState<ResumenData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        async function cargar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (!uid) {
                setCargando(false);
                return;
            }

            const { data: resumenData, error: errorResumen } = await obtenerResumenAutomatizacion(uid);

            setResumen(resumenData);
            setError(errorResumen);
            setCargando(false);

        }

        cargar();

    }, []);

    const estadoGeneral = (resumen?.grupoAutorizadosActivos || 0) > 0;

    return (

        <div className={styles.page}>

            <AutomatizacionHeader />

            {!usuarioId && !cargando && (
                <div className={styles.state}>Debes iniciar sesión para ver Automatización.</div>
            )}

            {cargando ? (

                <div className={styles.state}>Cargando resumen…</div>

            ) : usuarioId && (

                <>

                    {error && (
                        <p className={styles.error}>
                            <AlertTriangle size={15} />
                            No se pudo cargar todo el resumen ({error}).
                        </p>
                    )}

                    <div className={styles.grid}>

                        <StatCard
                            label="Estado"
                            value={estadoGeneral ? "Activa" : "Inactiva"}
                            tone={estadoGeneral ? "success" : "default"}
                            hint={estadoGeneral
                                ? "Al menos un grupo autorizado y activo."
                                : "Ningún grupo autorizado y activo todavía."}
                            icon={<Power size={16} />}
                        />

                        <StatCard
                            label="Grupos autorizados"
                            value={resumen?.grupoAutorizadosActivos ?? 0}
                            hint={`de ${resumen?.grupoAutorizadosTotal ?? 0} registrados`}
                            icon={<Users size={16} />}
                        />

                        <StatCard
                            label="Mensajes activos"
                            value={resumen?.mensajesActivos ?? 0}
                            hint={`de ${resumen?.mensajesTotal ?? 0} totales (globales + propios)`}
                            icon={<Mail size={16} />}
                        />

                        <StatCard
                            label="Eventos activos"
                            value={`${resumen?.eventosActivos ?? 0}/${resumen?.grupoAutorizadosActivos ?? 0}`}
                            hint="Event Sessions abiertos ahora, de tus grupos autorizados"
                            icon={<CalendarClock size={16} />}
                        />

                        <StatCard
                            label="Scheduler"
                            value="Preparado"
                            hint="Construido y probado (179/179), aún no arrancado en producción."
                            icon={<Clock size={16} />}
                        />

                    </div>

                </>

            )}

        </div>

    );

}
