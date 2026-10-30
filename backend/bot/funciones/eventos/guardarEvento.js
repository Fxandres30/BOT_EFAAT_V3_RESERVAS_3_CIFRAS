const supabase = require("../../../lib/supabase");
const { groupMetadata } = require("../../../services/baileys/groupQueue");
const { crearIdentidadEventoReal, fechaEventoHoy } = require("./identidadEventoReal");
const { finDelEvento } = require("../../../shared/eventos/estadosGestion");

// Datos del sorteo: los únicos que una detección o una publicación
// sincronizan sobre una fila existente, y solo si cambiaron. El ciclo de
// vida (estado, activo, abierto, cierre_*) tiene dueños propios: creación,
// cierre, panel, «Reabrir» y la confirmación de apertura de WhatsApp.
const CAMPOS_DE_ANUNCIO = [
    "nombre_evento", "hora_fin", "hora_cierre", "fecha_evento", "identidad_evento_real",
    "valor", "premios", "tabla", "cifras", "cantidad_numeros"
];
const CAMPOS_DE_GRUPO = ["grupo_nombre", "participantes", "descripcion_grupo"];
const CAMPOS_DE_SESION = ["usuario_id", "session_id", "telefono_bot"];

const CAMPOS_NUMERICOS = new Set(["valor", "cifras", "cantidad_numeros", "participantes"]);

// JSON con las claves ordenadas: jsonb no conserva su orden.
function jsonEstable(valor) {

    if (typeof valor === "string") {
        try { return jsonEstable(JSON.parse(valor)); } catch { return JSON.stringify(valor); }
    }

    if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`;

    if (valor && typeof valor === "object") {
        return `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${jsonEstable(valor[k])}`).join(",")}}`;
    }

    return JSON.stringify(valor ?? null);

}

function normalizar(campo, valor) {

    if (valor === null || valor === undefined || valor === "") return null;

    if (campo === "premios") return jsonEstable(valor);
    if (CAMPOS_NUMERICOS.has(campo)) return Number(valor);
    if (campo === "fecha_evento") return String(valor).slice(0, 10);

    if (campo === "hora_fin" || campo === "hora_cierre") {
        const hora = /^(\d{1,2}):(\d{2})/.exec(String(valor).trim());
        return hora ? `${hora[1].padStart(2, "0")}:${hora[2]}` : String(valor).trim();
    }

    return String(valor).trim();

}

// Solo lo que de verdad cambió. Lo que no se pudo leer (grupo sin metadata,
// socket sin contexto) no se compara: nunca borra un dato bueno.
function camposCambiados(anterior, datos, { grupoLeido }) {

    const campos = [
        ...CAMPOS_DE_ANUNCIO,
        ...(grupoLeido ? CAMPOS_DE_GRUPO : []),
        ...CAMPOS_DE_SESION.filter(c => datos[c] !== null)
    ];

    return Object.fromEntries(campos
        .filter(c => datos[c] !== undefined && normalizar(c, datos[c]) !== normalizar(c, anterior[c]))
        .map(c => [c, datos[c]]));

}

async function guardarEvento({

    sock,
    grupoId,
    evento,
    eventoAnterior,
    // Sorteo activo del que este anuncio es continuación (ver
    // identidadEventoReal.js::buscarSorteoVigente): conserva su identidad y
    // su fecha para no partir sus reservas/pagos en dos sorteos.
    sorteoVigente = null,
    // Fecha del sorteo según el anuncio (hoy, o mañana si se publicó de
    // noche una hora ya pasada — ver identidadEventoReal.js).
    fechaSorteo = null

}) {

    console.log("====================================");
    console.log("💾 GUARDAR EVENTO");
    console.log("====================================");

    let grupoNombre = null;
    let participantes = 0;
    let descripcionGrupo = null;
    let grupoLeido = false;

    try {

        // groupMetadata() es IQ -> pasa por la cola central para no
        // competir con abrir/cerrar grupo. try/catch existente intacto:
        // si falla, se sigue con grupoNombre=null (comportamiento previo).
        const metadata = await groupMetadata(sock, grupoId);

        grupoNombre = metadata.subject;
        participantes = metadata.participants?.length || 0;
        descripcionGrupo = metadata.desc || null;
        grupoLeido = true;

    } catch (err) {

        console.log("⚠ No se pudo obtener la información del grupo");

    }

    const context = sock.context || {};

    // Día operativo de Colombia (no UTC) — ver fechaEventoHoy(). Un sorteo
    // que continúa conserva la fecha con la que nació.
    const hoy = sorteoVigente?.fecha_evento || fechaSorteo || fechaEventoHoy();

    // Identidad del sorteo REAL (independiente del grupo) — mismo sorteo
    // anunciado en varios grupos produce el MISMO valor aquí, lo que
    // permite compartir/aislar correctamente la tabla física de reservas
    // entre esos grupos. Ver identidadEventoReal.js.
    const identidadEventoReal = sorteoVigente?.identidad_evento_real || crearIdentidadEventoReal({

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

        valor: evento.valor,
        premios: evento.premios,
        tabla: evento.tabla,
        cifras: evento.cifras,
        cantidad_numeros: evento.cantidad_numeros

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

        // Una fila terminada nunca vuelve a la vida por aquí: eso es «Reabrir».
        const fin = finDelEvento(eventoAnterior);

        if (fin) {

            console.log(`⛔ Evento ${eventoAnterior.id} ${fin}: no se actualiza ni se reactiva.`);

            return null;

        }

        const cambios = camposCambiados(eventoAnterior, datos, { grupoLeido });

        if (Object.keys(cambios).length === 0) {

            console.log(`⏭️ Sin cambios: ${eventoAnterior.nombre_evento}`);

            return eventoAnterior;

        }

        console.log(`♻ Actualizando: ${eventoAnterior.nombre_evento} → ${evento.nombre} (${Object.keys(cambios).join(", ")})`);

        cambios.actualizado_en = new Date();

        // Condicionado: si se cerró después de leerla, no se reabre.
        let { data, error } = await supabase
            .from("eventos_bot")
            .update(cambios)
            .eq("id", eventoAnterior.id)
            .eq("activo", true)
            .select();

        // Red de seguridad de despliegue: si la migración 015 (columna
        // identidad_evento_real) todavía no se aplicó en Supabase, Postgres
        // devuelve 42703 (columna inexistente) y SIN esto la actualización
        // del evento fallaría por completo — se reintenta una vez sin ese
        // campo para no romper la apertura/actualización real del evento
        // mientras se aplica la migración.
        if (error?.code === "42703") {

            console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — guardando el evento sin ella por ahora.");

            const { identidad_evento_real, ...cambiosSinIdentidad } = cambios;

            const reintento = await supabase
                .from("eventos_bot")
                .update(cambiosSinIdentidad)
                .eq("id", eventoAnterior.id)
                .eq("activo", true)
                .select();

            data = reintento.data;
            error = reintento.error;

        }

        if (error) {

            console.log("❌ Error actualizando evento");
            console.dir(error, { depth: null });

            return null;

        }

        if (!data?.length) {

            console.log(`⛔ Evento ${eventoAnterior.id}: dejó de estar activo mientras se guardaba; no se reactiva.`);

            return null;

        }

        console.log("✅ Evento actualizado correctamente");

        return data[0];

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

        estado: "abierto",

        creado_en: new Date(),

        actualizado_en: new Date(),

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