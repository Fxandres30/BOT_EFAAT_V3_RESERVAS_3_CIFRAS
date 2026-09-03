"use client";

import { useEffect, useState } from "react";

import "./EventoGrid.css";

import EventoCard from "../EventoCard/EventoCard";
import { obtenerEventos } from "@/services/eventos/obtenerEventos";

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
            <section className="eventoGrid">
                Cargando eventos...
            </section>
        );
    }

    if (!eventos.length) {
        return (
            <section className="eventoGrid">
                No hay eventos registrados.
            </section>
        );
    }

    return (
        <section className="eventoGrid">
            {eventos.map((evento) => (
                <EventoCard
                    key={evento.id}
                    evento={evento}
                />
            ))}
        </section>
    );
}