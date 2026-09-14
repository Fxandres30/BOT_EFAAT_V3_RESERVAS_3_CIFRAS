// ==========================================================================
// IdentityScanner — motor de recorrido recursivo (capa 1 de 2: extracción
// cruda, sin clasificar ni normalizar).
// ==========================================================================
// Reconstruye la idea central de BOT_Escaner_1.0/functions/escanearGrupo.js
// ::extraerDeObjeto — "no asumir en qué campo viene el identificador,
// recorrer TODO el objeto que entregó Baileys y encontrarlo donde sea" —
// pero corrigiendo sus dos límites reales:
//
//   1. El original hacía `if (data.includes("@lid")) lid = data` — usaba el
//      STRING COMPLETO como si fuera el JID. Si "@lid" apareciera dentro de
//      un string más largo (compuesto), el "lid" resultante habría sido
//      basura. Aquí se extrae el JID exacto con una expresión regular,
//      esté solo o incrustado.
//   2. El original tenía `if (!lid) lid = data` / `if (!telefono) ...` —
//      se quedaba con el PRIMERO y descartaba cualquier otro hallazgo en el
//      mismo objeto. Aquí se devuelven TODOS los hallazgos crudos; decidir
//      qué hacer con varios candidatos es responsabilidad de quien llame a
//      esto, no de este módulo.
//
// Esta capa NO clasifica (no decide si un JID es teléfono o LID — eso es
// clasificarJidEncontrado.js) ni normaliza (eso es normalizarCandidatos.js)
// ni toca Supabase ni reservas. Es SOLO extracción de texto sobre un objeto
// en memoria.
// ==========================================================================

const { clasificarJidEncontrado } = require("./clasificarJidEncontrado");

// Límite defensivo de profundidad — Baileys no produce estructuras tan
// anidadas, pero si algún día alguien pasa por error un objeto con forma
// distinta (p. ej. el propio `sock`), esto evita un recorrido descontrolado
// en vez de fallar en silencio o colgar el proceso.
const LIMITE_PROFUNDIDAD = 30;

// ==========================================================================
// Dominios de identidad PERSONAL que Baileys reconoce hoy — verificado
// contra el paquete realmente instalado:
// node_modules/@whiskeysockets/baileys/lib/WABinary/jid-utils.js
// (@whiskeysockets/baileys 7.0.0-rc14, el mismo que ya usa el resto del
// proyecto). Existen 4, no 2:
//   @s.whatsapp.net  -> isPnUser        (teléfono, dispositivo normal)
//   @lid             -> isLidUser       (LID, dispositivo normal)
//   @hosted          -> isHostedPnUser  (teléfono, cuenta "hosted")
//   @hosted.lid      -> isHostedLidUser (LID, cuenta "hosted")
// El orden en la alternancia importa: "hosted.lid" va ANTES que "hosted"
// (si no, "hosted" se comería el prefijo de "hosted.lid" y el resto ".lid"
// quedaría sin capturar / mal clasificado).
//
// El "user" de un JID de Baileys es numérico, con agente opcional ("_N") y
// dispositivo opcional (":N") — ver jidEncode() en el mismo archivo fuente.
// Se exige mínimo 5 dígitos para evitar falsos positivos sobre basura corta
// que por casualidad termine en uno de estos sufijos. Esta es la extracción
// "incrustada": un JID real en medio de un texto más largo (p. ej. el
// caption de un mensaje) — por eso necesita una ancla estricta.
const PATRON_JID_INCRUSTADO =
    /([0-9]{5,20}(?:_[0-9]{1,5})?(?::[0-9]{1,5})?@(?:hosted\.lid|hosted|lid|s\.whatsapp\.net))(?![A-Za-z0-9.])/g;

// ==========================================================================
// "Completo": el STRING ENTERO es el JID, no un fragmento dentro de un texto
// más largo. Este es el caso normal de los campos que ya entrega Baileys
// limpios (participant.id, participant.lid, participant.phoneNumber,
// message.key.participant...) — por eso NO exige que el "user" sea numérico
// ni una longitud mínima (a diferencia del patrón incrustado de arriba):
// usa exactamente el mismo criterio que los helpers oficiales de Baileys
// (isLidUser/isPnUser/... vía clasificarJidEncontrado), que tampoco lo
// exigen. Lo único que se exige aquí es que no tenga espacios — un JID real
// nunca los tiene, y es lo único que evita que un texto libre "normal" que
// por casualidad TERMINE en uno de estos dominios se capture completo (con
// todo el texto previo) en vez de solo el fragmento real — para eso está el
// patrón incrustado de arriba.
// ==========================================================================
function esJidCompletoSinEspacios(valor) {

    return !/\s/.test(valor) && clasificarJidEncontrado(valor) !== "otro";

}

function extraerJidsDeString(valor) {

    if (!valor) return [];

    const encontrados = new Set();

    if (esJidCompletoSinEspacios(valor)) {

        encontrados.add(valor);

    }

    for (const match of valor.matchAll(PATRON_JID_INCRUSTADO)) {

        encontrados.add(match[1]);

    }

    return [...encontrados];

}

function esBinario(valor) {

    return (
        Buffer.isBuffer(valor) ||
        (typeof Uint8Array !== "undefined" && valor instanceof Uint8Array) ||
        (typeof ArrayBuffer !== "undefined" && valor instanceof ArrayBuffer)
    );

}

// Long.js (protobuf de 64 bits — p. ej. messageTimestamp) trae propiedades
// internas numéricas (low/high) que no son JIDs y no vale la pena recorrer.
// Mismo duck-typing que ya usa guardarMensajeGrupo.js con
// `msg.messageTimestamp?.toNumber?.()`.
function esLongProtobuf(valor) {

    return typeof valor.toNumber === "function" && typeof valor.low === "number";

}

function recorrer(valor, ruta, hallazgos, visitados, profundidad) {

    if (valor === null || valor === undefined) return;

    if (typeof valor === "string") {

        for (const crudo of extraerJidsDeString(valor)) {

            hallazgos.push({ crudo, source: ruta || "(raiz)" });

        }

        return;

    }

    if (typeof valor !== "object") return; // number, boolean, bigint, function...

    if (esBinario(valor)) return;

    if (profundidad >= LIMITE_PROFUNDIDAD) return;

    if (visitados.has(valor)) return; // ciclo — nunca debería pasar con objetos de Baileys, pero es gratis blindarlo
    visitados.add(valor);

    if (Array.isArray(valor)) {

        valor.forEach((item, i) => recorrer(item, `${ruta}[${i}]`, hallazgos, visitados, profundidad + 1));

        return;

    }

    if (esLongProtobuf(valor)) return;

    for (const [clave, val] of Object.entries(valor)) {

        recorrer(val, ruta ? `${ruta}.${clave}` : clave, hallazgos, visitados, profundidad + 1);

    }

}

// ==========================================================================
// API pública de esta capa: recorre CUALQUIER objeto (mensaje crudo de
// Baileys, participante de grupo, grupo completo con o sin .participants,
// lo que sea) y devuelve los hallazgos CRUDOS:
//   [{ crudo: "573001234567:0@s.whatsapp.net", source: "message.key.participant" }, ...]
// Sin clasificar, sin normalizar, sin deduplicar — un mismo JID que
// aparezca en 3 lugares produce 3 entradas (la deduplicación es decisión
// de normalizarCandidatos.js, no de esta capa).
// ==========================================================================
function recorrerObjeto(objeto, { fuenteBase = "" } = {}) {

    const hallazgos = [];

    recorrer(objeto, fuenteBase, hallazgos, new Set(), 0);

    return hallazgos;

}

module.exports = {
    recorrerObjeto,
    extraerJidsDeString,
    PATRON_JID_INCRUSTADO
};
