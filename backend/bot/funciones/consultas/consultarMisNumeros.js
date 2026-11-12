const supabase = require("../../../lib/supabase");
const { reservaPerteneceAUsuario } = require("../usuarios/obtenerUsuarioGlobal");
const { soloDelCliente } = require("../reservas/filtroCliente");
const { vigente } = require("../../../shared/eventos/estadosGestion");
const { fechaEventoHoy } = require("../eventos/identidadEventoReal");
const { motorNuevo } = require("../../../rifas/motor");
const rifasBot = require("../../../rifas/bot");

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

    // Motor nuevo: sus números en la rifa del sorteo (evento.tabla_id). Se
    // confirma cada fila con la misma regla de pertenencia de siempre.
    if (motorNuevo()) {
        if (!usuario?.id) return [];
        const filas = await rifasBot.filasDelTitular(evento, usuario);
        if (filas === null) return null;
        return filas.filter(f => reservaPerteneceAUsuario(f, usuario));
    }

    if (!evento?.tabla || !usuario?.id) {
        return [];
    }

    // AISLAMIENTO POR SORTEO (06/11/2026): ver filtroDelSorteo más abajo.
    const delSorteo = await filtroDelSorteo(evento);
    if (delSorteo === null) return null;

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
    return (data || []).filter(f => reservaPerteneceAUsuario(f, usuario) && delSorteo(f));

}

// ==========================================================================
// AISLAMIENTO POR SORTEO (06/11/2026). Una consulta («qué debo», «mis
// números», «cuántos tengo», «¿el 23 es mío?») responde EXCLUSIVAMENTE del
// sorteo del grupo (evento). Nunca se agregan otros sorteos del cliente.
//
// Tabla de USO EXCLUSIVO (ningún otro sorteo vigente del cliente en ella):
// rige UNA TABLA = UN SORTEO (31/10). Una fila sin identidad, de un ciclo
// conservado o reservada a mano es de la cuadrícula de este sorteo.
//
// Tabla COMPARTIDA (otro sorteo vigente del mismo cliente usa la misma
// tabla física: dos precios en 5k_15k o en reservas_dos_cifras): solo
// cuentan las filas con la identidad de ESTE sorteo. Una fila sin identidad
// o de un sorteo terminado podría ser de cualquiera de los dos: no se
// adivina y no se cuenta en ninguno (los datos no cambian).
//
// -> predicado (fila) => ¿es de este sorteo? | null si no se pudo leer (el
//    llamador no afirma nada).
// ==========================================================================
async function filtroDelSorteo(evento, ahora = new Date()) {

    const ajenas = await identidadesDeOtrosSorteos(evento, ahora);
    if (ajenas === null) return null;
    if (!ajenas.size) return () => true;

    const propia = evento.identidad_evento_real || null;
    return (fila) => Boolean(propia) && fila?.identidad_evento_real === propia;

}

// Identidades de los OTROS sorteos vigentes del cliente en evento.tabla.
// -> Set (vacío si la tabla es de uso exclusivo) | null si falló la lectura.
async function identidadesDeOtrosSorteos(evento, ahora = new Date()) {

    if (!evento?.usuario_id || !evento?.tabla) return new Set();

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("id, identidad_evento_real, tabla, activo, estado, cierre_estado, cierre_motivo, cerrado_en, fecha_evento, usuario_id")
        .eq("usuario_id", evento.usuario_id)
        .eq("tabla", evento.tabla)
        .eq("activo", true);

    if (error) {
        console.log("❌ No se pudieron leer los sorteos que comparten la tabla:", error.message);
        return null;
    }

    const propia = evento.identidad_evento_real || null;

    return new Set((data || [])
        .filter(e => e.id !== evento.id && e.identidad_evento_real && e.identidad_evento_real !== propia && sorteoVigente(e, ahora))
        .map(e => e.identidad_evento_real));

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

// Compatibilidad: misma lectura, solo la lista de números.
async function consultarMisNumeros({ evento, usuario }) {

    const { todos } = await consultarMisNumerosPorEstado({ evento, usuario });

    return todos;

}

module.exports = {
    sorteoVigente,
    consultarMisNumeros,
    consultarMisNumerosPorEstado,
    filtroDelSorteo
};
