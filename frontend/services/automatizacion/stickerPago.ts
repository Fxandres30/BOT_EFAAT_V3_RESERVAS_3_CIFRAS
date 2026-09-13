import { supabase } from "@/lib/supabase";

// configuracion_stickers_pago — ver
// backend/supabase_migrations/011_configuracion_stickers_pago.sql y
// backend/supabase_migrations/013_configuracion_stickers_pago_predeterminado.sql.
//
// DOS NIVELES:
//   Nivel 1 — predeterminado: grupo_id = null. Un único sticker por
//             tenant, válido para cualquier grupo sin uno específico.
//   Nivel 2 — específico: grupo_id = JID real del grupo. Prioridad sobre
//             el predeterminado para ESE grupo exacto.
// La resolución de prioridad (específico > predeterminado) es responsabilidad
// exclusiva del backend (backend/bot/funciones/pagos/configuracionStickerPago.js
// :resolverStickerPago) — este archivo solo lee/activa/cancela/desactiva,
// nunca decide cuál "gana".
//
// Reparto de responsabilidades (a propósito, no se toca en este archivo):
//   - sticker_sha256 / registrado_en / registrado_por SOLO los escribe el
//     backend (backend/bot/funciones/pagos/registrarStickerPago.js), con
//     la service role, cuando captura un sticker real de WhatsApp.
//   - Este servicio (panel, usuario autenticado, sujeto a RLS
//     auth.uid()=usuario_id) SOLO activa/cancela el modo de registro y
//     desactiva el sticker ya guardado — nunca envía un hash.
export interface ConfiguracionStickerPago {
    id: string;
    usuario_id: string;
    grupo_id: string | null;
    sticker_sha256: string | null;
    registrado_en: string | null;
    registrado_por: string | null;
    esperando_registro: boolean;
    esperando_registro_expira_en: string | null;
    creado_en: string;
    actualizado_en: string;
}

// Mismo valor que backend/bot/funciones/pagos/configuracionStickerPago.js
// (MINUTOS_EXPIRACION_REGISTRO_DEFECTO) — se repite aquí solo para mostrar
// el mensaje correcto en el panel ("disponible durante 2 minutos"). La
// expiración REAL la decide siempre el backend comparando
// esperando_registro_expira_en contra la hora del servidor, nunca este
// valor de texto.
export const MINUTOS_EXPIRACION_REGISTRO = 2;

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

export async function obtenerConfiguracionStickerPago(usuarioId: string, grupoId: string | null) {

    const query = supabase
        .from("configuracion_stickers_pago")
        .select("*")
        .eq("usuario_id", usuarioId);

    return grupoId
        ? await query.eq("grupo_id", grupoId).maybeSingle()
        : await query.is("grupo_id", null).maybeSingle();

}

// Inicia (o reinicia) el modo de registro del nivel indicado (grupoId=null
// -> predeterminado; grupoId=<jid> -> específico de ese grupo).
//
// NO usa upsert(): un índice único PARCIAL (grupo_id IS NULL / IS NOT
// NULL, ver migración 013) no puede ser destino de un
// upsert(onConflict:"usuario_id,grupo_id") — Postgres solo infiere el
// conflicto de un ON CONFLICT por columnas contra un índice NO parcial en
// esas columnas exactas. Se usa el mismo patrón que ya usa el backend para
// esto (insertar optimista -> 23505 -> actualizar esa fila).
export async function activarRegistroStickerPago(usuarioId: string, grupoId: string | null) {

    const expira = new Date(Date.now() + MINUTOS_EXPIRACION_REGISTRO * 60 * 1000).toISOString();
    const ahora = new Date().toISOString();

    const insertado = await supabase
        .from("configuracion_stickers_pago")
        .insert({
            usuario_id: usuarioId,
            grupo_id: grupoId,
            esperando_registro: true,
            esperando_registro_expira_en: expira,
            actualizado_en: ahora
        })
        .select()
        .single();

    if (!insertado.error) {
        return insertado;
    }

    if (insertado.error.code !== CODIGO_VIOLACION_UNICA_POSTGRES) {
        return insertado;
    }

    // Ya existía una fila para este nivel — se reutiliza, nunca se duplica.
    const query = supabase
        .from("configuracion_stickers_pago")
        .update({
            esperando_registro: true,
            esperando_registro_expira_en: expira,
            actualizado_en: ahora
        })
        .eq("usuario_id", usuarioId);

    return grupoId
        ? await query.eq("grupo_id", grupoId).select().maybeSingle()
        : await query.is("grupo_id", null).select().maybeSingle();

}

// Cancela un registro en curso del nivel indicado SIN tocar un sticker ya
// guardado — caso "tenía un sticker, pulsé Reemplazar, me arrepentí y
// cancelé": el sticker anterior debe quedar exactamente como estaba.
export async function cancelarRegistroStickerPago(usuarioId: string, grupoId: string | null) {

    const query = supabase
        .from("configuracion_stickers_pago")
        .update({
            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()
        })
        .eq("usuario_id", usuarioId);

    return grupoId
        ? await query.eq("grupo_id", grupoId).select().maybeSingle()
        : await query.is("grupo_id", null).select().maybeSingle();

}

// Desactiva el sticker configurado del nivel indicado. NO borra la fila
// (solo actualiza sus columnas) — mismo criterio que el resto del panel
// nunca elimina filas de configuración innecesariamente (ver
// automationConfigs.ts, gruposAutorizados.ts).
export async function desactivarStickerPago(usuarioId: string, grupoId: string | null) {

    const query = supabase
        .from("configuracion_stickers_pago")
        .update({
            sticker_sha256: null,
            registrado_en: null,
            registrado_por: null,
            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()
        })
        .eq("usuario_id", usuarioId);

    return grupoId
        ? await query.eq("grupo_id", grupoId).select().maybeSingle()
        : await query.is("grupo_id", null).select().maybeSingle();

}
