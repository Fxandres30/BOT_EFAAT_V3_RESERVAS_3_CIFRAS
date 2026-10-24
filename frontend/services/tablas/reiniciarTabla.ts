import { supabase } from "@/lib/supabase";
import { obtenerTablaConfigCliente, obtenerTablasCliente } from "./tablasCliente";
import { registrarActividad } from "./registrarActividad";
import { prepararCuadricula, diagnosticar } from "./prepararCuadricula";
import {
    calcularImpacto,
    huellaFilas,
    puedeConfirmar,
    type EventoReinicio,
    type FilaReinicio,
    type ImpactoReinicio,
    type SorteoProgramadoReinicio
} from "./impactoReinicio";

// Reinicio de la tabla física de un precio (Tablas → «Reiniciar»): deja
// libres las 100 celdas (00-99) DEL USUARIO. Solo toca filas con
// usuario_id = usuarioId — nunca las de otro cliente que comparta la misma
// tabla física — y no borra ni cambia sorteos (programados o activos): solo
// los números.
//
// Dos pasos: revisarReinicio() calcula el impacto que ve el administrador
// (estados, reservas anticipadas, sorteos en curso, precios que comparten la
// tabla) y una huella de los números ocupados; reiniciarTabla() solo
// escribe con su confirmación expresa y si la tabla sigue como se revisó.

export interface RevisionReinicio {
    /** Sin cuadrícula todavía: «reiniciar» la crea (no hay nada que borrar). */
    sinCuadricula: boolean;
    impacto: ImpactoReinicio | null;
}

export interface ConfirmacionReinicio {
    texto: string;
    aceptaAnticipadas: boolean;
    /** La huella que vio el administrador (de revisarReinicio). */
    huella: string;
}

export interface ResultadoReinicio {
    accion: "creada" | "reiniciada";
    filas: number;
    /** Números que cambiaron durante la escritura y no se tocaron. */
    noTocadas: number;
    anticipadasEliminadas: number;
}

const CAMPOS_LIBRE = {
    estado: "libre",
    comprador: null,
    contacto: null,
    contacto_lower: null,
    lib: null,
    grupo_id: null,
    grupo_nombre: null,
    evento_id: null,
    nombre_evento: null,
    telefono_bot: null,
    fecha_reserva: null,
    hora_reserva: null,
    fecha_pago: null,
    hora_pago: null,
    temporal_por: null,
    bloqueado_hasta: null,
    ip_reserva: null,
    usuario_global_id: null,
    nombre: null,
    telefono: null
};

async function leerFilas(tabla: string, usuarioId: string): Promise<FilaReinicio[]> {
    const { data, error } = await supabase
        .from(tabla)
        .select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId);
    if (error) throw new Error("No se pudo leer la tabla. No se reinició nada.");
    return (data ?? []) as FilaReinicio[];
}

// Sorteos programados y eventos del cliente: para distinguir reservas
// anticipadas reales y sorteos en curso. Sin la tabla de sorteos programados
// (migración 024 sin aplicar) no puede haber anticipadas; cualquier otro
// error impide reiniciar (falla cerrado).
async function leerSorteos(usuarioId: string): Promise<{ sorteos: SorteoProgramadoReinicio[]; eventos: EventoReinicio[] }> {

    const [sp, ev] = await Promise.all([
        supabase.from("sorteos_programados").select("id, estado, identidad_evento_real, config").eq("usuario_id", usuarioId),
        supabase.from("eventos_bot").select("identidad_evento_real, activo, tabla, nombre_evento, valor").eq("usuario_id", usuarioId)
    ]);

    if (sp.error && sp.error.code !== "42P01" && sp.error.code !== "PGRST205")
        throw new Error("No se pudo comprobar si hay reservas anticipadas. No se reinició nada.");
    if (ev.error)
        throw new Error("No se pudo comprobar los sorteos de la tabla. No se reinició nada.");

    return { sorteos: (sp.error ? [] : sp.data ?? []) as SorteoProgramadoReinicio[], eventos: (ev.data ?? []) as EventoReinicio[] };

}

export async function revisarReinicio(precio: number, usuarioId: string): Promise<RevisionReinicio> {

    // Tabla física según la configuración DEL CLIENTE (tablas_cliente).
    const config = await obtenerTablaConfigCliente(precio, usuarioId);
    if (!config) throw new Error("Tabla no encontrada.");

    const filas = await leerFilas(config.tabla, usuarioId);
    if (filas.length === 0) return { sinCuadricula: true, impacto: null };

    const [{ sorteos, eventos }, precios] = await Promise.all([leerSorteos(usuarioId), obtenerTablasCliente(usuarioId)]);

    return {
        sinCuadricula: false,
        impacto: calcularImpacto({ tabla: config.tabla, precio, filas, sorteos, eventos, precios: precios.map(p => ({ precio: p.precio, tabla: p.tabla })) })
    };

}

export async function reiniciarTabla(precio: number, usuarioId: string, confirmacion?: ConfirmacionReinicio): Promise<ResultadoReinicio> {

    const config = await obtenerTablaConfigCliente(precio, usuarioId);
    if (!config) throw new Error("Tabla no encontrada.");

    const filasAhora = await leerFilas(config.tabla, usuarioId);

    // El panel no ve ninguna fila: puede que el cliente aún no tenga su
    // cuadrícula o que la base no deje leerla (RLS). El navegador ya no
    // inserta 00-99 por su cuenta (saltaba las guardias de la migración 027
    // y chocaba con UNIQUE(numero)): lo decide el backend con las filas
    // reales, sin tocar otra cuadrícula.
    if (filasAhora.length === 0) {

        const r = await prepararCuadricula(precio);

        // Lo que la sesión ve ahora (si se acaba de crear, sus 100 filas).
        const { count: vistas } = await supabase
            .from(config.tabla)
            .select("*", { count: "exact", head: true })
            .eq("usuario_id", usuarioId);

        const d = diagnosticar(r, vistas ?? 0);
        if (d.tipo !== "lista") throw new Error(d.mensaje);

        await registrarActividad({ usuarioId, tabla: config.tabla, tipo: "tabla_reiniciada", detalle: { precio, accion: "creada", filas: r.filas ?? config.cantidad } });

        return { accion: "creada", filas: r.filas ?? config.cantidad, noTocadas: 0, anticipadasEliminadas: 0 };

    }

    // Con números ya existentes, nunca sin la confirmación del diálogo.
    if (!confirmacion) throw new Error("Confirma el reinicio desde el diálogo. No se reinició nada.");

    const [{ sorteos, eventos }, precios] = await Promise.all([leerSorteos(usuarioId), obtenerTablasCliente(usuarioId)]);
    const impacto = calcularImpacto({ tabla: config.tabla, precio, filas: filasAhora, sorteos, eventos, precios: precios.map(p => ({ precio: p.precio, tabla: p.tabla })) });

    // La tabla cambió desde que el administrador revisó el impacto (una
    // reserva, un pago, un bloqueo nuevos): no se borra algo que no vio.
    if (huellaFilas(filasAhora) !== confirmacion.huella)
        throw new Error("La tabla cambió desde que revisaste el reinicio (nuevas reservas, pagos o bloqueos). No se reinició nada: vuelve a abrir «Reiniciar» y revisa.");

    if (!puedeConfirmar(impacto, confirmacion))
        throw new Error(impacto.totalAnticipadas > 0 && !confirmacion.aceptaAnticipadas
            ? `La tabla tiene ${impacto.totalAnticipadas} reserva(s) anticipada(s): confirma expresamente que se eliminan. No se reinició nada.`
            : "Falta la confirmación del reinicio. No se reinició nada.");

    // Solo las filas de ESTE cliente en esta tabla física, y cada una solo si
    // conserva el estado con el que se revisó (UPDATE condicionado por
    // estado): una reserva, pago o bloqueo que entre durante la escritura no
    // coincide y no se toca. Se informa cuántas quedaron sin tocar.
    const porEstado = new Map<string, string[]>();
    for (const f of filasAhora) porEstado.set(f.estado, [...(porEstado.get(f.estado) || []), f.numero]);

    let filas = 0;
    for (const [estado, numeros] of porEstado) {
        const { data, error } = await supabase
            .from(config.tabla)
            .update(CAMPOS_LIBRE)
            .eq("usuario_id", usuarioId)
            .eq("estado", estado)
            .in("numero", numeros)
            .select("numero");
        if (error) {
            throw new Error(filas
                ? `Reinicio incompleto: ${filas} número(s) quedaron disponibles y el resto no (${error.message || "error de la base"}). Revisa la tabla antes de reintentar.`
                : `No se pudo reiniciar la tabla: ${error.message || "error de la base"}. No se modificó nada.`);
        }
        filas += (data ?? []).length;
    }

    const noTocadas = filasAhora.length - filas;

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        tipo: "tabla_reiniciada",
        detalle: {
            precio,
            accion: "reiniciada",
            filas,
            no_tocadas: noTocadas,
            ocupados: impacto.ocupados,
            por_estado: impacto.porEstado,
            anticipadas_eliminadas: impacto.totalAnticipadas,
            sorteos_anticipados: impacto.anticipadas.map(a => ({ sorteo_id: a.sorteoId, nombre: a.nombre, cantidad: a.cantidad })),
            precios_compartidos: impacto.preciosCompartidos
        }
    });

    return { accion: "reiniciada", filas, noTocadas, anticipadasEliminadas: impacto.totalAnticipadas };

}
