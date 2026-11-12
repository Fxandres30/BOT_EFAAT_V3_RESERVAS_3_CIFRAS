// ==========================================================================
// rifas/bot.js — el bot de WhatsApp sobre el motor de rifas (MOTOR_RIFAS=nuevo).
//
// Mismo contrato que las funciones antiguas (filas con numero en texto,
// nombre, fecha/hora de reserva…), pero la fuente es UNA rifa:
//
//   evento (eventos_bot) → evento.tabla_id (051) → numeros_rifa de esa rifa
//
// Regla (docs/rifas/MOTOR_RIFAS.md §6): si el evento no tiene tabla_id, NO se
// cae al precio ni a la tabla física: se trata como «sin rifa», no se toca
// ningún número y queda el aviso en el registro para el administrador.
// ==========================================================================

const rifas = require("./repositorio");
const { esUuid } = require("./formato");

const db = () => require("../lib/supabase");

const SIN_RIFA = "SIN_RIFA";

function tablaIdDe(evento) {
    return evento?.tabla_id && esUuid(evento.tabla_id) ? evento.tabla_id : null;
}

// Un aviso por evento y operación (no inunda el registro con cada mensaje).
const avisados = new Set();
function avisarSinRifa(evento, operacion) {
    const clave = `${evento?.id}|${operacion}`;
    if (avisados.has(clave)) return;
    avisados.add(clave);
    if (avisados.size > 5000) avisados.clear();
    console.error(`🛑 [RIFAS] ${operacion}: el sorteo ${evento?.id ?? "?"} del grupo ${evento?.grupo_id ?? "?"} no tiene rifa asignada (tabla_id). No se toca ningún número. Asigna la rifa del grupo en el panel.`);
}

const errorSinRifa = { code: SIN_RIFA, message: "El sorteo no tiene una rifa asignada (tabla_id)." };

// Datos de la reserva tal como los guarda la rifa.
function datosDeEvento(evento) {
    const d = {};
    if (evento?.grupo_id) d.grupo_id = evento.grupo_id;
    if (evento?.grupo_nombre) d.grupo_nombre = evento.grupo_nombre;
    if (evento?.id && esUuid(evento.id)) d.evento_id = evento.id;
    if (evento?.identidad_evento_real) d.identidad_evento_real = evento.identidad_evento_real;
    if (evento?.nombre_evento || evento?.nombre) d.nombre_evento = evento.nombre_evento || evento.nombre;
    if (evento?.telefono_bot) d.telefono_bot = evento.telefono_bot;
    return d;
}

// Titular para «mis números», pagos y liberaciones: persona, LID o teléfono.
function titularDe(usuario) {
    const t = {};
    if (usuario?.id && esUuid(usuario.id)) t.usuario_global_id = usuario.id;
    if (usuario?.lid) t.lid = usuario.lid;
    if (usuario?.telefono) t.telefono = usuario.telefono;
    return t;
}

// ---------------------------------------------------------------- lecturas

// Filas de la rifa del evento (todas, o algunos números/estados).
// null = no se pudo leer o no hay rifa («no sé» no es «no hay filas»).
async function leerFilas(evento, { numeros = null, estados = null } = {}) {
    const tablaId = tablaIdDe(evento);
    if (!tablaId || !evento?.usuario_id) {
        avisarSinRifa(evento, "lectura");
        return null;
    }
    try {
        const { rifa, filas } = await rifas.leerNumeros(evento.usuario_id, tablaId, { numeros, estados });
        if (!rifa) {
            avisarSinRifa(evento, "lectura (rifa inexistente o de otro cliente)");
            return null;
        }
        return filas;
    } catch (e) {
        console.error(`❌ [RIFAS] lectura de la rifa ${tablaId}: ${e.message}`);
        return null;
    }
}

// Números ocupados (no libres) de una persona en la rifa del evento.
async function filasDelTitular(evento, usuario) {
    const tablaId = tablaIdDe(evento);
    if (!tablaId || !evento?.usuario_id) {
        avisarSinRifa(evento, "mis números");
        return null;
    }
    const t = titularDe(usuario);
    try {
        const { rifa, filas } = await rifas.numerosDelTitular(evento.usuario_id, tablaId, {
            telefono: t.telefono || null, lid: t.lid || null, usuarioGlobalId: t.usuario_global_id || null
        }, { estados: ["reservado", "en_proceso", "pagado", "bloqueado"] });
        if (!rifa && (t.telefono || t.lid || t.usuario_global_id)) return null;
        return filas;
    } catch (e) {
        console.error(`❌ [RIFAS] mis números en ${tablaId}: ${e.message}`);
        return null;
    }
}

// ---------------------------------------------------------------- escrituras

// Registro de actividad del panel (reservas_actividad) con la rifa. Si la
// 051 aún no añadió tabla_id, se reintenta sin ella. Nunca lanza.
async function registrarActividad(evento, filas, tipo, detalle, realizadoPor) {
    if (!evento?.usuario_id || !filas?.length) return;
    const base = filas.map(f => ({
        usuario_id: evento.usuario_id,
        tabla: evento.tabla || "numeros_rifa",
        numero: f.numero,
        evento_id: evento.id || null,
        tipo,
        detalle,
        realizado_por: realizadoPor
    }));
    try {
        let { error } = await db().from("reservas_actividad").insert(base.map(f => ({ ...f, tabla_id: tablaIdDe(evento) })));
        if (["42703", "PGRST204"].includes(error?.code)) ({ error } = await db().from("reservas_actividad").insert(base));
        if (error) console.error("⚠ [RIFAS] actividad no registrada:", error.message);
    } catch (e) {
        console.error("⚠ [RIFAS] actividad no registrada:", e.message);
    }
}

// Reserva en la rifa del evento. -> { filas, error } como reservarNumerosDetallado.
async function reservar({ evento, numeros, usuario, nombre, telefono, lid, lib, origen = "bot", operador = null, auditoria = {} }) {
    const tablaId = tablaIdDe(evento);
    if (!tablaId || !evento?.usuario_id) {
        avisarSinRifa(evento, "reserva");
        return { filas: [], error: errorSinRifa };
    }
    const manual = origen === "manual";
    const datos = {
        ...datosDeEvento(evento),
        comprador: nombre || null,
        contacto: telefono || null,
        telefono: telefono || null,
        lid: lid || null,
        lib: lib || null,
        usuario_global_id: usuario?.id && esUuid(usuario.id) ? usuario.id : null,
        observaciones: auditoria.observaciones || null
    };
    const quien = rifas.actor({
        origen: manual ? "manual" : "bot",
        operadorId: manual ? operador?.id : null,
        operadorEmail: manual ? operador?.email : null,
        solicitudId: auditoria.solicitudId || null,
        motivo: auditoria.motivo || null
    });
    const r = await rifas.reservar(evento.usuario_id, tablaId, numeros, datos, quien, { rifa: { cifras: evento.cifras } });
    if (r.motivo === "error_supabase" || r.motivo === "rifa_no_encontrada" || r.motivo === "rifa_inactiva") {
        if (r.motivo !== "error_supabase") avisarSinRifa(evento, `reserva (${r.motivo})`);
        return { filas: [], error: { code: r.motivo, message: r.error || r.motivo } };
    }
    if (!r.ok || !r.reservados?.length) return { filas: [], error: null };
    const filas = await leerFilas(evento, { numeros: r.reservados });
    await registrarActividad(evento, filas || [], "reservado",
        { comprador: datos.comprador, contacto: datos.contacto, grupo_nombre: evento.grupo_nombre, origen },
        manual ? `panel:${operador?.email || operador?.id || "desconocido"}` : "bot");
    return { filas: filas || [], error: null };
}

// Sticker de pago / confirmación del administrador: paga los RESERVADOS de
// esa persona en la rifa. Mismo resultado que marcarReservasPagadasPorAdmin:
// { estado: confirmado | sin_reservas | ya_pagado | error, actualizadas }.
async function pagarDelTitular({ evento, usuario, realizadoPor }) {
    const tablaId = tablaIdDe(evento);
    if (!tablaId || !evento?.usuario_id || !usuario?.id) {
        avisarSinRifa(evento, "pago");
        return { estado: "error", motivo: "sin_rifa", actualizadas: [] };
    }
    const filas = await filasDelTitular(evento, usuario);
    if (filas === null) return { estado: "error", actualizadas: [] };
    if (filas.length === 0) return { estado: "sin_reservas", actualizadas: [] };
    const reservados = filas.filter(f => f.estado === "reservado" || f.estado === "en_proceso").map(f => f.numero);
    if (reservados.length === 0) return { estado: "ya_pagado", actualizadas: [] };

    const r = await rifas.pagar(evento.usuario_id, tablaId, reservados,
        { titular: titularDe(usuario), metodo_pago: "sticker" },
        rifas.actor({ origen: "bot", motivo: `confirmado por ${realizadoPor || "administrador"}` }),
        { rifa: { cifras: evento.cifras } });
    if (r.motivo === "error_supabase") return { estado: "error", actualizadas: [] };
    if (!r.ok || !r.pagados?.length) return { estado: "ya_pagado", actualizadas: [] };

    const actualizadas = await leerFilas(evento, { numeros: r.pagados }) || [];
    await registrarActividad(evento, actualizadas, "pagado",
        { comprador: actualizadas[0]?.comprador || null, contacto: actualizadas[0]?.contacto || null, confirmado_via: "sticker_admin" },
        realizadoPor);
    return { estado: "confirmado", actualizadas };
}

// Rifa de un sorteo que nace o se actualiza en un grupo:
//   - si continúa otro sorteo (o ya tenía rifa), conserva esa;
//   - si no, rifa_resolver entre las rifas VINCULADAS al grupo, con el
//     precio del anuncio como filtro (D1). Ambigua o sin vínculo → null y
//     aviso: el sorteo se guarda, pero el bot no vende hasta asignarla.
async function rifaParaSorteo({ usuarioId, grupoId, precio, heredada = null }) {
    // El precio es solo un FILTRO entre las rifas vinculadas (D1). Si no es un
    // entero válido no se busca nada: buscar sin precio podría elegir la rifa
    // de otro precio.
    const valor = Number(String(precio ?? "").replace(/[^\d]/g, ""));
    if (!Number.isInteger(valor) || valor <= 0) {
        console.error(`🛑 [RIFAS] sorteo del grupo ${grupoId}: precio no válido (${precio}); no se asigna rifa.`);
        return null;
    }
    // Rifa heredada (sorteo que continúa, fila existente o programado): solo si
    // es del mismo cliente, del MISMO precio y sigue activa. Nunca la de otro
    // precio: eso volvería a mezclar dos rifas.
    if (heredada && esUuid(heredada)) {
        let rifa = null;
        try {
            rifa = await rifas.obtenerRifa(usuarioId, heredada);
        } catch (e) {
            console.error(`❌ [RIFAS] no se pudo leer la rifa heredada ${heredada}: ${e.message}`);
            return null;
        }
        if (rifa && Number(rifa.precio) === valor && rifa.activa && !rifa.archivada_en) return heredada;
        const como = rifa ? `es de $${rifa.precio}${rifa.activa ? "" : " (inactiva)"}` : "no existe para este cliente";
        console.error(`🛑 [RIFAS] sorteo de $${valor} en el grupo ${grupoId}: la rifa heredada ${heredada} ${como}; no se asigna. Asígnala en el panel.`);
        return null;
    }
    const r = await rifas.resolver(usuarioId, grupoId, { precio: valor });
    if (r.ok && esUuid(r.tabla_id)) return r.tabla_id;
    const candidatas = (r.candidatas || []).map(c => `${c.nombre} ($${c.precio})`).join(", ");
    console.error(`🛑 [RIFAS] sorteo de $${precio} en el grupo ${grupoId}: no se pudo asignar rifa (${r.motivo}${candidatas ? `: ${candidatas}` : ""}). Las reservas de este sorteo quedan detenidas hasta asignarla en el panel.`);
    return null;
}

module.exports = { SIN_RIFA, tablaIdDe, rifaParaSorteo, titularDe, leerFilas, filasDelTitular, reservar, pagarDelTitular, registrarActividad };
