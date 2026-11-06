const supabase = require("../../../lib/supabase");
const { groupMetadata } = require("../../../services/baileys/groupQueue");
const { crearIdentidadEventoReal, fechaEventoHoy } = require("./identidadEventoReal");
const { finDelEvento } = require("../../../shared/eventos/estadosGestion");
const { esPrecioOcupado } = require("../../../shared/eventos/unSorteoPorPrecio");

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

// Permiso de reservas ya decidido para este sorteo en otro grupo (047). Lo
// toma de la fila vigente que continúa o, si no, de la fila más reciente de
// la misma identidad. null = no hay permiso guardado (o falta la 047): la
// fila nueva queda como siempre (NULL = «según el estado»). Nunca lanza.
const MODOS_PERMISO = ["segun_estado", "permitidas", "desactivadas"];
async function permisoReservasDelSorteo(usuarioId, identidad, sorteoVigente) {
    if (MODOS_PERMISO.includes(sorteoVigente?.reservas_modo)) return sorteoVigente.reservas_modo;
    if (!usuarioId || !identidad) return null;
    try {
        const { data, error } = await supabase.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", identidad)
            .order("actualizado_en", { ascending: false }).limit(1);
        if (error) return null;
        // El panel escribe el permiso en TODAS las filas del sorteo: basta la
        // más reciente.
        const modo = data?.[0]?.reservas_modo;
        return MODOS_PERMISO.includes(modo) ? modo : null;
    } catch {
        return null;
    }
}

// La fila ACTIVA de un sorteo en un grupo (la que protege la 049). Nunca lanza.
async function filaActivaDelSorteo(usuarioId, grupoId, identidad) {
    try {
        const { data, error } = await supabase.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("grupo_id", grupoId).eq("identidad_evento_real", identidad).eq("activo", true).limit(1);
        return error ? null : (data?.[0] || null);
    } catch {
        return null;
    }
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

            if (esPrecioOcupado(error)) console.log("⛔ La base rechazó el cambio: este precio ya tiene otro sorteo activo de este cliente (043). Hay que reemplazar el anterior antes.");

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

    // Permiso de reservas (F3-E, 047): es del SORTEO, no del grupo. Un grupo
    // que se suma a un sorteo ya configurado hereda el permiso de sus otras
    // filas (misma identidad); si no, quedaría «según el estado» solo en ese
    // grupo. Sin la 047 las filas no traen la columna y no se añade nada.
    const modoHeredado = await permisoReservasDelSorteo(registro.usuario_id, registro.identidad_evento_real, sorteoVigente);
    if (modoHeredado) registro.reservas_modo = modoHeredado;

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

        if (esPrecioOcupado(resultado.error)) console.log("⛔ La base rechazó el evento: este precio ya tiene otro sorteo activo de este cliente (043). Hay que reemplazar el anterior antes.");

        // C2 (F4-F), solo con la migración 049: otra operación creó a la vez
        // la fila ACTIVA de este sorteo en este grupo (índice único). No es un
        // fallo: se devuelve la fila ganadora en vez de crear otra.
        if (resultado.error?.code === "23505" && registro.identidad_evento_real) {
            const ganadora = await filaActivaDelSorteo(registro.usuario_id, grupoId, registro.identidad_evento_real);
            if (ganadora) {
                console.log(`🤝 Otra operación creó a la vez este sorteo en el grupo (049): se adopta su fila ${ganadora.id}.`);
                return ganadora;
            }
        }

        return null;

    }

    console.log("✅ EVENTO CREADO");
    console.dir(resultado.data, { depth: null });

    return resultado.data[0];

}

module.exports = {

    guardarEvento

};