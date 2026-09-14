// ==========================================================================
// IdentityNormalizer — convierte los hallazgos CRUDOS de recorrerObjeto.js
// en candidatos clasificados y en las 3 listas deduplicadas pedidas
// (telefonos / lids / jids), sin perder evidencia de dónde salió cada uno.
// ==========================================================================
// Reglas ("no copiar los bugs del scanner antiguo"):
//
//   - Un JID @lid/@hosted.lid JAMÁS se convierte en teléfono, y viceversa
//     — se decide por dominio real (clasificarJidEncontrado.js), nunca por
//     posición/nombre de campo. Mismo principio que
//     bot/funciones/usuarios/obtenerUsuarioGlobal.js
//     ::normalizarIdentificadoresDesdeJid, que sigue siendo la ÚNICA
//     función que escribe teléfono/lid en la tabla "usuarios" — este
//     módulo NO la reemplaza ni la reimplementa para el flujo de negocio,
//     es una capa de escaneo/diagnóstico independiente.
//
//   - Nunca "me quedo con el primero": cada hallazgo produce un candidato;
//     si el mismo valor aparece en varios lugares, aparece varias veces en
//     `candidatos` (una por fuente) — la deduplicación solo ocurre en las
//     listas planas telefonos/lids/jids, que son para consumo rápido, no
//     para auditoría.
//
//   - El teléfono solo se le quita el "57" inicial cuando el crudo tiene
//     EXACTAMENTE 12 dígitos (57 + 10). El scanner antiguo (función
//     `limpiarTelefono` en escanearGrupo.js) y el sistema actual
//     (normalizarIdentificadoresDesdeJid) lo hacen sin exigir longitud
//     antes de recortar. Aquí SÍ se valida — pero sin descartar el
//     candidato si no cumple: se marca `valido: false` y se conserva. Esta
//     capa es de diagnóstico, no le corresponde decidir qué se guarda.
//
//   - El LID se conserva completo tal cual se encontró (igual que el resto
//     del sistema) y además se calcula `sinSufijoDispositivo` (sin ":N").
//     La auditoría de identidad (2026-09) documentó un caso REAL en
//     producción donde el mismo LID con y sin sufijo de dispositivo fue
//     tratado como dos personas distintas (ver
//     escanerIdentidades.js::usuarioDeJid, comentario "BUG REAL encontrado
//     en producción"). Este campo es informativo — no cambia el criterio
//     de "lid" que ya usa el resto del sistema.
// ==========================================================================

const { clasificarJidEncontrado } = require("./clasificarJidEncontrado");

function limpiarTelefono(crudo) {

    // "573001234567:0@s.whatsapp.net" -> usuario "573001234567:0"
    // (el agente "_N" y el dispositivo ":N" nunca son parte del número).
    const soloUsuario = crudo.split("@")[0].split(":")[0].split("_")[0];

    const soloDigitos = soloUsuario.replace(/\D/g, "");

    let valor = soloDigitos;

    if (soloDigitos.length === 12 && soloDigitos.startsWith("57")) {

        valor = soloDigitos.slice(2);

    }

    const valido = valor.length === 10 && valor.startsWith("3");

    return { valor, valido };

}

function quitarSufijoDispositivo(jidCompleto) {

    const [usuario, dominio] = jidCompleto.split("@");

    return `${usuario.split(":")[0]}@${dominio}`;

}

// ==========================================================================
// normalizarCandidatos(hallazgos) — hallazgos: [{ crudo, source }, ...]
// (salida cruda de recorrerObjeto.js).
//
// Devuelve:
//   {
//     telefonos: [...],   // strings deduplicados, ya limpios
//     lids: [...],        // JIDs completos deduplicados, tal cual
//     jids: [...],        // TODO jid reconocido, cualquier dominio, deduplicado
//     candidatos: [ { tipo, valor, crudo, source, ...extra }, ... ]
//   }
// ==========================================================================
function normalizarCandidatos(hallazgos = []) {

    const candidatos = [];
    const jidsUnicos = new Set();

    for (const { crudo, source } of hallazgos) {

        jidsUnicos.add(crudo);

        const tipo = clasificarJidEncontrado(crudo);

        if (tipo === "otro") continue; // no es identidad de persona (ver clasificarJidEncontrado.js)

        if (tipo === "phone") {

            const { valor, valido } = limpiarTelefono(crudo);

            candidatos.push({ tipo, valor, crudo, valido, source });

            continue;

        }

        // tipo === "lid"
        candidatos.push({

            tipo,
            valor: crudo,
            crudo,
            sinSufijoDispositivo: quitarSufijoDispositivo(crudo),
            source

        });

    }

    return {

        telefonos: [...new Set(candidatos.filter(c => c.tipo === "phone").map(c => c.valor))],

        lids: [...new Set(candidatos.filter(c => c.tipo === "lid").map(c => c.valor))],

        jids: [...jidsUnicos],

        candidatos

    };

}

module.exports = {
    normalizarCandidatos,
    limpiarTelefono,
    quitarSufijoDispositivo
};
