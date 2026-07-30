const supabase = require("../../../lib/supabase");

const TIEMPO_CACHE_MINUTOS = 10;

async function sincronizarGrupo({

    sock,
    grupoId

}) {

    try {

        // Buscar si el grupo ya existe
        const { data: grupoExistente, error: errorBusqueda } = await supabase

            .from("grupos")

            .select("*")

            .eq("jid", grupoId)

            .maybeSingle();

        if (errorBusqueda) {

            console.error(errorBusqueda);
            return null;

        }

        // Si fue sincronizado hace menos de 10 minutos, no volver a consultar WhatsApp
        if (grupoExistente?.actualizado_en) {

            const ultimaActualizacion = new Date(grupoExistente.actualizado_en);
            const ahora = new Date();

            const minutos =
                (ahora - ultimaActualizacion) / 1000 / 60;

            if (minutos < TIEMPO_CACHE_MINUTOS) {

                return grupoExistente;

            }

        }

        // Obtener información actual del grupo
        const metadata = await sock.groupMetadata(grupoId);

        let enlace = grupoExistente?.enlace || null;

        // Solo consultar el enlace si aún no existe
        if (!enlace) {

            try {

                const codigo = await sock.groupInviteCode(grupoId);

                enlace = `https://chat.whatsapp.com/${codigo}`;

            } catch (_) {

                enlace = null;

            }

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

        // Actualizar
        if (grupoExistente) {

            const { data, error } = await supabase

                .from("grupos")

                .update(registro)

                .eq("id", grupoExistente.id)

                .select()

                .single();

            if (error) {

                console.error(error);
                return grupoExistente;

            }

            console.log("🔄 Grupo actualizado:", data.nombre);

            return data;

        }

        // Crear
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

    } catch (err) {

        if (err?.message?.includes("rate-overlimit")) {

            console.log("⚠️ WhatsApp limitó temporalmente groupMetadata().");

            return null;

        }

        console.error(err);

        return null;

    }

}

module.exports = {

    sincronizarGrupo

};