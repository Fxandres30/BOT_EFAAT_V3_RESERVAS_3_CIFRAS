"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Lock } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Badge, BadgeTone } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

import {
    CATALOGO_ACTIVADORES,
    EntradaCatalogo,
    EstadoEntrada,
    NivelEdicion,
    ETIQUETA_ESTADO,
    ETIQUETA_EDICION,
    ETIQUETA_TIPO_ACTIVADOR
} from "@/services/activadores/catalogoActivadores";
import {
    EstadoRealActivadores,
    cargarEstadoRealActivadores,
    estadoDeTipo
} from "@/services/activadores/estadoActivadores";
import { TIPOS_MENSAJE } from "@/services/mensajes/tiposMensaje";

import styles from "./ActivadoresModal.module.css";

const TONO_ESTADO: Record<EstadoEntrada, BadgeTone> = {
    funciona: "success",
    con_conflicto: "warning",
    sin_efecto: "neutral",
    codigo_muerto: "error"
};

const TONO_EDICION: Record<NivelEdicion, BadgeTone> = {
    panel: "primary",
    mixto: "primary",
    codigo: "neutral",
    entorno: "warning",
    ninguno: "neutral"
};

const NOMBRE_TIPO: Record<string, string> = Object.fromEntries(TIPOS_MENSAJE.map((t) => [t.id, t.nombre]));

const TODOS = "todos";

// Busca la entrada del catálogo que usa un tipo de respuesta del panel de
// Mensajes (para abrir el modal directamente en ella).
export function entradaParaTipoRespuesta(tipoId: string): string | null {
    for (const modulo of CATALOGO_ACTIVADORES) {
        const entrada = modulo.entradas.find((e) => e.plantillas?.includes(tipoId));
        if (entrada) return entrada.id;
    }
    return null;
}

function coincide(entrada: EntradaCatalogo, filtro: string) {
    if (!filtro) return true;
    const texto = [
        entrada.nombre, entrada.resumen, entrada.accion,
        ...entrada.condiciones,
        ...entrada.activadores.flatMap((a) => [a.descripcion, ...(a.ejemplos || [])]),
        ...entrada.codigo.map((c) => `${c.archivo} ${c.simbolo || ""}`),
        ...(entrada.plantillas || [])
    ].join(" ").toLowerCase();
    return texto.includes(filtro.toLowerCase());
}

interface Props {
    open: boolean;
    onClose: () => void;
    usuarioId: string;
    enfocarId?: string | null;
}

export default function ActivadoresModal({ open, onClose, usuarioId, enfocarId = null }: Props) {

    return (

        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title="Activadores y acciones"
            description="Qué activa cada función del bot y qué hace realmente. Solo lectura: nada de aquí cambia el comportamiento del bot."
        >
            {open && <Contenido key={enfocarId || TODOS} usuarioId={usuarioId} enfocarId={enfocarId} onNavegar={onClose} />}
        </Modal>

    );

}

// Se monta de nuevo en cada apertura: filtros limpios y lectura fresca del
// estado real de la cuenta (solo lectura).
function Contenido({ usuarioId, enfocarId, onNavegar }: { usuarioId: string; enfocarId: string | null; onNavegar: () => void }) {

    const [filtro, setFiltro] = useState("");
    const [modulo, setModulo] = useState(TODOS);
    const [estadoFiltro, setEstadoFiltro] = useState(TODOS);
    const [estadoReal, setEstadoReal] = useState<EstadoRealActivadores | null>(null);
    const [cargando, setCargando] = useState(true);
    const listaRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {

        let cancelado = false;

        cargarEstadoRealActivadores(usuarioId)
            .then((r) => { if (!cancelado) setEstadoReal(r); })
            .catch((e: Error) => { if (!cancelado) setEstadoReal({ tipos: {}, reaccionesActivadas: true, automatizacion: null, sticker: null, errores: [e.message] }); })
            .finally(() => { if (!cancelado) setCargando(false); });

        return () => { cancelado = true; };

    }, [usuarioId]);

    // Abierto sobre una entrada concreta: llevarla a la vista.
    useEffect(() => {

        if (!enfocarId) return;

        const raf = requestAnimationFrame(() => {
            listaRef.current?.querySelector(`[data-entrada="${enfocarId}"]`)?.scrollIntoView({ block: "start" });
        });

        return () => cancelAnimationFrame(raf);

    }, [enfocarId]);

    const modulosVisibles = useMemo(() => CATALOGO_ACTIVADORES
        .filter((m) => modulo === TODOS || m.id === modulo)
        .map((m) => ({
            ...m,
            entradas: m.entradas.filter((e) => coincide(e, filtro) && (estadoFiltro === TODOS || e.estado === estadoFiltro))
        }))
        .filter((m) => m.entradas.length > 0), [modulo, filtro, estadoFiltro]);

    const totales = useMemo(() => {
        const todas = CATALOGO_ACTIVADORES.flatMap((m) => m.entradas);
        return {
            total: todas.length,
            conflicto: todas.filter((e) => e.estado === "con_conflicto").length,
            sinEfecto: todas.filter((e) => e.estado === "sin_efecto" || e.estado === "codigo_muerto").length
        };
    }, []);

    const visibles = modulosVisibles.reduce((n, m) => n + m.entradas.length, 0);

    return (

            <div className={styles.cuerpo}>

                <p className={styles.resumen}>
                    {totales.total} funciones · {totales.conflicto} con conflicto conocido · {totales.sinEfecto} sin efecto o sin uso
                </p>

                <div className={styles.filtros}>
                    <div className={styles.buscar}>
                        <Input
                            aria-label="Buscar"
                            placeholder="Buscar por función, frase, archivo o plantilla…"
                            value={filtro}
                            onChange={(e) => setFiltro(e.target.value)}
                        />
                    </div>
                    <Select aria-label="Módulo" value={modulo} onChange={(e) => setModulo(e.target.value)}>
                        <option value={TODOS}>Todos los módulos</option>
                        {CATALOGO_ACTIVADORES.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </Select>
                    <Select aria-label="Estado" value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
                        <option value={TODOS}>Todos los estados</option>
                        {(Object.keys(ETIQUETA_ESTADO) as EstadoEntrada[]).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
                    </Select>
                </div>

                {estadoReal?.errores.length ? (
                    <p className={styles.aviso} role="status">
                        <AlertTriangle size={13} aria-hidden="true" />
                        No se pudo leer parte de la configuración real: {estadoReal.errores.join(" · ")}
                    </p>
                ) : null}

                <div className={styles.lista} ref={listaRef}>

                    {visibles === 0 && <p className={styles.vacio}>Ninguna función coincide con la búsqueda.</p>}

                    {modulosVisibles.map((m) => (

                        <section key={m.id} className={styles.modulo} aria-labelledby={`modulo-${m.id}`}>

                            <h3 id={`modulo-${m.id}`} className={styles.moduloTitulo}>{m.nombre}</h3>
                            <p className={styles.moduloDescripcion}>{m.descripcion}</p>

                            {m.entradas.map((e) => (
                                <Entrada
                                    key={`${e.id}-${enfocarId === e.id}`}
                                    entrada={e}
                                    abierta={enfocarId === e.id}
                                    estadoReal={estadoReal}
                                    cargando={cargando}
                                    onNavegar={onNavegar}
                                />
                            ))}

                        </section>

                    ))}

                </div>

                <p className={styles.pie}>
                    <Lock size={12} aria-hidden="true" />
                    Probar qué detector se activaría con un mensaje requiere una simulación en el servidor del bot, que todavía no existe; no se muestra aquí para no duplicar los detectores.
                </p>

            </div>

    );

}

function Entrada({ entrada: e, abierta, estadoReal, cargando, onNavegar }: {
    entrada: EntradaCatalogo;
    abierta: boolean;
    estadoReal: EstadoRealActivadores | null;
    cargando: boolean;
    onNavegar: () => void;
}) {

    return (

        <details className={styles.entrada} data-entrada={e.id} open={abierta}>

            <summary className={styles.entradaResumen}>
                <span className={styles.entradaNombre}>{e.nombre}</span>
                <span className={styles.insignias}>
                    {e.sensible && <Badge size="sm" tone="warning">Modifica datos</Badge>}
                    <Badge size="sm" tone={TONO_ESTADO[e.estado]}>{ETIQUETA_ESTADO[e.estado]}</Badge>
                    {e.edicion.nivel !== "ninguno" && <Badge size="sm" tone={TONO_EDICION[e.edicion.nivel]}>{ETIQUETA_EDICION[e.edicion.nivel]}</Badge>}
                </span>
            </summary>

            <div className={styles.detalle}>

                <p className={styles.texto}>{e.resumen}</p>

                {e.avisos?.length ? (
                    <ul className={styles.avisos}>
                        {e.avisos.map((a) => <li key={a}><AlertTriangle size={12} aria-hidden="true" /> {a}</li>)}
                    </ul>
                ) : null}

                <Seccion titulo="Activadores">
                    <ul className={styles.activadores}>
                        {e.activadores.map((a, i) => (
                            <li key={i}>
                                <Badge size="sm" tone={a.tipo === "desconocido" ? "error" : "neutral"}>{ETIQUETA_TIPO_ACTIVADOR[a.tipo]}</Badge>
                                <span className={styles.texto}>{a.descripcion}</span>
                                {a.ejemplos?.length ? (
                                    <span className={styles.ejemplos}>
                                        {a.ejemplos.map((ej) => <code key={ej} className={styles.chip}>{ej}</code>)}
                                        <span className={styles.nota}>(ejemplos; lista completa en {a.fuente?.split("/").pop()})</span>
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </Seccion>

                {e.condiciones.length > 0 && (
                    <Seccion titulo="Condiciones">
                        <ul className={styles.puntos}>{e.condiciones.map((c) => <li key={c}>{c}</li>)}</ul>
                    </Seccion>
                )}

                <Seccion titulo="Qué hace">
                    <p className={styles.texto}>{e.accion}</p>
                    {(e.lee.length > 0 || e.escribe.length > 0) && (
                        <dl className={styles.datos}>
                            {e.lee.length > 0 && <><dt>Lee</dt><dd>{e.lee.join(" · ")}</dd></>}
                            {e.escribe.length > 0 && <><dt>Modifica</dt><dd>{e.escribe.join(" · ")}</dd></>}
                        </dl>
                    )}
                </Seccion>

                <Seccion titulo="Configuración">
                    <p className={styles.texto}>{e.edicion.detalle}</p>
                    {e.panel?.length ? (
                        <ul className={styles.puntos}>
                            {e.panel.map((p) => (
                                <li key={`${p.ruta}-${p.que}`}>
                                    <Link href={p.ruta} className={styles.enlace} onClick={onNavegar}>{p.pagina}</Link>: {p.que}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <EstadoReal entrada={e} estadoReal={estadoReal} cargando={cargando} />
                </Seccion>

                <Seccion titulo="Código">
                    <ul className={styles.codigo}>
                        {e.codigo.map((c) => <li key={`${c.archivo}-${c.simbolo}`}><code>{c.archivo}</code>{c.simbolo && <> · <code>{c.simbolo}</code></>}</li>)}
                    </ul>
                </Seccion>

            </div>

        </details>

    );

}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
    return (
        <div className={styles.seccion}>
            <p className={styles.seccionTitulo}>{titulo}</p>
            {children}
        </div>
    );
}

function EstadoReal({ entrada: e, estadoReal, cargando }: { entrada: EntradaCatalogo; estadoReal: EstadoRealActivadores | null; cargando: boolean }) {

    if (!e.estadoReal) return null;

    if (cargando && !estadoReal) {
        return <p className={styles.nota}>Leyendo la configuración real…</p>;
    }

    if (e.estadoReal === "tipos") {
        return (
            <ul className={styles.estadoReal} aria-label="Estado real en tu cuenta">
                {(e.plantillas || []).map((tipo) => {
                    const t = estadoDeTipo(estadoReal, tipo);
                    return (
                        <li key={tipo}>
                            <span>{NOMBRE_TIPO[tipo] || tipo}</span>
                            <Badge size="sm" tone={t.habilitado ? "success" : "error"}>{t.habilitado ? "Respuesta activada" : "Respuesta desactivada"}</Badge>
                            <span className={styles.nota}>{t.activas} de {t.total} plantilla{t.total === 1 ? "" : "s"} activa{t.activas === 1 ? "" : "s"}</span>
                        </li>
                    );
                })}
            </ul>
        );
    }

    if (e.estadoReal === "reacciones") {
        return (
            <p className={styles.estadoUnico}>
                Tu cuenta: <Badge size="sm" tone={estadoReal?.reaccionesActivadas ? "success" : "error"}>{estadoReal?.reaccionesActivadas ? "Activadas" : "Desactivadas"}</Badge>
            </p>
        );
    }

    if (e.estadoReal === "automatizacion") {
        const a = estadoReal?.automatizacion;
        if (!a) return <p className={styles.nota}>No se pudo leer la automatización.</p>;
        const n = a.porFuncion[e.id] ?? 0;
        return (
            <p className={styles.estadoUnico}>
                Tu cuenta: activada en <strong>{n}</strong> de {a.configuracionesActivas} grupo{a.configuracionesActivas === 1 ? "" : "s"} con automatización encendida · {a.gruposAutorizadosActivos} grupo{a.gruposAutorizadosActivos === 1 ? "" : "s"} autorizado{a.gruposAutorizadosActivos === 1 ? "" : "s"}.
            </p>
        );
    }

    const s = estadoReal?.sticker;
    if (!s) return <p className={styles.nota}>No se pudo leer el sticker de pago.</p>;
    return (
        <p className={styles.estadoUnico}>
            Tu cuenta: {s.registrados} sticker{s.registrados === 1 ? "" : "s"} registrado{s.registrados === 1 ? "" : "s"}{s.predeterminado ? " (incluye el predeterminado)" : " · sin sticker predeterminado"}.
        </p>
    );

}
