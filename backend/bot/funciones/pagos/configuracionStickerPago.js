// ==========================================================================
// configuracionStickerPago.js — FASE 1 (sticker de pago configurable desde
// el panel). ÚNICA fuente de verdad de persistencia para
// "configuracion_stickers_pago" — ningún otro módulo debe leer/escribir
// esa tabla directamente (mismo criterio arquitectónico que
// obtenerUsuarioGlobal.js para "usuarios").
//
// Responsabilidades (y solo estas):
//   - obtener configuración
//   - activar modo de registro
//   - comprobar si el registro está vigente
//   - guardar el fileSha256 capturado
//   - desactivar el modo de registro
//   - limpiar una configuración (des-registrar el sticker guardado)
//   - validar usuario_id + grupo_id
//
// Explícitamente NO hace nada de: cálculo de deuda, pagos parciales,
// matching bancario, pagos_movimientos, ni decide NADA sobre reservas —
// eso sigue siendo exclusivo de confirmarPagoPorSticker.js /
// marcarReservasPagadasPorAdmin.js, que esta fase no modifica en su lógica
// de negocio.
// ==========================================================================

const supabase = require("../../../lib/supabase");

// Mismo criterio de expiración corta que YA usa el proyecto para "algo
// temporal que espera una acción del lado de WhatsApp": el QR de conexión
// expira en 2 minutos (services/baileys/qr.js). No se inventa una
// duración distinta para el modo de registro.
const MINUTOS_EXPIRACION_REGISTRO_DEFECTO = 2;

function validarClave({ usuarioId, grupoId }) {

    return !!usuarioId && !!grupoId;

}

// Lectura simple — usada tanto por registrarStickerPago.js (para saber si
// hay un registro vigente) como por confirmarPagoPorSticker.js (para
// obtener el hash configurado).
async function obtenerConfiguracion({ usuarioId, grupoId }) {

    if (!validarClave({ usuarioId, grupoId })) {

        return null;

    }

    const { data, error } = await supabase
        .from("configuracion_stickers_pago")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .maybeSingle();

    if (error) {

        console.error("❌ [STICKER-PAGO] Error consultando configuracion_stickers_pago:", error.message);

        return null;

    }

    return data;

}

// Pura: decide si un registro está vigente AHORA. El vencimiento se decide
// siempre en código (comparando con Date.now()), nunca en SQL — mismo
// criterio que el resto del proyecto (p. ej. verificarHoraCierre.js).
function registroVigente(config) {

    if (!config) return false;

    if (config.esperando_registro !== true) return false;

    if (!config.esperando_registro_expira_en) return false;

    return new Date(config.esperando_registro_expira_en).getTime() > Date.now();

}

// Activa (o reactiva) el modo de registro para (usuario_id, grupo_id).
// Upsert sobre unique(usuario_id, grupo_id) — mismo patrón exacto que
// automation_configs.guardarConfiguracion() / grupos_autorizados.autorizarGrupo()
// en el frontend: no le importa a quien llama si la fila ya existía.
async function activarModoRegistro({ usuarioId, grupoId, minutos = MINUTOS_EXPIRACION_REGISTRO_DEFECTO }) {

    if (!validarClave({ usuarioId, grupoId })) {

        return { ok: false, error: "usuario_id y grupo_id son obligatorios" };

    }

    const expira = new Date(Date.now() + minutos * 60 * 1000);

    const { data, error } = await supabase
        .from("configuracion_stickers_pago")
        .upsert(
            {
                usuario_id: usuarioId,
                grupo_id: grupoId,
                esperando_registro: true,
                esperando_registro_expira_en: expira.toISOString(),
                actualizado_en: new Date().toISOString()
            },
            { onConflict: "usuario_id,grupo_id" }
        )
        .select()
        .single();

    if (error) {

        console.error("❌ [STICKER-PAGO] Error activando modo de registro:", error.message);

        return { ok: false, error: error.message };

    }

    return { ok: true, configuracion: data };

}

// Apaga el modo de registro sin tocar el sticker ya guardado (si lo hay).
// Se usa tanto para cancelar manualmente desde el panel como para limpiar
// una ventana vencida (ver registrarStickerPago.js) — en ambos casos el
// UPDATE está condicionado a (usuario_id, grupo_id) exactos, así que NUNCA
// afecta la configuración de otro grupo/tenant.
async function desactivarModoRegistro({ usuarioId, grupoId }) {

    if (!validarClave({ usuarioId, grupoId })) {

        return { ok: false, error: "usuario_id y grupo_id son obligatorios" };

    }

    const { error } = await supabase
        .from("configuracion_stickers_pago")
        .update({

            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()

        })
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId);

    if (error) {

        console.error("❌ [STICKER-PAGO] Error desactivando modo de registro:", error.message);

        return { ok: false, error: error.message };

    }

    return { ok: true };

}

// Guarda el hash capturado — SOLO si esperando_registro seguía true en la
// base de datos en el momento exacto del UPDATE (condición en el propio
// WHERE, no una comprobación previa por separado). Mismo criterio atómico
// que marcarReservasPagadasPorAdmin.js: si dos stickers casi simultáneos
// compiten por la misma ventana, el segundo UPDATE no encuentra fila que
// coincida y devuelve 0 filas — no hay carrera posible.
async function guardarStickerCapturado({ usuarioId, grupoId, stickerSha256, registradoPor }) {

    if (!validarClave({ usuarioId, grupoId }) || !stickerSha256) {

        return { ok: false, error: "usuario_id, grupo_id y stickerSha256 son obligatorios" };

    }

    const { data, error } = await supabase
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
        .eq("grupo_id", grupoId)
        .eq("esperando_registro", true)
        .select();

    if (error) {

        console.error("❌ [STICKER-PAGO] Error guardando sticker capturado:", error.message);

        return { ok: false, error: error.message };

    }

    if (!data || data.length === 0) {

        // El registro ya no estaba vigente en la BD al momento del UPDATE
        // (otra ejecución lo ganó primero, o venció justo antes) — no es un
        // error, simplemente no se guarda dos veces.
        return { ok: false, motivo: "registro_ya_no_vigente" };

    }

    return { ok: true, configuracion: data[0] };

}

// "Limpiar una configuración": des-registra el sticker guardado (para
// volver a registrar uno distinto desde cero). NO toca esperando_registro
// — activar un nuevo registro es responsabilidad explícita de
// activarModoRegistro().
async function limpiarStickerConfigurado({ usuarioId, grupoId }) {

    if (!validarClave({ usuarioId, grupoId })) {

        return { ok: false, error: "usuario_id y grupo_id son obligatorios" };

    }

    const { error } = await supabase
        .from("configuracion_stickers_pago")
        .update({

            sticker_sha256: null,
            registrado_en: null,
            registrado_por: null,
            actualizado_en: new Date().toISOString()

        })
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId);

    if (error) {

        console.error("❌ [STICKER-PAGO] Error limpiando configuración:", error.message);

        return { ok: false, error: error.message };

    }

    return { ok: true };

}

// Único punto que usa confirmarPagoPorSticker.js para obtener el hash
// vigente. Nunca cae a otro grupo/tenant ni a ningún valor por defecto:
// sin fila, o sin sticker_sha256 guardado, devuelve null — el llamador
// debe fallar cerrado (no confirmar ningún pago).
async function obtenerStickerConfigurado({ usuarioId, grupoId }) {

    const config = await obtenerConfiguracion({ usuarioId, grupoId });

    if (!config?.sticker_sha256) {

        return null;

    }

    return String(config.sticker_sha256).trim().toLowerCase();

}

module.exports = {

    MINUTOS_EXPIRACION_REGISTRO_DEFECTO,

    validarClave,
    obtenerConfiguracion,
    registroVigente,
    activarModoRegistro,
    desactivarModoRegistro,
    guardarStickerCapturado,
    limpiarStickerConfigurado,
    obtenerStickerConfigurado

};
