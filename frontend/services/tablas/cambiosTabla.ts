// Puesta al día POR FILA de la pantalla /tablas/:precio. Módulo puro: lo usa
// hooks/useTablaPrecio.ts con los avisos de Realtime y con las lecturas
// selectivas que siguen a una operación propia.
//
// - Las filas que no cambian conservan el MISMO objeto (las celdas
//   memorizadas no se vuelven a dibujar) y, si nada cambia, se devuelve la
//   misma lista (React no vuelve a pintar).
// - Un aviso repetido (el eco de una operación propia, un reenvío de
//   Realtime) trae la misma fila: no cambia nada. No se descarta por tiempo
//   ni por número, así que un cambio externo nunca se pierde.
// - Orden: un aviso con commit_timestamp anterior al último aplicado para
//   ese número se descarta; una lectura que empezó antes del último aviso
//   aplicado a un número no lo pisa.
// - El servidor sigue siendo la autoridad: esto solo decide qué se pinta.

import type { NumeroReserva } from "@/components/tablas/types";

type Fila = Record<string, unknown>;

export function mismaFila(a: object, b: object): boolean {
    if (a === b) return true;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        const va = (a as Fila)[k], vb = (b as Fila)[k];
        if (va === vb) continue;
        // jsonb (detalle, fila, premios...): igual por contenido.
        if (va && vb && typeof va === "object" && typeof vb === "object" && JSON.stringify(va) === JSON.stringify(vb)) continue;
        return false;
    }
    return true;
}

const porNumero = (a: NumeroReserva, b: NumeroReserva) => a.numero.localeCompare(b.numero);

// Filas nuevas o cambiadas (por número) sobre la lista actual.
export function fusionarNumeros(actuales: NumeroReserva[], nuevas: NumeroReserva[]): NumeroReserva[] {

    if (nuevas.length === 0) return actuales;

    const indice = new Map(actuales.map((n, i) => [n.numero, i]));
    let lista: NumeroReserva[] | null = null;
    let anadidas = false;

    for (const fila of nuevas) {
        const i = indice.get(fila.numero);
        if (i === undefined) {
            lista = lista || [...actuales];
            indice.set(fila.numero, lista.push(fila) - 1);
            anadidas = true;
            continue;
        }
        const actual = (lista || actuales)[i];
        if (mismaFila(actual, fila)) continue;
        lista = lista || [...actuales];
        lista[i] = fila;
    }

    if (!lista) return actuales;
    return anadidas ? lista.sort(porNumero) : lista;

}

// Lectura completa: manda lo leído, salvo en los números que `conservar`
// indique (cambiaron por un aviso mientras se leía). Comparte los objetos
// que no cambiaron.
export function reemplazarNumeros(actuales: NumeroReserva[], leidas: NumeroReserva[], conservar: (numero: string) => boolean): NumeroReserva[] {

    const previas = new Map(actuales.map(n => [n.numero, n]));
    const vistas = new Set<string>();

    const lista = leidas.map(fila => {
        vistas.add(fila.numero);
        const previa = previas.get(fila.numero);
        if (previa && (conservar(fila.numero) || mismaFila(previa, fila))) return previa;
        return fila;
    });

    // Un número que llegó por aviso durante la lectura y aún no estaba en ella.
    for (const n of actuales) if (!vistas.has(n.numero) && conservar(n.numero)) lista.push(n);

    lista.sort(porNumero);

    if (lista.length === actuales.length && lista.every((n, i) => n === actuales[i])) return actuales;
    return lista;

}

// Versiones por número. Cada aviso aplicado y cada lectura toman un turno
// creciente: una lectura solo vale para un número si ningún aviso se aplicó
// a ese número después de que ella empezara.
export function crearVersiones() {

    let turno = 0;
    const marca = new Map<string, number>();
    const commit = new Map<string, number>();

    return {

        iniciarLectura(): number {
            return ++turno;
        },

        lecturaVigente(numero: string, inicio: number): boolean {
            return (marca.get(numero) ?? 0) <= inicio;
        },

        aplicarLectura(numero: string, inicio: number) {
            if ((marca.get(numero) ?? 0) < inicio) marca.set(numero, inicio);
        },

        // Sin efectos: ¿es más viejo que el último aviso aplicado a ese número?
        esViejo(numero: string, commitTimestamp?: string | null): boolean {
            const t = commitTimestamp ? Date.parse(commitTimestamp) : NaN;
            const previo = commit.get(numero);
            return !Number.isNaN(t) && previo !== undefined && t < previo;
        },

        // false = aviso más viejo que el último aplicado a ese número.
        aceptarEvento(numero: string, commitTimestamp?: string | null): boolean {
            const t = commitTimestamp ? Date.parse(commitTimestamp) : NaN;
            if (!Number.isNaN(t)) {
                const previo = commit.get(numero);
                if (previo !== undefined && t < previo) return false;
                commit.set(numero, t);
            }
            marca.set(numero, ++turno);
            return true;
        }

    };

}

export type Versiones = ReturnType<typeof crearVersiones>;

// Aviso de Realtime tal como lo entrega supabase-js.
export interface AvisoRealtime {
    eventType: "INSERT" | "UPDATE" | "DELETE" | string;
    new?: Fila | null;
    old?: Fila | null;
    commit_timestamp?: string | null;
    errors?: unknown;
}

// Pertenece a OTRA tabla física (eventos_bot y reservas_actividad llevan la
// columna `tabla`). Sin la columna (DELETE sin identidad completa) no se
// sabe: no cuenta como ajeno.
export function esDeOtraTabla(aviso: AvisoRealtime, tabla: string): boolean {
    const f = aviso.new && Object.keys(aviso.new).length > 0 ? aviso.new : aviso.old;
    return typeof f?.tabla === "string" && f.tabla !== tabla;
}

const CAMPOS_MINIMOS = ["id", "numero", "estado", "usuario_id"];

export type DecisionNumero =
    | { tipo: "ignorar" }
    | { tipo: "recargar" }
    | { tipo: "releer"; numero: string }
    | { tipo: "aplicar"; numero: string; fila: NumeroReserva };

// Qué hacer con un aviso de la tabla de números.
//  - de otro cliente (no debería llegar: el canal filtra por usuario_id) -> ignorar;
//  - DELETE: Supabase no aplica el filtro del canal a los borrados y el aviso
//    solo trae la clave. Si la fila borrada no es una de las nuestras ->
//    ignorar; si lo es (o no se sabe) -> recarga completa;
//  - incompleto (le falta una columna que la fila ya tenía, o trae errores)
//    -> releer ese número;
//  - si no, aplicar la fila recibida.
export function decidirAvisoNumero(aviso: AvisoRealtime, usuarioId: string, actual: NumeroReserva | undefined, esFilaNuestra: (id: unknown) => boolean): DecisionNumero {

    if (aviso.eventType === "DELETE") {
        const old = aviso.old || {};
        if (old.usuario_id !== undefined && old.usuario_id !== usuarioId) return { tipo: "ignorar" };
        if (old.id !== undefined && old.id !== null && !esFilaNuestra(old.id)) return { tipo: "ignorar" };
        return { tipo: "recargar" };
    }

    const fila = aviso.new;
    if (!fila || typeof fila !== "object") return { tipo: "recargar" };
    if (fila.usuario_id !== usuarioId) return { tipo: "ignorar" };
    if (fila.numero === undefined || fila.numero === null) return { tipo: "recargar" };

    const numero = String(fila.numero);
    const requeridos = actual ? Object.keys(actual) : CAMPOS_MINIMOS;
    const errores = Array.isArray(aviso.errors) ? aviso.errors.length > 0 : Boolean(aviso.errors);

    if (errores || requeridos.some(k => !(k in fila))) return { tipo: "releer", numero };

    return { tipo: "aplicar", numero, fila: { ...(fila as unknown as NumeroReserva), numero } };

}

// Listas de movimientos (actividad, auditoría, archivo): unión por id, la más
// reciente primero, con el límite de siempre.
export function fusionarPorId<T extends { id: string | number }>(actuales: T[], nuevas: T[], fecha: (x: T) => string, limite: number): T[] {

    if (nuevas.length === 0) return actuales;

    const porId = new Map(actuales.map(x => [String(x.id), x]));
    let cambio = false;

    for (const x of nuevas) {
        const previa = porId.get(String(x.id));
        if (previa && mismaFila(previa, x)) continue;
        porId.set(String(x.id), x);
        cambio = true;
    }

    if (!cambio) return actuales;

    // Por instante, no por texto: PostgREST y Realtime no escriben la fecha igual.
    const instante = (x: T) => Date.parse(String(fecha(x))) || 0;

    return [...porId.values()]
        .sort((a, b) => instante(b) - instante(a))
        .slice(0, limite);

}

// Desde cuándo pedir lo nuevo de una lista: su fila más reciente menos un
// margen (una transacción larga puede registrar una fecha anterior a la de
// otra que ya se leyó). null = lista vacía: hay que leerla entera.
export function desdeVentana<T>(lista: T[], fecha: (x: T) => string | null | undefined, margenMs: number): string | null {

    let max = NaN;
    for (const x of lista) {
        const t = Date.parse(String(fecha(x) ?? ""));
        if (!Number.isNaN(t) && (Number.isNaN(max) || t > max)) max = t;
    }

    return Number.isNaN(max) ? null : new Date(max - margenMs).toISOString();

}
