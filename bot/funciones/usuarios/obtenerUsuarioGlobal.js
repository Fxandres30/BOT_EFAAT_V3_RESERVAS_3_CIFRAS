const supabase = require("../../../lib/supabase");

async function obtenerUsuarioGlobal({

    jid,
    telefono = null,
    lid = null,
    nombre = null

}) {

    // Extraer teléfono del JID
    if (!telefono && jid?.includes("@s.whatsapp.net")) {

        telefono = jid
            .replace("@s.whatsapp.net", "")
            .replace(/^57/, "");

    }

    // Extraer LID del JID
    if (!lid && jid?.includes("@lid")) {
        lid = jid;
    }

    let usuario = null;

    // ==========================
    // Buscar por LID
    // ==========================

    if (lid) {

        const { data } = await supabase

            .from("usuarios")

            .select("*")

            .eq("lid", lid)

            .maybeSingle();

        if (data) {
            usuario = data;
        }

    }

    // ==========================
    // Buscar por teléfono
    // ==========================

    if (!usuario && telefono) {

        const { data } = await supabase

            .from("usuarios")

            .select("*")

            .eq("telefono", telefono)

            .maybeSingle();

        if (data) {
            usuario = data;
        }

    }

    // ==========================
    // Existe
    // ==========================

    if (usuario) {

        const cambios = {};

        // Completar teléfono
        if (!usuario.telefono && telefono) {
            cambios.telefono = telefono;
        }

        // Completar LID
        if (!usuario.lid && lid) {
            cambios.lid = lid;
        }

        // Actualizar nombre
        if (nombre && usuario.nombre !== nombre) {
            cambios.nombre = nombre;
        }

        cambios.ultima_actividad = new Date();

        if (Object.keys(cambios).length > 0) {

            await supabase

                .from("usuarios")

                .update(cambios)

                .eq("id", usuario.id);

            usuario = {

                ...usuario,

                ...cambios

            };

        }

        return usuario;

    }

    // ==========================
    // Crear usuario
    // ==========================

    const { data: nuevo } = await supabase

        .from("usuarios")

        .insert({

            telefono,

            lid,

            nombre,

            ultima_actividad: new Date()

        })

        .select()

        .single();

    return nuevo;

}

module.exports = {
    obtenerUsuarioGlobal
};