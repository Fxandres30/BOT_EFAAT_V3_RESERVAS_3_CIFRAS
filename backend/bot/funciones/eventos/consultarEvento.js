const supabase = require("../../../lib/supabase");
const { eliminado, vigente } = require("../../../shared/eventos/estadosGestion");

// Sorteo (eventos_bot) de un grupo PARA UN CLIENTE. usuarioId es el dueño
// validado de la sesión que recibió el mensaje (sock.context.usuarioId) o
// del sorteo programado — nunca algo inferido del mensaje.
//
// Multisesión (2026-10-21): con varios WhatsApp conectados a la vez, el de
// otro cliente puede estar en el mismo grupo. Sin el filtro, ese otro
// cliente leería (y guardarEvento.js reescribiría) el sorteo de este. Sin
// dueño: null (falla cerrado).
//
// Varias filas por grupo y cliente (2026-10-23): cada sorteo programado
// distinto tiene su propia fila (publicador.js), así que el grupo conserva
// las de sus sorteos anteriores. Se devuelve el sorteo ACTIVO; si no hay
// ninguno, el más reciente — el mismo que devolvía la consulta cuando solo
// existía una fila (pagos y consultas después del cierre).
async function consultarEvento(grupoId, usuarioId) {

    if (!grupoId || !usuarioId) {

        if (grupoId) console.error("❌ [EVENTO] consulta sin dueño (usuario_id): no se devuelve ningún sorteo del grupo.");

        return null;

    }

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("usuario_id", usuarioId)
        .order("creado_en", { ascending: false });

    if (error) {

        console.log(error.message);

        return null;

    }

    // Un sorteo eliminado desde el panel (eliminación lógica) ya no es el
    // sorteo de nadie: se ignora su fila.
    const filas = (data || []).filter(f => !eliminado(f));

    // El activo de verdad: una fila que un reintento antiguo dejó con
    // activo=true después de cerrarla (cierre_estado "cerrado") no gana al
    // sorteo en curso. Sin ninguno, el más reciente (historia: el llamador
    // decide qué hacer con un sorteo terminado).
    // Motor de rifas (MOTOR_RIFAS=nuevo): con DOS o más sorteos vigentes en
    // el grupo no se elige «el más reciente»: el mensaje es ambiguo y no se
    // procesa (docs/rifas/MOTOR_RIFAS.md §6). Se avisa en el registro.
    const vigentes = filas.filter(vigente);
    if (vigentes.length > 1 && require("../../../rifas/motor").motorNuevo()) {
        console.error(`🛑 [RIFAS] el grupo ${grupoId} tiene ${vigentes.length} sorteos vigentes del mismo cliente (${vigentes.map(v => v.id).join(", ")}): mensaje ambiguo, no se procesa. Cierra uno en el panel.`);
        return null;
    }

    return vigentes[0] || filas[0] || null;

}

// Fila de ESTE sorteo (identidad) en el grupo, para reintentar su
// publicación sin duplicarla. Nunca devuelve la fila de otro sorteo.
// { ok: true, data: fila | null } | { ok: false } ante un error de lectura.
async function consultarEventoDelSorteo(grupoId, usuarioId, identidad) {

    if (!grupoId || !usuarioId || !identidad) return { ok: false };

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("usuario_id", usuarioId)
        .eq("identidad_evento_real", identidad)
        .order("creado_en", { ascending: false })
        .limit(1);

    if (error) {

        console.error("❌ [EVENTO] no se pudo buscar el sorteo del grupo:", error.message);

        return { ok: false };

    }

    return { ok: true, data: data?.[0] || null };

}

module.exports = {
    consultarEvento,
    consultarEventoDelSorteo
};
