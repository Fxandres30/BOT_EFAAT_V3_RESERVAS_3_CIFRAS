// ==========================================================================
// services/reservaManual.js — intervención MANUAL del propietario sobre un
// número de su tabla desde el panel (Tablas → número): reservar cuando el bot
// no pudo, registrar el pago, liberar y desbloquear.
//
// Reglas (ver docs/activacion/RESERVA_MANUAL.md):
//   - El cliente (usuarioId) y el operador salen SIEMPRE del token validado
//     en routes/tablas.js; nada de lo que mande el navegador decide de quién
//     son los datos.
//   - La reserva usa el MISMO servicio que el bot (reservarNumeros.js): mismo
//     UPDATE condicionado a estado='libre' sobre la cuadrícula del cliente
//     (filtroCliente.js). Eso es lo que impide reservas dobles, también entre
//     procesos: de dos intentos simultáneos solo uno encuentra la fila libre.
//   - Mismas validaciones que una reserva automática: formato del número
//     según las cifras del sorteo, sorteo activo del precio y abierto
//     (sorteoAceptaReservas), grupo autorizado (politicaGrupos.js) y
//     contacto del directorio del cliente (contactos_tenant).
//   - Ninguna operación envía mensajes ni toca WhatsApp.
//   - Cada intento (también rechazos y errores) queda en reservas_auditoria
//     (migración 032) con origen 'manual'.
// ==========================================================================

const supabase = require("../lib/supabase");

const { obtenerConfiguracionCliente } = require("../bot/funciones/eventos/tablasCliente");
const { obtenerTablasConocidas } = require("../bot/funciones/eventos/configEvento");
const { soloDelCliente } = require("../bot/funciones/reservas/filtroCliente");
const { validarFormatoNumero } = require("../bot/funciones/reservas/extraerNumeros");
const { reservarNumeros } = require("../bot/funciones/reservas/reservarNumeros");
const { sorteoAceptaReservas } = require("../bot/funciones/reservas/detectarReserva");
const { actualizarEvento } = require("../bot/funciones/reservas/actualizarEvento");
const { registrarAuditoria, historialNumero } = require("../bot/funciones/reservas/auditoriaReservas");
const { evaluarGrupo } = require("../bot/funciones/grupos/politicaGrupos");
const { listarContactos } = require("../bot/funciones/usuarios/listarContactos");
const { obtenerUsuarioGlobal } = require("../bot/funciones/usuarios/obtenerUsuarioGlobal");
const { esErrorTriggerCompradoresSinWhatsapp } = require("../bot/funciones/pagos/marcarReservasPagadasPorAdmin");

const MAX_MOTIVO = 500;
const MAX_OBSERVACIONES = 1000;
const MAX_METODO_PAGO = 60;

// Mismas columnas que limpia el reinicio seguro (migración 030).
const CAMPOS_LIBRE = {
    estado: "libre",
    comprador: null, contacto: null, contacto_lower: null, nombre: null, telefono: null, lib: null,
    grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null, telefono_bot: null,
    fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
    temporal_por: null, bloqueado_hasta: null, ip_reserva: null, usuario_global_id: null
};

// ------------------------------------------------------------- utilidades ---

function texto(valor, max) {
    if (valor === undefined || valor === null) return null;
    const t = String(valor).trim();
    return t ? t.slice(0, max) : null;
}

function ahoraBogota(ahora = new Date()) {
    return {
        fecha: ahora.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" }),
        hora: ahora.toLocaleTimeString("es-CO", { hour12: false, timeZone: "America/Bogota" })
    };
}

function normalizarBusqueda(valor) {
    return String(valor || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim();
}

// Mismo formato que guarda el bot (obtenerUsuarioGlobal: sin el prefijo 57).
function normalizarTelefono(valor) {
    let d = String(valor || "").replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
    return /^\d{7,15}$/.test(d) ? d : null;
}

// Estado REAL de la fila: una retención "en_proceso" vencida se muestra
// disponible en el panel, pero en la base sigue en_proceso y ni el bot ni
// el panel pueden reservarla hasta liberarla.
function estadoDeFila(fila, ahora = new Date()) {
    if (!fila) return null;
    if (fila.estado === "en_proceso" && fila.bloqueado_hasta && new Date(fila.bloqueado_hasta) <= ahora) return "en_proceso_vencido";
    return fila.estado;
}

function accionesPara(estado) {
    switch (estado) {
        case "libre": return ["reservar"];
        case "reservado": return ["pagar", "liberar"];
        case "pagado": return ["liberar"];
        case "bloqueado":
        case "en_proceso":
        case "en_proceso_vencido": return ["desbloquear"];
        default: return [];
    }
}

const rechazo = (motivo, mensaje, extra = {}) => ({ ok: false, motivo, mensaje, ...extra });

// ------------------------------------------------------------- lecturas ---

async function resolverConfig(usuarioId, precio) {
    const p = Number(precio);
    if (!usuarioId || !Number.isInteger(p) || p <= 0) return null;
    const config = await obtenerConfiguracionCliente(usuarioId, p);
    return config ? { ...config, precio: p } : null;
}

async function leerFila(usuarioId, tabla, numero) {

    const { data, error } = await soloDelCliente(
        supabase.from(tabla).select("*").eq("numero", numero),
        { usuario_id: usuarioId }
    ).maybeSingle();

    if (error) return { ok: false, error };

    return { ok: true, fila: data || null };

}

// Filas activas de eventos_bot del sorteo vigente de ESTE precio (una por
// grupo). Varias tablas comparten la tabla física entre precios: solo vale
// un sorteo cuyo valor sea el de la tabla abierta.
async function sorteoDelPrecio(usuarioId, tabla, precio) {

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("tabla", tabla)
        .eq("activo", true)
        .order("creado_en", { ascending: false });

    if (error) return { ok: false, error, filas: [] };

    const delPrecio = (data || []).filter(e => Number(String(e.valor ?? "").replace(/[^\d]/g, "")) === precio);

    if (delPrecio.length === 0) return { ok: true, filas: [] };

    // El sorteo más reciente y todos sus grupos (misma identidad real).
    const principal = delPrecio[0];
    const filas = principal.identidad_evento_real
        ? delPrecio.filter(e => e.identidad_evento_real === principal.identidad_evento_real)
        : [principal];

    return { ok: true, filas };

}

async function contextosDe(usuarioId, filas) {

    return Promise.all(filas.map(async (e) => {
        const politica = await evaluarGrupo(usuarioId, e.grupo_id);
        return {
            eventoId: e.id,
            grupoId: e.grupo_id || null,
            grupoNombre: e.grupo_nombre || null,
            autorizado: politica.permitido
        };
    }));

}

// ------------------------------------------------------------- contactos ---

// Directorio del cliente (listarContactos: contactos_tenant JOIN usuarios),
// en caché corta: la búsqueda se hace mientras el propietario escribe.
const VIGENCIA_DIRECTORIO_MS = 60_000;
const directorios = new Map();

function directorioDe(usuarioId) {

    const ahora = Date.now();
    const vigente = directorios.get(usuarioId);
    if (vigente && vigente.hasta > ahora) return vigente.lista;

    const lista = listarContactos({ usuarioId }).then(r => r.contactos || []);
    directorios.set(usuarioId, { hasta: ahora + VIGENCIA_DIRECTORIO_MS, lista });
    lista.catch(() => directorios.delete(usuarioId));

    return lista;

}

function olvidarDirectorio(usuarioId) {
    if (usuarioId) directorios.delete(usuarioId);
    else directorios.clear();
}

// Grupos de WhatsApp DE ESTE CLIENTE en los que se ha visto a cada contacto:
// sus reservas en la cuadrícula del cliente y sus mensajes en los grupos del
// cliente (mismo criterio que obtenerPerfilContacto.js).
async function gruposDeContactos(usuarioId, ids) {

    const porContacto = new Map(ids.map(id => [id, new Map()]));

    if (ids.length === 0) return porContacto;

    const [{ data: eventos }, { data: autorizados }] = await Promise.all([
        supabase.from("eventos_bot").select("grupo_id, grupo_nombre").eq("usuario_id", usuarioId),
        supabase.from("grupos_autorizados").select("grupo_id").eq("usuario_id", usuarioId).eq("activo", true)
    ]);

    const nombres = new Map();
    for (const e of eventos || []) if (e.grupo_id && e.grupo_nombre) nombres.set(e.grupo_id, e.grupo_nombre);

    const gruposCliente = [...new Set([
        ...(eventos || []).map(e => e.grupo_id),
        ...(autorizados || []).map(g => g.grupo_id)
    ].filter(Boolean))];

    const anotar = (id, grupoId, grupoNombre) => {
        if (!grupoId || !porContacto.has(id)) return;
        const grupos = porContacto.get(id);
        if (!grupos.has(grupoId) || (!grupos.get(grupoId) && grupoNombre)) {
            grupos.set(grupoId, grupoNombre || nombres.get(grupoId) || null);
        }
    };

    const reservas = await Promise.all(obtenerTablasConocidas().map(tabla =>
        supabase.from(tabla)
            .select("usuario_global_id, grupo_id, grupo_nombre")
            .eq("usuario_id", usuarioId)
            .in("usuario_global_id", ids)
    ));

    for (const { data } of reservas) for (const f of data || []) anotar(f.usuario_global_id, f.grupo_id, f.grupo_nombre);

    if (gruposCliente.length) {
        const { data: mensajes } = await supabase
            .from("mensajes_grupos_sorteos")
            .select("usuario_id, grupo_id, grupo_nombre")
            .in("usuario_id", ids)
            .in("grupo_id", gruposCliente)
            .limit(1000);
        for (const m of mensajes || []) anotar(m.usuario_id, m.grupo_id, m.grupo_nombre);
    }

    return porContacto;

}

// Búsqueda por nombre o teléfono SOLO en el directorio del cliente. Sin
// término: los más recientes. Sin duplicados (por id y por teléfono).
async function buscarContactos({ usuarioId, q, limite = 20 }) {

    if (!usuarioId) return { ok: false, motivo: "sin_usuario", contactos: [] };

    let directorio;

    try {
        directorio = await directorioDe(usuarioId);
    } catch (err) {
        console.error("❌ [RESERVA MANUAL] error leyendo el directorio:", err?.message);
        return { ok: false, motivo: "error_directorio", contactos: [] };
    }

    const termino = normalizarBusqueda(q);
    const digitos = termino.replace(/\D/g, "");
    const buscaTelefono = digitos.length >= 3 && digitos.length === termino.replace(/[\s+\-()]/g, "").length;
    const telefonoBuscado = buscaTelefono && digitos.length === 12 && digitos.startsWith("57") ? digitos.slice(2) : digitos;

    const coincide = (c) => {
        if (!termino) return true;
        if (buscaTelefono) return Boolean(c.telefono && c.telefono.includes(telefonoBuscado));
        return normalizarBusqueda(c.nombre).includes(termino);
    };

    const vistos = new Set();
    const telefonos = new Set();
    const elegidos = [];

    for (const c of directorio) {
        if (elegidos.length >= limite) break;
        if (!coincide(c) || vistos.has(c.id)) continue;
        if (c.telefono && telefonos.has(c.telefono)) continue;
        vistos.add(c.id);
        if (c.telefono) telefonos.add(c.telefono);
        elegidos.push(c);
    }

    const grupos = await gruposDeContactos(usuarioId, elegidos.map(c => c.id));

    return {
        ok: true,
        contactos: elegidos.map(c => ({
            id: c.id,
            nombre: c.nombre || null,
            telefono: c.telefono || null,
            telefonoPendiente: Boolean(c.telefonoPendiente),
            grupos: [...(grupos.get(c.id) || new Map())].map(([grupoId, grupoNombre]) => ({ grupoId, grupoNombre }))
        }))
    };

}

// Contacto del directorio de ESTE cliente, o null (de otro cliente = no existe).
async function contactoDelCliente(usuarioId, contactoId) {

    if (!contactoId || !/^[0-9a-f-]{36}$/i.test(String(contactoId))) return null;

    const { data: relacion, error } = await supabase
        .from("contactos_tenant")
        .select("usuario_global_id")
        .eq("usuario_id", usuarioId)
        .eq("usuario_global_id", contactoId)
        .maybeSingle();

    if (error || !relacion) return null;

    const { data: usuario } = await supabase
        .from("usuarios")
        .select("id, nombre, telefono, lid")
        .eq("id", contactoId)
        .maybeSingle();

    return usuario || null;

}

// Alta controlada de un contacto que el bot nunca vio. Usa el punto único de
// identidad (obtenerUsuarioGlobal) y nunca vincula una identidad que ya
// exista en la plataforma sin estar en el directorio del cliente: eso
// expondría el nombre que otra cuenta conoce de esa persona.
async function crearContactoManual({ usuarioId, nombre, telefono }) {

    const tel = normalizarTelefono(telefono);
    const nom = texto(nombre, 80);

    if (!tel) return rechazo("telefono_invalido", "El teléfono debe tener entre 7 y 15 dígitos.");
    if (!nom || nom.length < 2) return rechazo("nombre_invalido", "Escribe el nombre del contacto.");

    const { data: existentes, error } = await supabase
        .from("usuarios")
        .select("id, nombre, telefono, lid")
        .eq("telefono", tel)
        .limit(2);

    if (error) return rechazo("error_contacto", "No se pudo comprobar el teléfono. Inténtalo de nuevo.");

    if ((existentes || []).length >= 2) {
        return rechazo("telefono_ambiguo", "Ese teléfono tiene identidades duplicadas; resuélvelo antes de reservar.");
    }

    if ((existentes || []).length === 1) {
        const propio = await contactoDelCliente(usuarioId, existentes[0].id);
        if (propio) return { ok: true, contacto: propio, reutilizado: true };
        return rechazo("telefono_no_vinculable", "Ese teléfono ya existe en la plataforma pero no está en tus contactos. Aparecerá cuando escriba en uno de tus grupos.");
    }

    const creado = await obtenerUsuarioGlobal({
        telefono: tel,
        nombre: nom,
        usuarioIdTenant: usuarioId,
        origenContacto: "manual_panel"
    });

    if (!creado?.id) return rechazo("error_contacto", "No se pudo registrar el contacto.");

    olvidarDirectorio(usuarioId);

    return { ok: true, contacto: { id: creado.id, nombre: creado.nombre, telefono: creado.telefono, lid: creado.lid || null }, creado: true };

}

// -------------------------------------------------------------- contexto ---

async function contextoNumero({ usuarioId, precio, numero, ahora = new Date() }) {

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.");

    const lectura = await leerFila(usuarioId, config.tabla, String(numero));
    if (!lectura.ok) return rechazo("error_lectura", "No se pudo leer el número.");
    if (!lectura.fila) return rechazo("numero_inexistente", "Ese número no existe en tu tabla.");

    const fila = lectura.fila;
    const estado = estadoDeFila(fila, ahora);

    const [sorteo, historial] = await Promise.all([
        sorteoDelPrecio(usuarioId, config.tabla, config.precio),
        historialNumero({ usuarioId, tabla: config.tabla, numero: fila.numero })
    ]);

    const principal = sorteo.filas[0] || null;
    const contextos = principal ? await contextosDe(usuarioId, sorteo.filas) : [];
    const ultimoPago = historial.filas.find(h => h.accion === "pagar" && h.resultado === "ok") || null;

    return {
        ok: true,
        precio: config.precio,
        tabla: config.tabla,
        numero: fila.numero,
        estado,
        acciones: accionesPara(estado),
        fila: {
            comprador: fila.comprador || fila.nombre || null,
            telefono: fila.telefono || fila.contacto || null,
            contactoId: fila.usuario_global_id || null,
            grupoId: fila.grupo_id || null,
            grupoNombre: fila.grupo_nombre || null,
            eventoId: fila.evento_id || null,
            nombreEvento: fila.nombre_evento || null,
            fechaReserva: fila.fecha_reserva || null,
            horaReserva: fila.hora_reserva || null,
            fechaPago: fila.fecha_pago || null,
            horaPago: fila.hora_pago || null,
            motivoBloqueo: fila.temporal_por || null,
            bloqueadoHasta: fila.bloqueado_hasta || null
        },
        sorteo: principal ? {
            nombreEvento: principal.nombre_evento || null,
            valor: Number(principal.valor) || config.precio,
            fechaEvento: principal.fecha_evento || null,
            horaCierre: principal.hora_cierre || null,
            horaFin: principal.hora_fin || null,
            cifras: principal.cifras ?? config.cifras,
            aceptaReservas: sorteoAceptaReservas(principal, ahora)
        } : null,
        contextos,
        pago: ultimoPago ? {
            metodoPago: ultimoPago.metodo_pago || null,
            observaciones: ultimoPago.observaciones || null,
            operador: ultimoPago.operador_email || null,
            registradoEn: ultimoPago.creado_en
        } : null,
        historial: historial.filas.map(h => ({
            id: h.id,
            accion: h.accion,
            origen: h.origen,
            resultado: h.resultado,
            codigo: h.codigo || null,
            estadoAnterior: h.estado_anterior || null,
            estadoNuevo: h.estado_nuevo || null,
            contactoNombre: h.contacto_nombre || null,
            grupoNombre: h.grupo_nombre || null,
            motivo: h.motivo || null,
            observaciones: h.observaciones || null,
            metodoPago: h.metodo_pago || null,
            operador: h.operador_email || null,
            creadoEn: h.creado_en
        })),
        auditoriaDisponible: !historial.migracionPendiente,
        servidorAhora: ahora.toISOString()
    };

}

// --------------------------------------------------------------- reservar ---

async function reservarManual({
    usuarioId, operador, precio, numero, contactoId, nuevoContacto, eventoId,
    motivo, observaciones, solicitudId
}) {

    const motivoLimpio = texto(motivo, MAX_MOTIVO);
    const obsLimpias = texto(observaciones, MAX_OBSERVACIONES);
    const solicitud = texto(solicitudId, 80);

    const base = {
        usuario_id: usuarioId,
        operador_id: operador?.id || null,
        operador_email: operador?.email || null,
        origen: "manual",
        accion: "reservar",
        numero: String(numero ?? ""),
        motivo: motivoLimpio,
        observaciones: obsLimpias,
        solicitud_id: solicitud,
        precio: Number(precio) || null
    };

    // Todo rechazo queda auditado (si se sabe la tabla) antes de responder.
    const rechazar = async (r, extra = {}) => {
        if (extra.tabla || base.tabla) {
            await registrarAuditoria({ ...base, ...extra, resultado: r.motivo?.startsWith("error") ? "error" : "rechazado", codigo: r.motivo, error: r.motivo?.startsWith("error") ? r.mensaje : null });
        }
        return r;
    };

    if (!usuarioId) return rechazo("sin_usuario", "Sesión no válida.");

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.");

    base.tabla = config.tabla;
    base.precio = config.precio;

    if (!motivoLimpio || motivoLimpio.length < 3) {
        return rechazar(rechazo("falta_motivo", "Indica el motivo de la intervención manual."));
    }

    // ---- sorteo y grupo (contexto) ----
    const sorteo = await sorteoDelPrecio(usuarioId, config.tabla, config.precio);
    if (!sorteo.ok) return rechazar(rechazo("error_sorteo", "No se pudo leer el sorteo activo."));
    if (sorteo.filas.length === 0) return rechazar(rechazo("sin_sorteo", "No hay un sorteo activo para esta tabla."));

    let evento;
    if (eventoId) evento = sorteo.filas.find(e => e.id === eventoId);
    else if (sorteo.filas.length === 1) evento = sorteo.filas[0];

    if (!evento) return rechazar(rechazo("falta_grupo", "Selecciona el grupo de WhatsApp de la reserva."));

    const ctx = {
        evento_id: evento.id,
        identidad_evento_real: evento.identidad_evento_real || null,
        grupo_id: evento.grupo_id || null,
        grupo_nombre: evento.grupo_nombre || null
    };

    const cifras = Number.isInteger(evento.cifras) ? evento.cifras : config.cifras;
    if (!validarFormatoNumero(String(numero), cifras)) {
        return rechazar(rechazo("numero_invalido", `El número debe tener ${cifras} cifras.`), ctx);
    }

    if (!sorteoAceptaReservas(evento)) {
        return rechazar(rechazo("sorteo_cerrado", "El sorteo ya no acepta reservas (cerrado o pasó la hora de cierre)."), ctx);
    }

    const politica = await evaluarGrupo(usuarioId, evento.grupo_id);
    if (!politica.permitido) {
        return rechazar(rechazo("grupo_no_autorizado", "Ese grupo no está autorizado en EFAAT."), ctx);
    }

    // ---- contacto ----
    let contacto = null;

    if (contactoId) {
        contacto = await contactoDelCliente(usuarioId, contactoId);
        if (!contacto) return rechazar(rechazo("contacto_no_existe", "El contacto no está en tu directorio."), ctx);
    } else if (nuevoContacto && typeof nuevoContacto === "object") {
        const alta = await crearContactoManual({ usuarioId, nombre: nuevoContacto.nombre, telefono: nuevoContacto.telefono });
        if (!alta.ok) return rechazar(alta, ctx);
        contacto = alta.contacto;
    } else {
        return rechazar(rechazo("falta_contacto", "Selecciona el contacto de la reserva."), ctx);
    }

    const ctxContacto = {
        ...ctx,
        contacto_id: contacto.id,
        contacto_nombre: contacto.nombre || null,
        contacto_telefono: contacto.telefono || null
    };

    const esDelMismoSorteo = (f) => f.estado === "reservado" && f.usuario_global_id === contacto.id
        && (ctx.identidad_evento_real ? f.identidad_evento_real === ctx.identidad_evento_real : f.evento_id === evento.id);

    // ---- disponibilidad, justo antes de guardar ----
    const antes = await leerFila(usuarioId, config.tabla, String(numero));
    if (!antes.ok) return rechazar(rechazo("error_lectura", "No se pudo leer el número."), ctxContacto);
    if (!antes.fila) return rechazar(rechazo("numero_inexistente", "Ese número no existe en tu tabla."), ctxContacto);

    // Reintento de una reserva que ya quedó guardada (respuesta perdida).
    if (esDelMismoSorteo(antes.fila)) return { ok: true, idempotente: true, estado: "reservado" };

    if (antes.fila.estado !== "libre") {
        return rechazar(rechazo("no_disponible", "El número ya no está disponible.", { estadoActual: estadoDeFila(antes.fila) }), { ...ctxContacto, estado_anterior: antes.fila.estado });
    }

    // ---- guardar: el MISMO servicio que el bot ----
    const reservadas = await reservarNumeros({
        evento: { ...evento, tabla: config.tabla, cifras },
        numeros: [String(numero)],
        usuario: contacto,
        comprador: contacto.nombre,
        contacto: contacto.telefono,
        lib: contacto.lid || null,
        origen: "manual",
        operador,
        auditoria: { motivo: motivoLimpio, observaciones: obsLimpias, solicitudId: solicitud, precio: config.precio }
    });

    if (!reservadas || reservadas.length === 0) {

        // Otro (bot o panel) la tomó entre la lectura y el UPDATE, o falló
        // la escritura: se relee para responder con la verdad.
        const despues = await leerFila(usuarioId, config.tabla, String(numero));

        if (despues.ok && despues.fila && esDelMismoSorteo(despues.fila)) return { ok: true, idempotente: true, estado: "reservado" };

        if (despues.ok && despues.fila && despues.fila.estado !== "libre") {
            return rechazar(rechazo("no_disponible", "Otra operación reservó el número primero.", { estadoActual: estadoDeFila(despues.fila) }), { ...ctxContacto, estado_anterior: "libre", estado_nuevo: despues.fila.estado });
        }

        return rechazar(rechazo("error_guardar", "No se pudo guardar la reserva. Inténtalo de nuevo."), { ...ctxContacto, estado_anterior: "libre" });

    }

    // Contadores del sorteo (lo mismo que hace el bot tras reservar).
    try { await actualizarEvento(evento); } catch { /* best-effort */ }

    return { ok: true, estado: "reservado", fila: reservadas[0] };

}

// ----------------------------------------------------------------- pagar ---

// El propietario es quien valida los pagos de su tabla: registrar el pago
// aquí ES la confirmación administrativa (mismo efecto que el sticker del
// administrador). No existe un estado intermedio "pago por verificar" en las
// tablas; un número solo pasa de 'reservado' a 'pagado'.
async function pagarManual({ usuarioId, operador, precio, numero, metodoPago, observaciones, motivo, solicitudId }) {

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.");

    const base = {
        usuario_id: usuarioId,
        operador_id: operador?.id || null,
        operador_email: operador?.email || null,
        origen: "manual",
        accion: "pagar",
        tabla: config.tabla,
        precio: config.precio,
        numero: String(numero ?? ""),
        metodo_pago: texto(metodoPago, MAX_METODO_PAGO),
        observaciones: texto(observaciones, MAX_OBSERVACIONES),
        motivo: texto(motivo, MAX_MOTIVO),
        solicitud_id: texto(solicitudId, 80)
    };

    const lectura = await leerFila(usuarioId, config.tabla, base.numero);
    if (!lectura.ok) {
        await registrarAuditoria({ ...base, resultado: "error", codigo: "error_lectura" });
        return rechazo("error_lectura", "No se pudo leer el número.");
    }
    if (!lectura.fila) return rechazo("numero_inexistente", "Ese número no existe en tu tabla.");

    const fila = lectura.fila;
    const ctx = {
        evento_id: fila.evento_id || null,
        identidad_evento_real: fila.identidad_evento_real || null,
        grupo_id: fila.grupo_id || null,
        grupo_nombre: fila.grupo_nombre || null,
        contacto_id: fila.usuario_global_id || null,
        contacto_nombre: fila.comprador || fila.nombre || null,
        contacto_telefono: fila.telefono || fila.contacto || null,
        estado_anterior: fila.estado
    };

    if (fila.estado === "pagado" && base.solicitud_id) {
        const h = await historialNumero({ usuarioId, tabla: config.tabla, numero: base.numero, limite: 5 });
        if (h.filas.some(x => x.accion === "pagar" && x.resultado === "ok" && x.solicitud_id === base.solicitud_id)) {
            return { ok: true, idempotente: true, estado: "pagado" };
        }
    }

    if (fila.estado !== "reservado") {
        await registrarAuditoria({ ...base, ...ctx, resultado: "rechazado", codigo: "no_reservado" });
        return rechazo("no_reservado", fila.estado === "pagado" ? "Este número ya está pagado." : "Solo se puede registrar el pago de un número reservado.", { estadoActual: estadoDeFila(fila) });
    }

    const { fecha, hora } = ahoraBogota();

    const { data, error } = await soloDelCliente(
        supabase.from(config.tabla)
            .update({ estado: "pagado", fecha_pago: fecha, hora_pago: hora })
            .eq("numero", base.numero)
            .eq("estado", "reservado"),
        { usuario_id: usuarioId }
    ).select();

    if (error) {
        const motivoError = esErrorTriggerCompradoresSinWhatsapp(error) ? "pago_sin_telefono" : "error_guardar";
        await registrarAuditoria({ ...base, ...ctx, resultado: "error", codigo: motivoError, error: error.message || error.code });
        return rechazo(motivoError, motivoError === "pago_sin_telefono"
            ? "La base exige el teléfono del comprador para registrar el pago (contacto solo con LID)."
            : "No se pudo registrar el pago. Inténtalo de nuevo.");
    }

    if (!data || data.length === 0) {
        await registrarAuditoria({ ...base, ...ctx, resultado: "rechazado", codigo: "estado_cambio" });
        return rechazo("estado_cambio", "El número cambió de estado mientras se registraba el pago. Recarga y revisa.");
    }

    await registrarActividadPanel({ usuarioId, operador, tabla: config.tabla, numero: base.numero, eventoId: fila.evento_id, tipo: "pagado",
        detalle: { precio: config.precio, comprador: fila.comprador, contacto: fila.contacto, metodo_pago: base.metodo_pago, origen: "manual" } });

    await registrarAuditoria({ ...base, ...ctx, estado_nuevo: "pagado", resultado: "ok" });

    await sincronizarContadores(usuarioId, fila.evento_id);

    return { ok: true, estado: "pagado", fila: data[0] };

}

// --------------------------------------------------- liberar / desbloquear ---

async function liberarManual({ usuarioId, operador, precio, numero, confirmar, motivo, observaciones, solicitudId }) {

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.");

    const base = {
        usuario_id: usuarioId,
        operador_id: operador?.id || null,
        operador_email: operador?.email || null,
        origen: "manual",
        tabla: config.tabla,
        precio: config.precio,
        numero: String(numero ?? ""),
        motivo: texto(motivo, MAX_MOTIVO),
        observaciones: texto(observaciones, MAX_OBSERVACIONES),
        solicitud_id: texto(solicitudId, 80)
    };

    const lectura = await leerFila(usuarioId, config.tabla, base.numero);
    if (!lectura.ok) return rechazo("error_lectura", "No se pudo leer el número.");
    if (!lectura.fila) return rechazo("numero_inexistente", "Ese número no existe en tu tabla.");

    const fila = lectura.fila;
    const accion = ["bloqueado", "en_proceso"].includes(fila.estado) ? "desbloquear" : "liberar";
    const ctx = {
        accion,
        evento_id: fila.evento_id || null,
        identidad_evento_real: fila.identidad_evento_real || null,
        grupo_id: fila.grupo_id || null,
        grupo_nombre: fila.grupo_nombre || null,
        contacto_id: fila.usuario_global_id || null,
        contacto_nombre: fila.comprador || fila.nombre || null,
        contacto_telefono: fila.telefono || fila.contacto || null,
        estado_anterior: fila.estado
    };

    if (fila.estado === "libre") return rechazo("ya_libre", "El número ya está disponible.");

    if (confirmar !== true) {
        await registrarAuditoria({ ...base, ...ctx, resultado: "rechazado", codigo: "falta_confirmacion" });
        return rechazo("falta_confirmacion", "Confirma la operación.");
    }

    // Anular un pago borra el registro del comprador: exige motivo.
    if (fila.estado === "pagado" && (!base.motivo || base.motivo.length < 3)) {
        await registrarAuditoria({ ...base, ...ctx, resultado: "rechazado", codigo: "falta_motivo" });
        return rechazo("falta_motivo", "Indica el motivo para anular un número pagado.");
    }

    // Condicionado al estado leído: si entretanto cambió (p. ej. el bot
    // registró el pago), no se pisa.
    const { data, error } = await soloDelCliente(
        supabase.from(config.tabla)
            .update(CAMPOS_LIBRE)
            .eq("numero", base.numero)
            .eq("estado", fila.estado),
        { usuario_id: usuarioId }
    ).select();

    if (error) {
        await registrarAuditoria({ ...base, ...ctx, resultado: "error", codigo: "error_guardar", error: error.message || error.code });
        return rechazo("error_guardar", "No se pudo completar la operación. Inténtalo de nuevo.");
    }

    if (!data || data.length === 0) {
        await registrarAuditoria({ ...base, ...ctx, resultado: "rechazado", codigo: "estado_cambio" });
        return rechazo("estado_cambio", "El número cambió de estado. Recarga y revisa antes de volver a intentarlo.");
    }

    await registrarActividadPanel({ usuarioId, operador, tabla: config.tabla, numero: base.numero, eventoId: fila.evento_id,
        tipo: fila.estado === "pagado" ? "cancelado" : "liberado",
        detalle: { precio: config.precio, estadoAnterior: fila.estado, comprador: fila.comprador, contacto: fila.contacto, motivo: base.motivo, origen: "manual" } });

    await registrarAuditoria({ ...base, ...ctx, estado_nuevo: "libre", resultado: "ok" });

    await sincronizarContadores(usuarioId, fila.evento_id);

    return { ok: true, estado: "libre", accion };

}

// ------------------------------------------------------------- apoyo ---

// «Actividad reciente» del panel (reservas_actividad), escrita por el
// backend con el operador del token. Best-effort.
async function registrarActividadPanel({ usuarioId, operador, tabla, numero, eventoId, tipo, detalle }) {
    try {
        const { error } = await supabase.from("reservas_actividad").insert({
            usuario_id: usuarioId,
            tabla,
            numero,
            evento_id: eventoId || null,
            tipo,
            detalle,
            realizado_por: `panel:${operador?.email || operador?.id || "desconocido"}`
        });
        if (error) console.error("⚠ [RESERVA MANUAL] no se pudo registrar actividad:", error.message);
    } catch (err) {
        console.error("⚠ [RESERVA MANUAL] no se pudo registrar actividad:", err?.message);
    }
}

async function sincronizarContadores(usuarioId, eventoId) {
    if (!eventoId) return;
    try {
        const { data: evento } = await supabase.from("eventos_bot").select("*").eq("id", eventoId).eq("usuario_id", usuarioId).maybeSingle();
        if (evento) await actualizarEvento(evento);
    } catch { /* best-effort */ }
}

module.exports = {
    buscarContactos,
    contextoNumero,
    reservarManual,
    pagarManual,
    liberarManual,
    crearContactoManual,
    olvidarDirectorio,
    normalizarTelefono,
    estadoDeFila
};
