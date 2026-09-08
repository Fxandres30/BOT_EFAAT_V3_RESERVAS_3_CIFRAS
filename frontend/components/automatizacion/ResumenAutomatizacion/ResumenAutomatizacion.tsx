"use client";

import { useEffect, useState } from "react";

import "./ResumenAutomatizacion.css";

import { getUser } from "@/services/auth/getUser";
import { obtenerResumenAutomatizacion, ResumenAutomatizacion as ResumenData } from "@/services/automatizacion/estadisticas";

import AutomatizacionNav from "../AutomatizacionNav/AutomatizacionNav";

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

        <div className="resumen-automatizacion">

            <div>
                <h1 className="automatizacion-titulo">🤖 Automatización</h1>
                <p className="automatizacion-subtitulo">
                    Activa la automatización de EFAAT grupo por grupo: horarios permitidos,
                    mensajes automáticos de apertura, recordatorios, actualizaciones y cierre.
                    El sorteo (nombre, valor, premios, hora de cierre) siempre lo decide la
                    detección real del bot — aquí solo se configura el comportamiento.
                </p>
            </div>

            <AutomatizacionNav />

            {!usuarioId && !cargando && (
                <div className="resumen-estado-vacio">Debes iniciar sesión para ver Automatización.</div>
            )}

            {cargando ? (

                <div className="resumen-estado-vacio">Cargando resumen...</div>

            ) : usuarioId && (

                <>

                    {error && (
                        <p className="resumen-error">⚠️ No se pudo cargar todo el resumen ({error}).</p>
                    )}

                    <div className="resumen-cards">

                        <div className="resumen-card">
                            <span className="resumen-card-label">Estado</span>
                            <span className="resumen-card-valor">
                                {estadoGeneral ? "🟢 Activa" : "🔴 Inactiva"}
                            </span>
                            <span className="resumen-card-nota">
                                {estadoGeneral
                                    ? "Al menos un grupo autorizado y activo."
                                    : "Todavía no hay ningún grupo autorizado y activo."}
                            </span>
                        </div>

                        <div className="resumen-card">
                            <span className="resumen-card-label">Grupos autorizados</span>
                            <span className="resumen-card-valor">{resumen?.grupoAutorizadosActivos ?? 0}</span>
                            <span className="resumen-card-nota">de {resumen?.grupoAutorizadosTotal ?? 0} registrados</span>
                        </div>

                        <div className="resumen-card">
                            <span className="resumen-card-label">Mensajes activos</span>
                            <span className="resumen-card-valor">{resumen?.mensajesActivos ?? 0}</span>
                            <span className="resumen-card-nota">de {resumen?.mensajesTotal ?? 0} totales (globales + propios)</span>
                        </div>

                        <div className="resumen-card">
                            <span className="resumen-card-label">Eventos activos</span>
                            <span className="resumen-card-valor">{resumen?.eventosActivos ?? 0}/{resumen?.grupoAutorizadosActivos ?? 0}</span>
                            <span className="resumen-card-nota">Event Sessions abiertos ahora mismo, de tus grupos autorizados</span>
                        </div>

                        <div className="resumen-card">
                            <span className="resumen-card-label">Scheduler</span>
                            <span className="resumen-card-valor">⚪ Preparado</span>
                            <span className="resumen-card-nota">
                                Construido y probado (179/179), todavía no arrancado en producción.
                            </span>
                        </div>

                    </div>

                </>

            )}

        </div>

    );

}
