import type { ActividadReserva, EstadoNumero, NumeroReserva } from "./types";

// ==========================================================================
// «Historial de números» — une el ESTADO ACTUAL de cada número (la fila de
// la tabla física, la misma que pinta la cuadrícula) con los EVENTOS que de
// verdad quedaron registrados. Las dos cosas se presentan por separado: el
// estado actual nunca se deduce de los eventos ni al revés.
//
// Fuentes de eventos (todas filtradas por el cliente de la sesión):
//   auditoria  reservas_auditoria (032): solo la escribe el backend, es
//              inmutable y la fecha la pone la base. Registro fiable.
//   actividad  reservas_actividad (002): la escribe el backend, pero la RLS
//              también deja insertar al panel del propio cliente. Se muestra
//              como «actividad registrada», no como auditoría.
//   archivo    reservas_archivo (030): copia de cada fila liberada al
//              reiniciar la tabla desde un sorteo programado.
//
// Con la auditoría disponible, la actividad que DUPLICA un evento auditado
// (reservas y acciones del panel) se descarta; quedan solo los eventos que
// la auditoría no cubre (pago por sticker del admin, liberación por
// vencimiento).
//
// Nada se inventa: un dato ausente queda en null. Solo imports de tipos.
// ==========================================================================

export type FuenteEvento = "auditoria" | "actividad" | "archivo";

export interface FilaAuditoria {
    id: string;
    origen: "manual" | "bot";
    accion: "reservar" | "pagar" | "liberar" | "desbloquear";
    numero: string;
    grupo_nombre: string | null;
    contacto_nombre: string | null;
    contacto_telefono: string | null;
    estado_anterior: string | null;
    estado_nuevo: string | null;
    motivo: string | null;
    observaciones: string | null;
    metodo_pago: string | null;
    resultado: "ok" | "rechazado" | "error";
    codigo: string | null;
    operador_email: string | null;
    creado_en: string;
}

export interface FilaArchivo {
    id: string;
    numero: string;
    estado: string;
    nombre_evento: string | null;
    fila: Record<string, unknown> | null;
    motivo: string | null;
    archivado_en: string;
}

export interface EventoHistorial {
    id: string;
    fuente: FuenteEvento;
    titulo: string;
    // Instante real registrado por la base (ISO).
    en: string;
    origen: string | null;
    resultado: "ok" | "rechazado" | "error";
    estadoAnterior: string | null;
    estadoNuevo: string | null;
    cliente: string | null;
    contacto: string | null;
    grupo: string | null;
    detalles: string[];
}

export interface FilaHistorial {
    numero: string;
    estado: EstadoNumero;
    cliente: string | null;
    contacto: string | null;
    grupo: string | null;
    sorteo: string | null;
    // Fecha y hora guardadas en la fila (hora de Colombia), tal cual.
    reserva: { fecha: string; hora: string | null } | null;
    pago: { fecha: string; hora: string | null } | null;
    eventos: EventoHistorial[];
}

export interface FuentesHistorial {
    auditoria: FilaAuditoria[];
    auditoriaDisponible: boolean;
    actividad: ActividadReserva[];
    archivo: FilaArchivo[];
}

const TITULO_AUDITORIA: Record<FilaAuditoria["accion"], string> = {
    reservar: "Reserva",
    pagar: "Pago registrado",
    liberar: "Liberación",
    desbloquear: "Desbloqueo"
};

const TITULO_ACTIVIDAD: Record<string, string> = {
    reservado: "Reserva",
    pagado: "Pago registrado",
    liberado: "Liberación",
    bloqueado: "Bloqueo",
    cancelado: "Pago anulado"
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function desdeAuditoria(a: FilaAuditoria): EventoHistorial {
    return {
        id: `auditoria:${a.id}`,
        fuente: "auditoria",
        titulo: TITULO_AUDITORIA[a.accion] || a.accion,
        en: a.creado_en,
        origen: a.origen === "bot" ? "bot" : a.operador_email ? `panel · ${a.operador_email}` : "panel",
        resultado: a.resultado,
        estadoAnterior: a.estado_anterior,
        estadoNuevo: a.estado_nuevo,
        cliente: texto(a.contacto_nombre),
        contacto: texto(a.contacto_telefono),
        grupo: texto(a.grupo_nombre),
        detalles: [
            a.metodo_pago && `Método: ${a.metodo_pago}`,
            a.motivo && `Motivo: ${a.motivo}`,
            a.observaciones && `Observaciones: ${a.observaciones}`,
            a.resultado !== "ok" && a.codigo && `Código: ${a.codigo}`
        ].filter(Boolean) as string[]
    };
}

function origenActividad(realizadoPor: string | null, detalle: Record<string, unknown>): string | null {
    if (detalle.confirmado_via === "sticker_admin") return "sticker del administrador";
    if (realizadoPor === "bot:vencimiento") return "bot · reserva vencida";
    if (realizadoPor?.startsWith("panel:")) return `panel · ${realizadoPor.slice(6)}`;
    return texto(realizadoPor);
}

function desdeActividad(a: ActividadReserva): EventoHistorial {
    const d = a.detalle || {};
    const anterior = texto(d.estadoAnterior);
    return {
        id: `actividad:${a.id}`,
        fuente: "actividad",
        titulo: TITULO_ACTIVIDAD[a.tipo] || a.tipo,
        en: a.creado_en,
        origen: origenActividad(a.realizado_por, d),
        resultado: "ok",
        estadoAnterior: anterior,
        estadoNuevo: a.tipo === "liberado" || a.tipo === "cancelado" ? "libre" : a.tipo === "reservado" || a.tipo === "pagado" || a.tipo === "bloqueado" ? a.tipo : null,
        cliente: texto(d.comprador),
        contacto: texto(d.contacto),
        grupo: texto(d.grupo_nombre),
        detalles: [
            texto(d.metodo_pago) && `Método: ${d.metodo_pago}`,
            d.motivo === "vencimiento" && typeof d.minutos === "number" ? `Venció tras ${d.minutos} min sin pago` : texto(d.motivo) && `Motivo: ${d.motivo}`
        ].filter(Boolean) as string[]
    };
}

function desdeArchivo(a: FilaArchivo): EventoHistorial {
    const f = a.fila || {};
    return {
        id: `archivo:${a.id}`,
        fuente: "archivo",
        titulo: "Archivado al reiniciar la tabla",
        en: a.archivado_en,
        origen: "sorteo programado",
        resultado: "ok",
        estadoAnterior: a.estado,
        estadoNuevo: "libre",
        cliente: texto(f.comprador) || texto(f.nombre),
        contacto: texto(f.telefono) || texto(f.contacto),
        grupo: texto(f.grupo_nombre),
        detalles: [
            a.nombre_evento && `Sorteo: ${a.nombre_evento}`,
            texto(f.fecha_reserva) && `Reservado el ${f.fecha_reserva}${texto(f.hora_reserva) ? ` ${f.hora_reserva}` : ""}`,
            texto(f.fecha_pago) && `Pagado el ${f.fecha_pago}${texto(f.hora_pago) ? ` ${f.hora_pago}` : ""}`
        ].filter(Boolean) as string[]
    };
}

// Actividad que la auditoría ya registra: reservas (bot y panel) y acciones
// del panel. Solo se descarta si la auditoría está disponible.
function duplicaAuditoria(a: ActividadReserva): boolean {
    return a.tipo === "reservado" || !!a.realizado_por?.startsWith("panel:");
}

export function construirHistorial(numeros: NumeroReserva[], fuentes: FuentesHistorial, estadoDe: (n: NumeroReserva) => EstadoNumero): FilaHistorial[] {

    const eventos = new Map<string, EventoHistorial[]>();
    const agregar = (numero: string | null, e: EventoHistorial) => {
        if (!numero) return;
        const lista = eventos.get(numero) || [];
        lista.push(e);
        eventos.set(numero, lista);
    };

    if (fuentes.auditoriaDisponible) fuentes.auditoria.forEach(a => agregar(a.numero, desdeAuditoria(a)));
    fuentes.actividad
        .filter(a => a.numero && a.tipo in TITULO_ACTIVIDAD)
        .filter(a => !(fuentes.auditoriaDisponible && duplicaAuditoria(a)))
        .forEach(a => agregar(a.numero, desdeActividad(a)));
    fuentes.archivo.forEach(a => agregar(a.numero, desdeArchivo(a)));

    const filas: FilaHistorial[] = [];

    for (const n of numeros) {

        const estado = estadoDe(n);
        const lista = (eventos.get(n.numero) || []).sort((x, y) => y.en.localeCompare(x.en));
        const ocupado = estado !== "libre";

        // Un número libre sin ningún evento no tiene historial que mostrar.
        if (!ocupado && lista.length === 0) continue;

        filas.push({
            numero: n.numero,
            estado,
            // Datos de la reserva actual: solo si el número sigue ocupado.
            cliente: ocupado ? texto(n.comprador) || texto(n.nombre) : null,
            contacto: ocupado ? texto(n.telefono) || texto(n.contacto) : null,
            grupo: ocupado ? texto(n.grupo_nombre) : null,
            sorteo: ocupado ? texto(n.nombre_evento) : null,
            reserva: ocupado && n.fecha_reserva ? { fecha: n.fecha_reserva, hora: n.hora_reserva } : null,
            pago: ocupado && n.fecha_pago ? { fecha: n.fecha_pago, hora: n.hora_pago } : null,
            eventos: lista
        });

    }

    return filas.sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true }));

}

export type FiltroEstadoHistorial = "todos" | EstadoNumero;

export interface FiltrosHistorial {
    texto: string;
    estado: FiltroEstadoHistorial;
    grupo: string;
    // "AAAA-MM-DD" (fecha de Colombia) o "".
    fecha: string;
}

export const FILTROS_HISTORIAL_VACIOS: FiltrosHistorial = { texto: "", estado: "todos", grupo: "", fecha: "" };

// Fecha de Colombia ("AAAA-MM-DD") de un instante ISO.
export function fechaColombia(iso: string): string | null {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarHistorial(filas: FilaHistorial[], f: FiltrosHistorial): FilaHistorial[] {

    const q = normalizar(f.texto.trim());
    const qDigitos = q.replace(/\D/g, "");

    return filas.filter((fila) => {

        if (f.estado !== "todos" && fila.estado !== f.estado) return false;

        const grupos = [fila.grupo, ...fila.eventos.map(e => e.grupo)].filter(Boolean) as string[];
        if (f.grupo && !grupos.includes(f.grupo)) return false;

        if (f.fecha) {
            const fechas = [fila.reserva?.fecha, fila.pago?.fecha, ...fila.eventos.map(e => fechaColombia(e.en))];
            if (!fechas.includes(f.fecha)) return false;
        }

        if (q) {
            // Número: exacto con sus ceros ("07"; "7" también lo encuentra);
            // nombre o contacto: contiene.
            if (fila.numero === q || (/^\d+$/.test(q) && q.length < fila.numero.length && fila.numero === q.padStart(fila.numero.length, "0"))) return true;
            const nombres = [fila.cliente, ...fila.eventos.map(e => e.cliente)].filter(Boolean) as string[];
            const contactos = [fila.contacto, ...fila.eventos.map(e => e.contacto)].filter(Boolean) as string[];
            const enNombre = nombres.some(n => normalizar(n).includes(q));
            const enContacto = contactos.some(c => normalizar(c).includes(q) || (qDigitos.length >= 3 && c.replace(/\D/g, "").includes(qDigitos)));
            if (!enNombre && !enContacto) return false;
        }

        return true;

    });

}

export function gruposDelHistorial(filas: FilaHistorial[]): string[] {
    const set = new Set<string>();
    for (const f of filas) {
        if (f.grupo) set.add(f.grupo);
        f.eventos.forEach(e => e.grupo && set.add(e.grupo));
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
}
