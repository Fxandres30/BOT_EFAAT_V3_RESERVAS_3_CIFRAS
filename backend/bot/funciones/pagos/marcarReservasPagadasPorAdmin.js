// ==========================================================================
// marcarReservasPagadasPorAdmin() — FASE 3 (confirmación de pago por
// sticker de administrador, ver AUDITORÍA sección H/I/J).
//
// ÚNICA función que ejecuta el cambio real reservado -> pagado para este
// flujo. Reutiliza el mismo patrón que YA usa el proyecto para esta
// transición (frontend/services/tablas/marcarPagado.ts: UPDATE condicionado
// a estado='reservado' + verificar cuántas filas volvieron) y el mismo
// patrón de auditoría que reservarNumeros.js (INSERT en reservas_actividad,
// best-effort, nunca revierte el cambio ya guardado si la auditoría falla).
//
// No inventa una tabla nueva: la fuente de verdad sigue siendo evento.tabla
// (la tabla dinámica del evento), exactamente como en todo el resto del
// bot.
//
// Devuelve siempre uno de estos 3 resultados (nunca lanza):
//   { estado: "sin_reservas",  actualizadas: [] }  -> el cliente no tiene
//         NINGUNA fila (ni reservada ni pagada) para este evento.
//   { estado: "ya_pagado",     actualizadas: [] }  -> el cliente tiene filas
//         para este evento, pero NINGUNA en 'reservado' (ya estaban todas
//         pagadas, o una ejecución concurrente ya las pagó primero).
//   { estado: "confirmado",    actualizadas: [...] } -> se marcaron como
//         pagadas SOLO las filas que de verdad estaban en 'reservado'.
//   { estado: "error" }                              -> fallo de Supabase.
// ==========================================================================

const supabase = require("../../../lib/supabase");

// ==========================================================================
// CORRECCIÓN (auditoría "kellyJ🥰" / compradores_semanales.whatsapp=null,
// 2026-09): esta función SOLO actualizaba estado/fecha_pago/hora_pago —
// nunca refrescaba contacto/telefono/nombre/lid de la fila, aunque
// `usuario` (la identidad YA resuelta, ver confirmarPagoPorSticker.js) haya
// llegado con datos que la fila no tenía al momento de la reserva (p. ej.
// un cliente que reservó siendo "solo LID" y luego, antes del pago, su
// teléfono ya quedó asociado en "usuarios" por otra vía). Un TRIGGER de
// Postgres (fuera de este repo, ver supabase_migrations/
// 016_permisos_compradores_semanales.sql) copia estas columnas a
// compradores_semanales exactamente cuando estado pasa a 'pagado' — si la
// fila seguía con contacto=null, el trigger escribía whatsapp=null aunque
// ya existiera un teléfono real para ese usuario.
//
// calcularCamposIdentidadARellenar() decide qué columnas puede completar
// este pago SIN sobrescribir NADA ya guardado: mismo criterio que
// obtenerUsuarioGlobal.js ("un campo ya asignado nunca se sobrescribe con
// un valor distinto, solo se completa si está vacío"), aplicado aquí sobre
// TODAS las filas que se van a marcar pagadas a la vez (mismo cliente,
// mismo evento). Si `usuario` no trae teléfono (identidad "solo LID" que
// nunca se resolvió), simplemente no se agrega ninguna columna — el pago
// se confirma exactamente igual, sin inventar ni bloquear nada.
// ==========================================================================
function calcularCamposIdentidadARellenar(filasExistentes, usuario) {

    function puedeRellenar(campo, valorNuevo) {

        if (!valorNuevo) return false;

        // Ninguna de las filas que se van a marcar pagadas puede tener YA
        // un valor DISTINTO (no vacío) para este campo — si alguna lo
        // tiene, no se toca ninguna (mejor no arriesgar un dato mezclado
        // que forzar un refresco parcial).
        return filasExistentes.every(f => !f[campo] || f[campo] === valorNuevo);

    }

    const campos = {};

    // Teléfono: se guarda duplicado en dos columnas históricas de la tabla
    // dinámica (ver reservarNumeros.js) — se completan ambas si se puede,
    // porque no está confirmado cuál de las dos lee el trigger externo.
    if (puedeRellenar("contacto", usuario.telefono)) campos.contacto = usuario.telefono;
    if (puedeRellenar("telefono", usuario.telefono)) campos.telefono = usuario.telefono;

    // Nombre: mismo caso, duplicado en "comprador" y "nombre".
    if (puedeRellenar("comprador", usuario.nombre)) campos.comprador = usuario.nombre;
    if (puedeRellenar("nombre", usuario.nombre)) campos.nombre = usuario.nombre;

    if (puedeRellenar("lid", usuario.lid)) campos.lid = usuario.lid;

    return campos;

}

async function marcarReservasPagadasPorAdmin({ evento, usuario, realizadoPor }) {

    if (!evento?.tabla || !evento?.id || !usuario?.id) {

        return { estado: "error", actualizadas: [] };

    }

    // ======================================================================
    // 1. Clasificar el estado ACTUAL de las reservas de este cliente en
    //    ESTE evento — solo para elegir el mensaje correcto ("sin reservas"
    //    vs "ya pagado"). El cambio real de datos NUNCA depende de esta
    //    lectura: depende exclusivamente del WHERE del UPDATE de abajo.
    // ======================================================================

    // Antes filtraba solo por evento_id (la fila de eventos_bot de ESTE
    // grupo). Si el mismo sorteo real se anuncia en varios grupos, una
    // reserva hecha a través de OTRO grupo tiene el evento_id de ESE grupo,
    // así que un sticker de pago enviado en un grupo distinto al de la
    // reserva original nunca encontraba la fila ("sin_reservas") y el pago
    // no quedaba compartido. Se filtra por identidad_evento_real
    // (independiente del grupo, ver identidadEventoReal.js) para encontrar
    // la reserva sin importar en qué grupo del mismo sorteo real se hizo. Si
    // el evento todavía no trae esta identidad (dato histórico previo a esta
    // migración), se mantiene el comportamiento anterior (por evento_id).
    // Se piden también contacto/telefono/comprador/nombre/lid (no solo
    // numero/estado): calcularCamposIdentidadARellenar() los necesita para
    // decidir qué puede completar sin sobrescribir nada — mismo SELECT,
    // sin ninguna consulta adicional a Supabase.
    let querySelect = supabase
        .from(evento.tabla)
        .select("numero, estado, contacto, telefono, comprador, nombre, lid")
        .eq("usuario_global_id", usuario.id);

    querySelect = evento.identidad_evento_real
        ? querySelect.eq("identidad_evento_real", evento.identidad_evento_real)
        : querySelect.eq("evento_id", evento.id);

    const { data: filas, error: errorSelect } = await querySelect;

    if (errorSelect) {

        console.error("❌ [PAGO-STICKER] Error consultando reservas del cliente:", errorSelect.message);

        return { estado: "error", actualizadas: [] };

    }

    if (!filas || filas.length === 0) {

        // Cubre tanto "nunca reservó nada" como "sus reservas son de OTRO
        // evento" (evento_id no coincide, así que ni siquiera aparecen aquí).
        return { estado: "sin_reservas", actualizadas: [] };

    }

    const tieneAlgunaReservada = filas.some(f => f.estado === "reservado");

    if (!tieneAlgunaReservada) {

        return { estado: "ya_pagado", actualizadas: [] };

    }

    // ======================================================================
    // 2. Cambio real — atómico, condicionado a estado='reservado'. Esto es
    //    lo único que garantiza idempotencia real ante dos stickers
    //    seguidos (o dos ejecuciones concurrentes): si otra ejecución ya
    //    cambió estas filas a 'pagado' entre el SELECT de arriba y este
    //    UPDATE, aquí simplemente no hay filas que coincidan y `actualizadas`
    //    queda vacío — nunca se sobrescribe ni se duplica nada.
    //
    //    Filtros, en orden de intención:
    //      usuario_global_id   -> SOLO este cliente (nunca otro).
    //      identidad_evento_real -> SOLO este sorteo real, sin importar en
    //                           qué grupo se hizo la reserva original (ver
    //                           identidadEventoReal.js) — antes filtraba por
    //                           evento_id (el grupo actual), lo que dejaba
    //                           sin marcar reservas hechas vía OTRO grupo del
    //                           mismo sorteo. Si el evento no trae esta
    //                           identidad todavía, cae a evento_id (igual que
    //                           antes de este cambio).
    //      usuario_id        -> SOLO el tenant dueño de este evento (mismo
    //                           campo que reservarNumeros.js ya escribe en
    //                           cada fila — la tabla dinámica es compartida
    //                           entre tenants, ver frontend/services/tablas).
    //      estado='reservado'-> SOLO lo pendiente (nunca reescribe 'pagado').
    // ======================================================================

    const ahora = new Date();

    const fechaPago = ahora.toLocaleDateString("sv-SE", {
        timeZone: "America/Bogota"
    });

    const horaPago = ahora.toLocaleTimeString("es-CO", {
        hour12: false,
        timeZone: "America/Bogota"
    });

    // Solo las filas que de verdad van a pasar a 'pagado' (estado==='reservado'
    // en la lectura de arriba) deciden qué columnas de identidad se pueden
    // completar — una fila ya 'pagado' de un ciclo anterior no debe impedir
    // (ni condicionar) el refresco de las que sí se están pagando ahora.
    const filasAPagar = filas.filter(f => f.estado === "reservado");

    const camposIdentidad = calcularCamposIdentidadARellenar(filasAPagar, usuario);

    let queryUpdate = supabase
        .from(evento.tabla)
        .update({

            estado: "pagado",
            fecha_pago: fechaPago,
            hora_pago: horaPago,

            ...camposIdentidad

        })
        .eq("usuario_global_id", usuario.id)
        .eq("usuario_id", evento.usuario_id)
        .eq("estado", "reservado");

    queryUpdate = evento.identidad_evento_real
        ? queryUpdate.eq("identidad_evento_real", evento.identidad_evento_real)
        : queryUpdate.eq("evento_id", evento.id);

    const { data: actualizadas, error: errorUpdate } = await queryUpdate.select();

    if (errorUpdate) {

        console.error("❌ [PAGO-STICKER] Error marcando pagado:", errorUpdate.message);

        return { estado: "error", actualizadas: [] };

    }

    if (!actualizadas || actualizadas.length === 0) {

        // Carrera perdida contra otra ejecución (p. ej. doble sticker casi
        // simultáneo) — el resultado deseado ya existe, no es un error.
        return { estado: "ya_pagado", actualizadas: [] };

    }

    // ======================================================================
    // 3. Auditoría — SOLO por las filas que realmente cambiaron, con el
    //    JID real del administrador (nunca 'bot': queremos saber quién
    //    confirmó manualmente). Best-effort: si falla, el pago YA quedó
    //    guardado arriba y no se revierte — mismo criterio que
    //    reservarNumeros.js con reservas_actividad.
    // ======================================================================

    try {

        await supabase
            .from("reservas_actividad")
            .insert(actualizadas.map((fila) => ({

                usuario_id: evento.usuario_id,
                tabla: evento.tabla,
                numero: fila.numero,
                evento_id: evento.id,
                tipo: "pagado",

                detalle: {
                    comprador: fila.comprador || null,
                    contacto: fila.contacto || null,
                    confirmado_via: "sticker_admin"
                },

                realizado_por: realizadoPor

            })));

    } catch (errorActividad) {

        console.error("⚠ [PAGO-STICKER] No se pudo registrar actividad de pago:", errorActividad);

    }

    return { estado: "confirmado", actualizadas };

}

module.exports = { marcarReservasPagadasPorAdmin };
