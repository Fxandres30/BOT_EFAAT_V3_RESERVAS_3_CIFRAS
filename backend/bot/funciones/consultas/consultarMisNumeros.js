const supabase = require("../../../lib/supabase");
const { reservaPerteneceAUsuario } = require("../usuarios/obtenerUsuarioGlobal");
const { soloDelCliente } = require("../reservas/filtroCliente");
const { vigente } = require("../../../shared/eventos/estadosGestion");
const { fechaEventoHoy } = require("../eventos/identidadEventoReal");

// ¿Este sorteo es el VIGENTE de su tabla? Solo un sorteo vigente genera
// obligaciones actuales: activo, sin cierre ni gestión (cerrado, cancelado,
// desactivado, eliminado, sustituido: finDelEvento) y que no sea de un día
// ya pasado — una fila que quedó activo=true porque el cierre no corrió
// (bot caído a la hora del sorteo) es historia, no el sorteo actual.
// Un sorteo terminado nunca se presenta como actual ni reconstruye deuda
// (error en producción 31/10/2026: «¿qué debo?» nombraba sorteos pasados).
// REGLA F2 (06/11/2026): «activo» = fuente única (estadosGestion.vigente).
// Antes bastaba con que la vigencia no hubiera terminado, así que una fila
// con activo NULL (histórica, «inerte para el bot») contaba como vigente y
// su deuda se presentaba como actual, aunque el pago por sticker ya la
// rechazaba. Ahora es cerrada (regla 4). Las reservas y los pagos de esa
// fila no cambian: solo deja de presentarse como el sorteo actual.
function sorteoVigente(evento, ahora = new Date()) {

    if (!vigente(evento)) return false;

    const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : null;

    return !fecha || fecha >= fechaEventoHoy(ahora);

}

// READ-ONLY. Busca por usuario_global_id (el identificador de dueño que
// reservarNumeros.js ya escribe en cada reserva) Y, como respaldo, por
// lid/telefono/contacto del mismo usuario ya resuelto — así una reserva
// HISTÓRICA guardada con usuario_global_id=NULL (antes de que existiera esa
// columna, o de una identidad todavía no completada ese día) pero con
// lid/telefono coincidentes sigue reconociéndose como del mismo usuario. No
// se inventa ningún criterio nuevo: es el mismo reservaPerteneceAUsuario()
// que ya usa validarReservas.js. UNA TABLA = UN SORTEO (31/10/2026): toda
// la cuadrícula del cliente (evento.tabla + usuario_id) es el sorteo, sin
// separar por identidad_evento_real, evento_id ni grupo_id (son historia).
//
// Única consulta real a Supabase para "los números de este usuario en este
// evento" — consultarMisNumerosPorEstado() la clasifica por estado y
// consultarMisNumeros() (compatibilidad) se apoya en esa misma función.
async function obtenerFilasDelUsuario({ evento, usuario }) {

    if (!evento?.tabla || !usuario?.id) {
        return [];
    }

    const condiciones = [`usuario_global_id.eq.${usuario.id}`];

    if (usuario.lid) {
        condiciones.push(`lid.eq.${usuario.lid}`);
    }

    if (usuario.telefono) {
        condiciones.push(`telefono.eq.${usuario.telefono}`);
        condiciones.push(`contacto.eq.${usuario.telefono}`);
    }

    let { data, error } = await soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("numero, estado, usuario_global_id, lid, telefono, contacto, identidad_evento_real")
            .or(condiciones.join(","))
            .neq("estado", "libre"),
        evento
    ).order("numero", { ascending: true });

    // Red de seguridad de despliegue: si la migración 015 (columna
    // identidad_evento_real) todavía no se aplicó en Supabase, Postgres
    // devuelve 42703 (columna inexistente) — se reintenta una vez sin
    // pedirla para no romper "mis números" mientras se aplica la migración.
    if (error?.code === "42703") {

        console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — consultando sin ella por ahora.");

        const reintento = await soloDelCliente(
            supabase
                .from(evento.tabla)
                .select("numero, estado, usuario_global_id, lid, telefono, contacto")
                .or(condiciones.join(","))
                .neq("estado", "libre"),
            evento
        ).order("numero", { ascending: true });

        data = reintento.data;
        error = reintento.error;

    }

    // null = no se pudo leer («no sé» no es «no tienes números»).
    if (error) {

        console.log("❌ Error consultando mis números:", error.message);

        return null;

    }

    // La consulta trae CANDIDATAS (cualquier fila con su id, LID o teléfono);
    // cada una se confirma con la regla única de pertenencia: una fila de
    // OTRO propietario con este teléfono no es suya (fuga 65/86).
    // Antes se descartaban las filas con otra identidad: un número del
    // cliente en esta misma tabla (reservado a mano, conservado de otro
    // ciclo...) no aparecía en «mis números» ni en «qué debo».
    return (data || []).filter(f => reservaPerteneceAUsuario(f, usuario));

}

// ÚNICA lógica de "números del cliente por estado de pago" — la usan TODAS
// las consultas de esta familia (mis_numeros, mis_reservas,
// cantidad_reservas, consulta_pago y multiple, ver resolverConsulta.js),
// siempre con UNA sola lectura. No inventa ningún estado: solo clasifica
// lo que ya trae la fila. Lista BLANCA a propósito: solo "reservado"
// (pendiente de pago) y "pagado" son números del cliente — un estado
// operativo del panel ("bloqueado", "en_proceso") nunca se cuenta como
// suyo ni como deuda.
//
// Si la lectura falla devuelve errorLectura: true (listas vacías): el
// llamador responde con un mensaje técnico, nunca «no tienes números».
async function consultarMisNumerosPorEstado({ evento, usuario }) {

    const filas = await obtenerFilasDelUsuario({ evento, usuario });

    if (filas === null) {
        return { total: 0, todos: [], reservados: [], pagados: [], errorLectura: true };
    }

    const reservados = filas.filter(f => f.estado === "reservado").map(f => f.numero);
    const pagados = filas.filter(f => f.estado === "pagado").map(f => f.numero);

    // Números de igual longitud (canonicalizados al reservar): sort()
    // lexicográfico = orden numérico.
    const todos = [...reservados, ...pagados].sort();

    return {
        total: todos.length,
        todos,
        reservados,
        pagados
    };

}

// ==========================================================================
// Deuda en OTROS sorteos VIGENTES del mismo cliente (tenant).
//
// "¿Qué debo?" se responde con el sorteo del grupo y, además, con lo
// pendiente en las demás TABLAS del cliente que tienen un sorteo VIGENTE
// (otro grupo, otro precio). Solo números todavía "reservado" del usuario;
// nunca otro tenant, nunca se modifica nada.
//
// Una tabla sin sorteo vigente (su último sorteo cerró, se canceló, se
// desactivó o quedó de un día pasado) NO aporta deuda: sus filas son
// historia. Antes se representaba cada tabla con su sorteo más reciente
// aunque hubiera terminado (bastaba con los últimos 30 días y no estar
// cancelado) y la respuesta nombraba sorteos pasados con sus números.
// ==========================================================================

// Nunca lanza. -> { ok, lista }: ok=false si alguna lectura falló (la
// lista trae lo que sí se pudo leer). Así «no tienes pendientes en otros
// sorteos» solo se afirma cuando de verdad se revisaron.
async function consultarPendientesOtrosSorteosVerificado(args) {

    try {
        return await leerPendientesOtrosSorteos(args);
    } catch (err) {
        console.log("⚠️ No se pudieron leer los pendientes de otros sorteos:", err?.message);
        return { ok: false, lista: [] };
    }

}

// Compatibilidad: solo la lista.
async function consultarPendientesOtrosSorteos(args) {

    return (await consultarPendientesOtrosSorteosVerificado(args)).lista;

}

async function leerPendientesOtrosSorteos({ evento, usuario, ahora = new Date() }) {

    if (!evento?.usuario_id || !usuario?.id) return { ok: true, lista: [] };

    const { data: eventos, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("usuario_id", evento.usuario_id)
        .eq("activo", true)
        .order("creado_en", { ascending: false })
        .limit(200);

    if (error) {
        console.log("⚠️ No se pudieron leer los otros sorteos del cliente:", error.message);
        return { ok: false, lista: [] };
    }

    // UNA TABLA = UN SORTEO (31/10/2026): la deuda se agrupa por TABLA, no
    // por identidad, y cada tabla la representa su sorteo VIGENTE (eventos
    // ya vienen del más nuevo al más viejo). La tabla de este evento solo se
    // salta si él es el vigente: sus números ya los cuenta «mis números».
    // Si el sorteo del grupo terminó y su tabla sigue viva con otro sorteo
    // (tabla conservada, otro grupo), esa deuda se informa con ESE sorteo.
    const tablaPropia = sorteoVigente(evento, ahora) ? evento.tabla : null;
    const porTabla = new Map();

    for (const e of eventos || []) {
        if (!e.tabla || e.tabla === tablaPropia || porTabla.has(e.tabla)) continue;
        if (sorteoVigente(e, ahora)) porTabla.set(e.tabla, e);
    }

    if (!porTabla.size) return { ok: true, lista: [] };

    const condiciones = [`usuario_global_id.eq.${usuario.id}`];
    if (usuario.lid) condiciones.push(`lid.eq.${usuario.lid}`);
    if (usuario.telefono) {
        condiciones.push(`telefono.eq.${usuario.telefono}`);
        condiciones.push(`contacto.eq.${usuario.telefono}`);
    }

    const resultado = [];
    let ok = true;

    for (const [tabla, e] of porTabla) {

        const { data, error: errorTabla } = await supabase
            .from(tabla)
            .select("numero, estado, usuario_global_id, lid, telefono, contacto")
            .eq("usuario_id", evento.usuario_id)
            .eq("estado", "reservado")
            .or(condiciones.join(","))
            .order("numero", { ascending: true });

        if (errorTabla) {
            console.log(`⚠️ No se pudieron leer los pendientes de otros sorteos en ${tabla}:`, errorTabla.message);
            ok = false;
            continue;
        }

        const numeros = (data || [])
            .filter(f => reservaPerteneceAUsuario(f, usuario))
            .map(f => f.numero)
            .sort();

        if (!numeros.length) continue;

        const valor = Number(e.valor) || 0;

        resultado.push({
            eventoId: e.id,
            identidad: e.identidad_evento_real || null,
            nombre: e.nombre_evento || null,
            hora_fin: e.hora_fin || null,
            fecha_evento: e.fecha_evento ? String(e.fecha_evento).slice(0, 10) : null,
            numeros,
            montoPendiente: valor > 0 ? numeros.length * valor : null
        });

    }

    // Más reciente primero (fecha del sorteo).
    return { ok, lista: resultado.sort((a, b) => String(b.fecha_evento || "").localeCompare(String(a.fecha_evento || ""))) };

}

// Compatibilidad: misma lectura, solo la lista de números.
async function consultarMisNumeros({ evento, usuario }) {

    const { todos } = await consultarMisNumerosPorEstado({ evento, usuario });

    return todos;

}

module.exports = {
    sorteoVigente,
    consultarMisNumeros,
    consultarMisNumerosPorEstado,
    consultarPendientesOtrosSorteos,
    consultarPendientesOtrosSorteosVerificado
};
