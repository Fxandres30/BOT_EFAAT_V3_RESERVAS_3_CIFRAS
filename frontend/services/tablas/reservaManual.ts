import { fetchConSesion } from "@/lib/fetchConSesion";

// Intervención manual sobre un número (Tablas → número): todo pasa por el
// backend (backend/services/reservaManual.js), que aplica las mismas reglas
// que el bot, valida la disponibilidad justo antes de guardar y registra la
// auditoría con el operador sacado del token. El navegador nunca escribe en
// la tabla de números ni decide el cliente, el operador o el estado final.

export type EstadoReal = "libre" | "reservado" | "pagado" | "bloqueado" | "en_proceso" | "en_proceso_vencido";
export type AccionNumero = "reservar" | "pagar" | "liberar" | "desbloquear";

export interface GrupoContacto {
    grupoId: string;
    grupoNombre: string | null;
}

export interface ContactoBuscado {
    id: string;
    nombre: string | null;
    telefono: string | null;
    telefonoPendiente: boolean;
    grupos: GrupoContacto[];
}

export interface ContextoGrupo {
    eventoId: string;
    grupoId: string | null;
    grupoNombre: string | null;
    autorizado: boolean;
}

// Sorteo programado de este precio que todavía no se publicó: admite
// reservas anticipadas (se guardan con su identidad, sin evento todavía).
export interface SorteoProgramado {
    sorteoId: string;
    nombreEvento: string | null;
    fechaEvento: string | null;
    horaCierre: string | null;
    horaFin: string | null;
    publicarEn: string;
    cifras: number;
    aceptaReservas: boolean;
    motivo: string | null;
    grupos: { grupoId: string; grupoNombre: string | null; autorizado: boolean }[];
}

export interface EntradaHistorial {
    id: string;
    accion: AccionNumero;
    origen: "manual" | "bot";
    resultado: "ok" | "rechazado" | "error";
    codigo: string | null;
    estadoAnterior: string | null;
    estadoNuevo: string | null;
    contactoNombre: string | null;
    grupoNombre: string | null;
    motivo: string | null;
    observaciones: string | null;
    metodoPago: string | null;
    operador: string | null;
    creadoEn: string;
}

export interface ContextoNumero {
    ok: true;
    precio: number;
    tabla: string;
    numero: string;
    estado: EstadoReal;
    acciones: AccionNumero[];
    fila: {
        comprador: string | null;
        telefono: string | null;
        contactoId: string | null;
        grupoId: string | null;
        grupoNombre: string | null;
        eventoId: string | null;
        nombreEvento: string | null;
        fechaReserva: string | null;
        horaReserva: string | null;
        fechaPago: string | null;
        horaPago: string | null;
        motivoBloqueo: string | null;
        bloqueadoHasta: string | null;
        /** Nombre del sorteo programado si es una reserva anticipada. */
        sorteoAnticipado?: string | null;
    };
    sorteo: {
        nombreEvento: string | null;
        valor: number;
        fechaEvento: string | null;
        horaCierre: string | null;
        horaFin: string | null;
        cifras: number;
        aceptaReservas: boolean;
    } | null;
    contextos: ContextoGrupo[];
    programados?: SorteoProgramado[];
    pago: { metodoPago: string | null; observaciones: string | null; operador: string | null; registradoEn: string } | null;
    historial: EntradaHistorial[];
    auditoriaDisponible: boolean;
    servidorAhora: string;
}

export interface Fallo {
    ok: false;
    motivo: string;
    mensaje: string;
    estadoActual?: EstadoReal;
}

export interface Exito {
    ok: true;
    estado: EstadoReal;
    idempotente?: boolean;
    accion?: AccionNumero;
}

export type Resultado<T = Exito> = T | Fallo;

// Mensajes cuando el backend no llega a responder con uno propio.
const MENSAJES_RED: Record<string, string> = {
    backend_timeout: "El servidor no respondió a tiempo. Revisa el número antes de reintentar: la operación pudo haberse guardado.",
    backend_no_disponible: "No se pudo contactar al servidor. Inténtalo de nuevo.",
    red: "Sin conexión con el panel. Inténtalo de nuevo.",
    sin_sesion: "Tu sesión expiró. Vuelve a iniciar sesión.",
    sesion_invalida: "Tu sesión expiró. Vuelve a iniciar sesión."
};

async function llamar<T>(url: string, init?: RequestInit): Promise<Resultado<T>> {

    let res: Response;

    try {
        res = await fetchConSesion(url, init);
    } catch {
        return { ok: false, motivo: "red", mensaje: MENSAJES_RED.red };
    }

    let cuerpo: Record<string, unknown> = {};
    try {
        cuerpo = await res.json();
    } catch {
        /* cuerpo vacío o no JSON */
    }

    if (res.ok && cuerpo.ok !== false) return cuerpo as T;

    const motivo = String(cuerpo.motivo || cuerpo.code || `http_${res.status}`);

    return {
        ok: false,
        motivo,
        mensaje: String(cuerpo.mensaje || MENSAJES_RED[motivo] || cuerpo.error || "No se pudo completar la operación."),
        ...(cuerpo.estadoActual ? { estadoActual: cuerpo.estadoActual as EstadoReal } : {})
    };

}

const json = (cuerpo: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
});

export function buscarContactos(q: string) {
    return llamar<{ ok: true; contactos: ContactoBuscado[] }>(`/api/tablas/contactos?q=${encodeURIComponent(q)}`);
}

export function obtenerContextoNumero(precio: number, numero: string) {
    return llamar<ContextoNumero>(`/api/tablas/numero?precio=${precio}&numero=${encodeURIComponent(numero)}`);
}

export interface DatosReserva {
    contactoId?: string;
    nuevoContacto?: { nombre: string; telefono: string };
    /** Sorteo activo (su fila del grupo) o, en su lugar, sorteo programado + grupo. */
    eventoId?: string;
    sorteoProgramadoId?: string;
    grupoId?: string;
    motivo: string;
    observaciones?: string;
    solicitudId: string;
}

export function reservarNumeroManual(precio: number, numero: string, datos: DatosReserva) {
    return llamar<Exito>("/api/tablas/numero", json({ precio, numero, accion: "reservar", ...datos }));
}

export interface DatosPago {
    metodoPago?: string;
    observaciones?: string;
    motivo?: string;
    solicitudId?: string;
}

export function pagarNumeroManual(precio: number, numero: string, datos: DatosPago = {}) {
    return llamar<Exito>("/api/tablas/numero", json({ precio, numero, accion: "pagar", ...datos }));
}

export interface DatosLiberar {
    motivo?: string;
    observaciones?: string;
    solicitudId?: string;
}

export function liberarNumeroManual(precio: number, numero: string, datos: DatosLiberar = {}) {
    return llamar<Exito>("/api/tablas/numero", json({ precio, numero, accion: "liberar", confirmar: true, ...datos }));
}

export function nuevaSolicitudId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
