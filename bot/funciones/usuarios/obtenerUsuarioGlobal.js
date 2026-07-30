const supabase = require("../../../lib/supabase");

async function obtenerUsuarioGlobal({

    jid = null,
    telefono = null,
    lid = null,
    nombre = null

}) {

    // ==========================================
    // Normalizar valores
    // ==========================================

    jid = jid || null;
    telefono = telefono || null;
    lid = lid || null;
    nombre = nombre || null;

    if (jid === "null@s.whatsapp.net") jid = null;
    if (telefono === "null") telefono = null;
    if (lid === "null") lid = null;
    if (nombre === "null") nombre = null;

    // ==========================================
    // Extraer teléfono desde JID
    // ==========================================

    if (!telefono && jid && jid.includes("@s.whatsapp.net")) {

        telefono = jid
            .split("@")[0]
            .split(":")[0]
            .replace(/^57/, "");

    }

    // ==========================================
    // Extraer LID
    // ==========================================

    if (!lid && jid && jid.includes("@lid")) {

        lid = jid;

    }

    // ==========================================
    // Si no hay identificadores, salir
    // ==========================================

    if (!telefono && !lid) {

        console.log("⚠ Usuario sin teléfono ni LID");
        return null;

    }

    let usuario = null;

    // ==========================================
    // Buscar por LID
    // ==========================================

    if (lid) {

        const { data } = await supabase
            .from("usuarios")
            .select("*")
            .eq("lid", lid)
            .maybeSingle();

        if (data) usuario = data;

    }

    // ==========================================
    // Buscar por teléfono
    // ==========================================

    if (!usuario && telefono) {

        const { data } = await supabase
            .from("usuarios")
            .select("*")
            .eq("telefono", telefono)
            .maybeSingle();

        if (data) usuario = data;

    }

    // ==========================================
    // Actualizar usuario existente
    // ==========================================

    if (usuario) {

        const cambios = {};

        if (!usuario.telefono && telefono)
            cambios.telefono = telefono;

        if (!usuario.lid && lid)
            cambios.lid = lid;

        if (nombre && usuario.nombre !== nombre)
            cambios.nombre = nombre;

        cambios.ultima_actividad = new Date();

        if (Object.keys(cambios).length > 0) {

            const { error } = await supabase
                .from("usuarios")
                .update(cambios)
                .eq("id", usuario.id);

            if (!error) {

                usuario = {

                    ...usuario,
                    ...cambios

                };

            }

        }

        return usuario;

    }

    // ==========================================
    // Crear usuario
    // ==========================================

    const { data: nuevo, error } = await supabase
        .from("usuarios")
        .insert({

            telefono,
            lid,
            nombre,
            ultima_actividad: new Date()

        })
        .select()
        .single();

    if (error) {

        console.error("❌ Error creando usuario");
        console.error(error);

        return null;

    }

    return nuevo;

}

module.exports = {
    obtenerUsuarioGlobal
};