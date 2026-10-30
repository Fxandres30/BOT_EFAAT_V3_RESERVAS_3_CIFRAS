// Operaciones sobre VARIOS números de una tabla en una sola acción del panel
// (Tablas → «Seleccionar» y las acciones rápidas de «Historial de números»).
// Módulo puro: no llama a la red por sí mismo.
//
// Reutiliza las operaciones de un número que ya existen (reservarNumeroManual
// / pagarNumeroManual / liberarNumeroManual → backend/services/reservaManual.js),
// número a número y EN SERIE: las reglas siguen siendo las del servidor (solo
// un número 'libre' se reserva, con el UPDATE condicionado del bot; solo uno
// 'reservado' pasa a 'pagado'; liberar/desbloquear con UPDATE condicionado
// al estado leído; no cambia propietario, grupo, evento ni sorteo). Aquí
// solo se decide qué se envía y cómo se informa el resultado de cada número.

import type { DatosLiberar, DatosPago, DatosReserva, EstadoReal, Resultado } from "./reservaManual";

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
    /** El rechazo no depende del número (sorteo cerrado, contacto, grupo...):
     *  los siguientes darían lo mismo y no se intentan. */
    general?: boolean;
}

// Rechazos de la reserva que dependen del NÚMERO (u otra causa pasajera) y
// no detienen el lote; cualquier otro (sorteo, grupo, contacto, motivo...)
// se repetiría igual en todos los números.
const RECHAZOS_POR_NUMERO = new Set(["no_disponible", "numero_invalido", "numero_inexistente", "error_lectura", "error_guardar"]);

export function rechazoGeneral(motivo: string): boolean {
    if (RECHAZOS_POR_NUMERO.has(motivo)) return false;
    return !(motivo === "red" || motivo.startsWith("http_5") || motivo.startsWith("backend"));
}

export interface ResultadoOperacion {
    resultados: ResultadoNumero[];
    hechos: number;
    sinCambio: number;
    omitidos: number;
    errores: number;
}

export type DatosOperacion = Omit<DatosPago & DatosLiberar, "solicitudId">
    & Partial<Pick<DatosReserva, "contactoId" | "nuevoContacto" | "eventoId" | "sorteoProgramadoId" | "grupoId">>;

export interface Operaciones {
    /** Reserva manual de un número (opcional: solo la usa «reservar»). */
    reservar?: (numero: string, datos: DatosReserva) => Promise<Resultado>;
    pagar: (numero: string, datos: DatosPago) => Promise<Resultado>;
    liberar: (numero: string, datos: DatosLiberar) => Promise<Resultado>;
    /** Estado real del número en el servidor (GET del detalle), justo antes
     *  de liberar/desbloquear: el endpoint de liberar no recibe el estado
     *  esperado, así que si el número cambió entretanto (p. ej. un bloqueo
     *  pasó a reservado) NO se envía. */
    estadoReal: (numero: string) => Promise<{ ok: true; estado: EstadoReal } | { ok: false; mensaje: string }>;
}

const ESTADO_LEGIBLE: Record<EstadoReal, string> = {
    libre: "libre",
    reservado: "reservado",
    pagado: "pagado",
    bloqueado: "bloqueado",
    en_proceso: "en proceso",
    en_proceso_vencido: "con retención vencida"
};

const TEXTO_HECHO: Record<OperacionLote, string> = {
    reservar: "Reservado.",
    pagar: "Pago registrado.",
    liberar: "Liberado: vuelve a estar disponible.",
    desbloquear: "Desbloqueado: vuelve a estar disponible."
};

async function procesarUno(operacion: OperacionLote, n: NumeroSeleccionable, ops: Operaciones, datos: DatosOperacion, solicitudId: string): Promise<ResultadoNumero> {

    const { numero } = n;

    if (operacion === "reservar") {

        // La MISMA reserva manual de un número (backend/services/reservaManual.js):
        // valida sorteo, grupo y contacto, y reserva con el UPDATE condicionado
        // a 'libre' que usa el bot. Si otro lo tomó antes, responde no_disponible.
        if (!ops.reservar) return { numero, estado: "error", mensaje: "La reserva no está disponible." };
        const r = await ops.reservar(numero, {
            contactoId: datos.contactoId, nuevoContacto: datos.nuevoContacto,
            eventoId: datos.eventoId, sorteoProgramadoId: datos.sorteoProgramadoId, grupoId: datos.grupoId,
            motivo: datos.motivo || "", observaciones: datos.observaciones, solicitudId
        });
        if (r.ok) return r.idempotente
            ? { numero, estado: "sin_cambio", mensaje: "Ya estaba reservado para este contacto." }
            : { numero, estado: "hecho", mensaje: TEXTO_HECHO.reservar };
        if (r.motivo === "no_disponible") {
            return { numero, estado: "omitido", mensaje: `Ya no estaba libre${r.estadoActual ? ` (ahora está ${ESTADO_LEGIBLE[r.estadoActual]})` : ""}: otra operación lo tomó primero. No se tocó.` };
        }
        return { numero, estado: "error", mensaje: r.mensaje || "No se pudo reservar.", ...(rechazoGeneral(r.motivo) ? { general: true } : {}) };

    }

    if (operacion === "pagar") {

        // El servidor ya condiciona el pago a 'reservado': no hace falta leer antes.
        const r = await ops.pagar(numero, { metodoPago: datos.metodoPago, observaciones: datos.observaciones, motivo: datos.motivo, solicitudId });
        if (r.ok) return r.idempotente
            ? { numero, estado: "sin_cambio", mensaje: "Ya estaba registrado." }
            : { numero, estado: "hecho", mensaje: TEXTO_HECHO.pagar };
        if (r.motivo === "no_reservado" && r.estadoActual === "pagado") return { numero, estado: "sin_cambio", mensaje: r.mensaje || "Ya estaba pagado." };
        return { numero, estado: "error", mensaje: r.mensaje || "No se pudo registrar el pago." };

    }

    const real = await ops.estadoReal(numero);
    if (!real.ok) return { numero, estado: "error", mensaje: real.mensaje || "No se pudo comprobar el estado actual. No se tocó." };
    if (real.estado === "libre") return { numero, estado: "sin_cambio", mensaje: "Ya estaba libre." };
    if (real.estado !== n.estado) {
        return { numero, estado: "omitido", mensaje: `Cambió de estado (ahora está ${ESTADO_LEGIBLE[real.estado]}). No se tocó: revísalo antes.` };
    }

    const r = await ops.liberar(numero, { motivo: datos.motivo, observaciones: datos.observaciones, solicitudId });
    if (r.ok) return { numero, estado: "hecho", mensaje: TEXTO_HECHO[operacion] };
    if (r.motivo === "ya_libre") return { numero, estado: "sin_cambio", mensaje: r.mensaje || "Ya estaba libre." };
    return { numero, estado: "error", mensaje: r.mensaje || "No se pudo completar la operación." };

}

/**
 * Aplica `operacion` a `incluidos` uno detrás de otro. Un fallo no detiene
 * el resto; cada número queda con su resultado real. `solicitudLote`
 * identifica la operación: cada número usa `<solicitudLote>:<número>`, la
 * misma en un reintento de ese lote (el servidor la usa para no duplicar).
 */
export async function procesarOperacion({ operacion, incluidos, ops, datos = {}, solicitudLote, alAvanzar }: {
    operacion: OperacionLote;
    incluidos: NumeroSeleccionable[];
    ops: Operaciones;
    datos?: DatosOperacion;
    solicitudLote: string;
    alAvanzar?: (hechos: number, total: number) => void;
}): Promise<ResultadoOperacion> {

    const resultados: ResultadoNumero[] = [];
    let detenido: ResultadoNumero | null = null;

    for (const n of incluidos) {

        if (detenido) {
            resultados.push({ numero: n.numero, estado: "omitido", mensaje: `No se intentó: ${detenido.mensaje}` });
        } else {
            try {
                const r = await procesarUno(operacion, n, ops, datos, `${solicitudLote}:${n.numero}`);
                resultados.push(r);
                if (r.general) detenido = r;
            } catch (e) {
                resultados.push({ numero: n.numero, estado: "error", mensaje: e instanceof Error ? e.message : "Error inesperado." });
            }
        }

        alAvanzar?.(resultados.length, incluidos.length);

    }

    const contar = (e: EstadoResultado) => resultados.filter(x => x.estado === e).length;

    return { resultados, hechos: contar("hecho"), sinCambio: contar("sin_cambio"), omitidos: contar("omitido"), errores: contar("error") };

}
