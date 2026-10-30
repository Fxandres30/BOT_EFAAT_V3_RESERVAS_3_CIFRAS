"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { Skeleton } from "@/components/ui/Skeleton";

import EventoCard from "../EventoCard/EventoCard";
import EventoTresCifrasCard from "../EventoTresCifrasCard/EventoTresCifrasCard";
import ResultadoCard from "../ResultadoCard/ResultadoCard";
import { obtenerEventos } from "@/services/eventos/obtenerEventos";
import { apiSorteos, describirError, type SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import EditarSorteoActivoModal from "@/components/sorteos/EditarSorteoActivoModal";
import AdministrarEventoModal from "../AdministrarEventoModal";
import { administrableDe, origenDe, origenesPorEvento, sorteoPorEvento, type OrigenEvento } from "../centroEventos";
import { agruparEventos, type EventoCompartido } from "../agruparEventos";

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
    evento: EventoCompartido;
    modalidad: Modalidad;
    fase: Fase;
    origen: OrigenEvento | null;
    /** Abre su administración aquí mismo (null: el backend no la ofrece). */
    onAdministrar: (() => void) | null;
}

function Tarjeta({ item }: { item: EventoClasificado }) {
    return item.modalidad === "dos"
        ? <EventoCard evento={item.evento} origen={item.origen} onAdministrar={item.onAdministrar} />
        : <EventoTresCifrasCard evento={item.evento} modalidad={item.modalidad} origen={item.origen} onAdministrar={item.onAdministrar} />;
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
                                {lista.map((i) => <Tarjeta key={i.evento.clave} item={i} />)}
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

    // Centro de control: acciones por sorteo (GET /sorteos/eventos) y origen
    // de cada publicación (GET /sorteos/gestion), del backend de siempre.
    const [enGrupos, setEnGrupos] = useState<SorteoEnGrupos[]>([]);
    const [errorAcciones, setErrorAcciones] = useState<string | null>(null);
    const [origenes, setOrigenes] = useState<Map<string, OrigenEvento> | null>(null);
    const [administrando, setAdministrando] = useState<{ sorteo: SorteoEnGrupos; origen: OrigenEvento | null } | null>(null);
    const [editandoActivo, setEditandoActivo] = useState<string | null>(null);
    const [resultado, setResultado] = useState<string | null>(null);
    const enlaceAtendido = useRef(false);

    const cargar = useCallback(async () => {

        try {

            const [data, e, g] = await Promise.all([obtenerEventos(), apiSorteos.eventos(), apiSorteos.gestion()]);

            setEventos(data);

            if (e.ok) { setEnGrupos(e.data); setErrorAcciones(null); }
            // El backend anterior no tiene /sorteos/eventos: la ruta cae en
            // /sorteos/:id y responde 404.
            else setErrorAcciones(e.status === 404
                ? "el servidor del bot todavía ejecuta la versión anterior. Reinicia el backend (PM2) con el código nuevo para administrar los sorteos."
                : describirError(e));

            setOrigenes(g.ok ? origenesPorEvento(g.data) : null);

        } catch (error) {

            console.error("Error cargando eventos:", error);

        } finally {

            setLoading(false);

        }

    }, []);

    useEffect(() => {

        async function refrescar() {
            await cargar();
        }

        refrescar();

    }, [cargar]);

    // /eventos?sorteo=<evento> (enlaces «Administrar» de otras pantallas y los
    // antiguos /sorteos?vista=administrar): abre ESE sorteo una sola vez.
    useEffect(() => {
        if (enlaceAtendido.current || !enGrupos.length) return;
        const id = new URLSearchParams(window.location.search).get("sorteo");
        enlaceAtendido.current = true;
        const s = sorteoPorEvento(enGrupos, id);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s) setAdministrando({ sorteo: s, origen: origenDe({ id: s.id, grupos: s.grupos }, origenes) });
        else if (id) setResultado("El sorteo que abriste no aparece entre los administrables: se eliminó o terminó hace más de 30 días.");
    }, [enGrupos, origenes]);

    if (loading) {
        return (
            <div className={styles.grid}>
                {[0, 1, 2].map((i) => (
                    <Skeleton key={i} height={260} radius={10} />
                ))}
            </div>
        );
    }

    // Una tarjeta por sorteo real: sus filas (una por grupo) se agrupan.
    const items: EventoClasificado[] = agruparEventos(eventos).map((evento) => {
        const origen = origenDe(evento, origenes);
        const administrable = administrableDe(evento, enGrupos);
        return {
            evento,
            modalidad: modalidadDe(evento),
            fase: faseDe(evento),
            origen,
            onAdministrar: administrable ? () => { setResultado(null); setAdministrando({ sorteo: administrable, origen }); } : null
        };
    });

    const activos = items.filter((i) => i.fase === "activo");
    const programados = items.filter((i) => i.fase === "programado");
    const resultados = items
        .filter((i) => i.fase === "finalizado")
        .filter((i) => filtro === "todos" || i.modalidad === filtro);
    const totalResultados = items.filter((i) => i.fase === "finalizado").length;

    return (
        <>
            {resultado && <p className={styles.aviso} role="status">{resultado}</p>}
            {errorAcciones && <p className={styles.avisoError} role="alert">No se pudieron cargar las acciones de los sorteos: {errorAcciones}</p>}

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
                {/* Los sorteos del panel viven en Programados (o en «Publicar
                    ahora») hasta que se publican; entonces aparecen aquí. */}
                <p className={styles.vacio}>
                    Los sorteos creados desde el panel que aún no se publican están en{" "}
                    <Link href="/sorteos">Programados</Link>.
                </p>
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
                        {resultados.map((i) => <ResultadoCard key={i.evento.clave} evento={i.evento} modalidad={i.modalidad} origen={i.origen} onAdministrar={i.onAdministrar} />)}
                    </div>
                )}
            </details>

            {administrando && (
                <AdministrarEventoModal
                    key={administrando.sorteo.id}
                    sorteo={administrando.sorteo}
                    origen={administrando.origen}
                    onClose={() => setAdministrando(null)}
                    onEditar={(eventoId) => { setAdministrando(null); setEditandoActivo(eventoId); }}
                    onHecho={(m) => { setAdministrando(null); setResultado(m); cargar(); }}
                />
            )}

            {editandoActivo && (
                <EditarSorteoActivoModal
                    key={editandoActivo}
                    eventoId={editandoActivo}
                    onClose={() => { setEditandoActivo(null); cargar(); }}
                    onGuardado={() => { setEditandoActivo(null); cargar(); }}
                />
            )}
        </>
    );
}
