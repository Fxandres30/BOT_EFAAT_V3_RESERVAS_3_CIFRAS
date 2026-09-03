const supabase = require("../../../lib/supabase");

const TIEMPO_CACHE_MINUTOS = 10;

// Cache en memoria
const cacheGrupos = new Map();

// Grupos que actualmente se están sincronizando
const sincronizando = new Set();

async function sincronizarGrupo({

    sock,
    grupoId

}) {

    // Si ya se está sincronizando este grupo, devolver el cache si existe
    if (sincronizando.has(grupoId)) {

        const cache = cacheGrupos.get(grupoId);

        if (cache)
            return cache.data;

        return null;

    }

    // Revisar cache en memoria
    const cache = cacheGrupos.get(grupoId);

    if (cache) {

        const minutos =
            (Date.now() - cache.time) / 1000 / 60;

        if (minutos < TIEMPO_CACHE_MINUTOS)
            return cache.data;

    }

    sincronizando.add(grupoId);

    try {

        // Buscar grupo en Supabase
        const {

            data: grupoExistente,
            error: errorBusqueda

        } = await supabase

            .from("grupos")

            .select("*")

            .eq("jid", grupoId)

            .maybeSingle();

        if (errorBusqueda) {

            console.error(errorBusqueda);

            return null;

        }

        // Si Supabase tiene datos recientes, usar esos
        if (grupoExistente?.actualizado_en) {

            const ultimaActualizacion =
                new Date(grupoExistente.actualizado_en);

            const minutos =
                (Date.now() - ultimaActualizacion.getTime()) / 1000 / 60;

            if (minutos < TIEMPO_CACHE_MINUTOS) {

                cacheGrupos.set(grupoId, {

                    data: grupoExistente,
                    time: Date.now()

                });

                return grupoExistente;

            }

        }

        // Consultar WhatsApp SOLO cuando realmente sea necesario
        const metadata =
            await sock.groupMetadata(grupoId);

        let enlace =
            grupoExistente?.enlace || null;

        if (!enlace) {

            try {

                const codigo =
                    await sock.groupInviteCode(grupoId);

                enlace =
                    `https://chat.whatsapp.com/${codigo}`;

            } catch {

                enlace = null;

            }

        }

        const registro = {

            jid: metadata.id,

            nombre: metadata.subject,

            descripcion: metadata.desc || null,

            enlace,

            owner: metadata.owner || null,

            participantes:
                metadata.participants?.length || 0,

            announce:
                metadata.announce ?? false,

            restrict:
                metadata.restrict ?? false,

            member_add_mode:
                metadata.memberAddMode ?? false,

            join_approval_mode:
                metadata.joinApprovalMode ?? false,

            actualizado_en: new Date()

        };

        let resultado;

        if (grupoExistente) {

            const {

                data,
                error

            } = await supabase

                .from("grupos")

                .update(registro)

                .eq("id", grupoExistente.id)

                .select()

                .single();

            if (error) {

                console.error(error);

                resultado = grupoExistente;

            } else {

                console.log("🔄 Grupo actualizado:", data.nombre);

                resultado = data;

            }

        } else {

            const {

                data,
                error

            } = await supabase

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

            resultado = data;

        }

        // Guardar en cache
        cacheGrupos.set(grupoId, {

            data: resultado,
            time: Date.now()

        });

        return resultado;

    } catch (err) {

        if (err?.message?.includes("rate-overlimit")) {

            console.log("⚠️ WhatsApp limitó temporalmente groupMetadata().");

            // Si hay cache devolverlo
            const cache = cacheGrupos.get(grupoId);

            if (cache)
                return cache.data;

            return null;

        }

        console.error(err);

        const cache = cacheGrupos.get(grupoId);

        if (cache)
            return cache.data;

        return null;

    } finally {

        sincronizando.delete(grupoId);

    }

}

module.exports = {

    sincronizarGrupo

};