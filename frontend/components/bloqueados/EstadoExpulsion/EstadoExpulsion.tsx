"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck, Smartphone, Users, History } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

import { obtenerExpulsiones, reintentarExpulsiones } from "@/services/bloqueados/bloqueados";
import type {
    DetalleExpulsiones,
    EstadoBloqueoNativo,
    EstadoExpulsionGeneral,
    EstadoExpulsionGrupo,
    ExpulsionGrupo,
    ModoExpulsion,
    ResumenExpulsion
} from "@/components/bloqueados/types";

import styles from "./EstadoExpulsion.module.css";

// ==========================================================================
// Estado REAL de la expulsión de un bloqueado. Nunca muestra «Expulsado» si
// el backend no lo verificó con la lista real de participantes del grupo
// (estado "expulsado" = WhatsApp respondió 200 Y la relectura confirmó que
// ya no está). Mientras haya grupos en proceso, se actualiza solo.
// ==========================================================================

const GENERAL: Record<EstadoExpulsionGeneral, { texto: string; tono: BadgeTone }> = {
    desbloqueado: { texto: "Desbloqueado", tono: "neutral" },
    solo_registrado: { texto: "Bloqueo registrado", tono: "neutral" },
    expulsion_pendiente: { texto: "Expulsión pendiente", tono: "warning" },
    expulsado_de_todos: { texto: "Fuera de todos los grupos", tono: "success" },
    simulado: { texto: "Simulación: se expulsaría", tono: "primary" },
    parcial: { texto: "Expulsión parcial", tono: "warning" },
    sesion_desconectada: { texto: "WhatsApp desconectado", tono: "warning" },
    error_permisos: { texto: "Sin permisos de administrador", tono: "error" },
    error_whatsapp: { texto: "Error de WhatsApp", tono: "error" },
    requiere_atencion: { texto: "Requiere atención", tono: "error" }
};

const POR_GRUPO: Record<EstadoExpulsionGrupo, { texto: string; tono: BadgeTone }> = {
    pendiente: { texto: "Pendiente", tono: "warning" },
    en_curso: { texto: "Procesando", tono: "warning" },
    expulsado: { texto: "Expulsión verificada", tono: "success" },
    ya_no_estaba: { texto: "Ya no pertenecía al grupo", tono: "success" },
    simulado: { texto: "Simulado", tono: "primary" },
    sin_verificar: { texto: "Solicitud enviada, sin confirmar", tono: "error" },
    sin_permisos: { texto: "Error de permisos", tono: "error" },
    sesion_desconectada: { texto: "Sesión desconectada", tono: "warning" },
    error_whatsapp: { texto: "Error de WhatsApp", tono: "error" },
    identidad_ambigua: { texto: "Identidad dudosa", tono: "error" },
    no_expulsable: { texto: "Es administrador", tono: "error" },
    cancelado: { texto: "Cancelado", tono: "neutral" }
};

const NATIVO: Record<EstadoBloqueoNativo, string> = {
    aplicado: "Bloqueado en WhatsApp",
    fallido: "WhatsApp no aceptó el bloqueo",
    sin_sesion: "No aplicado: WhatsApp desconectado",
    no_disponible: "No disponible para este contacto",
    retirado: "Retirado en WhatsApp"
};

// Explicación corta de por qué un grupo necesita atención.
const AYUDA: Partial<Record<EstadoExpulsionGrupo, string>> = {
    sin_permisos: "La cuenta de WhatsApp conectada debe ser administradora del grupo.",
    sesion_desconectada: "Se intentará en cuanto el WhatsApp de esta cuenta vuelva a conectarse.",
    identidad_ambigua: "No se expulsó para no retirar a otra persona por error. Revísalo manualmente en el grupo.",
    no_expulsable: "WhatsApp no permite expulsar a un administrador o al propietario del grupo.",
    sin_verificar: "WhatsApp aceptó la solicitud, pero la persona seguía apareciendo en el grupo."
};

// Estados que el servidor reintenta solo (proximo_intento_en).
const REINTENTO_AUTOMATICO: EstadoExpulsionGrupo[] = ["sin_verificar", "sin_permisos", "sesion_desconectada", "error_whatsapp"];

// Etiqueta de un grupo: "en_curso" distingue si la solicitud ya salió hacia
// WhatsApp (ultimo_status "enviando") y "pendiente" si es un reintento.
function etiquetaGrupo(g: ExpulsionGrupo): { texto: string; tono: BadgeTone } {
    if (g.estado === "en_curso" && g.ultimo_status === "enviando") return { texto: "Solicitud enviada", tono: "warning" };
    if (g.estado === "pendiente" && g.intentos > 0) return { texto: "Reintento programado", tono: "warning" };
    return POR_GRUPO[g.estado] || { texto: g.estado, tono: "neutral" };
}

function plural(n: number, singular: string, varios: string): string {
    return `${n} ${n === 1 ? singular : varios}`;
}

const REINTENTABLES: EstadoExpulsionGrupo[] = ["pendiente", "sin_verificar", "sin_permisos", "sesion_desconectada", "error_whatsapp", "identidad_ambigua", "no_expulsable", "simulado"];

const INTERVALO_MS = 4000;
const MAX_ACTUALIZACIONES = 45; // ~3 minutos

function fecha(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function avisoModo(modo: ModoExpulsion | undefined): string | null {
    if (modo === "desactivado") return "La expulsión automática todavía no está activada en el servidor: el bloqueo quedó registrado y las expulsiones están en espera.";
    if (modo === "simulacion") return "Modo simulación: se revisan los grupos y se indica qué se haría, pero no se expulsa a nadie.";
    return null;
}

export function ChipExpulsion({ resumen }: { resumen?: ResumenExpulsion | null }) {

    if (!resumen) return <Badge tone="neutral" size="sm">Sin datos</Badge>;

    const { texto, tono } = GENERAL[resumen.estado] || GENERAL.solo_registrado;
    const cuenta = resumen.total > 0 && resumen.estado !== "desbloqueado" ? ` · ${resumen.resueltos}/${resumen.total}` : "";

    return <Badge tone={tono} size="sm" dot={resumen.estado === "expulsion_pendiente"}>{texto}{cuenta}</Badge>;

}

interface DetalleProps {
    bloqueadoId: string;
    // Para que la lista o el perfil refresquen su resumen.
    onActualizado?: (detalle: DetalleExpulsiones) => void;
    compacto?: boolean;
}

export function DetalleExpulsion({ bloqueadoId, onActualizado, compacto = false }: DetalleProps) {

    const [detalle, setDetalle] = useState<DetalleExpulsiones | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reintentando, setReintentando] = useState(false);
    const [verHistorial, setVerHistorial] = useState(false);

    // Cada incremento vuelve a consultar el backend.
    const [version, setVersion] = useState(0);
    const actualizaciones = useRef(0);
    const avisar = useRef(onActualizado);

    useEffect(() => { avisar.current = onActualizado; });

    useEffect(() => {

        let vivo = true;

        async function cargar() {
            try {
                const d = await obtenerExpulsiones(bloqueadoId);
                if (!vivo) return;
                setDetalle(d);
                setError(null);
                avisar.current?.(d);
            } catch (e) {
                if (vivo) setError(e instanceof Error ? e.message : "No se pudo consultar el estado de la expulsión.");
            }
        }

        cargar();

        return () => { vivo = false; };

    }, [bloqueadoId, version]);

    // Actualización automática mientras haya grupos en proceso.
    const enProceso = !!detalle && detalle.grupos.some(g => g.estado === "pendiente" || g.estado === "en_curso") && detalle.expulsion.modo !== "desactivado";

    useEffect(() => {
        if (!enProceso) return;
        const t = setTimeout(() => {
            if (actualizaciones.current >= MAX_ACTUALIZACIONES) return;
            actualizaciones.current += 1;
            setVersion(v => v + 1);
        }, INTERVALO_MS);
        return () => clearTimeout(t);
    }, [enProceso, detalle]);

    async function onReintentar() {
        setReintentando(true);
        const r = await reintentarExpulsiones(bloqueadoId).catch(() => ({ ok: false }));
        setReintentando(false);
        if (!r.ok) {
            setError("No se pudo reintentar. Inténtalo de nuevo.");
            return;
        }
        actualizaciones.current = 0;
        setVersion(v => v + 1);
    }

    if (error && !detalle) return <p className={styles.error}>{error}</p>;
    if (!detalle) return <p className={styles.cargando}>Consultando el estado de la expulsión…</p>;

    const { expulsion, grupos, intentos, bloqueado } = detalle;
    const vigentes = grupos.filter(g => g.estado !== "cancelado");
    const pendientesDeAtencion = vigentes.filter(g => REINTENTABLES.includes(g.estado) && g.estado !== "pendiente");
    const puedeReintentar = bloqueado.activo && vigentes.some(g => REINTENTABLES.includes(g.estado)) && expulsion.modo !== "desactivado";
    const aviso = avisoModo(expulsion.modo);
    const sinResolver = expulsion.total - expulsion.resueltos - expulsion.simulados;
    const vigilando = bloqueado.activo && !expulsion.migracionPendiente && !!expulsion.vigilanciaSegundos && vigentes.length > 0;

    return (
        <div className={compacto ? `${styles.detalle} ${styles.compacto}` : styles.detalle}>

            <ul className={styles.capas}>
                <li>
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span className={styles.capaTitulo}>Bloqueo en EFAAT</span>
                    <Badge tone={bloqueado.activo ? "error" : "neutral"} size="sm">{bloqueado.activo ? "Registrado" : "Desbloqueado"}</Badge>
                </li>
                <li>
                    <Smartphone size={14} aria-hidden="true" />
                    <span className={styles.capaTitulo}>Bloqueo en WhatsApp</span>
                    <span className={styles.capaTexto} title={bloqueado.bloqueo_nativo_error || undefined}>
                        {bloqueado.bloqueo_nativo_estado ? NATIVO[bloqueado.bloqueo_nativo_estado] : "Sin registro"}
                    </span>
                </li>
                <li>
                    <Users size={14} aria-hidden="true" />
                    <span className={styles.capaTitulo}>Expulsión de grupos</span>
                    <ChipExpulsion resumen={expulsion} />
                </li>
            </ul>

            {expulsion.migracionPendiente && (
                <p className={styles.aviso}>Falta activar la expulsión en la base de datos (migración 040). El bloqueo quedó registrado, pero nadie ha sido retirado de los grupos.</p>
            )}

            {!expulsion.migracionPendiente && aviso && <p className={styles.aviso}>{aviso}</p>}

            {vigilando && (
                <p className={styles.meta}>Vigilancia activa: cada {expulsion.vigilanciaSegundos} s se revisan los participantes reales de los grupos; si vuelve a entrar, se expulsa de nuevo.</p>
            )}

            {!expulsion.sesionConectada && bloqueado.activo && vigentes.some(g => !["expulsado", "ya_no_estaba"].includes(g.estado)) && (
                <p className={styles.aviso}>El WhatsApp de esta cuenta no está conectado. Las expulsiones se harán cuando vuelva a conectarse.</p>
            )}

            {!expulsion.migracionPendiente && vigentes.length === 0 && bloqueado.activo && (
                <p className={styles.aviso}>No hay grupos autorizados en esta cuenta: no hay de dónde expulsarlo.</p>
            )}

            {vigentes.length > 0 && (
                <>
                    <p className={styles.resumen}>
                        {plural(expulsion.total, "grupo asociado", "grupos asociados")}
                        {` · ${plural(expulsion.expulsados, "expulsión verificada", "expulsiones verificadas")}`}
                        {expulsion.yaNoEstaban > 0 && ` · ${expulsion.yaNoEstaban} ya no pertenecía${expulsion.yaNoEstaban === 1 ? "" : "n"}`}
                        {expulsion.simulados > 0 && ` · ${plural(expulsion.simulados, "simulado", "simulados")}`}
                        {sinResolver > 0 && ` · ${plural(sinResolver, "pendiente", "pendientes")}`}
                        {pendientesDeAtencion.length > 0 && ` · ${pendientesDeAtencion.length} requiere${pendientesDeAtencion.length === 1 ? "" : "n"} atención`}
                    </p>

                    <ul className={styles.grupos}>
                        {vigentes.map(g => {
                            const etiqueta = etiquetaGrupo(g);
                            const reintento = bloqueado.activo && expulsion.modo !== "desactivado" && REINTENTO_AUTOMATICO.includes(g.estado) && !!g.proximo_intento_en;
                            return (
                                <li key={g.id} className={styles.grupo}>
                                    <div className={styles.grupoCabecera}>
                                        <span className={styles.grupoNombre}>{g.grupo_nombre || g.grupo_id}</span>
                                        <Badge tone={etiqueta.tono} size="sm">{etiqueta.texto}</Badge>
                                        {reintento && <Badge tone="neutral" size="sm">Reintento programado</Badge>}
                                    </div>
                                    {(g.ultimo_error || AYUDA[g.estado]) && (
                                        <p className={styles.motivo}>{g.ultimo_error || AYUDA[g.estado]}</p>
                                    )}
                                    <p className={styles.meta}>
                                        {g.verificada_en ? `Verificado ${fecha(g.verificada_en)}` : g.ultimo_intento_en ? `Último intento ${fecha(g.ultimo_intento_en)}` : `Solicitado ${fecha(g.solicitada_en)}`}
                                        {g.origen === "reingreso" && " · reingresó al grupo"}
                                        {g.intentos > 0 && ` · ${g.intentos} intento${g.intentos === 1 ? "" : "s"}`}
                                        {g.proximo_intento_en && REINTENTABLES.includes(g.estado) && g.estado !== "pendiente" && ` · próximo intento ${fecha(g.proximo_intento_en)}`}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.acciones}>
                {puedeReintentar && (
                    <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={13} />} loading={reintentando} loadingText="Reintentando…" onClick={onReintentar}>
                        Reintentar grupos pendientes
                    </Button>
                )}
                {intentos.length > 0 && (
                    <Button size="sm" variant="ghost" leftIcon={<History size={13} />} onClick={() => setVerHistorial(v => !v)}>
                        {verHistorial ? "Ocultar historial" : `Historial (${intentos.length})`}
                    </Button>
                )}
            </div>

            {verHistorial && (
                <ol className={styles.historial}>
                    {intentos.map(i => (
                        <li key={i.id}>
                            <span className={styles.meta}>{fecha(i.creado_en)}</span>
                            <span>{i.grupo_nombre || i.grupo_id}</span>
                            <Badge tone={(POR_GRUPO[i.resultado as EstadoExpulsionGrupo] || { tono: "neutral" }).tono} size="sm">
                                {(POR_GRUPO[i.resultado as EstadoExpulsionGrupo] || { texto: i.resultado }).texto}
                            </Badge>
                            {i.modo === "simulacion" && <span className={styles.meta}>simulación</span>}
                            {i.status_whatsapp && <span className={styles.meta}>WhatsApp {i.status_whatsapp}</span>}
                            {i.error && <span className={styles.motivo}>{i.error}</span>}
                        </li>
                    ))}
                </ol>
            )}

        </div>
    );

}
