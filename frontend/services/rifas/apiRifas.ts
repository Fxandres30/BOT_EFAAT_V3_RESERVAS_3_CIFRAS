import { supabase } from "@/lib/supabase";

// Cliente del panel para el motor de rifas independientes (backend /rifas,
// a través de app/api/rifas). Cada rifa se identifica por su tabla_id: el
// precio es solo un dato. El backend saca el cliente del token.

export type ModoMotor = "legado" | "nuevo";

export interface Rifa {
    tabla_id: string;
    nombre: string;
    codigo: string | null;
    precio: number;
    cifras: number;
    cantidad: number;
    activa: boolean;
    visible: boolean;
    ciclo: number;
    archivada_en: string | null;
    libres: number;
    reservados: number;
    en_proceso: number;
    pagados: number;
    bloqueados: number;
    total: number;
}

export interface RifaDetalle {
    id: string;
    nombre: string;
    codigo: string | null;
    precio: number;
    cifras: number;
    cantidad: number;
    activa: boolean;
    ciclo: number;
    archivada_en: string | null;
}

export interface NumeroRifa {
    id: string;
    numero: string;
    estado: "libre" | "reservado" | "en_proceso" | "pagado" | "bloqueado";
    nombre: string | null;
    telefono: string | null;
    grupo_nombre: string | null;
    fecha_reserva: string | null;
    hora_reserva: string | null;
    fecha_pago: string | null;
    hora_pago: string | null;
    observaciones: string | null;
}

export interface GrupoRifa { grupo_id: string; predeterminada: boolean }

export type Respuesta<T> = ({ ok: true } & T) | { ok: false; motivo: string; error?: string; [k: string]: unknown };

async function llamar<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, motivo: "sin_sesion" };
    try {
        const res = await fetch(`/api/rifas${ruta}`, {
            method: metodo,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            cache: "no-store"
        });
        const json = await res.json().catch(() => null);
        if (!json || typeof json.ok !== "boolean") return { ok: false, motivo: "respuesta_invalida" };
        return json;
    } catch {
        return { ok: false, motivo: "backend_no_disponible" };
    }
}

// Situaciones en las que el bot se detiene y pide intervención (decisión D1).
export type AvisoRifas =
    | { tipo: "sorteo_sin_rifa"; evento_id: string; grupo_id: string; grupo_nombre: string | null; valor: number | null }
    | { tipo: "rifa_de_otro_precio"; evento_id: string; grupo_id: string; grupo_nombre: string | null; valor: number | null; precio_rifa: number; tabla_id: string }
    | { tipo: "grupo_ambiguo"; grupo_id: string; grupo_nombre: string | null; sorteos: { evento_id: string; valor: number | null }[] };

export const apiRifas = {
    modo: () => llamar<{ modo: ModoMotor }>("GET", "/modo"),
    avisos: () => llamar<{ modo: ModoMotor; avisos: AvisoRifas[] }>("GET", "/avisos"),
    // Reservas: crear una tabla y cambiar su valor (mismo tabla_id y datos).
    crearTabla: (precio: number, cifras = 2) =>
        llamar<{ tabla_id: string; precio: number; nombre: string; vinculados: number; sin_vincular: number }>("POST", "/tablas", { precio, cifras }),
    editarPrecio: (id: string, precio: number) =>
        llamar<{ tabla_id: string; precio: number; sin_cambios?: boolean; grupos_ambiguos: number }>("PATCH", `/${id}/precio`, { precio }),
    listar: (archivadas = false) => llamar<{ modo: ModoMotor; rifas: Rifa[] }>("GET", archivadas ? "?archivadas=1" : ""),
    crear: (datos: { nombre: string; precio: number; cifras: number; cantidad?: number; codigo?: string | null }) =>
        llamar<{ tabla_id: string }>("POST", "", datos),
    obtener: (id: string) => llamar<{ modo: ModoMotor; rifa: RifaDetalle; numeros: NumeroRifa[]; grupos: GrupoRifa[] }>("GET", `/${id}`),
    actualizar: (id: string, cambios: Partial<Pick<RifaDetalle, "nombre" | "codigo" | "activa">>) => llamar("PATCH", `/${id}`, cambios),
    archivar: (id: string) => llamar("POST", `/${id}/archivar`, {}),
    restaurar: (id: string) => llamar("POST", `/${id}/restaurar`, {}),
    eliminar: (id: string) => llamar("DELETE", `/${id}`),
    vincularGrupo: (id: string, grupoId: string, predeterminada = false) => llamar("POST", `/${id}/grupos`, { grupo_id: grupoId, predeterminada }),
    desvincularGrupo: (id: string, grupoId: string) => llamar("DELETE", `/${id}/grupos/${encodeURIComponent(grupoId)}`),
    reservar: (id: string, numeros: string[], datos: { comprador: string; telefono?: string; observaciones?: string }) =>
        llamar<{ reservados: string[]; no_disponibles: string[] }>("POST", `/${id}/reservar`, { numeros, ...datos }),
    pagar: (id: string, numeros: string[], metodoPago?: string) =>
        llamar<{ pagados: string[]; ya_pagados: string[]; no_pagables: string[] }>("POST", `/${id}/pagar`, { numeros, metodo_pago: metodoPago }),
    liberar: (id: string, numeros: string[], opciones: { incluir_pagados?: boolean; incluir_bloqueados?: boolean } = {}) =>
        llamar<{ liberados: string[]; no_liberados: string[] }>("POST", `/${id}/liberar`, { numeros, ...opciones }),
    bloquear: (id: string, numeros: string[]) => llamar<{ bloqueados: string[] }>("POST", `/${id}/bloquear`, { numeros }),
    reiniciar: (id: string, confirmacion: string) => llamar<{ archivados: number; ciclo: number }>("POST", `/${id}/reiniciar`, { confirmacion })
};

// Mensajes legibles de los motivos del motor.
export function mensajeMotivo(motivo: string): string {
    const m: Record<string, string> = {
        motor_legado: "El motor de rifas independientes todavía no está activo.",
        rifa_no_encontrada: "No se encontró esta rifa.",
        rifa_inactiva: "La rifa está inactiva.",
        rifa_archivada: "La rifa está archivada.",
        sorteo_en_curso: "Hay un sorteo en curso en un grupo de esta rifa. Ciérralo antes de reiniciarla.",
        confirmacion_requerida: "Escribe REINICIAR para confirmar.",
        no_disponibles: "Esos números ya no están libres.",
        nada_que_pagar: "No había números reservados para pagar.",
        nada_que_liberar: "No había números que liberar.",
        codigo_en_uso: "Ese código ya lo usa otra de tus rifas.",
        tiene_historial: "La rifa tiene historial: archívala en lugar de eliminarla.",
        sin_sesion: "Tu sesión expiró. Vuelve a iniciar sesión.",
        backend_no_disponible: "No hay conexión con el servidor.",
        datos_invalidos: "Revisa los datos.",
        sin_numeros: "Elige al menos un número."
    };
    return m[motivo] || `No se pudo completar (${motivo}).`;
}
