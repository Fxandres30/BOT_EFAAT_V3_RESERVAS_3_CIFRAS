const supabase = require("../../../lib/supabase");
const { reservaPerteneceAUsuario } = require("../usuarios/obtenerUsuarioGlobal");
const { soloDelCliente } = require("../reservas/filtroCliente");

// READ-ONLY. Busca por usuario_global_id (el identificador de dueño que
// reservarNumeros.js ya escribe en cada reserva) Y, como respaldo, por
// lid/telefono/contacto del mismo usuario ya resuelto — así una reserva
// HISTÓRICA guardada con usuario_global_id=NULL (antes de que existiera esa
// columna, o de una identidad todavía no completada ese día) pero con
// lid/telefono coincidentes sigue reconociéndose como del mismo usuario. No
// se inventa ningún criterio nuevo: es el mismo reservaPerteneceAUsuario()
// que ya usa validarReservas.js. Se aísla por identidad_evento_real (ver
// más abajo) pero no por evento_id/grupo_id: sigue tratando evento.tabla
// completa (para el sorteo real de este evento) como el estado vigente (el
// cierre de evento no resetea las filas).
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

    if (error) {

        console.log("❌ Error consultando mis números:", error.message);

        return [];

    }

    // La consulta trae CANDIDATAS (cualquier fila con su id, LID o teléfono);
    // cada una se confirma con la regla única de pertenencia: una fila de
    // OTRO propietario con este teléfono no es suya (fuga 65/86).
    const filas = (data || []).filter(f => reservaPerteneceAUsuario(f, usuario));

    // Aísla del mismo sorteo real (independiente del grupo) — una reserva
    // del mismo usuario pero de OTRO evento/ciclo (mismo precio, tabla
    // física compartida) no debe mezclarse en "mis números" de este evento.
    // Ver identidadEventoReal.js. Una fila sin identidad todavía (dato
    // previo a esta migración) se sigue incluyendo, para no ocultar
    // reservas reales por falta de backfill.
    const identidad = evento.identidad_evento_real || null;

    return identidad
        ? filas.filter(f => !f.identidad_evento_real || f.identidad_evento_real === identidad)
        : filas;

}

// ÚNICA lógica de "números del cliente por estado de pago" — la usan TODAS
// las consultas de esta familia (mis_numeros, mis_reservas,
// cantidad_reservas, consulta_pago y multiple, ver resolverConsulta.js),
// siempre con UNA sola lectura. No inventa ningún estado: solo clasifica
// lo que ya trae la fila. Lista BLANCA a propósito: solo "reservado"
// (pendiente de pago) y "pagado" son números del cliente — un estado
// operativo del panel ("bloqueado", "en_proceso") nunca se cuenta como
// suyo ni como deuda.
async function consultarMisNumerosPorEstado({ evento, usuario }) {

    const filas = await obtenerFilasDelUsuario({ evento, usuario });

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
// Deuda en OTROS sorteos del mismo cliente (tenant).
//
// "¿Qué debo?" se responde con el sorteo del grupo (activo o el más
// reciente). Desde que cada sorteo tiene su propia fila (2026-10-23) y se
// puede publicar uno nuevo mientras el anterior sigue con pagos pendientes,
// esa respuesta decía "no debes nada" a quien sí debía números del sorteo
// anterior (o de otro grupo del mismo cliente). Aquí se leen SOLO los números
// todavía "reservado" (pendientes de pago) del usuario en los demás sorteos
// recientes del cliente: nunca otro tenant, nunca un sorteo cancelado o
// eliminado, nunca se modifica nada.
// ==========================================================================
const DIAS_OTROS_SORTEOS = 30;
const ESTADOS_SIN_DEUDA = new Set(["cancelado", "eliminado"]);

function momentoDe(fila) {
    const fechas = [fila.actualizado_en, fila.creado_en, fila.fecha_evento]
        .map(f => (f ? new Date(f).getTime() : NaN))
        .filter(Number.isFinite);
    return fechas.length ? Math.max(...fechas) : 0;
}

// Nunca lanza: ante cualquier fallo se responde solo con el sorteo actual.
async function consultarPendientesOtrosSorteos(args) {

    try {
        return await leerPendientesOtrosSorteos(args);
    } catch (err) {
        console.log("⚠️ No se pudieron leer los pendientes de otros sorteos (se responde solo el actual):", err?.message);
        return [];
    }

}

async function leerPendientesOtrosSorteos({ evento, usuario, ahora = new Date() }) {

    if (!evento?.usuario_id || !usuario?.id) return [];

    const { data: eventos, error } = await supabase
        .from("eventos_bot")
        .select("id, grupo_id, nombre_evento, hora_fin, fecha_evento, valor, tabla, identidad_evento_real, estado, creado_en, actualizado_en")
        .eq("usuario_id", evento.usuario_id)
        .order("creado_en", { ascending: false })
        .limit(200);

    if (error) {
        console.log("⚠️ No se pudieron leer los otros sorteos del cliente (se responde solo el actual):", error.message);
        return [];
    }

    const limite = ahora.getTime() - DIAS_OTROS_SORTEOS * 24 * 60 * 60 * 1000;

    // Un sorteo real (identidad) puede tener una fila por grupo: una entrada.
    const porIdentidad = new Map();

    for (const e of eventos || []) {
        if (!e.identidad_evento_real || !e.tabla) continue;
        if (e.identidad_evento_real === evento.identidad_evento_real) continue;
        if (ESTADOS_SIN_DEUDA.has(e.estado)) continue;
        if (momentoDe(e) < limite) continue;
        if (!porIdentidad.has(e.identidad_evento_real)) porIdentidad.set(e.identidad_evento_real, e);
    }

    // Una fila cancelada/eliminada en un grupo anula la deuda de ese sorteo
    // aunque otra fila del mismo sorteo siga sin ese estado.
    for (const e of eventos || []) {
        if (ESTADOS_SIN_DEUDA.has(e.estado)) porIdentidad.delete(e.identidad_evento_real);
    }

    if (!porIdentidad.size) return [];

    const condiciones = [`usuario_global_id.eq.${usuario.id}`];
    if (usuario.lid) condiciones.push(`lid.eq.${usuario.lid}`);
    if (usuario.telefono) {
        condiciones.push(`telefono.eq.${usuario.telefono}`);
        condiciones.push(`contacto.eq.${usuario.telefono}`);
    }

    const porTabla = new Map();
    for (const e of porIdentidad.values()) {
        porTabla.set(e.tabla, [...(porTabla.get(e.tabla) || []), e.identidad_evento_real]);
    }

    const resultado = [];

    for (const [tabla, identidades] of porTabla) {

        const { data, error: errorTabla } = await supabase
            .from(tabla)
            .select("numero, estado, usuario_global_id, lid, telefono, contacto, identidad_evento_real")
            .eq("usuario_id", evento.usuario_id)
            .in("identidad_evento_real", identidades)
            .eq("estado", "reservado")
            .or(condiciones.join(","))
            .order("numero", { ascending: true });

        if (errorTabla) {
            console.log(`⚠️ No se pudieron leer los pendientes de otros sorteos en ${tabla}:`, errorTabla.message);
            continue;
        }

        for (const identidad of identidades) {

            const numeros = (data || [])
                .filter(f => f.identidad_evento_real === identidad && reservaPerteneceAUsuario(f, usuario))
                .map(f => f.numero)
                .sort();

            if (!numeros.length) continue;

            const e = porIdentidad.get(identidad);
            const valor = Number(e.valor) || 0;

            resultado.push({
                eventoId: e.id,
                identidad,
                nombre: e.nombre_evento || null,
                hora_fin: e.hora_fin || null,
                fecha_evento: e.fecha_evento ? String(e.fecha_evento).slice(0, 10) : null,
                numeros,
                montoPendiente: valor > 0 ? numeros.length * valor : null
            });

        }

    }

    // Más reciente primero (fecha del sorteo).
    return resultado.sort((a, b) => String(b.fecha_evento || "").localeCompare(String(a.fecha_evento || "")));

}

// Compatibilidad: misma lectura, solo la lista de números.
async function consultarMisNumeros({ evento, usuario }) {

    const { todos } = await consultarMisNumerosPorEstado({ evento, usuario });

    return todos;

}

module.exports = {
    consultarMisNumeros,
    consultarMisNumerosPorEstado,
    consultarPendientesOtrosSorteos
};
