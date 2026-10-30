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
const { reservarNumerosDetallado } = require("../bot/funciones/reservas/reservarNumeros");
const { sorteoAceptaReservas } = require("../bot/funciones/reservas/detectarReserva");
const { actualizarEvento } = require("../bot/funciones/reservas/actualizarEvento");
const { registrarAuditoria, historialNumero } = require("../bot/funciones/reservas/auditoriaReservas");
const { evaluarGrupo } = require("../bot/funciones/grupos/politicaGrupos");
const { buscarBloqueo } = require("../bot/funciones/bloqueo/bloqueoActivo");
const { listarContactos } = require("../bot/funciones/usuarios/listarContactos");
const { obtenerUsuarioGlobal } = require("../bot/funciones/usuarios/obtenerUsuarioGlobal");
const { esErrorTriggerCompradoresSinWhatsapp } = require("../bot/funciones/pagos/marcarReservasPagadasPorAdmin");
const { sorteosParaReservar, sorteosSinPublicar } = require("../sorteos/reservasAnticipadas");

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
const rechazoBloqueado = () => rechazo("contacto_bloqueado", "Este contacto está bloqueado. Desbloquéalo para reservarle números.");

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

// Sorteos programados de esta tabla y precio, todavía sin publicar, con sus
// grupos y si cada uno está autorizado (reservas anticipadas). Nunca crea
// nada en eventos_bot.
async function programadosDelPrecio(usuarioId, config, ahora) {

    const r = await sorteosParaReservar(usuarioId, { tabla: config.tabla, precio: config.precio, ahora });
    if (!r.ok) return { ok: false, lista: [] };

    const lista = await Promise.all(r.data.map(async (p) => ({
        ...p,
        grupos: await Promise.all(p.grupos.map(async (g) => ({
            grupoId: g.grupo_id,
            grupoNombre: g.grupo_nombre || null,
            autorizado: (await evaluarGrupo(usuarioId, g.grupo_id)).permitido
        })))
    })));

    return { ok: true, lista };

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

    const [sorteo, historial, programados, sinPublicar] = await Promise.all([
        sorteoDelPrecio(usuarioId, config.tabla, config.precio),
        historialNumero({ usuarioId, tabla: config.tabla, numero: fila.numero }),
        programadosDelPrecio(usuarioId, config, ahora),
        sorteosSinPublicar(usuarioId)
    ]);

    // Reserva anticipada: su sorteo programado todavía no tiene evento.
    const sorteoAnticipado = fila.identidad_evento_real && sinPublicar.ok
        ? sinPublicar.data.find(s => s.identidad_evento_real === fila.identidad_evento_real) || null
        : null;

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
            bloqueadoHasta: fila.bloqueado_hasta || null,
            sorteoAnticipado: sorteoAnticipado ? sorteoAnticipado.config?.nombre || "Sorteo programado" : null
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
        // Reservas anticipadas: sorteos programados de este precio que aún
        // no se publicaron (sin evento todavía).
        programados: programados.lista.map(p => ({
            sorteoId: p.sorteo.id,
            nombreEvento: p.sorteo.config?.nombre || null,
            fechaEvento: p.fecha || null,
            horaCierre: p.sorteo.config?.hora_cierre || null,
            horaFin: p.sorteo.config?.hora_fin || null,
            publicarEn: p.sorteo.publicar_en,
            cifras: p.sorteo.cifras ?? config.cifras,
            aceptaReservas: p.aceptaReservas,
            motivo: p.motivo,
            grupos: p.grupos
        })),
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

// Destino de una reserva ANTICIPADA: sorteo programado confirmado (versión
// vigente), sin publicar, de esta tabla y precio, sin reinicio pendiente,
// antes de su cierre, y uno de sus grupos. Devuelve un contexto EN MEMORIA
// (sin fila en eventos_bot): identidad y tabla del sorteo, evento_id vacío.
async function destinoProgramado(usuarioId, config, sorteoProgramadoId, grupoId) {

    const r = await sorteosParaReservar(usuarioId, { tabla: config.tabla, precio: config.precio });
    if (!r.ok) return rechazo("error_sorteo", "No se pudo leer el sorteo programado.");

    const p = r.data.find(x => x.sorteo.id === sorteoProgramadoId);
    if (!p) return rechazo("sorteo_no_disponible", "Ese sorteo programado no admite reservas anticipadas en esta tabla (no está confirmado, ya se publicó, cerró o es de otro precio).");
    if (!p.aceptaReservas) return rechazo("sorteo_no_disponible", p.motivo);

    if (!grupoId) return rechazo("falta_grupo", "Selecciona el grupo de WhatsApp de la reserva.");
    const grupo = p.grupos.find(g => g.grupo_id === grupoId);
    if (!grupo) return rechazo("grupo_no_del_sorteo", "Ese grupo no pertenece al sorteo programado.");

    return {
        ok: true,
        evento: {
            id: null,
            usuario_id: usuarioId,
            tabla: config.tabla,
            cifras: p.sorteo.cifras,
            valor: config.precio,
            identidad_evento_real: p.sorteo.identidad_evento_real,
            grupo_id: grupo.grupo_id,
            grupo_nombre: grupo.grupo_nombre || null,
            telefono_bot: null
        }
    };

}

// Datos comunes de auditoría de una reserva manual (uno o varios números).
function baseReserva({ usuarioId, operador, precio, motivo, observaciones, solicitudId, numero }) {
    return {
        usuario_id: usuarioId,
        operador_id: operador?.id || null,
        operador_email: operador?.email || null,
        origen: "manual",
        accion: "reservar",
        numero,
        motivo: texto(motivo, MAX_MOTIVO),
        observaciones: texto(observaciones, MAX_OBSERVACIONES),
        solicitud_id: texto(solicitudId, 80),
        precio: Number(precio) || null
    };
}

// Todo lo que una reserva manual comprueba ANTES de tocar la tabla: tabla del
// precio, motivo, sorteo y grupo, cierre, grupo autorizado y contacto. La
// misma función para un número y para un lote: una sola versión de las reglas.
// Devuelve { ok: true, config, evento, ctx, ctxContacto, contacto, anticipada,
// cifras } o { ok: false, respuesta }. rechazar audita y devuelve el rechazo.
async function prepararReserva({ usuarioId, precio, contactoId, nuevoContacto, eventoId, sorteoProgramadoId, grupoId, base, rechazar, comprobarNumero }) {

    if (!usuarioId) return { ok: false, respuesta: rechazo("sin_usuario", "Sesión no válida.") };

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return { ok: false, respuesta: rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.") };

    base.tabla = config.tabla;
    base.precio = config.precio;

    if (!base.motivo || base.motivo.length < 3) {
        return { ok: false, respuesta: await rechazar(rechazo("falta_motivo", "Indica el motivo de la intervención manual.")) };
    }

    // ---- sorteo y grupo (contexto) ----
    // Sorteo activo (eventoId) o programado sin publicar (sorteoProgramadoId
    // + grupoId): el propietario elige; nunca se deduce por el grupo.
    if (eventoId && sorteoProgramadoId) {
        return { ok: false, respuesta: await rechazar(rechazo("destino_ambiguo", "Elige un sorteo activo o uno programado, no ambos.")) };
    }

    const anticipada = Boolean(sorteoProgramadoId);
    let evento;

    if (anticipada) {

        const destino = await destinoProgramado(usuarioId, config, String(sorteoProgramadoId), grupoId ? String(grupoId) : null);
        if (!destino.ok) return { ok: false, respuesta: await rechazar(destino) };
        evento = destino.evento;

    } else {

        const sorteo = await sorteoDelPrecio(usuarioId, config.tabla, config.precio);
        if (!sorteo.ok) return { ok: false, respuesta: await rechazar(rechazo("error_sorteo", "No se pudo leer el sorteo activo.")) };
        if (sorteo.filas.length === 0) return { ok: false, respuesta: await rechazar(rechazo("sin_sorteo", "No hay un sorteo activo para esta tabla.")) };

        if (eventoId) evento = sorteo.filas.find(e => e.id === eventoId);
        else if (sorteo.filas.length === 1) evento = sorteo.filas[0];

    }

    if (!evento) return { ok: false, respuesta: await rechazar(rechazo("falta_grupo", "Selecciona el grupo de WhatsApp de la reserva.")) };

    const ctx = {
        evento_id: evento.id,
        identidad_evento_real: evento.identidad_evento_real || null,
        grupo_id: evento.grupo_id || null,
        grupo_nombre: evento.grupo_nombre || null
    };

    const cifras = Number.isInteger(evento.cifras) ? evento.cifras : config.cifras;
    const numeroMalo = comprobarNumero?.(cifras);
    if (numeroMalo) return { ok: false, respuesta: await rechazar(numeroMalo, ctx) };

    // El programado ya se comprobó (cierre incluido) en destinoProgramado.
    if (!anticipada && !sorteoAceptaReservas(evento)) {
        return { ok: false, respuesta: await rechazar(rechazo("sorteo_cerrado", "El sorteo ya no acepta reservas (cerrado o pasó la hora de cierre)."), ctx) };
    }

    const politica = await evaluarGrupo(usuarioId, evento.grupo_id);
    if (!politica.permitido) {
        return { ok: false, respuesta: await rechazar(rechazo("grupo_no_autorizado", "Ese grupo no está autorizado en EFAAT."), ctx) };
    }

    // ---- contacto ----
    let contacto = null;

    if (contactoId) {
        contacto = await contactoDelCliente(usuarioId, contactoId);
        if (!contacto) return { ok: false, respuesta: await rechazar(rechazo("contacto_no_existe", "El contacto no está en tu directorio."), ctx) };
    } else if (nuevoContacto && typeof nuevoContacto === "object") {
        const alta = await crearContactoManual({ usuarioId, nombre: nuevoContacto.nombre, telefono: nuevoContacto.telefono });
        if (!alta.ok) return { ok: false, respuesta: await rechazar(alta, ctx) };
        contacto = alta.contacto;
    } else {
        return { ok: false, respuesta: await rechazar(rechazo("falta_contacto", "Selecciona el contacto de la reserva."), ctx) };
    }

    const ctxContacto = {
        ...ctx,
        contacto_id: contacto.id,
        contacto_nombre: contacto.nombre || null,
        contacto_telefono: contacto.telefono || null
    };

    // Contacto que el propio cliente bloqueó: excepción de integridad (no un
    // aviso), porque esa decisión ya la tomó el administrador al bloquear.
    // Para reservarle, primero se desbloquea. Si «bloqueados» no se puede
    // leer, se reserva como siempre (falla abierto, ver bloqueoActivo.js) y
    // queda «[BLOQUEO ACTIVO] no se pudo leer bloqueados» en el registro.
    const { bloqueado } = await buscarBloqueo(usuarioId, { telefono: contacto.telefono || null, lid: contacto.lid || null }, { fresco: true });
    if (bloqueado) {
        return { ok: false, respuesta: await rechazar(rechazoBloqueado(), ctxContacto) };
    }

    return { ok: true, config, evento, ctx, ctxContacto, contacto, anticipada, cifras };

}

async function reservarManual({
    usuarioId, operador, precio, numero, contactoId, nuevoContacto, eventoId,
    sorteoProgramadoId, grupoId, motivo, observaciones, solicitudId
}) {

    const base = baseReserva({ usuarioId, operador, precio, motivo, observaciones, solicitudId, numero: String(numero ?? "") });

    // Todo rechazo queda auditado (si se sabe la tabla) antes de responder.
    const rechazar = async (r, extra = {}) => {
        if (extra.tabla || base.tabla) {
            await registrarAuditoria({ ...base, ...extra, resultado: r.motivo?.startsWith("error") ? "error" : "rechazado", codigo: r.motivo, error: r.motivo?.startsWith("error") ? r.mensaje : null });
        }
        return r;
    };

    const preparada = await prepararReserva({
        usuarioId, precio, contactoId, nuevoContacto, eventoId, sorteoProgramadoId, grupoId, base, rechazar,
        comprobarNumero: (cifras) => (validarFormatoNumero(String(numero), cifras) ? null : rechazo("numero_invalido", `El número debe tener ${cifras} cifras.`))
    });

    if (!preparada.ok) return preparada.respuesta;

    const { config, evento, ctx, ctxContacto, contacto, anticipada, cifras } = preparada;
    const motivoLimpio = base.motivo;
    const obsLimpias = base.observaciones;
    const solicitud = base.solicitud_id;

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
    const escritura = await reservarNumerosDetallado({
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

    // Bloqueado entre prepararReserva y el UPDATE (la barrera de
    // reservarNumeros.js lo detectó): se dice la causa real, no «no se pudo
    // guardar».
    if (escritura.contactoBloqueado) return rechazar(rechazoBloqueado(), ctxContacto);

    const reservadas = escritura.filas;

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

    // Contadores del sorteo (lo mismo que hace el bot tras reservar). Una
    // anticipada todavía no tiene evento: los cuenta el publicador al crearlo.
    if (!anticipada) {
        try { await actualizarEvento(evento); } catch { /* best-effort */ }
    }

    return { ok: true, estado: "reservado", fila: reservadas[0], ...(anticipada ? { anticipada: true } : {}) };

}

// ------------------------------------------------ pagos sin duplicar ---

// Una misma solicitud de pago (solicitudId) se ejecuta UNA vez por proceso:
// dos POST simultáneos (doble clic, reintento del navegador o del proxy)
// comparten la misma ejecución y la misma respuesta, y el reintento de una
// solicitud que ya terminó bien se reconoce aunque la auditoría (032) no
// esté disponible para consultarla. No cambia ninguna regla: el UPDATE
// sigue condicionado a estado='reservado' y sin solicitudId todo es igual.
const PAGOS_EN_CURSO = new Map();
const PAGOS_HECHOS = new Map();     // clave -> expira (ms)
const TTL_PAGO_HECHO_MS = 15 * 60 * 1000;
const MAX_PAGOS_HECHOS = 5000;

function clavePago(partes) {
    const solicitud = texto(partes[partes.length - 1], 80);
    return solicitud ? [...partes.slice(0, -1), solicitud].map(String).join("|") : null;
}

function pagoYaHecho(clave) {
    const expira = clave ? PAGOS_HECHOS.get(clave) : undefined;
    if (expira === undefined) return false;
    if (expira > Date.now()) return true;
    PAGOS_HECHOS.delete(clave);
    return false;
}

function recordarPago(clave) {
    if (!clave) return;
    PAGOS_HECHOS.delete(clave);
    PAGOS_HECHOS.set(clave, Date.now() + TTL_PAGO_HECHO_MS);
    // Map conserva el orden de inserción: se descartan los más antiguos.
    while (PAGOS_HECHOS.size > MAX_PAGOS_HECHOS) PAGOS_HECHOS.delete(PAGOS_HECHOS.keys().next().value);
}

async function unaVezPorSolicitud(clave, ejecutar) {
    if (!clave) return ejecutar();
    const enCurso = PAGOS_EN_CURSO.get(clave);
    if (enCurso) return enCurso;
    const promesa = Promise.resolve().then(ejecutar);
    PAGOS_EN_CURSO.set(clave, promesa);
    try {
        return await promesa;
    } finally {
        PAGOS_EN_CURSO.delete(clave);
    }
}

// ----------------------------------------------------------------- pagar ---

// El propietario es quien valida los pagos de su tabla: registrar el pago
// aquí ES la confirmación administrativa (mismo efecto que el sticker del
// administrador). No existe un estado intermedio "pago por verificar" en las
// tablas; un número solo pasa de 'reservado' a 'pagado'.
function pagarManual(datos) {
    const clave = clavePago([datos.usuarioId, "pagar", datos.precio, String(datos.numero ?? ""), datos.solicitudId]);
    return unaVezPorSolicitud(clave, async () => {
        const r = await pagarManualUnaVez(datos, clave);
        if (r && r.ok) recordarPago(clave);
        return r;
    });
}

async function pagarManualUnaVez({ usuarioId, operador, precio, numero, metodoPago, observaciones, motivo, solicitudId }, clave) {

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
        // Esta misma solicitud ya pagó el número (sin depender de la auditoría).
        if (pagoYaHecho(clave)) return { ok: true, idempotente: true, estado: "pagado" };
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

// ---------------------------------------------------- operaciones por lote ---
// Varios números en UNA solicitud y UNA escritura: una lectura de las filas,
// un UPDATE condicionado por estado (el mismo de la operación de un número,
// atómico fila a fila: de dos operaciones simultáneas solo una encuentra la
// fila en ese estado) y un solo insert de actividad y de auditoría. Las
// reglas son las de un número: reservar usa prepararReserva y reservarNumeros.
//
// Resultado por número: hecho | sin_cambio | omitido (su estado no lo admite
// o es de otro sorteo; no se tocó) | error. Un fallo individual no deshace
// los demás; un rechazo general (sorteo cerrado, contacto...) responde
// ok:false y no toca nada.

const MAX_LOTE = 1000;
const NUMERO_LOTE = /^\d{1,4}$/;

const ESTADO_LEGIBLE = {
    libre: "libre", reservado: "reservado", pagado: "pagado", bloqueado: "bloqueado",
    en_proceso: "en proceso", en_proceso_vencido: "con retención vencida"
};

function numerosDelLote(numeros) {
    const lista = [...new Set((Array.isArray(numeros) ? numeros : []).map(n => String(n?.numero ?? n ?? "").trim()))];
    if (lista.length === 0) return rechazo("sin_numeros", "No hay números seleccionados.");
    if (lista.length > MAX_LOTE) return rechazo("lote_grande", `Se pueden procesar hasta ${MAX_LOTE} números a la vez.`);
    if (lista.some(n => !NUMERO_LOTE.test(n))) return rechazo("numero_invalido", "La selección tiene un número no válido.");
    return { ok: true, lista };
}

async function leerFilas(usuarioId, tabla, numeros) {
    const { data, error } = await soloDelCliente(supabase.from(tabla).select("*").in("numero", numeros), { usuario_id: usuarioId });
    if (error) return { ok: false, error };
    const porNumero = new Map();
    // Número repetido en la cuadrícula: no se adivina cuál vale.
    for (const f of data || []) porNumero.set(String(f.numero), porNumero.has(String(f.numero)) ? null : f);
    return { ok: true, porNumero };
}

function contextoFila(fila) {
    return {
        evento_id: fila.evento_id || null,
        identidad_evento_real: fila.identidad_evento_real || null,
        grupo_id: fila.grupo_id || null,
        grupo_nombre: fila.grupo_nombre || null,
        contacto_id: fila.usuario_global_id || null,
        contacto_nombre: fila.comprador || fila.nombre || null,
        contacto_telefono: fila.telefono || fila.contacto || null,
        estado_anterior: fila.estado
    };
}

// ¿Ocupado por un sorteo que no es el activo de este precio? (por identidad:
// un sorteo en varios grupos tiene un evento por grupo).
function deOtroSorteo(fila, activos) {
    if (fila.estado !== "reservado" && fila.estado !== "pagado") return false;
    if (activos.length === 0) return true;
    if (fila.identidad_evento_real && activos.some(e => e.identidad_evento_real)) {
        return !activos.some(e => e.identidad_evento_real === fila.identidad_evento_real);
    }
    return fila.evento_id ? !activos.some(e => e.id === fila.evento_id) : true;
}

function respuestaLote(accion, resultados) {
    const orden = [...resultados].sort((a, b) => a.numero.localeCompare(b.numero));
    const contar = (e) => orden.filter(x => x.estado === e).length;
    return { ok: true, accion, resultados: orden, hechos: contar("hecho"), sinCambio: contar("sin_cambio"), omitidos: contar("omitido"), errores: contar("error") };
}

const noExiste = (numero) => ({ numero, estado: "error", codigo: "numero_inexistente", mensaje: "Ese número no existe en tu tabla." });
const repetido = (numero) => ({ numero, estado: "error", codigo: "numero_repetido", mensaje: "Ese número está repetido en la tabla: revísalo." });
const ajeno = (numero) => ({ numero, estado: "omitido", codigo: "otro_sorteo", mensaje: "Es de otro sorteo: no se tocó." });

async function contadoresDeFilas(usuarioId, filas) {
    // Una vez por sorteo: actualizarEvento recalcula todos sus grupos.
    const vistos = new Map();
    for (const f of filas) {
        if (f.evento_id && !vistos.has(f.identidad_evento_real || f.evento_id)) vistos.set(f.identidad_evento_real || f.evento_id, f.evento_id);
    }
    for (const eventoId of vistos.values()) await sincronizarContadores(usuarioId, eventoId);
}

async function reservarLote({ usuarioId, operador, precio, numeros, contactoId, nuevoContacto, eventoId, sorteoProgramadoId, grupoId, motivo, observaciones, solicitudId }) {

    const lote = numerosDelLote(numeros);
    if (!lote.ok) return lote;

    const base = baseReserva({ usuarioId, operador, precio, motivo, observaciones, solicitudId, numero: "" });

    const auditarRechazos = (filas) => registrarAuditoria(filas.map(({ numero, codigo, estado_anterior, ctx }) => ({
        ...base, ...ctx, numero, resultado: String(codigo).startsWith("error") ? "error" : "rechazado", codigo, ...(estado_anterior ? { estado_anterior } : {})
    })));

    const rechazar = async (r, extra = {}) => {
        if (base.tabla) await auditarRechazos(lote.lista.map(numero => ({ numero, codigo: r.motivo, ctx: extra })));
        return r;
    };

    const preparada = await prepararReserva({ usuarioId, precio, contactoId, nuevoContacto, eventoId, sorteoProgramadoId, grupoId, base, rechazar });
    if (!preparada.ok) return preparada.respuesta;

    const { config, evento, ctx, ctxContacto, contacto, anticipada, cifras } = preparada;

    const esDelMismoSorteo = (f) => f.estado === "reservado" && f.usuario_global_id === contacto.id
        && (ctx.identidad_evento_real ? f.identidad_evento_real === ctx.identidad_evento_real : f.evento_id === evento.id);

    const lectura = await leerFilas(usuarioId, config.tabla, lote.lista);
    if (!lectura.ok) return rechazar(rechazo("error_lectura", "No se pudieron leer los números."), ctxContacto);

    const resultados = [];
    const rechazos = [];
    const candidatos = [];

    const ocupado = (numero, fila, mensaje) => {
        resultados.push({ numero, estado: "omitido", codigo: "no_disponible", estadoActual: estadoDeFila(fila), mensaje });
        rechazos.push({ numero, codigo: "no_disponible", estado_anterior: fila.estado, ctx: ctxContacto });
    };

    for (const numero of lote.lista) {
        const fila = lectura.porNumero.get(numero);
        if (!validarFormatoNumero(numero, cifras)) resultados.push({ numero, estado: "error", codigo: "numero_invalido", mensaje: `El número debe tener ${cifras} cifras.` });
        else if (fila === undefined) resultados.push(noExiste(numero));
        else if (fila === null) resultados.push(repetido(numero));
        else if (esDelMismoSorteo(fila)) resultados.push({ numero, estado: "sin_cambio", mensaje: "Ya estaba reservado para este contacto." });
        else if (fila.estado !== "libre") ocupado(numero, fila, `No está libre (está ${ESTADO_LEGIBLE[estadoDeFila(fila)] || fila.estado}). No se tocó.`);
        else candidatos.push(numero);
    }

    const escritura = candidatos.length === 0 ? { filas: [] } : await reservarNumerosDetallado({
        evento: { ...evento, tabla: config.tabla, cifras },
        numeros: candidatos,
        usuario: contacto,
        comprador: contacto.nombre,
        contacto: contacto.telefono,
        lib: contacto.lid || null,
        origen: "manual",
        operador,
        auditoria: { motivo: base.motivo, observaciones: base.observaciones, solicitudId: base.solicitud_id, precio: config.precio }
    });

    // Bloqueado entre prepararReserva y el UPDATE: no se tocó ningún número.
    if (escritura.contactoBloqueado) return rechazar(rechazoBloqueado(), ctxContacto);

    const hechos = new Set((escritura.filas || []).map(f => String(f.numero)));
    for (const numero of hechos) resultados.push({ numero, estado: "hecho", mensaje: "Reservado." });

    // Otro (bot o panel) los tomó entre la lectura y el UPDATE, o falló la
    // escritura: se releen una vez para responder con la verdad.
    const perdidos = candidatos.filter(n => !hechos.has(n));

    if (perdidos.length) {
        const despues = await leerFilas(usuarioId, config.tabla, perdidos);
        for (const numero of perdidos) {
            const fila = despues.ok ? despues.porNumero.get(numero) : null;
            if (fila && esDelMismoSorteo(fila)) resultados.push({ numero, estado: "sin_cambio", mensaje: "Ya estaba reservado para este contacto." });
            else if (fila && fila.estado !== "libre") ocupado(numero, fila, `Ya no estaba libre (ahora está ${ESTADO_LEGIBLE[estadoDeFila(fila)] || fila.estado}): otra operación lo tomó primero. No se tocó.`);
            else {
                resultados.push({ numero, estado: "error", codigo: "error_guardar", mensaje: "No se pudo guardar la reserva. Inténtalo de nuevo." });
                rechazos.push({ numero, codigo: "error_guardar", estado_anterior: "libre", ctx: ctxContacto });
            }
        }
    }

    if (rechazos.length) await auditarRechazos(rechazos);

    // Una anticipada todavía no tiene evento: los cuenta el publicador.
    if (!anticipada && hechos.size) {
        try { await actualizarEvento(evento); } catch { /* best-effort */ }
    }

    return respuestaLote("reservar", resultados);

}

async function pagarLote({ usuarioId, operador, precio, numeros, metodoPago, observaciones, motivo, solicitudId, otrosSorteoAutorizados }) {

    const lote = numerosDelLote(numeros);
    if (!lote.ok) return lote;

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
        metodo_pago: texto(metodoPago, MAX_METODO_PAGO),
        observaciones: texto(observaciones, MAX_OBSERVACIONES),
        motivo: texto(motivo, MAX_MOTIVO),
        solicitud_id: texto(solicitudId, 80)
    };

    const [lectura, sorteo] = await Promise.all([
        leerFilas(usuarioId, config.tabla, lote.lista),
        sorteoDelPrecio(usuarioId, config.tabla, config.precio)
    ]);

    if (!lectura.ok || !sorteo.ok) return rechazo("error_lectura", "No se pudieron leer los números.");

    const autorizados = new Set((otrosSorteoAutorizados || []).map(String));
    const resultados = [];
    const auditoria = [];
    const candidatos = [];

    for (const numero of lote.lista) {
        const fila = lectura.porNumero.get(numero);
        if (fila === undefined) { resultados.push(noExiste(numero)); continue; }
        if (fila === null) { resultados.push(repetido(numero)); continue; }
        if (fila.estado === "pagado") { resultados.push({ numero, estado: "sin_cambio", mensaje: "Ya estaba pagado." }); continue; }
        const ctx = contextoFila(fila);
        if (fila.estado !== "reservado") {
            resultados.push({ numero, estado: "omitido", codigo: "no_reservado", estadoActual: estadoDeFila(fila), mensaje: `Cambió de estado (ahora está ${ESTADO_LEGIBLE[estadoDeFila(fila)] || fila.estado}). No se tocó.` });
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "no_reservado" });
        } else if (deOtroSorteo(fila, sorteo.filas) && !autorizados.has(numero)) {
            resultados.push(ajeno(numero));
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "otro_sorteo" });
        } else candidatos.push(numero);
    }

    const { fecha, hora } = ahoraBogota();

    const escribir = (lista) => soloDelCliente(
        supabase.from(config.tabla)
            .update({ estado: "pagado", fecha_pago: fecha, hora_pago: hora })
            .in("numero", lista)
            .eq("estado", "reservado"),
        { usuario_id: usuarioId }
    ).select();

    const pagadas = [];
    const fallidos = new Map();

    if (candidatos.length) {

        const { data, error } = await escribir(candidatos);

        if (!error) pagadas.push(...(data || []));
        else if (esErrorTriggerCompradoresSinWhatsapp(error) && candidatos.length > 1) {
            // El disparador de compradores aborta la sentencia entera si UNA
            // fila no tiene teléfono: se separa número a número (dentro de
            // esta misma solicitud) para no perder los pagos válidos.
            for (const numero of candidatos) {
                const uno = await escribir([numero]);
                if (uno.error) fallidos.set(numero, uno.error);
                else pagadas.push(...(uno.data || []));
            }
        } else for (const numero of candidatos) fallidos.set(numero, error);

    }

    const hechos = new Set(pagadas.map(f => String(f.numero)));

    for (const numero of candidatos) {
        const fila = lectura.porNumero.get(numero);
        const ctx = contextoFila(fila);
        const error = fallidos.get(numero);
        if (hechos.has(numero)) {
            resultados.push({ numero, estado: "hecho", mensaje: "Pago registrado." });
            auditoria.push({ ...base, ...ctx, numero, estado_nuevo: "pagado", resultado: "ok" });
        } else if (error) {
            const codigo = esErrorTriggerCompradoresSinWhatsapp(error) ? "pago_sin_telefono" : "error_guardar";
            resultados.push({ numero, estado: "error", codigo, mensaje: codigo === "pago_sin_telefono" ? "La base exige el teléfono del comprador para registrar el pago (contacto solo con LID)." : "No se pudo registrar el pago. Inténtalo de nuevo." });
            auditoria.push({ ...base, ...ctx, numero, resultado: "error", codigo, error: error.message || error.code });
        } else {
            resultados.push({ numero, estado: "omitido", codigo: "estado_cambio", mensaje: "Cambió de estado mientras se registraba el pago. No se tocó." });
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "estado_cambio" });
        }
    }

    await registrarActividadesPanel(pagadas.map(f => ({
        usuarioId, operador, tabla: config.tabla, numero: f.numero, eventoId: f.evento_id, tipo: "pagado",
        detalle: { precio: config.precio, comprador: f.comprador, contacto: f.contacto, metodo_pago: base.metodo_pago, origen: "manual" }
    })));

    await registrarAuditoria(auditoria);
    await contadoresDeFilas(usuarioId, pagadas);

    return respuestaLote("pagar", resultados);

}

// numeros: [{ numero, estado }]: el estado es el que el administrador vio y
// confirmó; si en el servidor ya es otro, ese número no se toca.
async function liberarLote({ usuarioId, operador, precio, numeros, confirmar, motivo, observaciones, solicitudId, otrosSorteoAutorizados }) {

    const lote = numerosDelLote(numeros);
    if (!lote.ok) return lote;

    if (confirmar !== true) return rechazo("falta_confirmacion", "Confirma la operación.");

    const config = await resolverConfig(usuarioId, precio);
    if (!config) return rechazo("tabla_no_configurada", "No existe una tabla configurada para este precio.");

    const esperados = new Map((Array.isArray(numeros) ? numeros : []).filter(n => n?.estado).map(n => [String(n.numero), n.estado]));

    const base = {
        usuario_id: usuarioId,
        operador_id: operador?.id || null,
        operador_email: operador?.email || null,
        origen: "manual",
        tabla: config.tabla,
        precio: config.precio,
        motivo: texto(motivo, MAX_MOTIVO),
        observaciones: texto(observaciones, MAX_OBSERVACIONES),
        solicitud_id: texto(solicitudId, 80)
    };

    const [lectura, sorteo] = await Promise.all([
        leerFilas(usuarioId, config.tabla, lote.lista),
        sorteoDelPrecio(usuarioId, config.tabla, config.precio)
    ]);

    if (!lectura.ok || !sorteo.ok) return rechazo("error_lectura", "No se pudieron leer los números.");

    const autorizados = new Set((otrosSorteoAutorizados || []).map(String));
    const resultados = [];
    const auditoria = [];
    const porEstado = new Map();
    const accionDe = (fila) => (["bloqueado", "en_proceso"].includes(fila.estado) ? "desbloquear" : "liberar");

    for (const numero of lote.lista) {
        const fila = lectura.porNumero.get(numero);
        if (fila === undefined) { resultados.push(noExiste(numero)); continue; }
        if (fila === null) { resultados.push(repetido(numero)); continue; }
        if (fila.estado === "libre") { resultados.push({ numero, estado: "sin_cambio", mensaje: "Ya estaba libre." }); continue; }
        const ctx = { ...contextoFila(fila), accion: accionDe(fila) };
        const esperado = esperados.get(numero);
        if (esperado && esperado !== fila.estado) {
            resultados.push({ numero, estado: "omitido", codigo: "estado_cambio", estadoActual: estadoDeFila(fila), mensaje: `Cambió de estado (ahora está ${ESTADO_LEGIBLE[estadoDeFila(fila)] || fila.estado}). No se tocó: revísalo antes.` });
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "estado_cambio" });
        } else if (deOtroSorteo(fila, sorteo.filas) && !autorizados.has(numero)) {
            resultados.push(ajeno(numero));
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "otro_sorteo" });
        } else if (fila.estado === "pagado" && (!base.motivo || base.motivo.length < 3)) {
            // Anular un pago borra el registro del comprador: exige motivo.
            resultados.push({ numero, estado: "error", codigo: "falta_motivo", mensaje: "Indica el motivo para anular un número pagado." });
            auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "falta_motivo" });
        } else porEstado.set(fila.estado, [...(porEstado.get(fila.estado) || []), numero]);
    }

    const liberadas = [];

    // Un UPDATE por estado leído: si entretanto cambió, no se pisa.
    for (const [estado, lista] of porEstado) {

        const { data, error } = await soloDelCliente(
            supabase.from(config.tabla).update(CAMPOS_LIBRE).in("numero", lista).eq("estado", estado),
            { usuario_id: usuarioId }
        ).select();

        const hechos = new Set((data || []).map(f => String(f.numero)));

        for (const numero of lista) {
            const fila = lectura.porNumero.get(numero);
            const ctx = { ...contextoFila(fila), accion: accionDe(fila) };
            if (hechos.has(numero)) {
                liberadas.push(fila);
                resultados.push({ numero, estado: "hecho", mensaje: accionDe(fila) === "desbloquear" ? "Desbloqueado: vuelve a estar disponible." : "Liberado: vuelve a estar disponible." });
                auditoria.push({ ...base, ...ctx, numero, estado_nuevo: "libre", resultado: "ok" });
            } else if (error) {
                resultados.push({ numero, estado: "error", codigo: "error_guardar", mensaje: "No se pudo completar la operación. Inténtalo de nuevo." });
                auditoria.push({ ...base, ...ctx, numero, resultado: "error", codigo: "error_guardar", error: error.message || error.code });
            } else {
                resultados.push({ numero, estado: "omitido", codigo: "estado_cambio", mensaje: "Cambió de estado. No se tocó: revísalo antes." });
                auditoria.push({ ...base, ...ctx, numero, resultado: "rechazado", codigo: "estado_cambio" });
            }
        }

    }

    await registrarActividadesPanel(liberadas.map(f => ({
        usuarioId, operador, tabla: config.tabla, numero: f.numero, eventoId: f.evento_id,
        tipo: f.estado === "pagado" ? "cancelado" : "liberado",
        detalle: { precio: config.precio, estadoAnterior: f.estado, comprador: f.comprador, contacto: f.contacto, motivo: base.motivo, origen: "manual" }
    })));

    await registrarAuditoria(auditoria);
    await contadoresDeFilas(usuarioId, liberadas);

    return respuestaLote("liberar", resultados);

}

function operarLote({ accion, ...datos }) {
    if (accion === "reservar") return reservarLote(datos);
    // Dos envíos simultáneos del MISMO lote de pagos comparten la ejecución.
    if (accion === "pagar") return unaVezPorSolicitud(clavePago([datos.usuarioId, "lote-pagar", datos.precio, datos.solicitudId]), () => pagarLote(datos));
    if (accion === "liberar") return liberarLote(datos);
    return rechazo("accion_invalida", "Operación no válida.");
}

// ------------------------------------------------------------- apoyo ---

// «Actividad reciente» del panel (reservas_actividad), escrita por el
// backend con el operador del token. Best-effort.
async function registrarActividadPanel(fila) {
    return registrarActividadesPanel([fila]);
}

async function registrarActividadesPanel(filas) {
    if (filas.length === 0) return;
    try {
        const { error } = await supabase.from("reservas_actividad").insert(filas.map(({ usuarioId, operador, tabla, numero, eventoId, tipo, detalle }) => ({
            usuario_id: usuarioId,
            tabla,
            numero,
            evento_id: eventoId || null,
            tipo,
            detalle,
            realizado_por: `panel:${operador?.email || operador?.id || "desconocido"}`
        })));
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
    operarLote,
    crearContactoManual,
    olvidarDirectorio,
    normalizarTelefono,
    estadoDeFila
};
