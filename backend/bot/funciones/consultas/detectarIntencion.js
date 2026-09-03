// Motor de intenciones (solo lectura de texto, ninguna consulta a Supabase
// aquí). Determinístico: NUNCA usa Gemini/IA para decidir la intención —
// Gemini solo puede redactar la RESPUESTA después, una vez el BOT ya
// determinó la consulta y obtuvo datos reales (ver responderResultado.js).
//
// Fase 6 — auditoría y mejora de comprensión de lenguaje natural. Reutiliza
// EXACTAMENTE el mismo criterio que ya usaba detectarReserva.js
// internamente (validarTextoReserva + extraerNumeros) para decidir si un
// mensaje es una reserva — ninguno de esos dos archivos se modificó, así
// se garantiza cero regresión sobre el flujo de reserva ya existente.
const { normalizarTexto } = require("../../utils/normalizarTexto");
const { validarTextoReserva } = require("../reservas/validarTextoReserva");
const { extraerNumeros } = require("../reservas/extraerNumeros");
const {
    contieneAlguna,
    contieneAlgunaFrase
} = require("../../utils/coincidenciaAproximada");

// ============================================================
// Palabras/frases clave por categoría. Cada una se compara contra el
// mensaje con tolerancia a errores de tecleo (ver coincidenciaAproximada.js)
// — no es necesario listar cada variante mal escrita a mano.
// ============================================================

// Preguntas de pago: se reconocen y documentan, pero NO se implementa
// lógica monetaria todavía (ver auditoría Fase 4 y Fase 6). Ninguna de
// estas palabras basta si el mensaje menciona explícitamente "número(s)"
// (ver guarda más abajo) — así "qué números debo" nunca se confunde con
// una pregunta de dinero.
//
// Dos niveles, a propósito:
//   BASE      -> ya existían antes de esta fase, son inequívocas de pago
//                incluso si el mensaje trae un número ("¿cuánto debo por
//                el 25?" sigue siendo pago, no reserva ni numero_especifico).
//   EXTENDIDA -> nuevas en esta fase ("pagado", "pagar"). Solo se
//                evalúan cuando NO hay ningún número en el mensaje,
//                porque "pagado" también es un disparador de
//                numero_especifico ("el 25 ya está pagado" debe seguir
//                siendo una consulta de ESE número, no de pago general).
const PAGO_PALABRAS_BASE = ["debo", "debe", "llevo", "falta", "pague"];
const PAGO_PALABRAS_EXTENDIDA = ["pagado", "pagar"];
const PAGO_FRASES = ["cuanto es lo mio"];

// Palabras que, combinadas con un número, indican que se pregunta por EL
// ESTADO de ese número concreto (nunca una reserva). "puedo reservar/
// agarrar/escoger/elegir" son preguntas (modo "puedo"), no órdenes — por
// eso son seguras de interceptar aquí: la palabra "reservar" ya está en
// la lista de bloqueo de validarTextoReserva.js (sin tocar ese archivo),
// así que estos mensajes NUNCA se clasificaban como reserva real.
const FRASES_PUEDO = ["puedo reservar", "puedo agarrar", "puedo escoger", "puedo elegir"];

const NUMERO_ESPECIFICO_FRASES = [
    "tengo",
    "es mio",
    "mio",
    "paso con",
    "que paso",
    "que pasa",
    "pasa con",
    "esta libre",
    "esta ocupado",
    "esta reservado",
    "esta pagado",
    "esta disponible",
    "quien tiene",
    "consulta",
    ...FRASES_PUEDO
];

const DISPONIBILIDAD_PALABRAS = ["disponible", "disponibles", "libre", "libres", "queda", "quedan"];

const CANTIDAD_PALABRAS = ["cuantos", "cuantas"];

// "número"/"numeros"/abreviación "num" — sustantivo explícito del
// dominio. Si aparece junto a una palabra de posesión (o de reserva),
// gana sobre cualquier otra lectura.
const NUMERO_RAIZ = ["numero", "numeros", "num"];

// Formas explícitas de "reserva" (sustantivo/participio/1ª persona
// pasado). "reserve" cubre también "reservé" (la tilde ya se quita en
// normalizarTexto.js).
const RESERVA_RAIZ = ["reserva", "reservas", "reservado", "reservados", "reservacion", "reservaciones", "reserve"];

// Palabras de posesión/pregunta corta que, SIN un sustantivo explícito
// ("número"/"reserva"), igual indican que el cliente pregunta por lo
// suyo: "qué tengo", "cuáles agarré", "los míos cuáles son", etc.
const POSESION_PALABRAS = ["mis", "tengo", "muestrame", "cuales", "mio", "mios", "agarre", "escogi", "quedaron"];

// "dia" NO se incluye como palabra suelta a propósito: colisiona con
// despedidas/saludos comunes de grupo de WhatsApp ("buen día", "que
// tengan buen día"). Solo cuenta como pregunta de evento en la
// construcción "qué día" (ver INFO_EVENTO_FRASES).
const INFO_EVENTO_PALABRAS = ["loteria", "sorteo", "hora", "evento", "cuando", "informacion", "info"];
const INFO_EVENTO_FRASES = ["que dia"];

// Un mensaje de UNA sola palabra normalizada ("cuáles?", "cuántos?") no
// trae suficiente contexto propio para decidir con seguridad — sin
// contexto conversacional (ver auditoría Fase 6, sección 9) es mejor
// "ninguna" que adivinar. Con 2+ palabras ya hay señal suficiente
// ("cuáles tengo", "mis números").
const MINIMO_TOKENS_PARA_CONSULTA = 2;

function detectarIntencion(texto = "") {

    if (!texto || !texto.trim()) {
        return { tipo: "ninguna", numeros: [] };
    }

    const normalizado = normalizarTexto(texto);
    const tokens = normalizado.split(" ").filter(Boolean);
    const numeros = extraerNumeros(texto);

    if (tokens.length < MINIMO_TOKENS_PARA_CONSULTA) {
        return resolverComoReservaOninguna(texto, numeros);
    }

    // 0. Pago: reconocida, no implementada (silencio intencional en
    // eventHandler.js). GUARDA: si el mensaje menciona explícitamente la
    // palabra "número(s)", NUNCA se clasifica como pago — así "qué
    // números debo" no se confunde con una pregunta de dinero.
    const mencionaNumeroPalabra = contieneAlguna(tokens, NUMERO_RAIZ);

    if (!mencionaNumeroPalabra) {

        if (contieneAlguna(tokens, PAGO_PALABRAS_BASE)) {
            return { tipo: "consulta_pago", numeros };
        }

        // Disparadores ampliados: solo sin ningún número en el mensaje
        // (ver comentario en la constante, arriba).
        if (numeros.length === 0) {

            if (contieneAlguna(tokens, PAGO_PALABRAS_EXTENDIDA) || contieneAlgunaFrase(tokens, PAGO_FRASES)) {
                return { tipo: "consulta_pago", numeros };
            }

        }

    }

    // 1. Número específico: requiere una pregunta de estado/posesión/
    // disponibilidad + un número concreto.
    if (numeros.length > 0 && contieneAlgunaFrase(tokens, NUMERO_ESPECIFICO_FRASES)) {
        return { tipo: "numero_especifico", numeros };
    }

    // Las demás intenciones de consulta nunca incluyen un número
    // específico (si lo incluyeran, ya se habría resuelto arriba).
    if (numeros.length === 0) {

        // 2. Disponibilidad — incluye las formas "puedo reservar/agarrar/
        // escoger/elegir" (sin número = pregunta general, no sobre un
        // número concreto).
        if (contieneAlguna(tokens, DISPONIBILIDAD_PALABRAS) || contieneAlgunaFrase(tokens, FRASES_PUEDO)) {
            return { tipo: "disponibilidad", numeros };
        }

        // 3. Cantidad — SIEMPRE antes que "mis números", para no
        // confundir "cuántos números tengo" (cantidad) con "qué números
        // tengo" (lista). Ver auditoría Fase 6, sección 3.
        if (contieneAlguna(tokens, CANTIDAD_PALABRAS)) {
            return { tipo: "cantidad_reservas", numeros };
        }

        // 4. Mis números / mis reservas — misma fuente de datos real
        // (consultarMisNumeros, ver resolverConsulta.js), la única
        // diferencia es qué PLANTILLAS se usan para redactar. Regla de
        // desempate, para casos ambiguos ("qué tengo", "cuáles
        // reservé"), donde ambas lecturas son igual de válidas:
        //   a) si menciona "número(s)" explícitamente -> mis_numeros
        //   b) si no, pero menciona una palabra de "reserva" -> mis_reservas
        //   c) si no menciona ninguno de los dos sustantivos, pero es una
        //      pregunta corta de posesión ("qué tengo", "cuáles tengo",
        //      "los míos cuáles son") -> mis_numeros (lectura por
        //      defecto, más genérica en este dominio).
        const tieneNumero = contieneAlguna(tokens, NUMERO_RAIZ);
        const tieneReserva = contieneAlguna(tokens, RESERVA_RAIZ);
        const tienePosesion = contieneAlguna(tokens, POSESION_PALABRAS);

        if (tieneNumero && (tienePosesion || tieneReserva)) {
            return { tipo: "mis_numeros", numeros };
        }

        if (tieneReserva) {
            return { tipo: "mis_reservas", numeros };
        }

        if (tienePosesion) {
            return { tipo: "mis_numeros", numeros };
        }

        // 5. Información del evento — solo datos reales de ctx.evento
        // (ver consultarInfoEvento.js, sin cambios).
        if (contieneAlguna(tokens, INFO_EVENTO_PALABRAS) || contieneAlgunaFrase(tokens, INFO_EVENTO_FRASES)) {
            return { tipo: "info_evento", numeros };
        }

    }

    return resolverComoReservaOninguna(texto, numeros);

}

// 6. Reserva: EXACTAMENTE el mismo criterio que ya usaba este archivo
// (validarTextoReserva + numeros.length > 0), reutilizado sin modificar
// detectarReserva.js ni validarTextoReserva.js. Es el último recurso,
// tanto para mensajes de una sola palabra (sin contexto suficiente para
// una consulta, pero un número bastaría para reservar) como para
// cualquier texto que no calzó con ninguna consulta reconocida.
function resolverComoReservaOninguna(texto, numeros) {

    if (validarTextoReserva(texto) && numeros.length > 0) {
        return { tipo: "reserva", numeros };
    }

    return { tipo: "ninguna", numeros };

}

module.exports = {
    detectarIntencion
};
