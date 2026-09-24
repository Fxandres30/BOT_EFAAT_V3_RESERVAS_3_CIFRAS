"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";

import { supabase } from "@/lib/supabase";

import styles from "./panel.module.css";

// ==========================================================================
// Panel privado de analítica. Usa la sesión de Supabase Auth que YA existe
// (la del login normal del panel): cada petición lleva el access_token y
// el backend lo verifica y exige que el usuario esté en
// public.analitica_admins. Sin sesión o sin autorización se muestra el 404
// estándar de Next y no se obtiene ningún dato.
// ==========================================================================

const ZONA = "America/Bogota";
const ACTIVOS_MS = 15000;
const RESUMEN_MS = 30000;
const POR_PAGINA = 50;

type Dispositivo = "mobile" | "tablet" | "desktop" | "unknown";
type Preset = "hoy" | "ayer" | "7d" | "rango";

interface Resumen {
    visitantes_unicos: number;
    visitantes_nuevos: number;
    sesiones: number;
    paginas_vistas: number;
    activos_ahora: number;
    dispositivos: Record<Dispositivo, number>;
    primera_visita: string | null;
    ultima_visita: string | null;
}

interface SesionFila {
    session_id: string;
    visitor_id: string;
    started_at: string;
    last_activity_at: string;
    ended_at?: string | null;
    end_reason?: string | null;
    landing_page?: string;
    current_page: string;
    page_views: number;
    referrer?: string | null;
    device_type: Dispositivo;
    operating_system: string | null;
    browser: string | null;
    ip: string | null;
    ip_anonimizada?: boolean;
    country?: string | null;
    city?: string | null;
}

interface Detalle {
    sesion: SesionFila & { user_agent: string | null; continued_as: string | null };
    visitante: {
        first_seen_at: string;
        last_seen_at: string;
        total_sessions: number;
        screen_width: number | null;
        screen_height: number | null;
    } | null;
    eventos: { event_type: string; page: string | null; created_at: string }[];
}

const NOMBRE_DISPOSITIVO: Record<Dispositivo, string> = {
    mobile: "Móvil",
    tablet: "Tablet",
    desktop: "PC",
    unknown: "Desconocido"
};

const NOMBRE_EVENTO: Record<string, string> = {
    new_visitor: "Primera visita",
    session_start: "Inicio de sesión",
    page_view: "Página vista",
    resume: "Reanudó actividad",
    idle: "Inactivo",
    exit: "Salida"
};

const NOMBRE_FIN: Record<string, string> = {
    exit: "Salida",
    idle: "Inactivo",
    timeout: "Expirada (30 min)"
};

const fFecha = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, day: "2-digit", month: "short", year: "numeric" });
const fHora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, hour: "numeric", minute: "2-digit", second: "2-digit" });
const fFechaHora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" });

function fecha(iso?: string | null) { return iso ? fFecha.format(new Date(iso)) : "—"; }
function hora(iso?: string | null) { return iso ? fHora.format(new Date(iso)) : "—"; }
function fechaHora(iso?: string | null) { return iso ? fFechaHora.format(new Date(iso)) : "—"; }

function hace(iso: string, ahora: number) {
    const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

function duracion(desde: string, hasta: string) {
    const s = Math.max(0, Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function corto(id: string) {
    return id.replace(/-/g, "").slice(0, 4).toUpperCase();
}

function dispositivoTexto(f: Pick<SesionFila, "device_type" | "operating_system" | "browser">) {
    return [NOMBRE_DISPOSITIVO[f.device_type] || "—", f.operating_system, f.browser].filter(Boolean).join(" · ");
}

function hoyIso() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
}

class SinAcceso extends Error {}

async function pedir<T>(ruta: string): Promise<T> {
    // getSession() devuelve el token vigente (supabase-js lo renueva solo).
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new SinAcceso();
    const res = await fetch(`/api/analitica-privada/${ruta}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
    });
    // Leer siempre el cuerpo: una respuesta sin consumir deja la petición abierta.
    const json = await res.json().catch(() => null);
    if (res.status === 404 && !ruta.startsWith("sesiones/")) throw new SinAcceso();
    if (!res.ok) throw new Error(String(res.status));
    return json?.datos as T;
}

// Puerta de acceso: nada del panel se monta hasta que el backend confirma
// que el usuario logueado es administrador de la analítica.
export default function PanelAnalitica() {

    const [acceso, setAcceso] = useState<"comprobando" | "permitido" | "denegado">("comprobando");

    useEffect(() => {
        let vigente = true;
        pedir("verificar")
            .then(() => { if (vigente) setAcceso("permitido"); })
            .catch(() => { if (vigente) setAcceso("denegado"); });
        return () => { vigente = false; };
    }, []);

    if (acceso === "denegado") notFound();
    if (acceso === "comprobando") return null;

    return <Panel />;

}

function Panel() {

    const [preset, setPreset] = useState<Preset>("hoy");
    const [desde, setDesde] = useState(hoyIso);
    const [hasta, setHasta] = useState(hoyIso);
    const [pagina, setPagina] = useState(0);

    const [resumen, setResumen] = useState<Resumen | null>(null);
    const [activos, setActivos] = useState<SesionFila[]>([]);
    const [historial, setHistorial] = useState<{ total: number; filas: SesionFila[] } | null>(null);
    const [detalle, setDetalle] = useState<Detalle | null>(null);
    const [detalleId, setDetalleId] = useState<string | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [actualizado, setActualizado] = useState<string | null>(null);
    const [ahora, setAhora] = useState(() => Date.now());

    const filtro = useMemo(() => {
        const p = new URLSearchParams({ preset });
        if (preset === "rango") {
            p.set("desde", desde);
            p.set("hasta", hasta);
        }
        return p.toString();
    }, [preset, desde, hasta]);

    const manejarError = useCallback((e: unknown) => {
        if (e instanceof SinAcceso) {
            // Sesión cerrada o acceso revocado: recargar muestra el 404.
            window.location.reload();
            return;
        }
        setError("No se pudieron cargar los datos. Se reintentará automáticamente.");
    }, []);

    // Cada efecto se suscribe a una fuente (petición + intervalo) y solo
    // actualiza estado en el callback de la respuesta.
    useEffect(() => {
        let vigente = true;
        const cargar = () => pedir<SesionFila[]>("activos")
            .then(d => {
                if (!vigente) return;
                setActivos(d);
                setActualizado(new Date().toISOString());
                setError(null);
            })
            .catch(manejarError);
        cargar();
        const id = setInterval(cargar, ACTIVOS_MS);
        return () => { vigente = false; clearInterval(id); };
    }, [manejarError]);

    useEffect(() => {
        let vigente = true;
        const cargar = () => pedir<Resumen>(`resumen?${filtro}`)
            .then(d => { if (vigente) setResumen(d); })
            .catch(manejarError);
        cargar();
        const id = setInterval(cargar, RESUMEN_MS);
        return () => { vigente = false; clearInterval(id); };
    }, [filtro, manejarError]);

    useEffect(() => {
        let vigente = true;
        pedir<{ total: number; filas: SesionFila[] }>(`historial?${filtro}&limite=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`)
            .then(d => { if (vigente) setHistorial(d); })
            .catch(manejarError);
        return () => { vigente = false; };
    }, [filtro, pagina, manejarError]);

    useEffect(() => {
        const id = setInterval(() => setAhora(Date.now()), 5000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (!detalleId) return;
        let vigente = true;
        pedir<Detalle>(`sesiones/${detalleId}`)
            .then(d => { if (vigente) setDetalle(d); })
            .catch(manejarError);
        return () => { vigente = false; };
    }, [detalleId, manejarError]);

    // El detalle cargado solo se muestra si corresponde a la sesión elegida.
    const detalleVisible = detalle && detalle.sesion.session_id === detalleId ? detalle : null;

    function cambiarPreset(p: Preset) {
        setPreset(p);
        setPagina(0);
    }

    const totalDispositivos = resumen
        ? resumen.dispositivos.mobile + resumen.dispositivos.tablet + resumen.dispositivos.desktop + resumen.dispositivos.unknown
        : 0;

    const pct = (n: number) => (totalDispositivos ? `${Math.round((n / totalDispositivos) * 100)} %` : "—");

    const totalPaginas = historial ? Math.max(1, Math.ceil(historial.total / POR_PAGINA)) : 1;

    const paginasVisitadas = detalleVisible
        ? detalleVisible.eventos.filter(e => e.event_type === "page_view").map(e => ({ page: e.page, at: e.created_at }))
        : [];

    return (
        <div className={styles.panel}>

            <header className={styles.cabecera}>
                <div>
                    <h1 className={styles.titulo}>Analítica privada</h1>
                    <p className={styles.textoSecundario}>
                        Visitas anónimas al panel · hora de Colombia
                        {actualizado && <> · actualizado {hora(actualizado)}</>}
                    </p>
                </div>
            </header>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <div className={styles.filtros} role="group" aria-label="Periodo">
                {([["hoy", "Hoy"], ["ayer", "Ayer"], ["7d", "Últimos 7 días"], ["rango", "Rango"]] as [Preset, string][]).map(([p, texto]) => (
                    <button
                        key={p}
                        className={preset === p ? styles.segmentoActivo : styles.segmento}
                        aria-pressed={preset === p}
                        onClick={() => cambiarPreset(p)}
                    >
                        {texto}
                    </button>
                ))}
                {preset === "rango" && (
                    <span className={styles.rango}>
                        <label>Desde <input type="date" value={desde} max={hasta} onChange={e => { setDesde(e.target.value); setPagina(0); }} /></label>
                        <label>Hasta <input type="date" value={hasta} min={desde} onChange={e => { setHasta(e.target.value); setPagina(0); }} /></label>
                    </span>
                )}
            </div>

            <section aria-labelledby="t-resumen">
                <h2 id="t-resumen" className={styles.subtitulo}>Resumen</h2>
                <div className={styles.tiles}>
                    <Tile etiqueta="Visitantes únicos" valor={resumen?.visitantes_unicos} pie={resumen ? `${resumen.visitantes_nuevos} nuevos` : undefined} />
                    <Tile etiqueta="Sesiones" valor={resumen?.sesiones} pie={resumen ? `${resumen.paginas_vistas} páginas vistas` : undefined} />
                    <Tile etiqueta="Activos ahora" valor={resumen?.activos_ahora} vivo />
                    <Tile etiqueta="Móvil" valor={resumen?.dispositivos.mobile} pie={resumen ? pct(resumen.dispositivos.mobile) : undefined} />
                    <Tile etiqueta="Tablet" valor={resumen?.dispositivos.tablet} pie={resumen ? pct(resumen.dispositivos.tablet) : undefined} />
                    <Tile etiqueta="PC" valor={resumen?.dispositivos.desktop} pie={resumen ? pct(resumen.dispositivos.desktop) : undefined} />
                </div>
                <p className={styles.textoSecundario}>
                    Primera visita registrada: <strong>{fechaHora(resumen?.primera_visita)}</strong>
                    {" · "}
                    Última actividad: <strong>{fechaHora(resumen?.ultima_visita)}</strong>
                </p>
            </section>

            <section aria-labelledby="t-activos">
                <h2 id="t-activos" className={styles.subtitulo}>
                    <span className={activos.length ? styles.puntoVivo : styles.puntoInactivo} aria-hidden="true" />
                    {activos.length} {activos.length === 1 ? "activo" : "activos"} ahora
                </h2>
                {activos.length === 0 ? (
                    <p className={styles.vacio}>Nadie activo en los últimos 2½ minutos.</p>
                ) : (
                    <ul className={styles.listaActivos}>
                        {activos.map(a => (
                            <li key={a.session_id}>
                                <button className={styles.activo} onClick={() => setDetalleId(a.session_id)}>
                                    <span className={styles.activoNombre}>Visitante {corto(a.visitor_id)}</span>
                                    <span>{dispositivoTexto(a)}</span>
                                    <span className={styles.textoSecundario}>{a.current_page} · IP {a.ip || "no disponible"}</span>
                                    <span className={styles.textoSecundario}>Activo {hace(a.last_activity_at, ahora)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="t-historial">
                <h2 id="t-historial" className={styles.subtitulo}>
                    Historial {historial && <span className={styles.textoSecundario}>({historial.total} sesiones)</span>}
                </h2>
                <div className={styles.tablaScroll}>
                    <table className={styles.tabla}>
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Hora</th>
                                <th>Visitante</th>
                                <th>Sesión</th>
                                <th>Dispositivo</th>
                                <th>Sistema</th>
                                <th>Navegador</th>
                                <th>IP</th>
                                <th>Página</th>
                                <th>Referrer</th>
                                <th>Última actividad</th>
                            </tr>
                        </thead>
                        <tbody>
                            {historial?.filas.map(f => (
                                <tr
                                    key={f.session_id}
                                    className={detalleId === f.session_id ? styles.filaSeleccionada : undefined}
                                    onClick={() => setDetalleId(f.session_id)}
                                >
                                    <td>{fecha(f.started_at)}</td>
                                    <td>{hora(f.started_at)}</td>
                                    <td className={styles.mono}>{corto(f.visitor_id)}</td>
                                    <td>
                                        <button className={styles.enlace} onClick={(e) => { e.stopPropagation(); setDetalleId(f.session_id); }}>
                                            {corto(f.session_id)}
                                        </button>
                                    </td>
                                    <td>{NOMBRE_DISPOSITIVO[f.device_type]}</td>
                                    <td>{f.operating_system || "—"}</td>
                                    <td>{f.browser || "—"}</td>
                                    <td className={styles.mono}>{f.ip ? `${f.ip}${f.ip_anonimizada ? " (anon.)" : ""}` : "—"}</td>
                                    <td>
                                        {f.landing_page}
                                        {f.current_page !== f.landing_page && <span className={styles.textoSecundario}> → {f.current_page}</span>}
                                        <span className={styles.textoSecundario}> ({f.page_views})</span>
                                    </td>
                                    <td className={styles.recortar}>{f.referrer || "Directo"}</td>
                                    <td>{hora(f.last_activity_at)}</td>
                                </tr>
                            ))}
                            {historial && historial.filas.length === 0 && (
                                <tr><td colSpan={11} className={styles.vacio}>Sin visitas en este periodo.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {historial && historial.total > POR_PAGINA && (
                    <div className={styles.paginacion}>
                        <button className={styles.botonSecundario} disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</button>
                        <span className={styles.textoSecundario}>Página {pagina + 1} de {totalPaginas}</span>
                        <button className={styles.botonSecundario} disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
                    </div>
                )}
            </section>

            {detalleId && (
                <div className={styles.fondoDetalle} onClick={() => setDetalleId(null)}>
                    <aside
                        className={styles.detalle}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Detalle de sesión"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className={styles.detalleCabecera}>
                            <h2 className={styles.subtitulo}>Sesión {corto(detalleId)}</h2>
                            <button className={styles.botonSecundario} onClick={() => setDetalleId(null)}>Cerrar</button>
                        </div>

                        {!detalleVisible ? (
                            <p className={styles.textoSecundario}>Cargando…</p>
                        ) : (
                            <>
                                <dl className={styles.datos}>
                                    <dt>Visitante</dt><dd className={styles.mono}>{corto(detalleVisible.sesion.visitor_id)} · {detalleVisible.visitante?.total_sessions ?? "—"} {detalleVisible.visitante?.total_sessions === 1 ? "sesión" : "sesiones"} en total</dd>
                                    <dt>Inicio</dt><dd>{fechaHora(detalleVisible.sesion.started_at)}</dd>
                                    <dt>Última actividad</dt><dd>{fechaHora(detalleVisible.sesion.last_activity_at)}</dd>
                                    <dt>Duración aprox.</dt><dd>{duracion(detalleVisible.sesion.started_at, detalleVisible.sesion.last_activity_at)}</dd>
                                    <dt>Estado</dt><dd>{detalleVisible.sesion.end_reason ? `${NOMBRE_FIN[detalleVisible.sesion.end_reason] || detalleVisible.sesion.end_reason} · ${hora(detalleVisible.sesion.ended_at)}` : "Abierta"}</dd>
                                    <dt>IP</dt><dd className={styles.mono}>{detalleVisible.sesion.ip ? `${detalleVisible.sesion.ip}${detalleVisible.sesion.ip_anonimizada ? " (anonimizada)" : ""}` : "No disponible"}</dd>
                                    <dt>Dispositivo</dt><dd>{NOMBRE_DISPOSITIVO[detalleVisible.sesion.device_type]}{detalleVisible.visitante?.screen_width ? ` · ${detalleVisible.visitante.screen_width}×${detalleVisible.visitante.screen_height}` : ""}</dd>
                                    <dt>Sistema</dt><dd>{detalleVisible.sesion.operating_system || "—"}</dd>
                                    <dt>Navegador</dt><dd>{detalleVisible.sesion.browser || "—"}</dd>
                                    <dt>Referrer</dt><dd>{detalleVisible.sesion.referrer || "Directo"}</dd>
                                    <dt>Primera visita</dt><dd>{fechaHora(detalleVisible.visitante?.first_seen_at)}</dd>
                                    <dt>User-Agent</dt><dd className={styles.ua}>{detalleVisible.sesion.user_agent || "—"}</dd>
                                </dl>

                                <h3 className={styles.subtitulo3}>Páginas visitadas ({paginasVisitadas.length})</h3>
                                <ol className={styles.paginas}>
                                    {paginasVisitadas.map((p, i) => (
                                        <li key={i}><span className={styles.mono}>{hora(p.at)}</span> {p.page}</li>
                                    ))}
                                </ol>

                                <h3 className={styles.subtitulo3}>Eventos</h3>
                                <ol className={styles.eventos}>
                                    {detalleVisible.eventos.map((e, i) => (
                                        <li key={i}>
                                            <span className={styles.mono}>{hora(e.created_at)}</span>
                                            {" "}{NOMBRE_EVENTO[e.event_type] || e.event_type}
                                            {e.page && <span className={styles.textoSecundario}> · {e.page}</span>}
                                        </li>
                                    ))}
                                </ol>
                            </>
                        )}
                    </aside>
                </div>
            )}

        </div>
    );

}

function Tile({ etiqueta, valor, pie, vivo }: { etiqueta: string; valor?: number; pie?: string; vivo?: boolean }) {
    return (
        <div className={styles.tile}>
            <span className={styles.tileEtiqueta}>
                {vivo && <span className={valor ? styles.puntoVivo : styles.puntoInactivo} aria-hidden="true" />}
                {etiqueta}
            </span>
            <span className={styles.tileValor}>{valor ?? "—"}</span>
            {pie && <span className={styles.tilePie}>{pie}</span>}
        </div>
    );
}
