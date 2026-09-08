"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CircleCheck, CircleSlash } from "lucide-react";

import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

import EventoCard from "../EventoCard/EventoCard";
import { obtenerEventos } from "@/services/eventos/obtenerEventos";

import styles from "./EventoGrid.module.css";

export default function EventoGrid() {

    const [eventos, setEventos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {

        async function cargar() {

            setLoading(true);

            try {

                const data = await obtenerEventos();

                setEventos(data);

            } catch (error) {

                console.error("Error cargando eventos:", error);

            } finally {

                setLoading(false);

            }

        }

        cargar();

    }, []);

    if (loading) {
        return (
            <div className={styles.grid}>
                {[0, 1, 2].map((i) => (
                    <Skeleton key={i} height={260} radius={10} />
                ))}
            </div>
        );
    }

    if (!eventos.length) {
        return (
            <EmptyState
                icon={<CalendarClock size={20} />}
                title="No hay eventos registrados"
                description="Los eventos aparecen aquí automáticamente cuando el bot detecta un sorteo en un grupo."
            />
        );
    }

    const norm = (e: string) => (e || "").toLowerCase();
    const abiertos = eventos.filter((e) => norm(e.estado) === "abierto").length;
    const cerrados = eventos.filter((e) => norm(e.estado) === "cerrado").length;

    return (
        <>
            <div className={styles.stats}>
                <StatCard label="Eventos" value={eventos.length} icon={<CalendarClock size={16} />} />
                <StatCard label="Abiertos" value={abiertos} tone="success" icon={<CircleCheck size={16} />} />
                <StatCard label="Cerrados" value={cerrados} icon={<CircleSlash size={16} />} />
            </div>

            <div className={styles.grid}>
                {eventos.map((evento) => (
                    <EventoCard key={evento.id} evento={evento} />
                ))}
            </div>
        </>
    );
}
