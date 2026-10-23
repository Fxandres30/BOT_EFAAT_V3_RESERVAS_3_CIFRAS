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
const { esPedidoDeTabla, quitarPrecios } = require("./pedidoTabla");
const { canonizarTokens, contieneAccionPago, contieneDeuda } = require("./vocabularioPago");
const {
    coincideAprox,
    contieneAlguna,
    contieneFrase,
    contieneAlgunaFrase
} = require("../../utils/coincidenciaAproximada");

// ============================================================
// Palabras/frases clave por categoría. Cada una se compara contra el
// mensaje con tolerancia a errores de tecleo (ver coincidenciaAproximada.js)
// — no es necesario listar cada variante mal escrita a mano.
// ============================================================

// Preguntas de pago — vocabulario EXACTO compartido en vocabularioPago.js
// (deuda: "debo"/"devo"/"debe"; acción: "pago"/"pagué"/"page"/"cancelé"...).
// Nunca por distancia de edición: "pasar"/"pasado" no son pago.
//
// Dos niveles, a propósito:
//   DEUDA -> inequívocas de dinero. Cuentan como pago incluso si el
//            mensaje trae un número ("¿cuánto debo por el 25?" sigue
//            siendo pago, no reserva ni numero_especifico).
//   DÉBIL -> "llevo" y "me falta(n)" también aparecen en frases de
//            RESERVA ("me llevo el 44") y de CANTIDAD ("cuántos llevo").
//            Solo cuentan como pago cuando NO hay ningún número en el
//            mensaje y NO es una pregunta de cantidad en plural. "falta"
//            suelta NO cuenta ("¿cuánto falta para el sorteo?" no es
//            pago): solo dentro de una frase de PAGO_FRASES_FALTA.
// Los verbos de ACCIÓN de pago se resuelven aparte (paso -0.5), ver
// comentario de esa regla más abajo.
const PAGO_PALABRAS_DEBIL = ["llevo"];
const PAGO_FRASES_FALTA = ["me falta", "me faltan"];

// ============================================================
// Verificación del estado de cuenta ("¿estoy al día?", "¿cómo voy?"): NO
// es una respuesta propia — se verifica con la MISMA respuesta de pago
// que "qué debo" (lo pendiente, o "estás al día"). Se comprueba ANTES que
// cualquier otra regla.
// ============================================================
const ESTADO_FRASES = [
    "estoy al dia", "quede al dia", "quedo al dia", "estamos al dia", "ando al dia", "voy al dia",
    "como voy", "como estoy", "como vamos", "como va mi cuenta", "como esta mi cuenta",
    "estado de cuenta", "mi estado", "mi saldo"
];

// Piden VER los dos estados a la vez ("¿cuáles tengo pagos y cuáles
// no?") -> "mis números" (todos, cada uno con su estado). "y cuáles no"
// solo cuenta si el mensaje habla de pago.
const AMBOS_ESTADOS_FRASES = ["pagados y pendientes", "pagos y pendientes"];
const AMBOS_ESTADOS_FRASES_CON_PAGO = ["y cuales no", "y los que no", "y cual no"];

function pideAmbosEstados(tokensPago) {

    if (contieneAlgunaFrase(tokensPago, AMBOS_ESTADOS_FRASES)) {
        return true;
    }

    return contieneAlgunaFrase(tokensPago, AMBOS_ESTADOS_FRASES_CON_PAGO) &&
        (contieneAccionPago(tokensPago) || contieneDeuda(tokensPago));

}

// ¿El cliente PREGUNTA por su pago o lo AFIRMA? "ya pagué", "cancelé el
// 25", "listo, pagué" son afirmaciones: el pago real lo confirma un
// administrador con el sticker de pago citando ESE mensaje del cliente
// (confirmarPagoPorSticker.js, en silencio) — el bot no responde ni
// confirma nada. Solo es pregunta con "?"/"¿" o una palabra
// interrogativa al inicio ("si ya pagué", "será que ya pagué") o "o no".
const INICIOS_PREGUNTA = new Set(["que", "cual", "cuales", "cuanto", "cuantos", "como", "si", "sera", "acaso", "verdad"]);

function esPregunta(textoOriginal, tokensPago) {

    if (/[?¿]/.test(textoOriginal || "")) return true;

    if (INICIOS_PREGUNTA.has(tokensPago[0])) return true;

    return contieneFrase(tokensPago, "o no");

}

// Auditoría "PAGO > CONSULTA" y "PAGO nunca es RESERVA ni CONSULTA
// genérica de números" (Problemas 1 y 2): las cuatro formas de un mismo
// campo semántico de pago. El cliente está afirmando/preguntando/
// declarando su intención de pago — nunca "qué números tengo" ni tomando
// un número — así que valen SIEMPRE, aunque el mensaje diga "número(s)"
// ("pago mis números", "quiero pagar los números que tengo") o traiga un
// número concreto ("pago el 25", "el 25 ya está pagado"). Se comprueban
// en un paso aparte (-0.5), ANTES de la guarda de "número(s)" de más
// abajo Y antes de la lógica de reserva/numero_especifico. Ninguna es
// válida como reserva: validarTextoReserva.js ya bloquea las cuatro, así
// que esta prioridad nunca le quita un mensaje real a una reserva.
//
// El sistema NUNCA le toma la palabra al cliente sobre si pagó: el único
// pago real lo confirma un administrador (sticker de pago,
// confirmarPagoPorSticker.js). Por eso:
//   - AFIRMACIÓN ("ya pagué", "ya pagué el 25", "cancelé el 25") -> el bot
//     no responde (tipo "ninguna"): es el mensaje que el administrador
//     cita con el sticker. Nunca es una reserva.
//   - PREGUNTA ("¿ya pagué?", "¿el 25 está pago?") -> estado REAL: con un
//     número, el de ESE número (numero_especifico); sin número, la
//     respuesta de pago del cliente (lo pendiente o "estás al día").
//
// "cancelé/cancelado" (= pagué/pagado en Colombia) pertenece a este mismo
// campo (validarTextoReserva.js, sin modificar, no bloqueaba "cancele").

// ============================================================
// Fase "consultas de pago" — frases COMPLETAS que fijan sin ambigüedad
// qué debe responder consulta_pago: "modo" (lista de números / cantidad /
// monto en pesos / resumen pagados+pendientes) y "bucket" (pendiente /
// pagado / total). Se listan
// explícitas, mismo estilo que el resto de este archivo (listas
// curadas con tolerancia a errores, nunca NLP genérico), porque frases
// gramaticalmente parecidas tienen significados distintos que ninguna
// heurística de una sola palabra resuelve bien (p. ej. "qué tengo que
// pagar" = monto, pero "qué tengo pendiente" = lista).
//
// Se comprueban ANTES que cualquier otra regla de este archivo — son
// frases inequívocas del dominio de pagos, nunca chocan con una reserva
// real (ninguna contiene un número ni un verbo de "tomar").
// ============================================================
const PAGO_FRASES_EXPLICITAS = [

    // lo que debe ("cuánto debo" = "qué debo"): la respuesta de pago
    // (números pendientes + valor si hay precio), nunca solo un monto.
    { frase: "cuanto debo", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto me falta pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto me falta", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto debo pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto tengo que pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "que tengo que pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto me toca pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "cuanto he pagado", modo: "monto", bucket: "pagado" },
    { frase: "cuanto llevo", modo: "monto", bucket: "pagado" },
    { frase: "cuanto es lo mio", modo: "monto", bucket: "total" },
    { frase: "cuanto es todo", modo: "monto", bucket: "total" },

    // lista (cuáles números)
    { frase: "cuales debo", modo: "lista", bucket: "pendiente" },
    { frase: "que numeros debo", modo: "lista", bucket: "pendiente" },
    { frase: "cuales me faltan por pagar", modo: "lista", bucket: "pendiente" },
    { frase: "que tengo pendiente", modo: "lista", bucket: "pendiente" },
    { frase: "cuales estan pendientes", modo: "lista", bucket: "pendiente" },
    { frase: "cuales pendientes", modo: "lista", bucket: "pendiente" },
    { frase: "cuales ya pague", modo: "lista", bucket: "pagado" },
    { frase: "que numeros ya estan pagos", modo: "lista", bucket: "pagado" },
    { frase: "cuales tengo pagados", modo: "lista", bucket: "pagado" },
    { frase: "cuales estan pagados", modo: "lista", bucket: "pagado" },
    { frase: "cuales pagados", modo: "lista", bucket: "pagado" },
    // "pagos"/"cancelados" = pagados (uso habitual en Colombia).
    { frase: "cuales tengo pagos", modo: "lista", bucket: "pagado" },
    { frase: "cuales estan pagos", modo: "lista", bucket: "pagado" },
    { frase: "que numeros tengo pagos", modo: "lista", bucket: "pagado" },
    { frase: "que numeros tengo pagados", modo: "lista", bucket: "pagado" },
    { frase: "que numeros ya pague", modo: "lista", bucket: "pagado" },
    { frase: "mis numeros pagados", modo: "lista", bucket: "pagado" },
    { frase: "cuales tengo cancelados", modo: "lista", bucket: "pagado" },
    { frase: "cuales estan cancelados", modo: "lista", bucket: "pagado" },
    { frase: "cuales ya cancele", modo: "lista", bucket: "pagado" },
    // Sin "ya" caían en la respuesta de pago (lo PENDIENTE): se preguntaba
    // por lo pagado. "cancelé" = pagué; las reservas liberadas no dejan
    // rastro del dueño en la tabla (reservaManual.js::CAMPOS_LIBRE), así
    // que nunca se responde con un historial de cancelaciones.
    { frase: "cuales pague", modo: "lista", bucket: "pagado" },
    { frase: "que numeros pague", modo: "lista", bucket: "pagado" },
    { frase: "cuales he pagado", modo: "lista", bucket: "pagado" },
    { frase: "que numeros he pagado", modo: "lista", bucket: "pagado" },
    { frase: "cuales cancele", modo: "lista", bucket: "pagado" },
    { frase: "que numeros cancele", modo: "lista", bucket: "pagado" },
    { frase: "que numeros ya cancele", modo: "lista", bucket: "pagado" },
    { frase: "cuales he cancelado", modo: "lista", bucket: "pagado" },
    { frase: "que numeros he cancelado", modo: "lista", bucket: "pagado" },
    { frase: "cuales tengo pendientes", modo: "lista", bucket: "pendiente" },

    // cantidad (cuántos)
    { frase: "cuantos me faltan por pagar", modo: "cantidad", bucket: "pendiente" },
    { frase: "cuantos me faltan", modo: "cantidad", bucket: "pendiente" },
    { frase: "cuantos debo", modo: "cantidad", bucket: "pendiente" },
    { frase: "cuantos estan pendientes", modo: "cantidad", bucket: "pendiente" },
    { frase: "cuantos pendientes", modo: "cantidad", bucket: "pendiente" },
    { frase: "cuantos ya pague", modo: "cantidad", bucket: "pagado" },
    { frase: "cuantos estan pagados", modo: "cantidad", bucket: "pagado" },
    { frase: "cuantos pagados", modo: "cantidad", bucket: "pagado" },

    // lo que falta por pagar — misma respuesta de pago que "qué debo".
    { frase: "me falta por pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "me faltan por pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "faltan por pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "falta por pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "me falta pagar", modo: "resumen", bucket: "pendiente" },
    { frase: "tengo algo pendiente", modo: "resumen", bucket: "pendiente" }

];

// esContarPlural evita un falso positivo real: la coincidencia aproximada
// (coincidenciaAproximada.js) trata "cuantos" y "cuanto" como la misma
// palabra (distancia de edición 1), así que sin este guard "cuántos
// llevo" calzaría con la frase "cuanto llevo" (frases "cuanto ...") en vez de
// seguir siendo una pregunta de CANTIDAD ("cuántos" siempre es plural /
// conteo, nunca dinero — mismo criterio que el resto del archivo).
function buscarFraseExplicitaPago(tokens, esContarPlural) {

    for (const entrada of PAGO_FRASES_EXPLICITAS) {

        if (esContarPlural && entrada.frase.startsWith("cuanto ")) {
            continue;
        }

        if (contieneFrase(tokens, entrada.frase)) {

            return { modo: entrada.modo, bucket: entrada.bucket };

        }

    }

    return null;

}

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
    "esta disponible",
    "quien tiene",
    "tiene",        // 3ª persona ("¿alguien tiene el 45?", "¿lo tiene alguien?")
                    // — NUNCA aparece en una orden de reserva ("tengo", en
                    // cambio, ya lo bloquea validarTextoReserva.js).
    "consulta",
    // NOTA: "esta pagado" / "ya pague" / "lo pague" / "ya lo pague" ya NO
    // están aquí — el paso -0.5 (PAGO_PALABRAS_ACCION) resuelve CUALQUIER
    // mensaje con "pagado"/"pague" + un número concreto como
    // numero_especifico, sin necesidad de listar la frase completa. Mismo
    // resultado exacto para "el 25 ya está pagado"/"el 25 ya lo pagué"
    // (ver tests protegidos en consultasPago.test.js #14/#15), pero
    // también cubre frases nuevas antes no listadas ("pague el 25",
    // "el 25 pagado").
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

// AVISO de que NO hay disponibilidad ("sin números disponibles", "no hay
// números disponibles", "ya no quedan números", "No quedan números
// disponibles." — este último es el propio mensaje fijo del bot): una
// negación que gobierna a la palabra de disponibilidad, a no más de 3
// palabras antes de ella. Es una AFIRMACIÓN, no una pregunta, así que no
// dispara la consulta de disponibilidad.
//
// NO es aviso (sigue siendo pregunta de disponibilidad):
//   - si el mensaje trae "?" o "¿" ("¿No quedan números?", "¿ya no
//     quedan?", "¿no hay disponibles?") — se mira el texto ORIGINAL,
//     normalizarTexto() quita los signos;
//   - si entre la negación y la palabra de disponibilidad hay una palabra
//     interrogativa ("no sé cuáles quedan").
const NEGACIONES_DISPONIBILIDAD = ["sin", "no"];
const INTERROGATIVAS = ["que", "cual", "cuales", "cuantos", "cuantas", "se", "saber"];
const VENTANA_NEGACION = 3;

function esAvisoSinDisponibilidad(textoOriginal, tokens) {

    if (/[?¿]/.test(textoOriginal || "")) return false;

    for (let i = 0; i < tokens.length; i++) {

        if (!DISPONIBILIDAD_PALABRAS.some(p => coincideAprox(tokens[i], p))) continue;

        for (let j = i - 1; j >= Math.max(0, i - VENTANA_NEGACION); j--) {

            if (INTERROGATIVAS.includes(tokens[j])) break;

            if (NEGACIONES_DISPONIBILIDAD.includes(tokens[j])) return true;

        }

    }

    return false;

}

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

// ============================================================
// Fase "consultas combinadas" — familia de tipos que SÍ pueden combinarse
// en un mismo mensaje ("mis números y cuánto debo"). reserva,
// numero_especifico, disponibilidad e info_evento NUNCA se combinan (no
// tiene sentido de negocio, y combinarlos arriesgaría tocar el detector de
// reservas — fuera de alcance de esta fase).
// ============================================================
const FAMILIA_COMBINABLE = new Set(["mis_numeros", "mis_reservas", "cantidad_reservas", "consulta_pago"]);

// Separadores de segmentos dentro de un mismo mensaje: " y " (palabra
// completa, nunca dentro de otra palabra como "hoy"/"muy") y comas. Se
// aplica sobre el texto ORIGINAL (con tildes) — cada segmento se vuelve a
// normalizar por su cuenta dentro de detectarIntencionUnica().
function dividirEnSegmentos(texto) {

    return texto
        .split(/,|\s+y\s+/i)
        .map(s => s.trim())
        .filter(Boolean);

}

// mis_reservas y mis_numeros son la MISMA respuesta (resolverConsulta.js):
// "mis números y mis reservas" es una sola pregunta, no dos respuestas
// iguales seguidas.
function claveIntencion(i) {
    const tipo = i.tipo === "mis_reservas" ? "mis_numeros" : i.tipo;
    return `${tipo}|${i.modo || ""}|${i.bucket || ""}`;
}

// Punto de entrada público: primero clasifica el mensaje COMPLETO con la
// misma lógica de siempre (detectarIntencionUnica, sin cambios de
// comportamiento) — reserva/numero_especifico/disponibilidad/info_evento/
// ninguna se devuelven TAL CUAL, sin pasar por combinación. Solo cuando el
// mensaje completo ya clasificó como parte de la familia combinable se
// intenta ver si el mensaje trae MÁS de una pregunta de esa misma familia
// (separadas por "y"/","), cada una resuelta con la MISMA función — nunca
// una regla nueva de clasificación.
function detectarIntencion(texto = "", cifras = 2) {

    const principal = detectarIntencionUnica(texto, cifras);

    if (!FAMILIA_COMBINABLE.has(principal.tipo)) {
        return principal;
    }

    // "¿cuáles tengo pagos y cuáles no?" es UNA pregunta ("mis números"),
    // no dos: el "y" no separa preguntas aquí.
    if (principal.tipo === "mis_numeros" && pideAmbosEstados(canonizarTokens(normalizarTexto(texto).split(" ").filter(Boolean)))) {
        return principal;
    }

    const segmentos = dividirEnSegmentos(texto || "");

    if (segmentos.length < 2) {
        return principal;
    }

    const vistos = new Set();
    const intenciones = [];

    for (const segmento of segmentos) {

        const r = detectarIntencionUnica(segmento, cifras);

        if (!FAMILIA_COMBINABLE.has(r.tipo)) continue;

        const clave = claveIntencion(r);

        if (vistos.has(clave)) continue;

        vistos.add(clave);
        intenciones.push(r);

    }

    // Los segmentos no aportaron una combinación real (p. ej. "y" formaba
    // parte de una sola pregunta, como "mis números y reservas" que ambos
    // segmentos resuelven igual) — se devuelve el resultado de siempre.
    if (intenciones.length < 2) {
        return principal;
    }

    return { tipo: "multiple", numeros: [], intenciones };

}

function detectarIntencionUnica(texto = "", cifras = 2) {

    if (!texto || !texto.trim()) {
        return { tipo: "ninguna", numeros: [] };
    }

    const normalizado = normalizarTexto(texto);
    const tokens = normalizado.split(" ").filter(Boolean);
    const numeros = extraerNumeros(texto, cifras);

    // Pregunta de CONTEO en plural ("cuántos", "cuántas"): señal fuerte de
    // que se pregunta por una CANTIDAD, no por dinero. Coincidencia exacta
    // a propósito — "cuánto" (singular, dinero) NO debe activarla.
    const esContarPlural = tokens.some(t => t === "cuantos" || t === "cuantas");

    // Tokens con los errores de escritura habituales de pago ya corregidos
    // ("q devo" -> "que debo", "ya page" -> "ya pague"). Solo se usan para
    // las reglas de pago/estado; el resto de reglas sigue con `tokens`.
    const tokensPago = canonizarTokens(tokens);

    // -2. "¿Estoy al día?" / "¿cómo voy?" -> se verifica con la misma
    // respuesta de pago; "¿cuáles tengo pagos y cuáles no?" -> "mis
    // números". Ninguna contiene un número ni un verbo de "tomar".
    if (numeros.length === 0 && contieneAlgunaFrase(tokensPago, ESTADO_FRASES)) {
        return { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };
    }

    if (numeros.length === 0 && pideAmbosEstados(tokensPago)) {
        return { tipo: "mis_numeros", numeros };
    }

    // -1. Frases EXPLÍCITAS de pago (modo+bucket sin ambigüedad) — máxima
    // prioridad, antes que cualquier otra regla. Ninguna de estas frases
    // contiene un número ni un verbo de "tomar", así que nunca choca con
    // una reserva real.
    const fraseExplicitaPago = buscarFraseExplicitaPago(tokensPago, esContarPlural);

    if (fraseExplicitaPago) {
        return { tipo: "consulta_pago", numeros, ...fraseExplicitaPago };
    }

    // -0.75. Pedido corto/informal de la tabla ("actualiza", "tabla",
    // "actualiza x fa", "¿hay números?", "disponibles") -> la MISMA
    // intención "disponibilidad" de siempre (ver pedidoTabla.js). Va antes
    // del mínimo de palabras porque muchos de estos pedidos son de una sola
    // palabra. Nunca aplica con un número concreto (reserva /
    // numero_especifico siguen igual), con pago/comprobante/resultado, ni
    // con un conteo en plural ("cuántos números hay" sigue como estaba).
    const pedidoTabla = esContarPlural ? null : esPedidoDeTabla(texto, tokens, numeros);

    if (pedidoTabla?.esPedido) {
        return { tipo: "disponibilidad", numeros };
    }

    // Anuncio de quien publica ("quedó actualizada la tabla", "actualizo
    // tabla") u orden de no hacerlo ("no actualicen"): no es ninguna
    // consulta — sin esto, "quedó" caería en la palabra "queda" de abajo.
    if (pedidoTabla?.regla === "anuncio" || pedidoTabla?.regla === "negacion") {
        return { tipo: "ninguna", numeros };
    }

    // "tabla 10k", "la del 10.000", "actualiza la de $5000": los únicos
    // "números" son el precio de la tabla (extraerNumeros, sin modificar,
    // lee "10k" como el 10). Sin los precios no queda ningún número y sí un
    // pedido de tabla -> disponibilidad, nunca una reserva del 10.
    if (!esContarPlural && numeros.length > 0) {

        const sinPrecios = quitarPrecios(texto);

        if (sinPrecios !== texto && extraerNumeros(sinPrecios, cifras).length === 0) {

            const tokensSinPrecios = normalizarTexto(sinPrecios).split(" ").filter(Boolean);

            if (esPedidoDeTabla(sinPrecios, tokensSinPrecios, []).esPedido) {
                return { tipo: "disponibilidad", numeros: [] };
            }

        }

    }

    // "debo" / "devo" / "deboo" / "¿debo?" a solas: la deuda en primera
    // persona es inequívoca aunque sea una sola palabra — misma respuesta de
    // pago que "qué debo" (paso 0). "debe"/"debemos" sueltos son ambiguos y
    // siguen sujetos al mínimo de palabras.
    if (tokensPago.length === 1 && tokensPago[0] === "debo") {
        return { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };
    }

    if (tokens.length < MINIMO_TOKENS_PARA_CONSULTA) {
        return resolverComoReservaOninguna(texto, numeros);
    }

    // -0.5. Verbos/estado de ACCIÓN de pago ("pago", "pagué", "page",
    // "pagado", "cancelé"...) — ver comentario de esta familia arriba.
    // Máxima prioridad después de las frases explícitas: nunca se apaga
    // por la palabra "número(s)" ni por traer un número concreto, y nunca
    // llega a reserva. Afirmación -> sin respuesta; pregunta -> estado real.
    if (contieneAccionPago(tokensPago)) {

        if (!esPregunta(texto, tokensPago)) {
            return { tipo: "ninguna", numeros };
        }

        if (numeros.length > 0) {
            return { tipo: "numero_especifico", numeros };
        }

        return { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };

    }

    // 0. Deuda ("qué debo", "q devo", "debo algo", "qué números debo") —
    // resumen enfocado en lo pendiente, también con la palabra
    // "número(s)" (lo pendiente SON números). "cuántos ... debo" es un
    // conteo de pendientes.
    if (contieneDeuda(tokensPago)) {

        return esContarPlural
            ? { tipo: "consulta_pago", numeros, modo: "cantidad", bucket: "pendiente" }
            : { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };

    }

    // Disparadores débiles: solo cuando NO hay ningún número en el
    // mensaje, NO menciona "número(s)" y NO es una pregunta de conteo en
    // plural (ver comentarios de las constantes, arriba). Así "me llevo el
    // 44" queda como reserva y "cuántos llevo" como cantidad.
    if (numeros.length === 0 && !esContarPlural && !contieneAlguna(tokens, NUMERO_RAIZ)) {

        if (contieneAlgunaFrase(tokensPago, PAGO_FRASES_FALTA)) {
            return { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };
        }

        if (contieneAlguna(tokensPago, PAGO_PALABRAS_DEBIL)) {
            return { tipo: "consulta_pago", numeros, modo: "resumen", bucket: "pendiente" };
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

        // 1c. Aviso "sin/no hay/ya no quedan números" (afirmación, no
        // pregunta): no es ninguna consulta — ver esAvisoSinDisponibilidad.
        if (esAvisoSinDisponibilidad(texto, tokens)) {
            return { tipo: "ninguna", numeros };
        }

        // 2. Disponibilidad — incluye las formas "puedo reservar/agarrar/
        // escoger/elegir" (sin número = pregunta general, no sobre un
        // número concreto).
        if (contieneAlguna(tokens, DISPONIBILIDAD_PALABRAS) || contieneAlgunaFrase(tokens, FRASES_PUEDO)) {
            return { tipo: "disponibilidad", numeros };
        }

        // 3. Cantidad — SIEMPRE antes que "mis números", para no
        // confundir "cuántos números tengo" (cantidad) con "qué números
        // tengo" (lista). Ver auditoría Fase 6, sección 3.
        // Coincidencia EXACTA ("cuántos"/"cuántas"): a 1 error de
        // distancia, "cuanto" (dinero, singular) caería aquí.
        if (esContarPlural) {
            return { tipo: "cantidad_reservas", numeros };
        }

        // 4. Mis números / mis reservas — misma fuente de datos real
        // (consultarMisNumeros, ver resolverConsulta.js) y misma respuesta
        // (plantillas de mis_numeros, ver calcularTipoPresentacion); la
        // etiqueta mis_reservas solo conserva el interruptor antiguo. Regla de
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
