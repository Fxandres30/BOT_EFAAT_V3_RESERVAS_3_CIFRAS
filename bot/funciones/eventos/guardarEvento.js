const supabase = require("../../../lib/supabase");

async function guardarEvento({

    sock,
    grupoId,
    evento,
    eventoAnterior

}) {

    console.log("====================================");
    console.log("💾 GUARDAR EVENTO");
    console.log("====================================");

    let grupoNombre = null;
    let participantes = 0;
    let descripcionGrupo = null;

    try {

        const metadata = await sock.groupMetadata(grupoId);

        grupoNombre = metadata.subject;
        participantes = metadata.participants?.length || 0;
        descripcionGrupo = metadata.desc || null;

    } catch (err) {

        console.log("⚠ No se pudo obtener la información del grupo");
        console.error(err);

    }

    const context = sock.context || {};

    console.log("📌 Context:");
    console.log(context);

    console.log("📌 Evento:");
    console.log(evento);

    console.log("📌 Evento anterior:");
    console.log(eventoAnterior);

    const hoy = new Date().toISOString().split("T")[0];

    const datos = {

        usuario_id: context.usuarioId ?? null,

        session_id: context.sessionId ?? null,

        telefono_bot: context.telefono ?? null,

        grupo_id: grupoId,

        grupo_nombre: grupoNombre,

        participantes,

        descripcion_grupo: descripcionGrupo,

        nombre_evento: evento.nombre,

        hora_fin: evento.hora,

        hora_cierre: evento.horaCierre,

        fecha_evento: hoy,

        estado: "abierto",

        valor: evento.valor,

        premios: evento.premios,

        tabla: evento.tabla,

        cifras: evento.cifras,

        cantidad_numeros: evento.cantidad_numeros,

        actualizado_en: new Date()

    };

    console.log("📦 Datos a guardar:");
    console.log(datos);

    // ===============================
    // ACTUALIZAR
    // ===============================

    if (eventoAnterior) {

        console.log("♻ Actualizando evento...");

        const { data, error } = await supabase
            .from("eventos_bot")
            .update(datos)
            .eq("id", eventoAnterior.id)
            .select()
            .single();

        if (error) {

            console.log("❌ Error actualizando evento");
            console.error(error);

            return null;

        }

        console.log("✅ Evento actualizado");
        console.log(data);

        return data;

    }

    // ===============================
    // CREAR
    // ===============================

    console.log("🆕 Creando nuevo evento...");

    const { data, error } = await supabase
        .from("eventos_bot")
        .insert({

            ...datos,

            creado_en: new Date(),

            reservados: 0,

            pagados: 0,

            pendientes: 0,

            libres: evento.cantidad_numeros,

            activo: true,

            abierto: true

        })
        .select()
        .single();

    if (error) {

        console.log("❌ Error creando evento");
        console.error(error);

        return null;

    }

    console.log("✅ Evento creado correctamente");
    console.log(data);

    return data;

}

module.exports = {

    guardarEvento

};