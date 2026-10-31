// Operaciones sobre VARIOS números de una tabla en una sola acción del panel
// (Tablas → «Seleccionar» y las acciones rápidas de «Historial de números»).
// Módulo puro: no llama a la red por sí mismo.
//
// El lote va en UNA solicitud y lo procesa el servidor en una sola escritura
// (backend/services/reservaManual.js → operarLote), con las reglas de un
// número: solo uno 'libre' se reserva, con el UPDATE condicionado del bot;
// solo uno 'reservado' pasa a 'pagado'; liberar/desbloquear con UPDATE
// condicionado al estado confirmado; no cambia propietario, grupo, evento ni
// sorteo. Aquí solo se decide qué se envía y cómo se informa cada número.

import type { DatosLiberar, DatosPago, DatosReserva, RespuestaLote, Resultado } from "./reservaManual";

export type EstadoSeleccion = "libre" | "reservado" | "pagado" | "bloqueado" | "en_proceso";

/** Número tal como lo ve la cuadrícula (estado efectivo). */
export interface NumeroSeleccionable {
    numero: string;
    estado: EstadoSeleccion;
    /** Reservado/pagado de OTRO sorteo (no el activo de la tabla): en un
     *  lote solo entra si el administrador lo incluye expresamente. */
    otroSorteo?: boolean;
}

export interface Excluido {
    numero: string;
    motivo: string;
    /** Excluido solo por ser de otro sorteo (se puede incluir a propósito). */
    otroSorteo?: boolean;
}

/**
 * reservar: libre → reservado (a un contacto, en el sorteo y grupo elegidos).
 * pagar: reservado → pagado.
 * liberar: reservado o pagado → libre (anular un pago exige motivo).
 * desbloquear: bloqueado → libre. «En proceso» (retención temporal del
 * bot) no entra en ninguna operación rápida: se conserva su restricción y
 * se gestiona desde el detalle del número.
 */
export type OperacionLote = "reservar" | "pagar" | "liberar" | "desbloquear";

export const ESTADOS_OPERACION: Record<OperacionLote, EstadoSeleccion[]> = {
    reservar: ["libre"],
    pagar: ["reservado"],
    liberar: ["reservado", "pagado"],
    desbloquear: ["bloqueado"]
};

const MOTIVO_OTRO_SORTEO = "Es de otro sorteo: no se incluye salvo que lo marques expresamente.";

const MOTIVO_EXCLUSION: Record<OperacionLote, Partial<Record<EstadoSeleccion, string>>> = {
    reservar: {
        reservado: "Ya está reservado.",
        pagado: "Está pagado.",
        bloqueado: "Está bloqueado: desbloquéalo antes.",
        en_proceso: "Está en proceso (retención temporal): revísalo desde su detalle."
    },
    pagar: {
        pagado: "Ya está pagado.",
        libre: "Está libre: no tiene una reserva que pagar.",
        bloqueado: "Está bloqueado: desbloquéalo antes.",
        en_proceso: "Está en proceso (retención temporal): revísalo desde su detalle."
    },
    liberar: {
        libre: "Ya está libre.",
        bloqueado: "Está bloqueado: usa «Desbloquear».",
        en_proceso: "Está en proceso (retención temporal): revísalo desde su detalle."
    },
    desbloquear: {
        libre: "Ya está libre.",
        reservado: "Está reservado, no bloqueado.",
        pagado: "Está pagado, no bloqueado.",
        en_proceso: "Está en proceso (retención temporal): revísalo desde su detalle."
    }
};

export interface Clasificacion {
    /** Números que se enviarán, con el estado con el que se clasificaron. */
    incluidos: NumeroSeleccionable[];
    excluidos: Excluido[];
}

/** Números seleccionados que admite `operacion` y los que no, con el porqué.
 *  Los de OTRO sorteo quedan fuera salvo `incluirOtroSorteo` (decisión
 *  expresa del administrador); reservar solo toma libres, que no son de
 *  ningún sorteo. */
export function clasificarOperacion(numeros: NumeroSeleccionable[], seleccion: Iterable<string>, operacion: OperacionLote, { incluirOtroSorteo = false }: { incluirOtroSorteo?: boolean } = {}): Clasificacion {

    const porNumero = new Map(numeros.map(n => [n.numero, n]));
    const incluidos: NumeroSeleccionable[] = [];
    const excluidos: Excluido[] = [];

    for (const numero of [...new Set(seleccion)].sort()) {

        const n = porNumero.get(numero);

        if (!n) excluidos.push({ numero, motivo: "Ya no está en la tabla." });
        else if (!ESTADOS_OPERACION[operacion].includes(n.estado)) excluidos.push({ numero, motivo: MOTIVO_EXCLUSION[operacion][n.estado] || "No admite esta operación." });
        else if (n.otroSorteo && !incluirOtroSorteo) excluidos.push({ numero, motivo: MOTIVO_OTRO_SORTEO, otroSorteo: true });
        else incluidos.push({ numero, estado: n.estado, ...(n.otroSorteo ? { otroSorteo: true } : {}) });

    }

    return { incluidos, excluidos };

}

/** Acción rápida de un número en «Historial de números»: una operación o
 *  abrir su detalle (desde ahí, si está libre, el flujo de reserva). */
export type AccionRapida = Exclude<OperacionLote, "reservar"> | "detalle";

/** Acciones rápidas que admite un número según su estado efectivo. Un libre
 *  nunca pasa directamente a pagado; uno en proceso solo abre su detalle.
 *  Reservar uno pide contacto y grupo: se hace desde su detalle. */
export function accionesRapidas(estado: EstadoSeleccion): AccionRapida[] {
    const ops = (Object.keys(ESTADOS_OPERACION) as OperacionLote[])
        .filter((op): op is Exclude<OperacionLote, "reservar"> => op !== "reservar" && ESTADOS_OPERACION[op].includes(estado));
    return [...ops, "detalle"];
}

/** Cuántos números de la selección admite cada operación (barra de
 *  selección). Cuenta también los de otro sorteo: el diálogo los separa y
 *  el administrador decide si incluirlos. */
export function operacionesCompatibles(numeros: NumeroSeleccionable[], seleccion: Iterable<string>): Record<OperacionLote, number> {
    const lista = [...seleccion];
    const contar = (op: OperacionLote) => clasificarOperacion(numeros, lista, op, { incluirOtroSorteo: true }).incluidos.length;
    return { reservar: contar("reservar"), pagar: contar("pagar"), liberar: contar("liberar"), desbloquear: contar("desbloquear") };
}

/** Anular un pago exige motivo en el servidor (mínimo 3 caracteres). */
export function exigeMotivo(operacion: OperacionLote, incluidos: NumeroSeleccionable[]): boolean {
    return operacion === "liberar" && incluidos.some(n => n.estado === "pagado");
}

export type EstadoResultado = "hecho" | "sin_cambio" | "omitido" | "error";

export interface ResultadoNumero {
    numero: string;
    estado: EstadoResultado;
    mensaje: string;
}

export interface ResultadoOperacion {
    resultados: ResultadoNumero[];
    hechos: number;
    sinCambio: number;
    omitidos: number;
    errores: number;
}

export type DatosOperacion = Omit<DatosPago & DatosLiberar, "solicitudId">
    & Partial<Pick<DatosReserva, "contactoId" | "nuevoContacto" | "eventoId" | "sorteoProgramadoId" | "grupoId" | "sinSorteo">>;

/** Envía el lote al servidor en UNA solicitud (operarLote). */
export type EnviarLote = (cuerpo: Record<string, unknown>) => Promise<Resultado<RespuestaLote>>;

/** Cuerpo de la solicitud: el servidor no recibe más que esto. Liberar y
 *  desbloquear llevan el estado que el administrador vio y confirmó: si en
 *  el servidor ya es otro, ese número no se toca. */
export function cuerpoDelLote(operacion: OperacionLote, incluidos: NumeroSeleccionable[], datos: DatosOperacion, solicitudLote: string): Record<string, unknown> {

    const otrosSorteoAutorizados = incluidos.filter(n => n.otroSorteo).map(n => n.numero);
    const comunes = { solicitudId: solicitudLote, observaciones: datos.observaciones, motivo: datos.motivo };

    if (operacion === "reservar") {
        return {
            ...comunes, accion: "reservar", numeros: incluidos.map(n => n.numero),
            contactoId: datos.contactoId, nuevoContacto: datos.nuevoContacto,
            eventoId: datos.eventoId, sorteoProgramadoId: datos.sorteoProgramadoId, grupoId: datos.grupoId, sinSorteo: datos.sinSorteo
        };
    }

    if (operacion === "pagar") {
        return { ...comunes, accion: "pagar", numeros: incluidos.map(n => n.numero), metodoPago: datos.metodoPago, otrosSorteoAutorizados };
    }

    return { ...comunes, accion: "liberar", confirmar: true, numeros: incluidos.map(({ numero, estado }) => ({ numero, estado })), otrosSorteoAutorizados };

}

/**
 * Aplica `operacion` a todos los `incluidos` en UNA solicitud. El servidor
 * responde el resultado de cada número; un rechazo general (sorteo cerrado,
 * contacto...) no toca nada y se informa en todos. `solicitudLote` identifica
 * el lote: reintentarlo no duplica (lo ya hecho vuelve como «sin cambios»).
 */
export async function procesarOperacion({ operacion, incluidos, enviar, datos = {}, solicitudLote }: {
    operacion: OperacionLote;
    incluidos: NumeroSeleccionable[];
    enviar: EnviarLote;
    datos?: DatosOperacion;
    solicitudLote: string;
}): Promise<ResultadoOperacion> {

    if (incluidos.length === 0) return { resultados: [], hechos: 0, sinCambio: 0, omitidos: 0, errores: 0 };

    const r = await enviar(cuerpoDelLote(operacion, incluidos, datos, solicitudLote));

    if (!r.ok) {
        return {
            resultados: incluidos.map(n => ({ numero: n.numero, estado: "error", mensaje: r.mensaje || "No se pudo completar la operación." })),
            hechos: 0, sinCambio: 0, omitidos: 0, errores: incluidos.length
        };
    }

    const resultados: ResultadoNumero[] = r.resultados.map(({ numero, estado, mensaje }) => ({ numero, estado, mensaje }));
    const contar = (e: EstadoResultado) => resultados.filter(x => x.estado === e).length;

    return { resultados, hechos: contar("hecho"), sinCambio: contar("sin_cambio"), omitidos: contar("omitido"), errores: contar("error") };

}
