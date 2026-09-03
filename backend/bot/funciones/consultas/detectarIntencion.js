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
// Tres niveles, a propósito:
//   FUERTE    -> inequívocas de dinero. Cuentan como pago incluso si el
//                mensaje trae un número ("¿cuánto debo por el 25?" sigue
//                siendo pago, no reserva ni numero_especifico).
//   DÉBIL     -> "llevo"/"falta" también aparecen en frases de RESERVA
//                ("me llevo el 44") y de CANTIDAD ("cuántos llevo"). Solo
//                cuentan como pago cuando NO hay ningún número en el
//                mensaje y NO es una pregunta de cantidad en plural
//                ("cuántos/cuántas ..."). Así "cuánto llevo" sigue siendo
//                pago, "me llevo el 44" es reserva y "cuántos llevo" es
//                cantidad.
//   EXTENDIDA -> "pagado"/"pagar". Solo sin ningún número (colisiona con
//                numero_especifico: "el 25 ya está pagado" debe seguir
//                siendo una consulta de ESE número) y sin pregunta de
//                cantidad en plural.
const PAGO_PALABRAS_FUERTE = ["debo", "debe", "pague"];
const PAGO_PALABRAS_DEBIL = ["llevo", "falta"];
const PAGO_PALABRAS_EXTENDIDA = ["pagado", "pagar"];
const PAGO_FRASES = ["cuanto es lo mio"];

// Palabras que, combinadas con un número, indican que se pregunta por EL
// ESTADO de ese número concreto (nunca una reserva). "puedo reservar/
// agarrar/escoger/elegir" son preguntas (modo "puedo"), no órdenes — por
// eso son seguras de interceptar aquí: la palabra "reservar" ya está en
// la lista de bloqueo de validarTextoReserva.js (sin tocar ese archivo),
// así que estos mensajes NUNCA se clasificaban como reserva real.
const FRASES_PUEDO = ["puedo reservar", "puedo agarrar", "puedo escoger", "puedo elegir"];

// SOLO preguntas reales sobre el ESTADO o el DUEÑO de un número concreto.
// NO se incluyen palabras de posesión sueltas ("mío", "es mío", "tengo"):
// "mío el 55", "el 91 es mío", "45 para mí" son RESERVAS — el cliente está
// TOMANDO el número, no preguntando por su estado. numero_especifico se
// reserva para "¿está libre el 45?", "¿quién tiene el 45?", "¿el 45 está
// ocupado?".
const NUMERO_ESPECIFICO_FRASES = [
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
    "tiene",        // 3ª persona ("¿alguien tiene el 45?", "¿lo tiene alguien?")
                    // — NUNCA aparece en una orden de reserva ("tengo", en
                    // cambio, ya lo bloquea validarTextoReserva.js).
    "consulta",
    ...FRASES_PUEDO
];

// Palabras de disponibilidad/estado que, junto a un número y SIN ninguna
// señal de que el cliente está tomando el número, indican una pregunta
// sobre ESE número ("¿el 45 sigue libre?", "¿el 45 disponible?").
const NUMERO_ESPECIFICO_ESTADO = ["libre", "libres", "disponible", "disponibles"];

// Verbos/expresiones de "tomar" un número. Si aparecen, el mensaje es una
// reserva aunque también mencione "libre"/"disponible" ("quiero el 45 que
// esté libre").
const TOMA_PALABRAS = ["quiero", "dame", "damelo", "separa", "separame", "aparta", "apartame", "reservame", "cojo", "pido", "pongo", "ponme", "apunto", "apuntame", "regalame", "anota", "anotame"];
const TOMA_FRASES = ["para mi", "pa mi"];

// Señal INEQUÍVOCA de que el cliente está tomando el número (incluye la
// posesión "mío" y "me llevo"). Usada por el paso 0.5 para resolver la
// ambigüedad "toma + condición de disponibilidad" a favor de la reserva.
const TOMA_RESERVA_PALABRAS = [...TOMA_PALABRAS, "mio", "mios"];
const TOMA_RESERVA_FRASES = [...TOMA_FRASES, "me llevo"];

// "quiero SABER si el 45 está libre" -> aquí "quiero" es pregunta, no
// orden. Si aparece un verbo de conocimiento, la toma NO cuenta y el
// mensaje se resuelve como consulta de estado (numero_especifico).
const VERBOS_CONOCIMIENTO = ["saber", "consultar", "preguntar", "averiguar"];

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

    // Pregunta de CONTEO en plural ("cuántos", "cuántas"): señal fuerte de
    // que se pregunta por una CANTIDAD, no por dinero. Coincidencia exacta
    // a propósito — "cuánto" (singular, dinero) NO debe activarla.
    const esContarPlural = tokens.some(t => t === "cuantos" || t === "cuantas");

    if (tokens.length < MINIMO_TOKENS_PARA_CONSULTA) {
        return resolverComoReservaOninguna(texto, numeros);
    }

    // 0. Pago: reconocida, no implementada (silencio intencional en
    // eventHandler.js). GUARDA: si el mensaje menciona explícitamente la
    // palabra "número(s)", NUNCA se clasifica como pago — así "qué
    // números debo" no se confunde con una pregunta de dinero.
    const mencionaNumeroPalabra = contieneAlguna(tokens, NUMERO_RAIZ);

    if (!mencionaNumeroPalabra) {

        if (contieneAlguna(tokens, PAGO_PALABRAS_FUERTE)) {
            return { tipo: "consulta_pago", numeros };
        }

        // Disparadores débiles y ampliados: solo cuando NO hay ningún
        // número en el mensaje y NO es una pregunta de conteo en plural
        // (ver comentarios de las constantes, arriba). Así "me llevo el
        // 44" queda como reserva y "cuántos llevo" como cantidad.
        if (numeros.length === 0 && !esContarPlural) {

            if (
                contieneAlguna(tokens, PAGO_PALABRAS_DEBIL) ||
                contieneAlguna(tokens, PAGO_PALABRAS_EXTENDIDA) ||
                contieneAlgunaFrase(tokens, PAGO_FRASES)
            ) {
                return { tipo: "consulta_pago", numeros };
            }

        }

    }

    // 0.5 Toma explícita + número -> RESERVA, aunque el mensaje traiga
    // además una condición de disponibilidad ("sepárame el 45 ¿está
    // libre?", "dame el 45 si está libre"). Va ANTES de numero_especifico
    // para resolver esa ambigüedad. NO aplica si hay un verbo de
    // conocimiento ("quiero SABER si el 45 está libre" sigue siendo
    // numero_especifico). El criterio de reserva sigue siendo el de
    // siempre: validarTextoReserva (sin modificar) + un número.
    if (
        numeros.length > 0 &&
        !contieneAlguna(tokens, VERBOS_CONOCIMIENTO) &&
        (
            contieneAlguna(tokens, TOMA_RESERVA_PALABRAS) ||
            contieneAlgunaFrase(tokens, TOMA_RESERVA_FRASES)
        ) &&
        validarTextoReserva(texto)
    ) {
        return { tipo: "reserva", numeros };
    }

    // 1. Número específico: pregunta de estado/dueño + un número concreto.
    if (numeros.length > 0 && contieneAlgunaFrase(tokens, NUMERO_ESPECIFICO_FRASES)) {
        return { tipo: "numero_especifico", numeros };
    }

    // 1b. Número + palabra de disponibilidad ("¿el 45 sigue libre?"), SOLO
    // si el mensaje no expresa que el cliente está tomando el número
    // (posesión / "quiero" / "dame" / etc.). Si expresa toma, es reserva.
    if (
        numeros.length > 0 &&
        contieneAlguna(tokens, NUMERO_ESPECIFICO_ESTADO) &&
        !contieneAlguna(tokens, POSESION_PALABRAS) &&
        !contieneAlguna(tokens, TOMA_PALABRAS) &&
        !contieneAlgunaFrase(tokens, TOMA_FRASES)
    ) {
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
