import { supabase } from "@/lib/supabase";

// configuracion_stickers_pago — SIN cambios de esquema respecto a
// backend/supabase_migrations/011_configuracion_stickers_pago.sql.
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
    grupo_id: string;
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

export async function obtenerConfiguracionStickerPago(usuarioId: string, grupoId: string) {

    return await supabase
        .from("configuracion_stickers_pago")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .maybeSingle();

}

// Inicia (o reinicia) el modo de registro. Upsert sobre
// unique(usuario_id, grupo_id) — mismo patrón exacto que
// automationConfigs.guardarConfiguracion() / gruposAutorizados.autorizarGrupo().
// NUNCA toca sticker_sha256/registrado_en/registrado_por: eso solo lo
// escribe el backend al capturar el sticker real.
export async function activarRegistroStickerPago(usuarioId: string, grupoId: string) {

    const expira = new Date(Date.now() + MINUTOS_EXPIRACION_REGISTRO * 60 * 1000);

    return await supabase
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

}

// Cancela un registro en curso SIN tocar un sticker ya guardado — caso
// "tenía un sticker, pulsé Reemplazar, me arrepentí y cancelé": el sticker
// anterior debe quedar exactamente como estaba.
export async function cancelarRegistroStickerPago(usuarioId: string, grupoId: string) {

    return await supabase
        .from("configuracion_stickers_pago")
        .update({
            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()
        })
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .select()
        .maybeSingle();

}

// Desactiva el sticker configurado. NO borra la fila (solo actualiza sus
// columnas) — mismo criterio que el resto del panel nunca elimina filas de
// configuración innecesariamente (ver automationConfigs.ts, gruposAutorizados.ts).
export async function desactivarStickerPago(usuarioId: string, grupoId: string) {

    return await supabase
        .from("configuracion_stickers_pago")
        .update({
            sticker_sha256: null,
            registrado_en: null,
            registrado_por: null,
            esperando_registro: false,
            esperando_registro_expira_en: null,
            actualizado_en: new Date().toISOString()
        })
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .select()
        .maybeSingle();

}
