"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Plus, RefreshCw, Search, Sticker } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { avisar } from "@/components/ui/Avisos";

import type { EstadoStickerPago } from "@/hooks/useStickerPago";
import { aplicarAVarios } from "@/services/automatizacion/automationConfigs";
import { GrupoAutorizado, alternarGrupoAutorizado, autorizarGrupo } from "@/services/automatizacion/gruposAutorizados";
import { listarGruposConStickerPropio } from "@/services/automatizacion/stickerPago";
import { FiltroGrupos, GrupoVista, coincideFiltro, filtrarGrupos, ordenarGrupos } from "@/services/automatizacion/vistaGrupos";

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import AutorizarGrupoModal from "../AutorizarGrupoModal/AutorizarGrupoModal";
import EditorAutomatizacion from "../CentroAutomatizaciones/EditorAutomatizacion";
import type { SeccionEditor } from "../CentroAutomatizaciones/TarjetaGrupo";
import type { FilaGrupo } from "../CentroAutomatizaciones/filaGrupo";
import { useEstadoAutomatizacion } from "../compartido/useEstadoAutomatizacion";
import { AUTOMATIZACION, AUTORIZACION, CONEXION } from "../compartido/estados";
import StickerPagoPredeterminadoSection from "./StickerPagoPredeterminadoSection";
import TarjetaGrupoAutomatizacion from "./TarjetaGrupoAutomatizacion";
import styles from "../compartido/Automatizacion.module.css";

const FILTROS: { id: FiltroGrupos; texto: string }[] = [
    { id: "todos", texto: "Todos" },
    { id: "autorizados", texto: "Autorizados" },
    { id: "por_autorizar", texto: "Por autorizar" },
    { id: "sin_conexion", texto: "Sin conexión" },
    { id: "pausados", texto: "Automatización pausada" }
];

function filtroDeUrl(valor: string | null): FiltroGrupos {
    return FILTROS.some((f) => f.id === valor) ? (valor as FiltroGrupos) : "todos";
}

// Grupos de Automatización: autorización, conexión y estado de la
// automatización de cada grupo, más el sticker de confirmación de pagos.
// Mismas reglas de siempre: autorizar/reactivar usan grupos_autorizados
// (autorizarGrupo / alternarGrupoAutorizado) y pausar usa el interruptor
// general del grupo (aplicarAVarios con { activo }) — nada más cambia.
export default function GruposAutomatizacion() {

    const estado = useEstadoAutomatizacion();
    const { usuarioId, cargando, error, grupos, sesiones, autorizados, ahora } = estado;

    const router = useRouter();
    const params = useSearchParams();

    const [filtro, setFiltro] = useState<FiltroGrupos>(() => filtroDeUrl(params.get("filtro")));
    const [texto, setTexto] = useState("");
    const [modalAutorizar, setModalAutorizar] = useState(false);
    const [procesando, setProcesando] = useState<Set<string>>(() => new Set());
    const [editor, setEditor] = useState<{ grupoId: string; seccion: SeccionEditor } | null>(null);
    const [pausa, setPausa] = useState<FilaGrupo | null>(null);
    const [desautorizar, setDesautorizar] = useState<GrupoVista<FilaGrupo> | null>(null);
    const [stickerEstado, setStickerEstado] = useState<EstadoStickerPago | null>(null);
    const [propios, setPropios] = useState<Set<string> | null | undefined>(undefined);

    useEffect(() => {
        if (!usuarioId) return;
        let vigente = true;
        listarGruposConStickerPropio(usuarioId).then(({ data }) => { if (vigente) setPropios(data); });
        return () => { vigente = false; };
    }, [usuarioId]);

    // Enlace directo desde el Resumen: «Administrar sticker».
    useEffect(() => {
        if (cargando || typeof window === "undefined" || window.location.hash !== "#sticker-pago") return;
        document.getElementById("sticker-pago")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [cargando]);

    const ordenados = useMemo(() => ordenarGrupos(grupos), [grupos]);
    const visibles = filtrarGrupos(ordenados, filtro, texto);

    const sesionesConectadas = (sesiones || []).filter((s) => s.estado === "conectada");
    const sesionesDesconectadas = (sesiones || []).filter((s) => s.estado === "desconectada");
    const sesionesSinVerificar = (sesiones || []).filter((s) => s.estado === "no_verificable");

    // ------------------------------------------------------------ acciones ---

    async function conProcesando(clave: string, fn: () => Promise<void>) {
        if (procesando.has(clave)) return;
        setProcesando((prev) => new Set(prev).add(clave));
        try {
            await fn();
        } finally {
            setProcesando((prev) => {
                const copia = new Set(prev);
                copia.delete(clave);
                return copia;
            });
        }
    }

    function autorizar(grupoId: string) {
        if (!usuarioId) return;
        conProcesando(grupoId, async () => {
            const { data, error: err } = await autorizarGrupo(usuarioId, grupoId);
            if (err || !data) {
                avisar.error("No se pudo autorizar el grupo. Intenta de nuevo.");
                return;
            }
            estado.reemplazarAutorizacion(data as GrupoAutorizado);
            avisar.ok("Grupo autorizado.");
        });
    }

    function cambiarAutorizacion(g: GrupoVista<FilaGrupo>, activo: boolean) {
        const auth = g.autorizacion;
        if (!auth) return;
        return conProcesando(g.grupoId, async () => {
            const { data, error: err } = await alternarGrupoAutorizado(auth.id, activo);
            if (err || !data) {
                avisar.error("No se pudo cambiar la autorización. Intenta de nuevo.");
                return;
            }
            estado.reemplazarAutorizacion(data as GrupoAutorizado);
            avisar.ok(activo ? "Autorización reactivada." : "Autorización desactivada. La configuración se conserva.");
        });
    }

    function aplicarActivo(fila: FilaGrupo, activo: boolean) {
        if (!usuarioId) return;
        return conProcesando(fila.config.grupo_id, async () => {
            const { data, error: err } = await aplicarAVarios(usuarioId, [fila.config.grupo_id], { activo });
            if (err || !data) {
                avisar.error(`No se cambió la automatización (${err || "sin respuesta"}).`);
                return;
            }
            estado.reemplazarConfigs(data);
            avisar.ok(activo ? "Automatización reactivada." : "Automatización pausada. No saldrán mensajes automáticos nuevos.");
        });
    }

    function alternarAutomatizacion(fila: FilaGrupo) {
        // Pausar con un sorteo en marcha se confirma (mismo criterio que el
        // Centro de control); reactivar es inmediato.
        if (fila.config.activo && fila.cicloAbierto) {
            setPausa(fila);
            return;
        }
        aplicarActivo(fila, !fila.config.activo);
    }

    function abrirEditor(g: GrupoVista<FilaGrupo>, seccion: SeccionEditor) {
        if (g.fila) setEditor({ grupoId: g.fila.config.grupo_id, seccion });
        // Sin configuración todavía: la pantalla de detalle la crea (igual que antes).
        else router.push(`/automatizacion/grupos/${encodeURIComponent(g.grupoId)}`);
    }

    function alAutorizado(nuevo: GrupoAutorizado) {
        estado.reemplazarAutorizacion(nuevo);
        setModalAutorizar(false);
        avisar.ok("Grupo autorizado.");
    }

    const filaEditor = editor ? estado.filas.find((f) => f.config.grupo_id === editor.grupoId) || null : null;

    // -------------------------------------------------------------- render ---

    return (

        <div className={styles.page}>

            <AutomatizacionHeader
                title="Grupos"
                description="Autoriza tus grupos de WhatsApp, revisa su conexión y activa o pausa su automatización. Cada grupo muestra qué mensajes automáticos tiene y cuándo sale el siguiente."
                actions={usuarioId && (
                    <>
                        <Button size="sm" variant="secondary" onClick={() => estado.recargar()} loading={estado.actualizando} disabled={estado.actualizando}>
                            <RefreshCw size={13} /> Actualizar
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => document.getElementById("sticker-pago")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                            <Sticker size={13} /> Sticker de pagos
                        </Button>
                        <Button size="sm" onClick={() => setModalAutorizar(true)}>
                            <Plus size={13} /> Autorizar grupo
                        </Button>
                    </>
                )}
            />

            {cargando ? (

                <div className={styles.state}>Cargando grupos…</div>

            ) : !usuarioId ? (

                <div className={styles.state}>Debes iniciar sesión para administrar grupos.</div>

            ) : (

                <>

                    {error && <p className={styles.avisoError}><AlertTriangle size={15} /><span className={styles.avisoTexto}>{error}</span></p>}

                    <section className={styles.panel} aria-label="Conexión de WhatsApp">
                        <div className={styles.sesiones}>
                            <strong style={{ color: "var(--efaat-text)" }}>Tu WhatsApp:</strong>
                            {sesiones === null ? (
                                <Badge size="sm" tone="neutral">Comprobando…</Badge>
                            ) : sesiones.length === 0 ? (
                                <>
                                    <Badge size="sm" tone="error" dot>Sin WhatsApp vinculado</Badge>
                                    <Link href="/sesiones" prefetch={false} className={styles.enlace}>Vincular en Sesiones</Link>
                                </>
                            ) : (
                                <>
                                    {sesionesConectadas.map((s) => <Badge key={s.sessionId} size="sm" tone="success" dot>{s.nombreSesion} · conectado</Badge>)}
                                    {sesionesDesconectadas.map((s) => <Badge key={s.sessionId} size="sm" tone="error" dot>{s.nombreSesion} · desconectado</Badge>)}
                                    {sesionesSinVerificar.map((s) => <Badge key={s.sessionId} size="sm" tone="warning" dot>{s.nombreSesion} · sin verificar</Badge>)}
                                    {sesionesConectadas.length === 0 && <Link href="/sesiones" prefetch={false} className={styles.enlace}>Reconectar en Sesiones</Link>}
                                </>
                            )}
                        </div>

                        {sesiones !== null && sesionesConectadas.length === 0 && sesionesSinVerificar.length > 0 && (
                            <p className={styles.alerta}>
                                <AlertTriangle size={13} />
                                No pudimos comprobar tu WhatsApp en este momento. Tus autorizaciones siguen guardadas y no se cambió nada.
                            </p>
                        )}

                        <details className={styles.leyenda}>
                            <summary>¿Qué significa cada estado?</summary>
                            <div className={styles.leyendaGrid}>
                                {[CONEXION.conectado, CONEXION.no_visto, CONEXION.sin_sesion, CONEXION.no_verificable,
                                    AUTORIZACION.autorizado, AUTORIZACION.pausada, AUTORIZACION.no_autorizado,
                                    AUTOMATIZACION.activa, AUTOMATIZACION.pausada, AUTOMATIZACION.sin_configurar].map((e) => (
                                    <div key={e.texto} className={styles.leyendaItem}>
                                        <span><Badge size="sm" tone={e.tono}>{e.texto}</Badge></span>
                                        <span>{e.explicacion}</span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    </section>

                    <div className={styles.toolbar}>
                        <div className={styles.chips} role="tablist" aria-label="Filtrar grupos">
                            {FILTROS.map((f) => {
                                const n = grupos.filter((g) => coincideFiltro(g, f.id)).length;
                                return (
                                    <button
                                        key={f.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={filtro === f.id}
                                        className={`${styles.chip} ${filtro === f.id ? styles.chipActivo : ""}`}
                                        onClick={() => setFiltro(f.id)}
                                    >
                                        {f.texto} <span className={styles.chipContador}>{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <label className={styles.buscar}>
                            <Search size={14} className={styles.buscarIcono} aria-hidden="true" />
                            <input type="search" placeholder="Buscar grupo" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar grupo" />
                        </label>
                    </div>

                    {grupos.length === 0 ? (

                        <EmptyState
                            title={sesiones === null ? "Buscando tus grupos…" : "No hay grupos para mostrar"}
                            description={sesiones === null
                                ? "Estamos consultando tu WhatsApp en vivo."
                                : sesionesConectadas.length > 0
                                    ? "Tu WhatsApp está conectado pero no reportó ningún grupo. Puedes autorizar uno por su identificador con «Autorizar grupo»."
                                    : "Conecta tu WhatsApp en «Sesiones» para ver tus grupos, o autoriza uno por su identificador con «Autorizar grupo»."}
                        />

                    ) : visibles.length === 0 ? (

                        <EmptyState
                            title="Ningún grupo coincide"
                            action={<Button size="sm" variant="secondary" onClick={() => { setFiltro("todos"); setTexto(""); }}>Ver todos</Button>}
                        />

                    ) : (

                        <div className={styles.grid}>
                            {visibles.map((g) => (
                                <TarjetaGrupoAutomatizacion
                                    key={g.grupoId}
                                    grupo={g}
                                    ahora={ahora}
                                    stickerPropio={propios === undefined ? undefined : propios === null ? null : propios.has(g.grupoId)}
                                    stickerGeneral={stickerEstado === null || stickerEstado === "cargando" ? null : stickerEstado === "configurado" || stickerEstado === "esperando"}
                                    procesando={procesando.has(g.grupoId)}
                                    onAutorizar={() => autorizar(g.grupoId)}
                                    onReactivarAutorizacion={() => cambiarAutorizacion(g, true)}
                                    onDesactivarAutorizacion={() => setDesautorizar(g)}
                                    onAlternarAutomatizacion={() => g.fila && alternarAutomatizacion(g.fila)}
                                    onConfigurar={() => abrirEditor(g, "general")}
                                    onProgramar={() => abrirEditor(g, "programaciones")}
                                />
                            ))}
                        </div>

                    )}

                    <StickerPagoPredeterminadoSection usuarioId={usuarioId} onEstado={setStickerEstado} />

                </>

            )}

            {modalAutorizar && usuarioId && (
                <AutorizarGrupoModal
                    usuarioId={usuarioId}
                    gruposYaAutorizados={autorizados.map((g) => g.grupo_id)}
                    onClose={() => setModalAutorizar(false)}
                    onAutorizado={alAutorizado}
                />
            )}

            {usuarioId && filaEditor && editor && (
                <EditorAutomatizacion
                    key={editor.grupoId}
                    usuarioId={usuarioId}
                    fila={filaEditor}
                    seccionInicial={editor.seccion}
                    ahora={ahora}
                    onClose={() => setEditor(null)}
                    onGuardado={(config) => estado.reemplazarConfigs([config])}
                    onHistorial={() => router.push(`/automatizacion/programacion?vista=actividad&grupo=${encodeURIComponent(editor.grupoId)}`)}
                />
            )}

            {pausa && (
                <Modal
                    open
                    size="sm"
                    onClose={() => setPausa(null)}
                    title="Pausar automatización"
                    footer={
                        <div className={styles.botonesPie}>
                            <Button variant="ghost" size="sm" onClick={() => setPausa(null)}>Cancelar</Button>
                            <Button
                                variant="danger"
                                size="sm"
                                loading={procesando.has(pausa.config.grupo_id)}
                                onClick={async () => { await aplicarActivo(pausa, false); setPausa(null); }}
                            >
                                Pausar
                            </Button>
                        </div>
                    }
                >
                    <p className={styles.nota}>
                        <strong>{pausa.nombre}</strong> tiene un sorteo en marcha. Mientras esté en pausa no saldrán recordatorios,
                        actualizaciones, tabla inicial ni cierre nuevos; los recordatorios que venzan durante la pausa quedarán omitidos.
                        Lo ya enviado y la configuración se conservan.
                    </p>
                </Modal>
            )}

            {desautorizar && (
                <Modal
                    open
                    size="sm"
                    onClose={() => setDesautorizar(null)}
                    title="Desactivar autorización"
                    footer={
                        <div className={styles.botonesPie}>
                            <Button variant="ghost" size="sm" onClick={() => setDesautorizar(null)}>Cancelar</Button>
                            <Button
                                variant="danger"
                                size="sm"
                                loading={procesando.has(desautorizar.grupoId)}
                                onClick={async () => { await cambiarAutorizacion(desautorizar, false); setDesautorizar(null); }}
                            >
                                Desactivar
                            </Button>
                        </div>
                    }
                >
                    <p className={styles.nota}>
                        EFAAT dejará de automatizar este grupo. La autorización y la configuración no se borran: puedes
                        reactivarla cuando quieras.
                    </p>
                </Modal>
            )}

        </div>

    );

}
