// ==========================================================================
// Simulador de la demostración pública — 100% en memoria del navegador.
//
// NO importa Supabase, NO hace fetch, NO conoce sesiones de WhatsApp ni
// tablas reales. Es una versión simplificada y propia de la demo: imita el
// tipo de respuesta que da EFAAT (reserva completa/parcial, número ocupado,
// disponibilidad, mis números) con textos inspirados en las plantillas base
// "Natural" (services/mensajes/plantillasBase.ts), pero NO es el motor real
// de intenciones del bot (backend/bot/funciones/consultas/detectarIntencion.js).
// Todos los nombres y números son ficticios.
// ==========================================================================

export const PARTICIPANTE_DEMO = "Camila";
export const EVENTO_DEMO = "Sorteo de demostración";
export const PRECIO_DEMO = 5000;
export const MAX_NUMEROS_POR_MENSAJE = 10;
export const REACCION_RESERVA = "👍";

// Dueño de cada número 0..99 (null = libre).
export type EstadoDemo = ReadonlyArray<string | null>;

export type TipoRespuesta =
    | "reserva_completa"
    | "reserva_parcial"
    | "numero_ocupado"
    | "todos_ocupados"
    | "ya_era_tuyo"
    | "mis_numeros"
    | "disponibilidad"
    | "numero_especifico"
    | "fuera_de_rango"
    | "ayuda";

export interface ResultadoDemo {
    estado: EstadoDemo;
    tipo: TipoRespuesta;
    respuesta: string;
    reaccion: string | null;
    reservados: number[];
}

const OCUPADOS_INICIALES: Array<[number, string]> = [
    [3, "Andrés"], [7, "Lucía"], [12, "Mateo"], [18, "Valentina"], [21, "Julián"],
    [27, "Lucía"], [33, "Andrés"], [38, "Sara"], [41, "Mateo"], [45, "Julián"],
    [50, "Valentina"], [56, "Sara"], [62, "Andrés"], [69, "Lucía"], [74, "Mateo"],
    [77, "Sara"], [81, "Julián"], [88, "Valentina"], [90, "Andrés"], [99, "Lucía"]
];

export function crearEstadoInicial(): EstadoDemo {
    const estado: Array<string | null> = Array.from({ length: 100 }, () => null);
    for (const [numero, dueno] of OCUPADOS_INICIALES) estado[numero] = dueno;
    return estado;
}

export function formatearNumero(n: number): string {
    return n.toString().padStart(2, "0");
}

// "07", "07 y 23", "07, 23 y 45"
export function listaNumeros(numeros: number[]): string {
    const t = numeros.map(formatearNumero);
    if (t.length <= 1) return t.join("");
    return `${t.slice(0, -1).join(", ")} y ${t[t.length - 1]}`;
}

function normalizar(texto: string): string {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// Números enteros escritos en el mensaje, en orden y sin repetir.
function extraerEnteros(texto: string): string[] {
    const vistos = new Set<string>();
    const lista: string[] = [];
    for (const m of texto.match(/\d+/g) ?? []) {
        if (!vistos.has(m)) {
            vistos.add(m);
            lista.push(m);
        }
    }
    return lista;
}

const RE_MIS_NUMEROS = /\bmis (numeros|reservas|boletas)\b|\bque numeros? tengo\b|\bcuales (son )?(mis|los mios)\b|\bcuantos (numeros )?tengo\b/;
const RE_DISPONIBILIDAD = /\bdisponibles?\b|\bquedan?\b|\blibres?\b|\bque numeros hay\b|\bcuales hay\b/;
const RE_PREGUNTA_NUMERO = /\b(esta|estan|sigue|siguen)\b.*\b(libres?|disponibles?)\b|^\s*(el|la)?\s*\d{1,2}\s*(esta|sigue)?\s*(libre|disponible)/;

export function contarLibres(estado: EstadoDemo): number {
    return estado.filter((d) => d === null).length;
}

export function numerosDe(estado: EstadoDemo, dueno: string): number[] {
    const lista: number[] = [];
    estado.forEach((d, i) => { if (d === dueno) lista.push(i); });
    return lista;
}

function resultado(estado: EstadoDemo, tipo: TipoRespuesta, respuesta: string, extra: Partial<ResultadoDemo> = {}): ResultadoDemo {
    return { estado, tipo, respuesta, reaccion: null, reservados: [], ...extra };
}

// Procesa un mensaje de la participante de ejemplo. Función pura: nunca
// modifica `estado`, devuelve uno nuevo.
export function procesarMensaje(estado: EstadoDemo, mensaje: string, cliente: string = PARTICIPANTE_DEMO): ResultadoDemo {

    const texto = normalizar(mensaje);
    const enteros = extraerEnteros(texto);

    if (RE_MIS_NUMEROS.test(texto) && enteros.length === 0) {
        const mios = numerosDe(estado, cliente);
        if (mios.length === 0) {
            return resultado(estado, "mis_numeros", `${cliente}, todavía no tienes números reservados en el ${EVENTO_DEMO.toLowerCase()}.`);
        }
        return resultado(estado, "mis_numeros", mios.length === 1
            ? `${cliente}, tu número es: ${listaNumeros(mios)}`
            : `${cliente}, tus números son: ${listaNumeros(mios)}`);
    }

    if (enteros.length === 0) {
        if (RE_DISPONIBILIDAD.test(texto)) {
            const libres = estado.flatMap((d, i) => (d === null ? [i] : []));
            if (libres.length === 0) return resultado(estado, "disponibilidad", "Ya no quedan números disponibles en este sorteo.");
            return resultado(estado, "disponibilidad", libres.length === 1
                ? `Número disponible: ${listaNumeros(libres)}`
                : `Números disponibles (${libres.length}): ${listaNumeros(libres)}`);
        }
        return resultado(estado, "ayuda",
            "En esta demostración puedes reservar (por ejemplo «me anotas el 23 y el 45»), preguntar qué números quedan o consultar tus números.");
    }

    if (enteros.some((e) => e.length > 2)) {
        return resultado(estado, "fuera_de_rango", "En este sorteo de ejemplo los números van del 00 al 99. Escribe números de una o dos cifras.");
    }

    // "Quiero 3 números" pide una cantidad, no el número 03.
    if (/\b\d+ (numeros|boletas)\b/.test(texto)) {
        return resultado(estado, "ayuda", "En esta demostración escribe los números exactos que quieres, por ejemplo «me anotas el 23 y el 45».");
    }

    const numeros = enteros.map(Number).slice(0, MAX_NUMEROS_POR_MENSAJE);

    // "¿El 23 está libre?" — consulta, no reserva.
    if (RE_PREGUNTA_NUMERO.test(texto) || (texto.includes("?") && RE_DISPONIBILIDAD.test(texto))) {
        const partes = numeros.map((n) => {
            const dueno = estado[n];
            if (dueno === null) return `el ${formatearNumero(n)} está disponible`;
            if (dueno === cliente) return `el ${formatearNumero(n)} ya es tuyo`;
            return `el ${formatearNumero(n)} ya está ocupado`;
        });
        const frase = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
        return resultado(estado, "numero_especifico", `${cliente}, ${frase}.`);
    }

    const libres = numeros.filter((n) => estado[n] === null);
    const mios = numeros.filter((n) => estado[n] === cliente);
    const ocupados = numeros.filter((n) => estado[n] !== null && estado[n] !== cliente);

    if (libres.length === 0 && ocupados.length === 0) {
        return resultado(estado, "ya_era_tuyo", mios.length === 1
            ? `${cliente}, el ${listaNumeros(mios)} ya es tuyo 😊`
            : `${cliente}, ${listaNumeros(mios)} ya son tuyos 😊`);
    }

    if (libres.length === 0) {
        return resultado(estado, ocupados.length === 1 ? "numero_ocupado" : "todos_ocupados", ocupados.length === 1
            ? `${cliente}, el número ${listaNumeros(ocupados)} ya está ocupado.`
            : `${cliente}, los números ${listaNumeros(ocupados)} ya estaban ocupados.`);
    }

    const nuevo = [...estado];
    for (const n of libres) nuevo[n] = cliente;

    const reservadoTxt = libres.length === 1
        ? `${listaNumeros(libres)} quedó reservado`
        : `${listaNumeros(libres)} quedaron reservados`;

    if (ocupados.length === 0) {
        return resultado(nuevo, "reserva_completa", `¡Listo ${cliente}! ${reservadoTxt} 🎟️`, { reaccion: REACCION_RESERVA, reservados: libres });
    }

    const ocupadoTxt = ocupados.length === 1
        ? `${listaNumeros(ocupados)} ya estaba ocupado`
        : `${listaNumeros(ocupados)} ya estaban ocupados`;

    return resultado(nuevo, "reserva_parcial", `${cliente}, ${reservadoTxt}. ${ocupadoTxt}.`, { reaccion: REACCION_RESERVA, reservados: libres });

}
