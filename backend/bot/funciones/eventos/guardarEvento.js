const supabase = require("../../../lib/supabase");
const { groupMetadata } = require("../../../services/baileys/groupQueue");
const { crearIdentidadEventoReal } = require("./identidadEventoReal");

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

        // groupMetadata() es IQ -> pasa por la cola central para no
        // competir con abrir/cerrar grupo. try/catch existente intacto:
        // si falla, se sigue con grupoNombre=null (comportamiento previo).
        const metadata = await groupMetadata(sock, grupoId);

        grupoNombre = metadata.subject;
        participantes = metadata.participants?.length || 0;
        descripcionGrupo = metadata.desc || null;

    } catch (err) {

        console.log("⚠ No se pudo obtener la información del grupo");

    }

    const context = sock.context || {};

    const hoy = new Date().toISOString().split("T")[0];

    // Identidad del sorteo REAL (independiente del grupo) — mismo sorteo
    // anunciado en varios grupos produce el MISMO valor aquí, lo que
    // permite compartir/aislar correctamente la tabla física de reservas
    // entre esos grupos. Ver identidadEventoReal.js.
    const identidadEventoReal = crearIdentidadEventoReal({

        usuario_id: context.usuarioId ?? null,
        nombre_evento: evento.nombre,
        hora_fin: evento.hora,
        valor: evento.valor,
        fecha_evento: hoy

    });

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

        identidad_evento_real: identidadEventoReal,

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

        let { data, error } = await supabase
            .from("eventos_bot")
            .update(datos)
            .eq("id", eventoAnterior.id)
            .select()
            .single();

        // Red de seguridad de despliegue: si la migración 015 (columna
        // identidad_evento_real) todavía no se aplicó en Supabase, Postgres
        // devuelve 42703 (columna inexistente) y SIN esto la actualización
        // del evento fallaría por completo — se reintenta una vez sin ese
        // campo para no romper la apertura/actualización real del evento
        // mientras se aplica la migración.
        if (error?.code === "42703") {

            console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — guardando el evento sin ella por ahora.");

            const { identidad_evento_real, ...datosSinIdentidad } = datos;

            const reintento = await supabase
                .from("eventos_bot")
                .update(datosSinIdentidad)
                .eq("id", eventoAnterior.id)
                .select()
                .single();

            data = reintento.data;
            error = reintento.error;

        }

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

    let resultado = await supabase
        .from("eventos_bot")
        .insert(registro)
        .select();

    // Misma red de seguridad de despliegue que en la rama de actualización
    // de arriba (ver comentario ahí) — evita que la CREACIÓN de un evento
    // nuevo falle por completo si la migración 015 todavía no se aplicó.
    if (resultado.error?.code === "42703") {

        console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — creando el evento sin ella por ahora.");

        const { identidad_evento_real, ...registroSinIdentidad } = registro;

        resultado = await supabase
            .from("eventos_bot")
            .insert(registroSinIdentidad)
            .select();

    }

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