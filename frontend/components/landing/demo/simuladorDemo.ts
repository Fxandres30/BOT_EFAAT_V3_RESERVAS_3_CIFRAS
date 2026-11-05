// ==========================================================================
// Simulador de la demostración pública — 100% en memoria del navegador.
//
// NO importa Supabase, NO hace fetch, NO conoce sesiones de WhatsApp ni
// tablas reales. Es una versión simplificada y propia de la demo que imita
// las respuestas del bot real; NO es su motor de intenciones
// (backend/bot/funciones/consultas/detectarIntencion.js). Todos los nombres
// y números son ficticios.
//
// Reglas copiadas del comportamiento real (auditado el 05/11/2026):
//   - Reacciones (reservas/reaccionReserva.js): ✅ solo si TODOS los números
//     pedidos se reservaron, ❌ solo si TODOS eran de otras personas,
//     ninguna en cualquier otro caso.
//   - Consultas (consultas/resolverConsulta.js): mis números con su estado,
//     cantidad, valor total / pagado / pendiente, disponibilidad y estado de
//     un número concreto. Los textos siguen los mensajes fijos del bot.
//   - «Ya pagué» / «ya cancelé» (en Colombia «cancelar» es PAGAR) es una
//     AFIRMACIÓN de pago: el bot no responde; el organizador la confirma
//     respondiendo con su sticker de pago (pagos/confirmarPagoPorSticker.js,
//     que procesa en silencio) o desde el panel. Nadie lee el comprobante ni
//     consulta bancos.
//   - Un participante NO puede soltar números por mensaje: el bot no lo
//     hace. En la demo, el pedido llega como aviso al organizador, que es
//     quien libera desde el panel (como en el panel real).
// ==========================================================================

import { formatearCOP } from "@/lib/comercial/planes";

export const EVENTO_DEMO = "Sorteo de demostración";
export const PRECIO_DEMO = 5000;
export const MAX_NUMEROS_POR_MENSAJE = 10;
export const REACCION_TODOS_RESERVADOS = "✅";
export const REACCION_TODOS_OCUPADOS = "❌";

// Participantes con los que el visitante puede escribir. El primero es el
// predeterminado.
export const PARTICIPANTES_DEMO = ["Camila", "Mateo", "Sara"] as const;
export const PARTICIPANTE_DEMO = PARTICIPANTES_DEMO[0];

export type EstadoNumero = "reservado" | "pagado";

export interface Casilla {
    dueno: string;
    estado: EstadoNumero;
}

// Casilla de cada número 0..99 (null = libre).
export type TablaDemo = ReadonlyArray<Casilla | null>;

export type TipoRespuesta =
    | "reserva_completa"
    | "reserva_parcial"
    | "numero_ocupado"
    | "todos_ocupados"
    | "ya_era_tuyo"
    | "mis_numeros"
    | "cantidad"
    | "valor_total"
    | "valor_pagado"
    | "valor_pendiente"
    | "disponibilidad"
    | "numero_especifico"
    | "aviso_pago"
    | "solicitud_liberar"
    | "fuera_de_rango"
    | "ayuda";

export interface ResultadoDemo {
    tabla: TablaDemo;
    tipo: TipoRespuesta;
    // null = el bot no responde (igual que el bot real ante «ya pagué»).
    respuesta: string | null;
    reaccion: string | null;
    // Números que cambiaron de dueño con este mensaje.
    reservados: number[];
    // Números a los que se refiere un aviso para el organizador.
    numeros: number[];
    // Aclaración propia de la demo (no es un mensaje del bot).
    nota: string | null;
}

// [número, dueño, estado]. Mateo y Sara también son participantes
// seleccionables: al escribir como ellos ya tienen números.
const OCUPADOS_INICIALES: Array<[number, string, EstadoNumero]> = [
    [3, "Andrés", "pagado"], [7, "Lucía", "reservado"], [12, "Mateo", "pagado"], [18, "Valentina", "reservado"],
    [21, "Julián", "pagado"], [27, "Lucía", "pagado"], [33, "Andrés", "reservado"], [38, "Sara", "reservado"],
    [41, "Mateo", "reservado"], [45, "Julián", "reservado"], [50, "Valentina", "pagado"], [56, "Sara", "pagado"],
    [62, "Andrés", "pagado"], [69, "Lucía", "reservado"], [74, "Mateo", "reservado"], [77, "Sara", "reservado"],
    [81, "Julián", "pagado"], [88, "Valentina", "reservado"], [90, "Andrés", "reservado"], [99, "Lucía", "pagado"]
];

export function crearTablaInicial(): TablaDemo {
    const tabla: Array<Casilla | null> = Array.from({ length: 100 }, () => null);
    for (const [numero, dueno, estado] of OCUPADOS_INICIALES) tabla[numero] = { dueno, estado };
    return tabla;
}

// ---------- Formato ----------

export function formatearNumero(n: number): string {
    return n.toString().padStart(2, "0");
}

// "07", "07 y 23", "07, 23 y 45"
export function listaNumeros(numeros: number[]): string {
    const t = numeros.map(formatearNumero);
    if (t.length <= 1) return t.join("");
    return `${t.slice(0, -1).join(", ")} y ${t[t.length - 1]}`;
}

// Filas de 10, como la grilla de disponibles del bot.
function grillaNumeros(numeros: number[]): string {
    const filas: string[] = [];
    for (let i = 0; i < numeros.length; i += 10) {
        filas.push(numeros.slice(i, i + 10).map(formatearNumero).join(" "));
    }
    return filas.join("\n");
}

// ---------- Lecturas de la tabla ----------

export interface Conteo {
    libres: number;
    reservados: number;
    pagados: number;
}

export function contarTabla(tabla: TablaDemo): Conteo {
    const c: Conteo = { libres: 0, reservados: 0, pagados: 0 };
    for (const casilla of tabla) {
        if (casilla === null) c.libres++;
        else if (casilla.estado === "pagado") c.pagados++;
        else c.reservados++;
    }
    return c;
}

export function numerosLibres(tabla: TablaDemo): number[] {
    const lista: number[] = [];
    tabla.forEach((c, i) => { if (c === null) lista.push(i); });
    return lista;
}

export interface NumerosParticipante {
    todos: number[];
    reservados: number[];
    pagados: number[];
}

export function numerosDe(tabla: TablaDemo, dueno: string): NumerosParticipante {
    const r: NumerosParticipante = { todos: [], reservados: [], pagados: [] };
    tabla.forEach((c, i) => {
        if (c?.dueno !== dueno) return;
        r.todos.push(i);
        (c.estado === "pagado" ? r.pagados : r.reservados).push(i);
    });
    return r;
}

// Dueños en orden de aparición en la tabla (para el resumen del panel).
export function duenosDe(tabla: TablaDemo): string[] {
    const vistos: string[] = [];
    for (const c of tabla) if (c && !vistos.includes(c.dueno)) vistos.push(c.dueno);
    return vistos;
}

// ---------- Operaciones del organizador (panel / sticker) ----------
// Funciones puras: nunca modifican la tabla recibida.

// reservado -> pagado para los números indicados (los que ya estaban
// pagados o libres se ignoran). Devuelve los que realmente cambiaron.
export function marcarPagados(tabla: TablaDemo, numeros: number[]): { tabla: TablaDemo; cambiados: number[] } {
    const nueva = [...tabla];
    const cambiados: number[] = [];
    for (const n of numeros) {
        const c = nueva[n];
        if (c && c.estado === "reservado") {
            nueva[n] = { ...c, estado: "pagado" };
            cambiados.push(n);
        }
    }
    return { tabla: cambiados.length ? nueva : tabla, cambiados };
}

// Sticker del organizador citando a un participante: TODOS sus números
// reservados pasan a pagados (igual que confirmarPagoPorSticker.js).
export function confirmarPagoDe(tabla: TablaDemo, dueno: string): { tabla: TablaDemo; cambiados: number[] } {
    return marcarPagados(tabla, numerosDe(tabla, dueno).reservados);
}

// Devuelve números a disponibles (reservados o pagados).
export function liberarNumeros(tabla: TablaDemo, numeros: number[]): { tabla: TablaDemo; cambiados: number[] } {
    const nueva = [...tabla];
    const cambiados: number[] = [];
    for (const n of numeros) {
        if (nueva[n] !== null && nueva[n] !== undefined) {
            nueva[n] = null;
            cambiados.push(n);
        }
    }
    return { tabla: cambiados.length ? nueva : tabla, cambiados };
}

// ---------- Interpretación de mensajes ----------

function normalizar(texto: string): string {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[¿¡!.,;:()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Números enteros escritos en el mensaje, en orden y sin repetir.
function extraerEnteros(texto: string): string[] {
    const vistos = new Set<string>();
    const lista: string[] = [];
    for (const m of texto.match(/\d+/g) ?? []) {
        const clave = m.length <= 2 ? String(Number(m)) : m;
        if (!vistos.has(clave)) {
            vistos.add(clave);
            lista.push(m);
        }
    }
    return lista;
}

const INICIOS_PREGUNTA = /^(que|cual|cuales|cuanto|cuantos|como|si|sera|acaso|verdad)\b/;

function esPregunta(original: string, texto: string): boolean {
    return original.includes("?") || INICIOS_PREGUNTA.test(texto) || /\bo no\b/.test(texto);
}

// Afirmación de pago: «ya pagué», «ya cancelé el 25», «te transferí».
const RE_PAGO_ACCION = /\b(pague|page|cancele|cancelo|canceladito|consigne|transferi|deposite|te pase|envie (el )?(pago|comprobante|dinero|plata)|hice (el )?(pago|transferencia)|pago hecho|ya esta pago)\b/;
// «Cancelar» en Colombia es pagar: «quiero cancelar», «cómo cancelo».
const RE_CANCELAR = /\bcancel(ar|o|e|ado|ados|ada|adas)\b/;
const RE_LIBERAR = /\b(ya no (lo |los |la |las )?quiero|no (lo |los |la |las )?quiero|suelt[ao]|solt(ar|ame|emos)|libera(r|me|lo|los)?|quita(r|me|lo|los)?|borra(r|me|lo|los)?|desanota(r|me)?|desaparta(r|me)?)\b/;

const RE_VALOR_PENDIENTE = /\bcuanto (debo|me falta|tengo que pagar|me toca pagar|me toca)\b|\bque debo\b|\b(debo|devo)\b|\bestoy al dia\b|\bcomo voy\b|\bmi saldo\b|\bque tengo pendiente\b/;
const RE_VALOR_PAGADO = /\bcuanto (he pagado|llevo pagado|llevo|pague)\b/;
const RE_VALOR_TOTAL = /\b(valor|total)\b.*\b(mis|mio|mios|reservas?|numeros)\b|\bcuanto (es todo|es lo mio|son mis|suman mis|valen mis|vale lo mio|es en total)\b/;
const RE_CANTIDAD = /\bcuant[oa]s (numeros |boletas |puestos )?(tengo|llevo|reserve|son mios)\b/;
const RE_MIS_NUMEROS = /\bmis (numeros|reservas|boletas|puestos)\b|\bque numeros? tengo\b|\bcuales (son )?(mis|los mios)\b|\bcuales tengo\b/;
const RE_DISPONIBILIDAD = /\bdisponibles?\b|\bquedan?\b|\blibres?\b|\bque numeros hay\b|\bcuales hay\b|\btabla\b|\bactualiza\b/;
const RE_PREGUNTA_NUMERO = /\b(esta|estan|sigue|siguen)\b.*\b(libres?|disponibles?|ocupados?|pagos?|pagados?)\b|\bde quien es\b|\bquien tiene\b|^\s*(el|la)?\s*\d{1,2}\s*(esta|sigue)?\s*(libre|disponible)/;

function resultado(tabla: TablaDemo, tipo: TipoRespuesta, respuesta: string | null, extra: Partial<ResultadoDemo> = {}): ResultadoDemo {
    return { tabla, tipo, respuesta, reaccion: null, reservados: [], numeros: [], nota: null, ...extra };
}

const AYUDA =
    "En esta demostración puedes reservar («me anotas el 23 y el 45»), consultar «mis números», " +
    "«¿cuántos tengo?», «¿cuánto debo?», «¿qué números quedan?» o «¿el 15 está libre?».";

function respuestaMisNumeros(cliente: string, n: NumerosParticipante): string {
    if (n.todos.length === 0) return `${cliente}, todavía no tienes números en el ${EVENTO_DEMO.toLowerCase()}.`;
    const uno = n.todos.length === 1;
    const encabezado = `${cliente}, ${uno ? "tu número es" : "tus números son"}: ${listaNumeros(n.todos)}`;
    if (n.reservados.length === 0) return `${encabezado}\n✅ ${uno ? "Está pagado." : "Todos están pagados."}`;
    if (n.pagados.length === 0) return `${encabezado}\n⏳ ${uno ? "Está pendiente de pago." : "Todos están pendientes de pago."}`;
    return [
        encabezado,
        `✅ ${n.pagados.length === 1 ? "Pagado" : "Pagados"}: ${listaNumeros(n.pagados)}`,
        `⏳ ${n.reservados.length === 1 ? "Pendiente" : "Pendientes"} de pago: ${listaNumeros(n.reservados)}`
    ].join("\n");
}

function respuestaPendiente(cliente: string, n: NumerosParticipante): string {
    if (n.todos.length === 0) return `${cliente}, no tienes números en este sorteo, así que no debes nada.`;
    if (n.reservados.length === 0) return `✅ ${cliente}, estás al día: no tienes números pendientes de pago.`;
    return `⏳ ${cliente}, te falta pagar: ${listaNumeros(n.reservados)} — ${formatearCOP(n.reservados.length * PRECIO_DEMO)}.`;
}

function estadoDeNumero(tabla: TablaDemo, n: number, cliente: string): string {
    const c = tabla[n];
    const t = formatearNumero(n);
    if (!c) return `El número ${t} está libre.`;
    if (c.dueno === cliente) return c.estado === "pagado" ? `El número ${t} ya está pagado por ti.` : `El número ${t} ya lo tienes reservado.`;
    return c.estado === "pagado" ? `El número ${t} ya fue pagado por otra persona.` : `El número ${t} está reservado por otra persona.`;
}

// Procesa un mensaje de un participante. Función pura: nunca modifica
// `tabla`, devuelve una nueva cuando hay cambios.
export function procesarMensaje(tabla: TablaDemo, mensaje: string, cliente: string = PARTICIPANTE_DEMO): ResultadoDemo {

    const texto = normalizar(mensaje);
    const enteros = extraerEnteros(texto);
    const pregunta = esPregunta(mensaje, texto);
    const mios = numerosDe(tabla, cliente);
    const mencionados = enteros.filter((e) => e.length <= 2).map(Number);

    // 1. Pedido de soltar números: el bot no libera; avisa al organizador.
    if (RE_LIBERAR.test(texto)) {
        const candidatos = mencionados.length ? mencionados.filter((n) => mios.todos.includes(n)) : mios.todos;
        return resultado(tabla, "solicitud_liberar", null, { numeros: candidatos });
    }

    // 2. Afirmación de pago («ya pagué», «ya cancelé el 25»): sin respuesta.
    if (RE_PAGO_ACCION.test(texto) && !pregunta) {
        const numeros = mencionados.length ? mencionados.filter((n) => mios.reservados.includes(n)) : mios.reservados;
        return resultado(tabla, "aviso_pago", null, { numeros });
    }

    // 3. «Cancelar» es pagar: nunca reserva ni suelta números.
    if (RE_CANCELAR.test(texto)) {
        return resultado(tabla, "valor_pendiente", respuestaPendiente(cliente, mios), {
            numeros: mios.reservados,
            nota: "En Colombia «cancelar» significa pagar, y así lo entiende EFAAT. Para soltar un número escribe, por ejemplo, «ya no quiero el 15»."
        });
    }

    if (enteros.length === 0) {

        if (RE_VALOR_PAGADO.test(texto)) {
            return resultado(tabla, "valor_pagado", mios.pagados.length
                ? `✅ ${cliente}, has pagado: ${formatearCOP(mios.pagados.length * PRECIO_DEMO)} (${listaNumeros(mios.pagados)}).`
                : `${cliente}, todavía no has pagado nada.`);
        }

        if (RE_VALOR_TOTAL.test(texto)) {
            if (mios.todos.length === 0) return resultado(tabla, "valor_total", `${cliente}, todavía no tienes números en este sorteo.`);
            const partes = [`💰 ${cliente}, el total de tus números es: ${formatearCOP(mios.todos.length * PRECIO_DEMO)}.`];
            if (mios.pagados.length) partes.push(`✅ Pagado: ${formatearCOP(mios.pagados.length * PRECIO_DEMO)}`);
            if (mios.reservados.length) partes.push(`⏳ Pendiente: ${formatearCOP(mios.reservados.length * PRECIO_DEMO)}`);
            return resultado(tabla, "valor_total", partes.join("\n"));
        }

        if (RE_VALOR_PENDIENTE.test(texto) || RE_PAGO_ACCION.test(texto)) {
            return resultado(tabla, "valor_pendiente", respuestaPendiente(cliente, mios), { numeros: mios.reservados });
        }

        if (RE_CANTIDAD.test(texto)) {
            const k = mios.todos.length;
            return resultado(tabla, "cantidad", `${cliente}, tienes ${k} número${k === 1 ? "" : "s"} en total.`);
        }

        if (RE_MIS_NUMEROS.test(texto)) return resultado(tabla, "mis_numeros", respuestaMisNumeros(cliente, mios));

        if (RE_DISPONIBILIDAD.test(texto)) {
            const libres = numerosLibres(tabla);
            return resultado(tabla, "disponibilidad", libres.length
                ? `Números disponibles (${libres.length}):\n${grillaNumeros(libres)}`
                : "No quedan números disponibles.");
        }

        return resultado(tabla, "ayuda", AYUDA);
    }

    if (RE_PAGO_ACCION.test(texto) || RE_VALOR_PENDIENTE.test(texto)) {
        return resultado(tabla, "valor_pendiente", respuestaPendiente(cliente, mios), { numeros: mios.reservados });
    }

    if (enteros.some((e) => e.length > 2)) {
        return resultado(tabla, "fuera_de_rango", "En este sorteo de ejemplo los números van del 00 al 99. Escribe números de una o dos cifras.");
    }

    // "Quiero 3 números" pide una cantidad, no el número 03.
    if (/\b\d+ (numeros|boletas|puestos)\b/.test(texto)) {
        return resultado(tabla, "ayuda", "Escribe los números exactos que quieres, por ejemplo «me anotas el 23 y el 45».");
    }

    const numeros = mencionados.slice(0, MAX_NUMEROS_POR_MENSAJE);

    // "¿El 23 está libre?" — es una pregunta, nunca una reserva.
    if (RE_PREGUNTA_NUMERO.test(texto) || (pregunta && RE_DISPONIBILIDAD.test(texto))) {
        return resultado(tabla, "numero_especifico", numeros.map((n) => estadoDeNumero(tabla, n, cliente)).join("\n"), { numeros });
    }

    const libres = numeros.filter((n) => tabla[n] === null);
    const propios = numeros.filter((n) => tabla[n]?.dueno === cliente);
    const ocupados = numeros.filter((n) => tabla[n] !== null && tabla[n]?.dueno !== cliente);

    if (libres.length === 0 && ocupados.length === 0) {
        return resultado(tabla, "ya_era_tuyo", propios.length === 1
            ? `${cliente}, el ${listaNumeros(propios)} ya es tuyo 😊`
            : `${cliente}, ${listaNumeros(propios)} ya son tuyos 😊`);
    }

    if (libres.length === 0) {
        // ❌ solo si TODOS los pedidos eran de otras personas.
        return resultado(tabla, ocupados.length === 1 ? "numero_ocupado" : "todos_ocupados", ocupados.length === 1
            ? `${cliente}, el número ${listaNumeros(ocupados)} ya está ocupado.`
            : `${cliente}, los números ${listaNumeros(ocupados)} ya estaban ocupados.`,
        { reaccion: propios.length === 0 ? REACCION_TODOS_OCUPADOS : null });
    }

    const nueva = [...tabla];
    for (const n of libres) nueva[n] = { dueno: cliente, estado: "reservado" };

    const reservadoTxt = libres.length === 1
        ? `${listaNumeros(libres)} quedó reservado`
        : `${listaNumeros(libres)} quedaron reservados`;

    if (ocupados.length === 0 && propios.length === 0) {
        return resultado(nueva, "reserva_completa", `¡Listo ${cliente}! ${reservadoTxt} 🎟️`,
            { reaccion: REACCION_TODOS_RESERVADOS, reservados: libres, numeros: libres });
    }

    // Parcial (algún número ocupado o ya propio): se reserva lo libre, sin
    // reacción, y se dice qué no se pudo.
    const ocupadoTxt = ocupados.length === 0
        ? (propios.length === 1 ? `${listaNumeros(propios)} ya era tuyo` : `${listaNumeros(propios)} ya eran tuyos`)
        : ocupados.length === 1
            ? `${listaNumeros(ocupados)} ya estaba ocupado`
            : `${listaNumeros(ocupados)} ya estaban ocupados`;

    return resultado(nueva, "reserva_parcial", `${cliente}, ${reservadoTxt}. ${ocupadoTxt}.`, { reservados: libres, numeros: libres });

}
