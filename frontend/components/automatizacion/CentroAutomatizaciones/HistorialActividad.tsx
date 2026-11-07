"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

import { EntradaHistorial, listarHistorial } from "@/services/automatizacion/historialAutomatizacion";
import { fechaValida, formatearMomento, formatearRestante, nombreAccion } from "@/services/automatizacion/estadoProgramacion";
import { nombreCategoria } from "@/services/automatizacion/tiposCategorias";
import {
    ETIQUETA_HISTORIAL,
    ETIQUETA_TIPO_HISTORIAL,
    EstadoHistorial,
    TipoHistorial,
    estadoHistorial,
    motivoHistorial,
    tipoHistorial
} from "@/services/automatizacion/centroAutomatizaciones";

import type { FilaGrupo } from "./filaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

interface Props {
    usuarioId: string;
    filas: FilaGrupo[];
    grupoInicial: string | null;
    ahora: Date;
}

const TONO: Record<EstadoHistorial, BadgeTone> = {
    enviado: "success",
    omitido: "neutral",
    fallido: "error",
    en_curso: "primary",
    sin_confirmar: "warning"
};

export default function HistorialActividad({ usuarioId, filas, grupoInicial, ahora }: Props) {

    const [grupo, setGrupo] = useState<string>(grupoInicial || "");
    const [desde, setDesde] = useState("");
    const [hasta, setHasta] = useState("");
    const [estado, setEstado] = useState<EstadoHistorial | "">("");
    const [tipo, setTipo] = useState<TipoHistorial | "">("");

    const [version, setVersion] = useState(0);
    const [resultado, setResultado] = useState<{ clave: string; entradas: EntradaHistorial[]; error: string | null; limite: number } | null>(null);

    // Clave de la consulta vigente: mientras el resultado no sea de esta
    // clave, se está cargando (sin setState síncrono en el efecto).
    const clave = JSON.stringify({ grupo, desde, hasta, version });

    useEffect(() => {

        let vigente = true;

        listarHistorial(usuarioId, { grupoId: grupo || null, desde: desde || null, hasta: hasta || null }).then((res) => {
            if (!vigente) return;
            setResultado({ clave, entradas: res.data || [], error: res.error, limite: res.limite });
        });

        return () => { vigente = false; };

    }, [usuarioId, grupo, desde, hasta, clave]);

    const cargando = resultado?.clave !== clave;
    const entradas = resultado ? resultado.entradas : null;
    const error = resultado?.error || null;
    const limite = resultado?.limite || 300;

    const nombres = useMemo(() => new Map(filas.map((f) => [f.config.grupo_id, f.nombre])), [filas]);

    const visibles = (entradas || []).filter((e) => {
        if (estado && estadoHistorial(e, ahora) !== estado) return false;
        if (tipo && tipoHistorial(e.tipo_accion) !== tipo) return false;
        return true;
    });

    // Próximos envíos: calculados en vivo sobre el cierre real (no son filas
    // del historial: todavía no ocurrieron).
    const proximos = filas
        .filter((f) => !grupo || f.config.grupo_id === grupo)
        .flatMap((f) => f.recordatorios
            .filter((r) => ["programado", "proximo", "pendiente"].includes(r.resultado.estado) && r.resultado.momento)
            .map((r) => ({ fila: f, r })))
        .sort((a, b) => (a.r.resultado.momento as Date).getTime() - (b.r.resultado.momento as Date).getTime());

    return (

        <div className={styles.seccion}>

            <div className={styles.filtrosHistorial}>
                <select className={styles.filtro} value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
                    <option value="">Todos los grupos</option>
                    {filas.map((f) => <option key={f.config.grupo_id} value={f.config.grupo_id}>{f.nombre}</option>)}
                </select>
                <input type="date" className={styles.filtro} value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
                <input type="date" className={styles.filtro} value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
                <select className={styles.filtro} value={estado} onChange={(e) => setEstado(e.target.value as EstadoHistorial | "")} aria-label="Estado">
                    <option value="">Todos los estados</option>
                    {(Object.keys(ETIQUETA_HISTORIAL) as EstadoHistorial[]).map((k) => <option key={k} value={k}>{ETIQUETA_HISTORIAL[k]}</option>)}
                </select>
                <select className={styles.filtro} value={tipo} onChange={(e) => setTipo(e.target.value as TipoHistorial | "")} aria-label="Tipo de mensaje">
                    <option value="">Todos los tipos</option>
                    {(Object.keys(ETIQUETA_TIPO_HISTORIAL) as TipoHistorial[]).map((k) => <option key={k} value={k}>{ETIQUETA_TIPO_HISTORIAL[k]}</option>)}
                </select>
                <Button size="sm" variant="secondary" onClick={() => setVersion((v) => v + 1)} loading={cargando} disabled={cargando}>
                    <RefreshCw size={13} /> Actualizar
                </Button>
            </div>

            {!estado || estado === "en_curso" ? (
                <div className={styles.bloque}>
                    <span className={styles.etiqueta}>Programados en el sorteo actual</span>
                    {proximos.length === 0 ? (
                        <p className={styles.nota}>No hay mensajes programados pendientes{grupo ? " en este grupo" : ""}.</p>
                    ) : (
                        <div className={styles.tablaScroll}>
                            <table className={styles.tabla}>
                                <thead>
                                    <tr><th>Grupo</th><th>Mensaje</th><th>Hora prevista</th><th>Estado</th></tr>
                                </thead>
                                <tbody>
                                    {proximos.map(({ fila, r }) => (
                                        <tr key={`${fila.config.grupo_id}-${r.clave}`}>
                                            <td>{fila.nombre}</td>
                                            <td>Recordatorio {r.resultado.offset} min antes · {nombreCategoria(r.categoria)}</td>
                                            <td>{formatearMomento(r.resultado.momento as Date, ahora)}</td>
                                            <td>
                                                <Badge size="sm" tone="primary">
                                                    {r.resultado.etiqueta}{r.resultado.restanteMs !== null && ` · ${formatearRestante(r.resultado.restanteMs)}`}
                                                </Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            ) : null}

            {error && <p className={styles.alertaError}>{error}</p>}

            {entradas === null ? (
                <p className={styles.nota}>Cargando historial…</p>
            ) : visibles.length === 0 ? (
                <p className={styles.nota}>No hay registros con estos filtros.</p>
            ) : (
                <div className={styles.tablaScroll}>
                    <table className={styles.tabla}>
                        <thead>
                            <tr>
                                <th>Fecha real</th>
                                <th>Grupo</th>
                                <th>Tipo</th>
                                <th>Prevista</th>
                                <th>Estado</th>
                                <th>Resultado</th>
                                <th>Mensaje</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibles.map((e) => {
                                const est = estadoHistorial(e, ahora);
                                const real = fechaValida(e.finalizado_en) || fechaValida(e.ejecutado_en);
                                const motivo = motivoHistorial(e);
                                return (
                                    <tr key={e.id}>
                                        <td>{real ? formatearMomento(real, ahora) : "No registrado"}</td>
                                        <td>{nombres.get(e.grupo_id) || e.grupo_id}</td>
                                        <td>{nombreAccion(e.tipo_accion)}</td>
                                        <td className={styles.celdaSecundaria}>{e.prevista ? formatearMomento(e.prevista, ahora) : "—"}</td>
                                        <td><Badge size="sm" tone={TONO[est]}>{ETIQUETA_HISTORIAL[est]}</Badge></td>
                                        <td className={styles.celdaSecundaria}>
                                            {est === "enviado" ? "WhatsApp aceptó el mensaje" : motivo || (est === "sin_confirmar" ? "Empezó y no se registró el final" : "—")}
                                        </td>
                                        <td className={styles.celdaMensaje}>{e.mensaje || (est === "enviado" ? "No registrado" : "—")}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <p className={styles.nota}>
                Se muestran los {limite} registros más recientes del filtro elegido. «Enviado» significa que WhatsApp aceptó el
                mensaje; el sistema no confirma entrega ni lectura. No existe un estado «cancelado»: lo que no se envió por las
                reglas (grupo cerrado, sin números libres, automatización pausada) aparece como «Omitido».
            </p>

        </div>

    );

}
