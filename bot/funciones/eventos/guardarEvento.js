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

    }

    const context = sock.context || {};

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

         // 👇 AGREGA ESTO
    activo: true,
    abierto: true,

        valor: evento.valor,
        premios: evento.premios,
        tabla: evento.tabla,
        cifras: evento.cifras,
        cantidad_numeros: evento.cantidad_numeros,

        actualizado_en: new Date()

    };

    console.log("📋 Resumen del evento");

    console.table({

        grupo: grupoNombre,
        evento: evento.nombre,
        hora: evento.hora,
        valor: `$${evento.valor}`,
        premios: evento.premios.length,
        tabla: evento.tabla,
        participantes

    });

    // ===============================
    // ACTUALIZAR
    // ===============================

    if (eventoAnterior) {

        console.log(`♻ Actualizando: ${eventoAnterior.nombre_evento} → ${evento.nombre}`);

        const { data, error } = await supabase
            .from("eventos_bot")
            .update(datos)
            .eq("id", eventoAnterior.id)
            .select()
            .single();

        if (error) {

            console.log("❌ Error actualizando evento");
            console.dir(error, { depth: null });

            return null;

        }

        console.log("✅ Evento actualizado correctamente");

        return data;

    }

    // ===============================
    // CREAR
    // ===============================

    console.log(`🆕 Creando evento: ${evento.nombre}`);

    console.log("====================================");
    console.log("🧪 PROBANDO TABLA eventos_bot");
    console.log("====================================");

    const pruebaSelect = await supabase
        .from("eventos_bot")
        .select("*")
        .limit(1);

    console.log("RESULTADO SELECT:");
    console.dir(pruebaSelect, { depth: null });

    const registro = {

        ...datos,

        creado_en: new Date(),

        reservados: 0,

        pagados: 0,

        pendientes: 0,

        libres: evento.cantidad_numeros,

        activo: true,

        abierto: true

    };

    console.log("====================================");
    console.log("📦 DATOS A INSERTAR");
    console.log("====================================");
    console.dir(registro, { depth: null });

    const resultado = await supabase
        .from("eventos_bot")
        .insert(registro)
        .select();

    console.log("====================================");
    console.log("📥 RESPUESTA INSERT");
    console.log("====================================");
    console.dir(resultado, { depth: null });

    if (resultado.error) {

        console.log("❌ ERROR INSERTANDO EVENTO");
        console.dir(resultado.error, { depth: null });

        return null;

    }

    console.log("✅ EVENTO CREADO");
    console.dir(resultado.data, { depth: null });

    return resultado.data[0];

}

module.exports = {

    guardarEvento

};