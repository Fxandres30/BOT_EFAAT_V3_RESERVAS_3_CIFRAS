"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Info, Smartphone, Users, PauseCircle, Ticket } from "lucide-react";

import { Card, EmptyState, SectionHeader, StatCard, StatusBadge } from "@/components/ui";
import { getUser } from "@/services/auth/getUser";
import { obtenerGruposDisponibles, type SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import { listarGruposAutorizados, type GrupoAutorizado } from "@/services/automatizacion/gruposAutorizados";
import { mergearGrupos } from "@/services/automatizacion/mergeGrupos";
import { resumirGrupos, type ResumenGrupos } from "@/lib/cuenta/resumenGrupos";

import CuentaHeader from "./CuentaNav";
import styles from "./Cuenta.module.css";

const ESTADO_SESION = {
    conectada: { status: "online", label: "Conectada" },
    desconectada: { status: "offline", label: "Desconectada" },
    no_verificable: { status: "pending", label: "Sin verificar" }
} as const;

export default function MisGrupos() {

    const [sesiones, setSesiones] = useState<SesionConGrupos[]>([]);
    const [resumen, setResumen] = useState<ResumenGrupos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {

        async function cargar() {

            // Mismo origen que Automatización › Grupos: el usuario de la
            // sesión, sus filas de `sesiones` y sus grupos_autorizados.
            const { data } = await getUser();
            const uid = data.user?.id;

            if (!uid) {
                setCargando(false);
                return;
            }

            const [sesionesRes, autorizadosRes] = await Promise.all([
                obtenerGruposDisponibles(uid),
                listarGruposAutorizados(uid)
            ]);

            const autorizados = autorizadosRes.error ? [] : (autorizadosRes.data as GrupoAutorizado[]);
            if (autorizadosRes.error) setError("No pudimos cargar tus grupos autorizados. Inténtalo de nuevo más tarde.");

            setSesiones(sesionesRes);
            setResumen(resumirGrupos(sesionesRes, mergearGrupos(sesionesRes, autorizados)));
            setCargando(false);

        }

        cargar();

    }, []);

    return (

        <div className={styles.page}>

            <CuentaHeader />

            {cargando ? (
                <div className={styles.state}>Consultando tus grupos y conexiones…</div>
            ) : !resumen ? (
                <div className={styles.state}>Tu sesión terminó. Inicia sesión de nuevo.</div>
            ) : (

                <div className={styles.stack}>

                    {error && (
                        <p className={styles.error} role="alert">
                            <AlertCircle size={15} aria-hidden="true" />
                            {error}
                        </p>
                    )}

                    <div className={styles.grid}>
                        <StatCard
                            label="Grupos en uso"
                            value={resumen.enUso.length}
                            hint="Autorizados y activos en EFAAT."
                            icon={<Users size={16} />}
                            tone="primary"
                        />
                        <StatCard
                            label="Cupo contratado"
                            value={resumen.cupoContratado ?? <span className={styles.sinDato}>No registrado</span>}
                            hint="Aún no se guarda en el panel."
                            icon={<Ticket size={16} />}
                        />
                        <StatCard
                            label="Conexiones de WhatsApp"
                            value={resumen.conexiones.total}
                            hint={`${resumen.conexiones.conectadas} conectada${resumen.conexiones.conectadas === 1 ? "" : "s"} ahora`}
                            icon={<Smartphone size={16} />}
                        />
                        <StatCard
                            label="Grupos pausados"
                            value={resumen.pausados.length}
                            hint="Autorizados, pero en pausa: EFAAT no los atiende."
                            icon={<PauseCircle size={16} />}
                        />
                    </div>

                    <p className={styles.aviso} role="status">
                        <Info size={15} aria-hidden="true" />
                        <span>
                            El número de grupos incluido en tu plan todavía no se registra en el panel. Para
                            confirmarlo, revisa «Mi suscripción» o escríbenos.
                        </span>
                    </p>

                    <Card padding="lg">

                        <SectionHeader
                            title="Conexiones"
                            description="Tus números de WhatsApp vinculados. El estado se consulta en vivo."
                            actions={<Link className={styles.enlace} href="/sesiones" prefetch={false}>Administrar sesiones</Link>}
                        />

                        {sesiones.length === 0 ? (
                            <EmptyState bare icon={<Smartphone size={20} />} title="Todavía no tienes conexiones" description="Conecta tu WhatsApp desde Sesiones." />
                        ) : (
                            <ul className={styles.lista}>
                                {sesiones.map((s) => (
                                    <li key={s.sessionId} className={styles.fila}>
                                        <span className={styles.filaTexto}>
                                            <span>{s.nombreSesion}</span>
                                            {s.telefono && <span className={styles.filaSub}>{s.telefono}</span>}
                                        </span>
                                        <StatusBadge status={ESTADO_SESION[s.estado].status} label={ESTADO_SESION[s.estado].label} size="sm" />
                                    </li>
                                ))}
                            </ul>
                        )}

                    </Card>

                    <Card padding="lg">

                        <SectionHeader
                            title="Grupos autorizados"
                            description="Los grupos que EFAAT puede gestionar para ti."
                            actions={<Link className={styles.enlace} href="/automatizacion/grupos" prefetch={false}>Administrar grupos</Link>}
                        />

                        {resumen.enUso.length + resumen.pausados.length === 0 ? (
                            <EmptyState bare icon={<Users size={20} />} title="Aún no has autorizado grupos" description="Autorízalos desde Automatización › Grupos." />
                        ) : (
                            <ul className={styles.lista}>
                                {[...resumen.enUso, ...resumen.pausados].map((g) => (
                                    <li key={g.grupoId} className={styles.fila}>
                                        <span className={styles.filaTexto}>
                                            {/* Sin nombre inventado: solo el real si una sesión lo ve ahora. */}
                                            <span>{g.conectado ? g.nombre : "Grupo no visible ahora"}</span>
                                            <span className={styles.filaSub}>{g.conectado ? g.sesiones.map((s) => s.nombreSesion).join(", ") : g.grupoId}</span>
                                        </span>
                                        <StatusBadge
                                            status={g.autorizacion!.activo ? "active" : "inactive"}
                                            label={g.autorizacion!.activo ? "Activo" : "Pausado"}
                                            size="sm"
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}

                    </Card>

                </div>

            )}

        </div>

    );

}
