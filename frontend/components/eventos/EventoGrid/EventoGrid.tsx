"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Skeleton } from "@/components/ui/Skeleton";

import EventoCard from "../EventoCard/EventoCard";
import EventoTresCifrasCard from "../EventoTresCifrasCard/EventoTresCifrasCard";
import ResultadoCard from "../ResultadoCard/ResultadoCard";
import { obtenerEventos } from "@/services/eventos/obtenerEventos";

import type { Evento } from "../types";
import { MODALIDADES, faseDe, modalidadDe, type Fase, type Modalidad } from "../modalidad";

import styles from "./EventoGrid.module.css";

type FiltroResultados = "todos" | "tres_pago" | "tres_gratis";

const FILTROS: { id: FiltroResultados; texto: string }[] = [
    { id: "todos", texto: "Todos" },
    { id: "tres_pago", texto: "3 cifras pagos" },
    { id: "tres_gratis", texto: "3 cifras gratis" }
];

interface EventoClasificado {
    evento: Evento;
    modalidad: Modalidad;
    fase: Fase;
}

function Tarjeta({ item }: { item: EventoClasificado }) {
    return item.modalidad === "dos"
        ? <EventoCard evento={item.evento} />
        : <EventoTresCifrasCard evento={item.evento} modalidad={item.modalidad} />;
}

// Sección con subsecciones por modalidad (2 cifras / 3 cifras / gratis).
function PorModalidad({ items, palabra, vacio }: { items: EventoClasificado[]; palabra: string; vacio: string }) {
    return (
        <div className={styles.subsecciones}>
            {MODALIDADES.map((m) => {
                const lista = items.filter((i) => i.modalidad === m.id);
                return (
                    <details key={m.id} className={`${styles.sub} ${styles[`sub_${m.id}`]}`} open>
                        <summary className={styles.subTitulo}>
                            <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
                            {m.titulo} — {lista.length} {palabra}{lista.length === 1 ? "" : "s"}
                        </summary>
                        {lista.length === 0 ? (
                            <p className={styles.vacio}>{vacio}</p>
                        ) : (
                            <div className={styles.grid}>
                                {lista.map((i) => <Tarjeta key={i.evento.id} item={i} />)}
                            </div>
                        )}
                    </details>
                );
            })}
        </div>
    );
}

export default function EventoGrid() {

    const [eventos, setEventos] = useState<Evento[]>([]);
    const [loading, setLoading] = useState(true);
    const [filtro, setFiltro] = useState<FiltroResultados>("todos");

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

    const items: EventoClasificado[] = eventos.map((evento) => ({
        evento,
        modalidad: modalidadDe(evento),
        fase: faseDe(evento)
    }));

    const activos = items.filter((i) => i.fase === "activo");
    const programados = items.filter((i) => i.fase === "programado");
    const resultados = items
        .filter((i) => i.fase === "finalizado")
        .filter((i) => filtro === "todos" || i.modalidad === filtro);
    const totalResultados = items.filter((i) => i.fase === "finalizado").length;

    return (
        <>
            <div className={styles.resumen}>
                {MODALIDADES.map((m) => {
                    const n = activos.filter((i) => i.modalidad === m.id).length;
                    return (
                        <div key={m.id} className={`${styles.bloque} ${styles[`bloque_${m.id}`]}`}>
                            <span className={styles.bloqueTitulo}>{m.titulo}</span>
                            <span className={styles.bloqueActivos}>
                                <span className={n ? styles.puntoVivo : styles.puntoInactivo} aria-hidden="true" />
                                {n} {n === 1 ? "activo" : "activos"}
                            </span>
                            <span className={styles.bloqueDato}>{m.cantidad} números · {m.rango}</span>
                            <span className={styles.bloqueTipo}>{m.tipo}</span>
                        </div>
                    );
                })}
            </div>

            <details className={styles.seccion} open>
                <summary className={styles.seccionTitulo}>
                    <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
                    Activos <span className={styles.contador}>{activos.length}</span>
                </summary>
                <PorModalidad items={activos} palabra="activo" vacio="Sin sorteos activos" />
            </details>

            <details className={styles.seccion}>
                <summary className={styles.seccionTitulo}>
                    <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
                    Programados <span className={styles.contador}>{programados.length}</span>
                </summary>
                <PorModalidad items={programados} palabra="programado" vacio="Sin sorteos programados" />
            </details>

            <details className={styles.seccion} open>
                <summary className={styles.seccionTitulo}>
                    <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
                    Resultados <span className={styles.contador}>{totalResultados}</span>
                </summary>
                <div className={styles.filtros} role="group" aria-label="Filtrar resultados">
                    {FILTROS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className={filtro === f.id ? styles.filtroActivo : styles.filtro}
                            aria-pressed={filtro === f.id}
                            onClick={() => setFiltro(f.id)}
                        >
                            {f.texto}
                        </button>
                    ))}
                </div>
                {resultados.length === 0 ? (
                    <p className={styles.vacio}>
                        {totalResultados === 0 ? "Aún no hay sorteos finalizados." : "No hay sorteos finalizados de esta modalidad."}
                    </p>
                ) : (
                    <div className={styles.grid}>
                        {resultados.map((i) => <ResultadoCard key={i.evento.id} evento={i.evento} modalidad={i.modalidad} />)}
                    </div>
                )}
            </details>
        </>
    );
}
