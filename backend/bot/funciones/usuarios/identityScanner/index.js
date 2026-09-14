// ==========================================================================
// IdentityScanner — API pública
// ==========================================================================
// Capa independiente y de SOLO LECTURA:
//
//   Baileys -> IdentityScanner (recorrerObjeto) -> IdentityNormalizer
//   (normalizarCandidatos)
//
// No escribe en Supabase, no toca reservas, no reemplaza a
// obtenerUsuarioGlobal.js ni a escanerIdentidades.js — esos siguen siendo
// el ÚNICO camino real de negocio (resolución/creación de "usuarios"), sin
// ningún cambio. Esta capa existe para AUDITAR/COMPARAR qué encuentra un
// recorrido recursivo completo del objeto de Baileys frente al camino
// actual de campos fijos (participant.id / .lid / .phoneNumber).
//
// Expone dos formas de escaneo, ambas sobre el MISMO motor:
//   - escanearMensaje()        -> tiempo real, un mensaje de messages.upsert.
//   - escanearTodosLosGrupos() -> completo, groupFetchAllParticipating(),
//                                  encuentra personas que nunca escribieron.
// ==========================================================================

const { recorrerObjeto } = require("./recorrerObjeto");
const { normalizarCandidatos } = require("./normalizarCandidatos");
const { resolverIdentidadMensaje } = require("./resolverIdentidadMensaje");

// Recorre y normaliza CUALQUIER objeto (mensaje, participante, grupo...).
function escanearObjeto(objeto, { fuenteBase = "" } = {}) {

    const hallazgos = recorrerObjeto(objeto, { fuenteBase });

    return normalizarCandidatos(hallazgos);

}

// Escaneo de UN mensaje crudo de Baileys — para el camino "tiempo real"
// (equivalente conceptual a lo que hacía BOT_Escaner_1.0 dentro de su
// listener de messages.upsert, pero recorriendo el mensaje COMPLETO, no
// solo msg.key.participant / msg.key.participantPn).
function escanearMensaje(message) {

    return escanearObjeto(message, { fuenteBase: "message" });

}

// Escaneo de UN participante de grupo (forma "Contact" de Baileys: id, lid,
// phoneNumber, name, notify, verifiedName...).
function escanearParticipante(participante, { grupoId = null } = {}) {

    return escanearObjeto(participante, {
        fuenteBase: grupoId
            ? `grupo[${grupoId}].participante[${participante?.id || "?"}]`
            : `participante[${participante?.id || "?"}]`
    });

}

// Escaneo de UN grupo completo (metadata con .participants ya incluido).
// Recorre el objeto grupo ENTERO, no solo .participants — así también
// captura campos como owner/subjectOwner si Baileys los expone, sin tener
// que enumerarlos a mano.
function escanearGrupo(grupo) {

    return escanearObjeto(grupo, { fuenteBase: `grupo[${grupo?.id || "?"}]` });

}

// ==========================================================================
// Escaneo COMPLETO de TODOS los grupos de la sesión activa — equivalente
// funcional a BOT_Escaner_1.0/functions/escanearGrupo.js::escanearGrupos,
// pero usando el motor recursivo (recorrerObjeto) en vez de
// extraerDeObjeto(). Recorre TODOS los participantes de TODOS los grupos,
// no solo quienes ya escribieron — por eso encuentra identidades que el
// camino en tiempo real (messages.upsert) nunca vería.
//
// SOLO LECTURA: una única llamada a groupFetchAllParticipating() (mismo
// criterio que bot/funciones/usuarios/escanerIdentidades.js, para no
// disparar una IQ de groupMetadata() por grupo). No llama a Supabase, no
// llama a obtenerUsuarioGlobal, no crea ni actualiza nada.
// ==========================================================================
async function escanearTodosLosGrupos(sock) {

    if (!sock || typeof sock.groupFetchAllParticipating !== "function") {

        throw new Error("El socket no expone groupFetchAllParticipating() — ¿sesión de Baileys no conectada?");

    }

    const mapa = await sock.groupFetchAllParticipating();
    const grupos = Object.values(mapa || {});

    let hallazgos = [];
    let participantesAnalizados = 0;

    for (const grupo of grupos) {

        participantesAnalizados += (grupo.participants || []).length;

        hallazgos = hallazgos.concat(
            recorrerObjeto(grupo, { fuenteBase: `grupo[${grupo.id}]` })
        );

    }

    const resultado = normalizarCandidatos(hallazgos);

    return {

        gruposEncontrados: grupos.length,
        participantesAnalizados,

        ...resultado

    };

}

module.exports = {

    escanearObjeto,
    escanearMensaje,
    escanearParticipante,
    escanearGrupo,
    escanearTodosLosGrupos,

    // Función central de identidad de UN mensaje entrante (auditoría de
    // mensajes entrantes, 2026-09) — ver resolverIdentidadMensaje.js.
    resolverIdentidadMensaje

};
