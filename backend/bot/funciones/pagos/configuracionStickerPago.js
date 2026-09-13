// ==========================================================================
// configuracionStickerPago.js — ÚNICA fuente de persistencia y resolución
// para "configuracion_stickers_pago". Ningún otro módulo debe leer/escribir
// esa tabla directamente (mismo criterio arquitectónico que
// obtenerUsuarioGlobal.js para "usuarios").
//
// CORRECCIÓN ARQUITECTÓNICA — dos niveles de configuración:
//
//   Nivel 1 — PREDETERMINADO: usuario_id, grupo_id = NULL.
//             Un único sticker por tenant, válido para cualquier grupo que
//             no tenga uno específico.
//
//   Nivel 2 — ESPECÍFICO: usuario_id, grupo_id = JID real del grupo.
//             Opcional. Si existe, tiene PRIORIDAD sobre el predeterminado
//             para ese grupo exacto.
//
// Ver supabase_migrations/013_configuracion_stickers_pago_predeterminado.sql
// para el esquema (grupo_id nullable + 2 índices únicos parciales).
//
// IMPORTANTE — por qué ya NO se usa upsert(): un índice único PARCIAL
// (como "grupo_id IS NULL" o "grupo_id IS NOT NULL") no puede ser el
// destino de un ON CONFLICT por lista de columnas (limitación real de
// Postgres/PostgREST, documentada en la migración 013). En su lugar se usa
// el mismo patrón YA establecido en el proyecto para esto exacto:
// "insertar optimista -> si 23505 (unique_violation), la fila ya existe ->
// hacer UPDATE de esa fila" (ver bot/funciones/usuarios/obtenerUsuarioGlobal.js
// y backend/pagos/pagosController.js). Nunca hay ventana de carrera: el
// índice único parcial es quien decide atómicamente, en Postgres, si el
// INSERT puede pasar o no.
// ==========================================================================

const supabase = require("../../../lib/supabase");

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

// Mismo criterio de expiración corta que ya usa el proyecto para "algo
// temporal que espera una acción del lado de WhatsApp": el QR de conexión
// expira en 2 minutos (services/baileys/qr.js).
const MINUTOS_EXPIRACION_REGISTRO_DEFECTO = 2;

function validarUsuario(usuarioId) {

    return !!usuarioId;

}

// ==========================================================================
// Lectura de un nivel puntual. grupoId=null -> predeterminado (Nivel 1);
// grupoId=<jid> -> específico de ese grupo (Nivel 2). Usa .is() para NULL
// — .eq("grupo_id", null) NO funciona en PostgREST (genera grupo_id=eq.null,
// que nunca matchea filas NULL reales).
// ==========================================================================
async function obtenerConfiguracion({ usuarioId, grupoId = null }) {

    if (!validarUsuario(usuarioId)) {

        return null;

    }

    let query = supabase
        .from("configuracion_stickers_pago")
        .select("*")
        .eq("usuario_id", usuarioId);

    query = grupoId
        ? query.eq("grupo_id", grupoId)
        : query.is("grupo_id", null);

    const { data, error } = await query.maybeSingle();

    if (error) {

        console.error("❌ [STICKER-PAGO] Error consultando configuracion_stickers_pago:", error.message);

        return null;

    }

    return data;

}

// Pura: decide si un registro está vigente AHORA. El vencimiento se decide
// siempre en código (comparando con Date.now()), nunca en SQL.
function registroVigente(config) {

    if (!config) return false;

    if (config.esperando_registro !== true) return false;

    if (!config.esperando_registro_expira_en) return false;

    return new Date(config.esperando_registro_expira_en).getTime() > Date.now();

}

// Activa (o reactiva) el modo de registro para el nivel indicado
// (grupoId=null -> predeterminado; grupoId=<jid> -> específico). Patrón
// insert-optimista -> 23505 -> update (ver cabecera del archivo).
async function activarModoRegistro({ usuarioId, grupoId = null, minutos = MINUTOS_EXPIRACION_REGISTRO_DEFECTO }) {

    if (!validarUsuario(usuarioId)) {

        return { ok: false, error: "usuario_id es obligatorio" };

    }

    const expira = new Date(Date.now() + minutos * 60 * 1000).toISOString();
    const ahora = new Date().toISOString();

    const { data: insertado, error: errorInsert } = await supabase
        .from("configuracion_stickers_pago")
        .insert({

            usuario_id: usuarioId,
            grupo_id: grupoId || null,
            esperando_registro: true,
            esperando_registro_expira_en: expira,
            actualizado_en: ahora

        })
        .select()
        .single();

    if (!errorInsert) {

        return { ok: true, configuracion: insertado };

    }

    if (errorInsert.code !== CODIGO_VIOLACION_UNICA_POSTGRES) {

        console.error("❌ [STICKER-PAGO] Error activando modo de registro:", errorInsert.message);

        return { ok: false, error: errorInsert.message };

    }

    // Ya existía una fila para este nivel (el índice único parcial
    // correspondiente lo garantiza) — se reutiliza, nunca se duplica.
    let query = supabase
        .from("configuracion_stickers_pago")
        .update({

            esperando_registro: true,
            esperando_registro_expira_en: expira,
            actualizado_en: ahora

        })
        .eq("usuario_id", usuarioId);

    query = grupoId
        ? query.eq("grupo_id", grupoId)
        : query.is("grupo_id", null);

    const { data: actualizado, error: errorUpdate } = await query.select().maybeSingle();

    if (errorUpdate || !actualizado) {

        console.error("❌ [STICKER-PAGO] Error activando modo de registro (fila existente):", errorUpdate?.message);

        return { ok: false, error: errorUpdate?.message || "no se pudo activar el registro" };

    }

    return { ok: true, configuracion: actualizado };

}

// Apaga el modo de registro del nivel indicado, sin tocar un sticker ya
// guardado. Condicionado a (usuario_id, grupo_id-o-null) exactos — nunca
// afecta el otro nivel ni otro grupo/tenant.
async function desactivarModoRegistro({ usuarioId, grupoId = null }) {

    if (!validarUsuario(usuarioId)) {

        return { ok: false, error: "usuario_id es obligatorio" };

    }

    let query = supabase
        .from("configuracion_stickers_pago")
        .update({

            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()

        })
        .eq("usuario_id", usuarioId);

    query = grupoId
        ? query.eq("grupo_id", grupoId)
        : query.is("grupo_id", null);

    const { error } = await query;

    if (error) {

        console.error("❌ [STICKER-PAGO] Error desactivando modo de registro:", error.message);

        return { ok: false, error: error.message };

    }

    return { ok: true };

}

// Guarda el hash capturado en el nivel indicado — SOLO si esperando_registro
// seguía true en la base de datos en el momento exacto del UPDATE
// (condición en el propio WHERE). Mismo criterio atómico que
// marcarReservasPagadasPorAdmin.js.
async function guardarStickerCapturado({ usuarioId, grupoId = null, stickerSha256, registradoPor }) {

    if (!validarUsuario(usuarioId) || !stickerSha256) {

        return { ok: false, error: "usuario_id y stickerSha256 son obligatorios" };

    }

    let query = supabase
        .from("configuracion_stickers_pago")
        .update({

            sticker_sha256: stickerSha256,
            registrado_en: new Date().toISOString(),
            registrado_por: registradoPor || null,
            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()

        })
        .eq("usuario_id", usuarioId)
        .eq("esperando_registro", true);

    query = grupoId
        ? query.eq("grupo_id", grupoId)
        : query.is("grupo_id", null);

    const { data, error } = await query.select();

    if (error) {

        console.error("❌ [STICKER-PAGO] Error guardando sticker capturado:", error.message);

        return { ok: false, error: error.message };

    }

    if (!data || data.length === 0) {

        // El registro ya no estaba vigente al momento del UPDATE (otra
        // ejecución lo ganó primero, o venció justo antes) — no es un
        // error.
        return { ok: false, motivo: "registro_ya_no_vigente" };

    }

    return { ok: true, configuracion: data[0] };

}

// Des-registra el sticker guardado del nivel indicado (nunca borra la
// fila).
async function limpiarStickerConfigurado({ usuarioId, grupoId = null }) {

    if (!validarUsuario(usuarioId)) {

        return { ok: false, error: "usuario_id es obligatorio" };

    }

    let query = supabase
        .from("configuracion_stickers_pago")
        .update({

            sticker_sha256: null,
            registrado_en: null,
            registrado_por: null,
            actualizado_en: new Date().toISOString()

        })
        .eq("usuario_id", usuarioId);

    query = grupoId
        ? query.eq("grupo_id", grupoId)
        : query.is("grupo_id", null);

    const { error } = await query;

    if (error) {

        console.error("❌ [STICKER-PAGO] Error limpiando configuración:", error.message);

        return { ok: false, error: error.message };

    }

    return { ok: true };

}

function normalizarHash(valor) {

    return valor ? String(valor).trim().toLowerCase() : null;

}

// ==========================================================================
// resolverStickerPago({ usuarioId, grupoId }) — ÚNICA función de
// resolución para CONFIRMAR UN PAGO. Prioridad: específico del grupo
// primero, predeterminado del tenant como respaldo. Nunca se duplica esta
// lógica dentro de confirmarPagoPorSticker.js.
//
// Devuelve { hash, nivel: "especifico"|"predeterminado" } o null si no hay
// ningún sticker configurado en ningún nivel — el llamador debe fallar
// cerrado (no confirmar ningún pago).
// ==========================================================================
async function resolverStickerPago({ usuarioId, grupoId }) {

    if (!validarUsuario(usuarioId)) {

        return null;

    }

    if (grupoId) {

        const especifico = await obtenerConfiguracion({ usuarioId, grupoId });
        const hashEspecifico = normalizarHash(especifico?.sticker_sha256);

        if (hashEspecifico) {

            return { hash: hashEspecifico, nivel: "especifico" };

        }

    }

    const predeterminado = await obtenerConfiguracion({ usuarioId, grupoId: null });
    const hashPredeterminado = normalizarHash(predeterminado?.sticker_sha256);

    if (hashPredeterminado) {

        return { hash: hashPredeterminado, nivel: "predeterminado" };

    }

    return null;

}

// ==========================================================================
// obtenerRegistroVigenteParaCaptura({ usuarioId, grupoId }) — usada por
// registrarStickerPago.js para decidir, ante un sticker entrante en un
// grupo concreto, si corresponde a un registro vigente ESPECÍFICO de ese
// grupo o al registro vigente PREDETERMINADO del tenant. Misma prioridad
// que resolverStickerPago(): específico primero.
//
// Devuelve { nivel, grupoId (null si es predeterminado), config } o null
// si no hay ningún registro vigente en ningún nivel para este mensaje.
// ==========================================================================
async function obtenerRegistroVigenteParaCaptura({ usuarioId, grupoId }) {

    if (!validarUsuario(usuarioId)) {

        return null;

    }

    if (grupoId) {

        const especifico = await obtenerConfiguracion({ usuarioId, grupoId });

        if (registroVigente(especifico)) {

            return { nivel: "especifico", grupoId, config: especifico };

        }

    }

    const predeterminado = await obtenerConfiguracion({ usuarioId, grupoId: null });

    if (registroVigente(predeterminado)) {

        return { nivel: "predeterminado", grupoId: null, config: predeterminado };

    }

    return null;

}

module.exports = {

    MINUTOS_EXPIRACION_REGISTRO_DEFECTO,

    obtenerConfiguracion,
    registroVigente,
    activarModoRegistro,
    desactivarModoRegistro,
    guardarStickerCapturado,
    limpiarStickerConfigurado,

    resolverStickerPago,
    obtenerRegistroVigenteParaCaptura

};
