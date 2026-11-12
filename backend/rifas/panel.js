// ==========================================================================
// rifas/panel.js — la pantalla ORIGINAL de Tablas sobre el motor de rifas.
//
// La pantalla /tablas/:id conserva su diseño de siempre; lo que cambia es de
// dónde salen los datos. Este módulo responde EXACTAMENTE con el contrato que
// esa pantalla ya usaba (services/tablas/reservaManual.ts del panel:
// ContextoNumero, Exito/Fallo y RespuestaLote), pero operando sobre UNA rifa
// (tabla_id) del cliente:
//   - reservar: mismo camino que el bot (reservarNumerosDetallado → rifa del
//     evento), con la resolución de contacto y el bloqueo de siempre;
//   - pagar / liberar / desbloquear: funciones rifa_* (auditadas en la base).
// usuarioId sale SIEMPRE del token (routes/rifas.js); la rifa ya está
// comprobada como del cliente (cargarRifa).
// ==========================================================================

const rifas = require("./repositorio");
const rifasBot = require("./bot");
const { aTexto, aEntero, esUuid } = require("./formato");
const { vigente } = require("../shared/eventos/estadosGestion");

const db = () => require("../lib/supabase");
const reservaManual = () => require("../services/reservaManual");
const reservarNumeros = () => require("../bot/funciones/reservas/reservarNumeros");
const bloqueo = () => require("../bot/funciones/bloqueo/bloqueoActivo");

const ACCIONES_HISTORIAL = new Set(["reservar", "pagar", "liberar", "desbloquear"]);

const fallo = (motivo, mensaje, extra = {}) => ({ ok: false, motivo, mensaje, ...extra });

function accionesDe(estado) {
    if (estado === "libre") return ["reservar"];
    if (estado === "reservado" || estado === "en_proceso") return ["pagar", "liberar"];
    if (estado === "pagado") return ["liberar"];
    if (estado === "bloqueado") return ["desbloquear"];
    return [];
}

// Sorteos VIGENTES de esta rifa (eventos_bot.tabla_id = la rifa).
async function sorteosDeLaRifa(usuarioId, tablaId) {
    const { data, error } = await db().from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).eq("tabla_id", tablaId).eq("activo", true);
    if (error) throw new Error(error.message);
    return (data || []).filter(vigente);
}

function textoNumero(rifa, valor) {
    const entero = aEntero(valor, { cifras: rifa.cifras, cantidad: rifa.cantidad });
    return entero === null ? null : aTexto(entero, rifa.cifras);
}

async function filaDe(usuarioId, rifa, texto) {
    const { filas } = await rifas.leerNumeros(usuarioId, rifa.id, { numeros: [texto] });
    return filas[0] || null;
}

// ------------------------------------------------------------- contexto ---
// GET /rifas/:id/numero?numero=07 → ContextoNumero (ventana del número).
async function contextoNumero(usuarioId, rifa, valor) {
    const numero = textoNumero(rifa, valor);
    if (!numero) return fallo("numero_invalido", `Ese número no está en esta tabla (0 a ${rifa.cantidad - 1}).`);

    const [fila, sorteos, auditoria] = await Promise.all([
        filaDe(usuarioId, rifa, numero),
        sorteosDeLaRifa(usuarioId, rifa.id),
        db().from("reservas_auditoria")
            .select("id, accion, origen, resultado, codigo, estado_anterior, estado_nuevo, contacto_nombre, grupo_nombre, motivo, observaciones, metodo_pago, operador_email, creado_en")
            .eq("usuario_id", usuarioId).eq("tabla_id", rifa.id).eq("numero", numero)
            .order("creado_en", { ascending: false }).limit(50)
    ]);
    if (!fila) return fallo("numero_invalido", "Ese número no existe en esta tabla.");

    const historial = (auditoria.data || [])
        .filter(a => ACCIONES_HISTORIAL.has(a.accion))
        .map(a => ({
            id: a.id, accion: a.accion, origen: a.origen === "bot" ? "bot" : "manual", resultado: a.resultado,
            codigo: a.codigo, estadoAnterior: a.estado_anterior, estadoNuevo: a.estado_nuevo,
            contactoNombre: a.contacto_nombre, grupoNombre: a.grupo_nombre, motivo: a.motivo,
            observaciones: a.observaciones, metodoPago: a.metodo_pago, operador: a.operador_email, creadoEn: a.creado_en
        }));
    const pagoAud = fila.estado === "pagado" ? historial.find(h => h.accion === "pagar" && h.resultado === "ok") : null;
    const s = sorteos[0] || null;

    return {
        ok: true,
        precio: rifa.precio,
        tabla: "numeros_rifa",
        numero,
        estado: fila.estado,
        acciones: accionesDe(fila.estado),
        fila: {
            comprador: fila.comprador, telefono: fila.telefono, contactoId: fila.usuario_global_id,
            grupoId: fila.grupo_id, grupoNombre: fila.grupo_nombre, eventoId: fila.evento_id, nombreEvento: fila.nombre_evento,
            fechaReserva: fila.fecha_reserva, horaReserva: fila.hora_reserva, fechaPago: fila.fecha_pago, horaPago: fila.hora_pago,
            motivoBloqueo: fila.estado === "bloqueado" ? fila.observaciones : null, bloqueadoHasta: fila.bloqueado_hasta
        },
        sorteo: s ? {
            nombreEvento: s.nombre_evento || null, valor: Number(String(s.valor ?? "").replace(/[^\d]/g, "")) || rifa.precio,
            fechaEvento: s.fecha_evento || null, horaCierre: s.hora_cierre || null, horaFin: s.hora_fin || null,
            cifras: rifa.cifras, aceptaReservas: true
        } : null,
        contextos: sorteos.map(e => ({ eventoId: e.id, grupoId: e.grupo_id || null, grupoNombre: e.grupo_nombre || null, autorizado: true })),
        programados: [],
        pago: pagoAud ? { metodoPago: pagoAud.metodoPago, observaciones: pagoAud.observaciones, operador: pagoAud.operador, registradoEn: pagoAud.creadoEn } : null,
        historial,
        auditoriaDisponible: !auditoria.error,
        servidorAhora: new Date().toISOString()
    };
}

// ------------------------------------------------------------- reservas ---

// Contacto de la reserva: del directorio del cliente o alta nueva (mismas
// reglas que la pantalla de siempre) y nunca un contacto bloqueado.
async function contactoDeReserva(usuarioId, { contactoId, nuevoContacto }) {
    let contacto = null;
    if (contactoId) {
        contacto = await reservaManual().contactoDelCliente(usuarioId, contactoId);
        if (!contacto) return { fallo: fallo("contacto_no_existe", "El contacto no está en tu directorio.") };
    } else if (nuevoContacto && typeof nuevoContacto === "object") {
        const alta = await reservaManual().crearContactoManual({ usuarioId, nombre: nuevoContacto.nombre, telefono: nuevoContacto.telefono });
        if (!alta.ok) return { fallo: fallo(alta.motivo || "error_contacto", alta.mensaje || "No se pudo registrar el contacto.") };
        contacto = alta.contacto;
    } else {
        return { fallo: fallo("falta_contacto", "Selecciona el contacto de la reserva.") };
    }
    const { bloqueado } = await bloqueo().buscarBloqueo(usuarioId, { telefono: contacto.telefono || null, lid: contacto.lid || null }, { fresco: true });
    if (bloqueado) return { fallo: fallo("contacto_bloqueado", "Ese contacto está bloqueado. Desbloquéalo antes de reservarle.") };
    return { contacto };
}

// El sorteo al que va la reserva: el elegido (si es de ESTA rifa) o ninguno.
async function eventoDeReserva(usuarioId, rifa, { eventoId, grupoId }) {
    if (eventoId && esUuid(eventoId)) {
        const { data, error } = await db().from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("id", eventoId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data || data.tabla_id !== rifa.id) return { fallo: fallo("sorteo_de_otra_tabla", "Ese sorteo no es de esta tabla.") };
        return { evento: { ...data, cifras: rifa.cifras } };
    }
    return { evento: { id: null, usuario_id: usuarioId, tabla: "numeros_rifa", tabla_id: rifa.id, cifras: rifa.cifras, grupo_id: grupoId || null } };
}

async function reservar(usuarioId, operador, rifa, cuerpo, textos) {
    const c = await contactoDeReserva(usuarioId, cuerpo);
    if (c.fallo) return { general: c.fallo };
    const e = await eventoDeReserva(usuarioId, rifa, cuerpo);
    if (e.fallo) return { general: e.fallo };
    const r = await reservarNumeros().reservarNumerosDetallado({
        evento: e.evento,
        numeros: textos,
        usuario: c.contacto,
        comprador: c.contacto.nombre || null,
        contacto: c.contacto.telefono || null,
        origen: "manual",
        operador,
        auditoria: { motivo: cuerpo.motivo || null, observaciones: cuerpo.observaciones || null, solicitudId: cuerpo.solicitudId || null, precio: rifa.precio }
    });
    if (r.contactoBloqueado) return { general: fallo("contacto_bloqueado", "Ese contacto está bloqueado. Desbloquéalo antes de reservarle.") };
    if (r.error) return { general: fallo(r.error.code || "error", r.error.message || "No se pudo reservar.") };
    // Ya reservado A ESTE MISMO contacto = repetición (sin cambio); a otra
    // persona = no disponible.
    const { filas } = await rifas.leerNumeros(usuarioId, rifa.id, { numeros: textos });
    const suyos = new Set(filas.filter(f => f.estado === "reservado" && f.usuario_global_id === c.contacto.id).map(f => f.numero));
    const hechos = new Set((r.filas || []).map(f => f.numero));
    return { hechos, sinCambio: new Set([...suyos].filter(n => !hechos.has(n))) };
}

async function pagar(usuarioId, operador, rifa, cuerpo, textos) {
    const datos = {};
    if (typeof cuerpo.metodoPago === "string") datos.metodo_pago = cuerpo.metodoPago.slice(0, 60);
    if (typeof cuerpo.observaciones === "string") datos.observaciones = cuerpo.observaciones.slice(0, 1000);
    const r = await rifas.pagar(usuarioId, rifa.id, textos, datos, actorPanel(operador, cuerpo), { rifa });
    if (r.motivo === "error_supabase") return { general: fallo("error_supabase", "No se pudo registrar el pago.") };
    return { hechos: new Set((r.pagados || []).map(n => aTexto(n, rifa.cifras))), sinCambio: new Set((r.ya_pagados || []).map(n => aTexto(n, rifa.cifras))) };
}

// Liberar según el estado real: suelta una reserva, anula un pago o desbloquea.
async function liberar(usuarioId, operador, rifa, cuerpo, textos) {
    const r = await rifas.liberar(usuarioId, rifa.id, textos, {}, actorPanel(operador, cuerpo),
        { rifa, incluirPagados: true, incluirBloqueados: true });
    if (r.motivo === "error_supabase") return { general: fallo("error_supabase", "No se pudo liberar.") };
    return { hechos: new Set((r.liberados || []).map(n => aTexto(n, rifa.cifras))) };
}

const actorPanel = (operador, cuerpo) => rifas.actor({
    origen: "manual", operadorId: operador?.id || null, operadorEmail: operador?.email || null,
    solicitudId: cuerpo.solicitudId || null, motivo: cuerpo.motivo || null
});

const OPERACIONES = { reservar, pagar, liberar, desbloquear: liberar };
const ESTADO_FINAL = { reservar: "reservado", pagar: "pagado", liberar: "libre", desbloquear: "libre" };

// Actividad reciente del panel (el bot ya la registra al reservar).
async function registrar(usuarioId, operador, rifa, accion, textos) {
    if (accion === "reservar" || textos.length === 0) return;
    const { filas } = await rifas.leerNumeros(usuarioId, rifa.id, { numeros: textos });
    await rifasBot.registrarActividad({ usuario_id: usuarioId, tabla: "numeros_rifa", tabla_id: rifa.id, id: null }, filas,
        accion === "pagar" ? "pagado" : "liberado", { origen: "manual" }, `panel:${operador?.email || operador?.id || "desconocido"}`);
}

// POST /rifas/:id/numero { numero, accion, ... } → Exito | Fallo
async function operarNumero(usuarioId, operador, rifa, cuerpo) {
    const accion = cuerpo?.accion;
    if (!OPERACIONES[accion]) return fallo("accion_invalida", "Operación no válida.");
    const numero = textoNumero(rifa, cuerpo.numero);
    if (!numero) return fallo("numero_invalido", `Ese número no está en esta tabla (0 a ${rifa.cantidad - 1}).`);
    const antes = await filaDe(usuarioId, rifa, numero);
    const r = await OPERACIONES[accion](usuarioId, operador, rifa, cuerpo, [numero]);
    if (r.general) return { ...r.general, estadoActual: antes?.estado };
    if (r.hechos.has(numero)) {
        await registrar(usuarioId, operador, rifa, accion, [numero]);
        return { ok: true, estado: ESTADO_FINAL[accion], accion };
    }
    const ahora = await filaDe(usuarioId, rifa, numero);
    // Reservar solo es repetición si es del mismo contacto (r.sinCambio).
    if (r.sinCambio?.has(numero) || (accion !== "reservar" && ahora?.estado === ESTADO_FINAL[accion])) {
        return { ok: true, estado: ahora?.estado || ESTADO_FINAL[accion], idempotente: true, accion };
    }
    return fallo(accion === "reservar" ? "no_disponible" : "estado_invalido",
        accion === "reservar" ? `El ${numero} ya no está libre.` : `El ${numero} no se puede ${accion === "pagar" ? "pagar" : "liberar"} en su estado actual.`,
        { estadoActual: ahora?.estado });
}

// POST /rifas/:id/lote { accion, numeros, ... } → RespuestaLote
async function operarLote(usuarioId, operador, rifa, cuerpo) {
    const accion = cuerpo?.accion;
    if (!["reservar", "pagar", "liberar"].includes(accion)) return fallo("accion_invalida", "Operación no válida.");
    const pedidos = (Array.isArray(cuerpo.numeros) ? cuerpo.numeros : []).slice(0, rifas.MAX_NUMEROS)
        .map(n => (n && typeof n === "object" ? n.numero : n));
    const textos = [...new Set(pedidos.map(n => textoNumero(rifa, n)).filter(Boolean))];
    if (textos.length === 0) return fallo("sin_numeros", "Elige al menos un número.");

    const r = await OPERACIONES[accion](usuarioId, operador, rifa, cuerpo, textos);
    if (r.general) return r.general;
    const hechos = textos.filter(n => r.hechos.has(n));
    await registrar(usuarioId, operador, rifa, accion, hechos);

    const { filas } = await rifas.leerNumeros(usuarioId, rifa.id, { numeros: textos });
    const estadoDe = new Map(filas.map(f => [f.numero, f.estado]));
    const resultados = textos.map(n => {
        if (r.hechos.has(n)) return { numero: n, estado: "hecho", mensaje: "Hecho." };
        if (r.sinCambio?.has(n) || (accion !== "reservar" && estadoDe.get(n) === ESTADO_FINAL[accion])) return { numero: n, estado: "sin_cambio", mensaje: "Ya estaba así.", estadoActual: estadoDe.get(n) };
        return { numero: n, estado: "omitido", mensaje: "Su estado cambió; no se tocó.", codigo: "estado_cambiado", estadoActual: estadoDe.get(n) };
    });
    const contar = (e) => resultados.filter(x => x.estado === e).length;
    return { ok: true, accion, resultados, hechos: contar("hecho"), sinCambio: contar("sin_cambio"), omitidos: contar("omitido"), errores: contar("error") };
}

module.exports = { contextoNumero, operarNumero, operarLote };
