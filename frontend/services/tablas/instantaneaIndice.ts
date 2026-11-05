import type { EntradaEstadoSorteo, EstadoTarjeta } from "@/services/tablas/estadoSorteoPrecio";
import type { ConfiguracionTabla } from "@/services/tablas/tablasCliente";

// Instantánea del índice de Reservas en localStorage — EXCEPCIÓN autorizada
// (05/11/2026) a la regla «nada en localStorage», solo para esta pantalla.
//
// Para qué: tras recargar (F5) pintar al instante lo último que se vio, en
// vez de «Consultando sorteo…», mientras el servidor valida.
//
// Reglas:
//   - Solo lo que ya se ve en las tarjetas: precios/tablas y, por precio,
//     estado, nombre del sorteo, fecha de publicación, nº de grupos y motivo.
//     NUNCA cuentas de pago, titulares, mensajes, premios, diseños,
//     participantes ni teléfonos (se guarda una lista blanca de campos).
//   - Una clave por usuario; al leer se exige que coincida con el usuario de
//     la sesión. Al cerrar sesión o cambiar de cuenta se borran todas
//     (hooks/useSesion.ts); al guardar se borran las de otros usuarios.
//   - Vigencia máxima 24 h; versión de formato; contenido dañado = se borra.
//   - Nunca se presenta como confirmada: el índice muestra un aviso hasta
//     que el servidor valida, y lo del servidor siempre la sustituye.
//   - Sin localStorage (privado, bloqueado, lleno): todo sigue como antes.

export const PREFIJO_INSTANTANEA = "efaat:indice-reservas:v1:";
export const VIGENCIA_INSTANTANEA_MS = 24 * 60 * 60 * 1000;

const ESTADOS: readonly EstadoTarjeta[] = ["activo", "programado", "revision", "sin_sorteo", "no_disponible"];
const MAX_TEXTO = 200;

export interface EstadoPrecioGuardado {
    precio: number;
    entradas: EntradaEstadoSorteo[];
}

export interface InstantaneaIndice {
    usuarioId: string;
    /** Momento de la lectura del servidor de la que salen estos datos. */
    leidoEn: number;
    tablas: ConfiguracionTabla[];
    estados: EstadoPrecioGuardado[];
    /** Qué fuentes respondieron en esa lectura (el resumen no afirma «—»). */
    disponibles: { activos: boolean; programados: boolean };
}

function almacenamiento(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

const claveDe = (usuarioId: string) => `${PREFIJO_INSTANTANEA}${usuarioId}`;

const texto = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, MAX_TEXTO) : null);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Lista blanca: solo estos campos pasan, guardando o leyendo.
function limpiarEntrada(e: unknown): EntradaEstadoSorteo | null {

    if (!e || typeof e !== "object") return null;
    const o = e as Record<string, unknown>;

    if (!ESTADOS.includes(o.estado as EstadoTarjeta) || typeof o.clave !== "string") return null;

    const salida: EntradaEstadoSorteo = { estado: o.estado as EstadoTarjeta, clave: o.clave.slice(0, MAX_TEXTO), nombre: texto(o.nombre) };

    const grupos = numero(o.grupos);
    if (grupos !== null) salida.grupos = grupos;

    if (o.publicarEn === null) salida.publicarEn = null;
    else if (o.publicarEn !== undefined) {
        const fecha = new Date(o.publicarEn as string | number | Date);
        if (!Number.isNaN(fecha.getTime())) salida.publicarEn = fecha;
    }

    if (typeof o.publicando === "boolean") salida.publicando = o.publicando;
    const motivo = texto(o.motivo);
    if (motivo !== null) salida.motivo = motivo;

    return salida;

}

function limpiarTabla(t: unknown): ConfiguracionTabla | null {
    if (!t || typeof t !== "object") return null;
    const o = t as Record<string, unknown>;
    const precio = numero(o.precio), cifras = numero(o.cifras), cantidad = numero(o.cantidad);
    if (precio === null || cifras === null || cantidad === null || typeof o.tabla !== "string") return null;
    return { precio, tabla: o.tabla.slice(0, MAX_TEXTO), cifras, cantidad };
}

function limpiar(datos: unknown): Omit<InstantaneaIndice, "usuarioId" | "leidoEn"> | null {

    if (!datos || typeof datos !== "object") return null;
    const o = datos as Record<string, unknown>;

    if (!Array.isArray(o.tablas) || !Array.isArray(o.estados)) return null;

    const tablas = o.tablas.map(limpiarTabla);
    if (tablas.some((t) => !t)) return null;

    const estados: EstadoPrecioGuardado[] = [];
    for (const e of o.estados) {
        const precio = numero((e as Record<string, unknown>)?.precio);
        const entradas = (e as Record<string, unknown>)?.entradas;
        if (precio === null || !Array.isArray(entradas)) return null;
        const limpias = entradas.map(limpiarEntrada);
        if (limpias.some((x) => !x)) return null;
        estados.push({ precio, entradas: limpias as EntradaEstadoSorteo[] });
    }

    const d = (o.disponibles || {}) as Record<string, unknown>;

    return {
        tablas: tablas as ConfiguracionTabla[],
        estados,
        disponibles: { activos: d.activos === true, programados: d.programados === true }
    };

}

// Instantánea de `usuarioId` si existe, es suya, está vigente y es válida.
// Cualquier otra cosa se borra y devuelve null.
export function leerInstantanea(usuarioId: string | null | undefined, ahora = Date.now()): InstantaneaIndice | null {

    if (!usuarioId) return null;
    const ls = almacenamiento();
    if (!ls) return null;

    const clave = claveDe(usuarioId);

    try {

        const crudo = ls.getItem(clave);
        if (!crudo) return null;

        const o = JSON.parse(crudo) as Record<string, unknown>;
        const leidoEn = numero(o?.leidoEn);
        const datos = limpiar(o);

        const valida = o && o.v === 1 && o.usuarioId === usuarioId && datos && leidoEn !== null
            && leidoEn <= ahora + 60_000 && ahora - leidoEn <= VIGENCIA_INSTANTANEA_MS;

        if (!valida) {
            ls.removeItem(clave);
            return null;
        }

        return { usuarioId, leidoEn: leidoEn as number, ...datos! };

    } catch {
        try { ls.removeItem(clave); } catch { /* sin acceso */ }
        return null;
    }

}

// Tras una lectura CORRECTA del servidor. Deja solo la de este usuario.
export function guardarInstantanea(i: InstantaneaIndice): void {

    const ls = almacenamiento();
    if (!ls || !i.usuarioId) return;

    const datos = limpiar(i);
    if (!datos) return;

    try {
        borrarInstantaneas(i.usuarioId);
        ls.setItem(claveDe(i.usuarioId), JSON.stringify({ v: 1, usuarioId: i.usuarioId, leidoEn: i.leidoEn, ...datos }));
    } catch {
        /* lleno o bloqueado: seguimos sin instantánea */
    }

}

// Todas las instantáneas (salvo la de `excepto`). Solo toca claves con el
// prefijo propio: no afecta a otros datos del navegador.
export function borrarInstantaneas(excepto?: string | null): void {

    const ls = almacenamiento();
    if (!ls) return;

    try {
        const conservar = excepto ? claveDe(excepto) : null;
        for (let i = ls.length - 1; i >= 0; i--) {
            const k = ls.key(i);
            if (k && k.startsWith(PREFIJO_INSTANTANEA) && k !== conservar) ls.removeItem(k);
        }
    } catch {
        /* sin acceso */
    }

}
