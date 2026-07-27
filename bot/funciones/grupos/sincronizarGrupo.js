const supabase = require("../../../lib/supabase");

async function sincronizarGrupo({

    sock,
    grupoId

}) {

    try {

        // Obtener información actual del grupo desde WhatsApp
        const metadata = await sock.groupMetadata(grupoId);

        let enlace = null;

        try {

            const codigo = await sock.groupInviteCode(grupoId);

            enlace = `https://chat.whatsapp.com/${codigo}`;

        } catch (_) {

            // El bot puede no tener permisos
            enlace = null;

        }

        const registro = {

            jid: metadata.id,

            nombre: metadata.subject,

            descripcion: metadata.desc || null,

            enlace,

            owner: metadata.owner || null,

            participantes: metadata.participants?.length || 0,

            announce: metadata.announce ?? false,

            restrict: metadata.restrict ?? false,

            member_add_mode: metadata.memberAddMode ?? false,

            join_approval_mode: metadata.joinApprovalMode ?? false,

            actualizado_en: new Date()

        };

        // Buscar si ya existe
        const { data: grupoExistente } = await supabase

            .from("grupos")

            .select("id")

            .eq("jid", grupoId)

            .maybeSingle();

        // Si existe → actualizar
        if (grupoExistente) {

            const { data, error } = await supabase

                .from("grupos")

                .update(registro)

                .eq("id", grupoExistente.id)

                .select()

                .single();

            if (error) {

                console.error(error);

                return null;

            }

            console.log("🔄 Grupo actualizado:", data.nombre);

            return data;

        }

        // Si no existe → crear
        const { data, error } = await supabase

            .from("grupos")

            .insert({

                ...registro,

                activo: true,

                creado_en: new Date()

            })

            .select()

            .single();

        if (error) {

            console.error(error);

            return null;

        }

        console.log("✅ Grupo registrado:", data.nombre);

        return data;

    }

    catch (err) {

        console.error(err);

        return null;

    }

}

module.exports = {

    sincronizarGrupo

};