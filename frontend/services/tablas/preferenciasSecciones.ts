// Preferencias visuales del panel de tablas: qué secciones están contraídas.
// Se guardan en localStorage del navegador, una clave por usuario (el cliente
// del panel = su usuario_id), así dos cuentas en el mismo navegador nunca
// comparten preferencias. Solo se guardan booleanos: nada de reservas,
// números ni datos del cliente.

export type SeccionPanel = "historial" | "reservas" | "grupos" | "actividad";

export type EstadoSecciones = Record<SeccionPanel, boolean>;

// Comportamiento sin preferencia guardada: todo abierto (el de siempre). Una
// preferencia guardada antes de existir «historial» lo deja abierto.
export const SECCIONES_PREDETERMINADAS: EstadoSecciones = {
    historial: true,
    reservas: true,
    grupos: true,
    actividad: true
};

const SECCIONES = Object.keys(SECCIONES_PREDETERMINADAS) as SeccionPanel[];

type Almacen = Pick<Storage, "getItem" | "setItem">;

export function claveSecciones(usuarioId: string) {
    return `efaat:panel-tablas:secciones:v1:${usuarioId}`;
}

export function almacenNavegador(): Almacen | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

export function leerSecciones(almacen: Almacen | null, usuarioId: string | null): EstadoSecciones {

    const estado = { ...SECCIONES_PREDETERMINADAS };
    if (!almacen || !usuarioId) return estado;

    try {
        const guardado = JSON.parse(almacen.getItem(claveSecciones(usuarioId)) || "null");
        if (guardado && typeof guardado === "object") {
            // Solo claves conocidas con valor booleano; lo demás se ignora.
            for (const s of SECCIONES) {
                if (typeof guardado[s] === "boolean") estado[s] = guardado[s];
            }
        }
    } catch {
        // JSON corrupto o almacenamiento bloqueado: predeterminado.
    }

    return estado;

}

export function guardarSecciones(almacen: Almacen | null, usuarioId: string | null, estado: EstadoSecciones) {

    if (!almacen || !usuarioId) return;

    const limpio: Partial<EstadoSecciones> = {};
    for (const s of SECCIONES) limpio[s] = estado[s] !== false;

    try {
        almacen.setItem(claveSecciones(usuarioId), JSON.stringify(limpio));
    } catch {
        // Modo privado / cuota llena: se sigue sin persistir.
    }

}
