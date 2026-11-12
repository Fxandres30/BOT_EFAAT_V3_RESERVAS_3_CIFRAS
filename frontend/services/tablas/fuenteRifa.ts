import { supabase } from "@/lib/supabase";
import type { TablaConfig } from "@/lib/tablasConfig";
import type { ActividadReserva, EventoActivo, NumeroReserva } from "@/components/tablas/types";
import type { FilaArchivo, FilaAuditoria } from "@/components/tablas/historialDatos";
import { LIMITE_HISTORIAL, type EventosHistorial } from "./obtenerHistorial";
import { huellaFilas, type FilaReinicio, type ImpactoReinicio } from "./impactoReinicio";
import type { ConfirmacionReinicio, ResultadoReinicio, RevisionReinicio } from "./reiniciarTabla";
import { apiRifas, mensajeMotivo } from "@/services/rifas/apiRifas";
import { fechaColombia, ZONA_COLOMBIA } from "@/lib/tiempo/colombia";

// "HH:MM:SS" en Colombia, como guardaban las tablas antiguas su hora_reserva.
const FORMATO_HORA = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_COLOMBIA, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const horaColombia = (d: Date) => FORMATO_HORA.format(d);

// ==========================================================================
// Fuente de datos de la pantalla ORIGINAL de Tablas cuando la tabla es una
// rifa del motor independiente (tabla_id). Devuelve exactamente las mismas
// formas que las lecturas de siempre (NumeroReserva, EventoActivo,
// actividad, historial), así la pantalla no cambia: solo de dónde salen los
// datos. Todo se filtra por tabla_id Y usuario_id (la RLS además solo deja
// leer las filas del cliente de la sesión).
// ==========================================================================

export const TABLA_RIFA = "numeros_rifa";

export interface RifaPanel {
    id: string;
    usuario_id: string;
    nombre: string;
    codigo: string | null;
    precio: number;
    cifras: number;
    cantidad: number;
    activa: boolean;
    ciclo: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esTablaId = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);

const texto = (n: number, cifras: number) => String(n).padStart(Math.max(1, cifras), "0");
const fecha = (iso: string | null | undefined) => (iso ? fechaColombia(new Date(iso)) : null);
const hora = (iso: string | null | undefined) => (iso ? horaColombia(new Date(iso)) : null);

export async function obtenerRifaPanel(tablaId: string, usuarioId: string): Promise<RifaPanel | null> {
    const { data, error } = await supabase.from("tablas_rifas")
        .select("id, usuario_id, nombre, codigo, precio, cifras, cantidad, activa, ciclo")
        .eq("id", tablaId).eq("usuario_id", usuarioId).maybeSingle();
    if (error) throw new Error("No se pudo leer la tabla.");
    return (data as RifaPanel | null) ?? null;
}

export function configDeRifa(rifa: RifaPanel): TablaConfig {
    return { tabla: TABLA_RIFA, cifras: rifa.cifras, cantidad: rifa.cantidad };
}

// Fila de numeros_rifa → fila de la cuadrícula tal como la pinta la pantalla.
export function filaPanel(f: Record<string, unknown>, cifras: number): NumeroReserva {
    const s = (k: string) => (f[k] === undefined ? null : (f[k] as string | null));
    return {
        id: f.id as unknown as number,
        numero: texto(Number(f.numero), cifras),
        estado: f.estado as NumeroReserva["estado"],
        comprador: s("comprador"),
        contacto: s("contacto"),
        nombre: s("comprador"),
        telefono: s("telefono"),
        lib: s("lib"),
        grupo_id: s("grupo_id"),
        grupo_nombre: s("grupo_nombre"),
        evento_id: s("evento_id"),
        nombre_evento: s("nombre_evento"),
        identidad_evento_real: s("identidad_evento_real"),
        usuario_id: s("usuario_id"),
        usuario_global_id: s("usuario_global_id"),
        telefono_bot: s("telefono_bot"),
        fecha_reserva: fecha(s("reservado_en")),
        hora_reserva: hora(s("reservado_en")),
        fecha_pago: fecha(s("pagado_en")),
        hora_pago: hora(s("pagado_en")),
        temporal_por: s("temporal_por"),
        bloqueado_hasta: s("bloqueado_hasta"),
        ip_reserva: null,
        contacto_lower: s("contacto")?.toLowerCase() ?? null,
        creado_en: (s("actualizado_en") ?? "") as string,
        ...({ tabla_id: s("tabla_id"), lid: s("lid") } as object)
    };
}

export async function leerNumerosRifa(tablaId: string, usuarioId: string, cifras: number, numeros?: string[]): Promise<NumeroReserva[]> {
    if (numeros && numeros.length === 0) return [];
    const filas: NumeroReserva[] = [];
    // Hasta 10.000 números por rifa: por páginas (la API corta en 1000).
    for (let desde = 0; ; desde += 1000) {
        let q = supabase.from("numeros_rifa").select("*").eq("tabla_id", tablaId).eq("usuario_id", usuarioId);
        if (numeros) q = q.in("numero", numeros.map(Number).filter(Number.isInteger));
        const { data, error } = await q.order("numero", { ascending: true }).range(desde, desde + 999);
        if (error) throw error;
        filas.push(...(data || []).map(f => filaPanel(f, cifras)));
        if (!data || data.length < 1000) break;
    }
    return filas;
}

// Sorteo de ESTA rifa (eventos_bot.tabla_id), el más reciente activo.
export async function obtenerEventoActivoRifa(tablaId: string, usuarioId: string): Promise<EventoActivo | null> {
    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("tabla_id", tablaId).eq("usuario_id", usuarioId).eq("activo", true)
        .order("creado_en", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as EventoActivo | null;
}

export async function obtenerActividadRifa(tablaId: string, usuarioId: string, limite: number, desde?: string): Promise<ActividadReserva[]> {
    let q = supabase.from("reservas_actividad").select("*").eq("tabla_id", tablaId).eq("usuario_id", usuarioId);
    if (desde) q = q.gte("creado_en", desde);
    const { data, error } = await q.order("creado_en", { ascending: false }).limit(limite);
    if (error) {
        if (desde) throw error;
        console.error("No se pudo cargar actividad reciente:", error.message);
        return [];
    }
    return (data || []) as ActividadReserva[];
}

const COLUMNAS_AUDITORIA = "id, origen, accion, numero, grupo_nombre, contacto_nombre, contacto_telefono, contacto_id, estado_anterior, estado_nuevo, motivo, observaciones, metodo_pago, resultado, codigo, operador_email, creado_en";

// Auditoría de los números de ESTA rifa + su archivo (reinicios y el
// historial migrado de las tablas antiguas).
export async function obtenerHistorialRifa(tablaId: string, usuarioId: string, cifras: number, desde?: { auditoria: string | null; archivo: string | null | false }): Promise<EventosHistorial> {
    let qa = supabase.from("reservas_auditoria").select(COLUMNAS_AUDITORIA)
        .eq("usuario_id", usuarioId).eq("tabla_id", tablaId)
        .in("accion", ["reservar", "pagar", "liberar", "desbloquear"]).neq("numero", "*");
    let qr = supabase.from("numeros_rifa_archivo").select("id, numero, estado, fila, motivo, archivado_en")
        .eq("usuario_id", usuarioId).eq("tabla_id", tablaId);
    if (desde?.auditoria) qa = qa.gte("creado_en", desde.auditoria);
    if (desde?.archivo) qr = qr.gte("archivado_en", desde.archivo);

    const [auditoria, archivo] = await Promise.all([
        qa.order("creado_en", { ascending: false }).limit(LIMITE_HISTORIAL),
        desde?.archivo === false ? { data: [], error: null } : qr.order("archivado_en", { ascending: false }).limit(LIMITE_HISTORIAL)
    ]);
    if (auditoria.error) console.warn("[historial] auditoría no disponible:", auditoria.error.message);
    if (archivo.error) console.warn("[historial] archivo no disponible:", archivo.error.message);

    const filasArchivo: FilaArchivo[] = (archivo.error ? [] : (archivo.data || []) as Record<string, unknown>[]).map(a => {
        const fila = (a.fila || {}) as Record<string, unknown>;
        // Lo migrado de las tablas antiguas trae la fila original dentro de «legado».
        const original = (fila.legado as Record<string, unknown> | undefined) ?? fila;
        return {
            id: String(a.id),
            numero: texto(Number(a.numero), cifras),
            estado: String(a.estado),
            nombre_evento: (original.nombre_evento as string | null) ?? null,
            fila: original,
            motivo: (a.motivo as string | null) ?? null,
            archivado_en: String(a.archivado_en)
        };
    });

    return {
        auditoria: auditoria.error ? [] : ((auditoria.data || []) as FilaAuditoria[]),
        auditoriaDisponible: !auditoria.error,
        archivo: filasArchivo
    };
}

// ---------------------------------------------------------------- reinicio ---

async function filasOcupadas(tablaId: string, usuarioId: string, cifras: number): Promise<FilaReinicio[]> {
    const { data, error } = await supabase.from("numeros_rifa").select("numero, estado, identidad_evento_real")
        .eq("tabla_id", tablaId).eq("usuario_id", usuarioId).neq("estado", "libre").order("numero");
    if (error) throw new Error("No se pudo leer la tabla. No se reinició nada.");
    return (data || []).map(f => ({ numero: texto(Number(f.numero), cifras), estado: f.estado, identidad_evento_real: f.identidad_evento_real }));
}

// Impacto del reinicio de ESTA rifa: solo sus números. Ninguna otra tabla se
// ve afectada, por eso preciosCompartidos siempre va vacío.
export async function revisarReinicioRifa(rifa: RifaPanel, usuarioId: string): Promise<RevisionReinicio> {
    const ocupadas = await filasOcupadas(rifa.id, usuarioId, rifa.cifras);
    const { data: eventos } = await supabase.from("eventos_bot").select("nombre_evento, valor, activo")
        .eq("tabla_id", rifa.id).eq("usuario_id", usuarioId).eq("activo", true);
    const cuenta = (e: string) => ocupadas.filter(f => f.estado === e).length;
    const impacto: ImpactoReinicio = {
        tabla: TABLA_RIFA,
        total: rifa.cantidad,
        ocupados: ocupadas.length,
        porEstado: {
            reservado: cuenta("reservado"), pagado: cuenta("pagado"), bloqueado: cuenta("bloqueado"), en_proceso: cuenta("en_proceso"),
            otros: ocupadas.filter(f => !["reservado", "pagado", "bloqueado", "en_proceso"].includes(f.estado)).length
        },
        anticipadas: [],
        totalAnticipadas: 0,
        sorteosActivos: (eventos || []).map(e => ({ nombre: e.nombre_evento || "Sorteo", valor: Number(String(e.valor ?? "").replace(/[^\d]/g, "")) || null })),
        preciosCompartidos: [],
        huella: huellaFilas(ocupadas)
    };
    return { sinCuadricula: false, impacto };
}

// Reinicia SOLO esta rifa (backend rifa_reiniciar: archiva lo ocupado, sube
// el ciclo). Si la rifa cambió desde la revisión, no se reinicia.
export async function reiniciarRifa(rifa: RifaPanel, usuarioId: string, confirmacion?: ConfirmacionReinicio): Promise<ResultadoReinicio> {
    const ocupadas = await filasOcupadas(rifa.id, usuarioId, rifa.cifras);
    if (ocupadas.length > 0 && (!confirmacion || confirmacion.huella !== huellaFilas(ocupadas))) {
        throw new Error("La tabla cambió desde que la revisaste. Vuelve a revisarla antes de reiniciar.");
    }
    const r = await apiRifas.reiniciar(rifa.id, "REINICIAR");
    if (!r.ok) throw new Error((r as { error?: string }).error || mensajeMotivo(r.motivo));
    return { accion: "reiniciada", filas: rifa.cantidad, noTocadas: 0, anticipadasEliminadas: 0 };
}
