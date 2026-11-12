// ==========================================================================
// routes/rifas.js — panel «Mis rifas» sobre el motor de rifas (050).
//
// Cada rifa es independiente: se identifica por su tabla_id (UUID), nunca por
// el precio. El cliente sale del token (exigirUsuario → req.usuarioId); un
// usuarioId o tabla_id ajenos responden lo mismo que uno inexistente.
//
// Preparar (crear, editar, vincular grupos, archivar) se permite siempre: no
// toca números ni ventas. Operar números (reservar, pagar, liberar, bloquear,
// reiniciar) solo con MOTOR_RIFAS=nuevo, para que el panel y el bot nunca
// vendan en dos motores a la vez.
// ==========================================================================

const router = require("express").Router();

const { exigirUsuario } = require("../middleware/autenticacionUsuario");
const rifas = require("../rifas/repositorio");
const { modoMotor, motorNuevo } = require("../rifas/motor");
const { resultadoEnTexto } = require("../rifas/formato");
const { vigente } = require("../shared/eventos/estadosGestion");

const supabase = () => require("../lib/supabase");

// Códigos de negocio → HTTP. El cuerpo siempre lleva { ok, motivo }.
const HTTP = {
    rifa_no_encontrada: 404, sin_cliente: 401, motor_legado: 409, sorteo_en_curso: 409,
    confirmacion_requerida: 400, sin_numeros: 400, demasiados_numeros: 400, datos_invalidos: 400,
    codigo_en_uso: 409, config_invalida: 400, tiene_historial: 409, error_supabase: 502
};

function responder(res, r, cifras) {
    const cuerpo = cifras ? resultadoEnTexto(r, cifras) : r;
    if (r?.ok) return res.json(cuerpo);
    return res.status(HTTP[r?.motivo] || 409).json(cuerpo);
}

const quien = (req, motivo) => rifas.actor({
    origen: "manual",
    operadorId: req.usuarioId,
    operadorEmail: req.usuarioEmail,
    solicitudId: req.get("x-solicitud-id") || req.body?.solicitud_id || null,
    motivo: motivo || req.body?.motivo || null
});

// Envoltura: errores inesperados → 500 sin detalles internos.
const ruta = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        console.error(`❌ [RUTA RIFAS] ${req.method} ${req.originalUrl}: ${e.message}`);
        res.status(500).json({ ok: false, motivo: "error_interno", error: "No se pudo completar la operación." });
    }
};

// Solo con el motor nuevo activo.
function exigirMotorNuevo(req, res, next) {
    if (motorNuevo()) return next();
    return res.status(409).json({ ok: false, motivo: "motor_legado", error: "El motor de rifas independientes todavía no está activo." });
}

// La rifa del cliente (o 404). Deja req.rifa para no volver a leerla.
async function cargarRifa(req, res, next) {
    try {
        const rifa = await rifas.obtenerRifa(req.usuarioId, req.params.id);
        if (!rifa) return res.status(404).json({ ok: false, motivo: "rifa_no_encontrada" });
        req.rifa = rifa;
        return next();
    } catch (e) {
        console.error(`❌ [RUTA RIFAS] cargarRifa: ${e.message}`);
        return res.status(502).json({ ok: false, motivo: "error_supabase" });
    }
}

const numerosDelCuerpo = (req) => (Array.isArray(req.body?.numeros) ? req.body.numeros.slice(0, rifas.MAX_NUMEROS + 1) : []);

// Datos del comprador que el panel puede enviar (lista blanca).
function datosComprador(body = {}) {
    const d = {};
    for (const k of ["comprador", "contacto", "telefono", "observaciones", "grupo_id", "grupo_nombre"]) {
        if (typeof body[k] === "string" && body[k].trim()) d[k] = body[k].trim();
    }
    if (typeof body.usuario_global_id === "string") d.usuario_global_id = body.usuario_global_id;
    return d;
}

// Sorteos en curso en los grupos vinculados a la rifa: reiniciarla borraría
// números que el sorteo está vendiendo. Con eventos_bot.tabla_id (051) se
// filtra por la rifa; antes, por los grupos vinculados.
async function sorteosEnCurso(usuarioId, tablaId) {
    const grupos = (await rifas.gruposDeRifa(usuarioId, tablaId)).map(g => g.grupo_id);
    if (grupos.length === 0) return [];
    const { data, error } = await supabase().from("eventos_bot")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .in("grupo_id", grupos);
    if (error) throw new Error(error.message);
    return (data || []).filter(e => vigente(e) && (e.tabla_id === undefined || e.tabla_id === null || e.tabla_id === tablaId));
}

// ------------------------------------------------------------------ lectura

router.get("/modo", exigirUsuario, (req, res) => res.json({ ok: true, modo: modoMotor() }));

// Avisos que piden intervención del administrador (decisión D1): el bot se
// detiene en estos casos y no elige una rifa por su cuenta. Se calculan en
// el momento a partir de los sorteos VIGENTES del cliente.
//   sorteo_sin_rifa      sorteo vigente sin tabla_id: el bot no vende.
//   grupo_ambiguo        grupo con 2+ sorteos vigentes: el bot no responde.
//   rifa_de_otro_precio  sorteo vigente cuya rifa no es de su precio.
router.get("/avisos", exigirUsuario, ruta(async (req, res) => {
    const { data, error } = await supabase().from("eventos_bot")
        .select("id, grupo_id, grupo_nombre, valor, tabla_id, estado, activo, cierre_estado, cierre_motivo")
        .eq("usuario_id", req.usuarioId).eq("activo", true);
    if (error) throw new Error(error.message);
    const vigentes = (data || []).filter(vigente);
    const lista = await rifas.listarRifas(req.usuarioId, { incluirArchivadas: true });
    const precioDe = new Map(lista.map((r) => [r.tabla_id || r.id, Number(r.precio)]));
    const valor = (e) => Number(String(e.valor ?? "").replace(/[^\d]/g, "")) || null;
    const avisos = [];
    const porGrupo = new Map();
    for (const e of vigentes) {
        porGrupo.set(e.grupo_id, [...(porGrupo.get(e.grupo_id) || []), e]);
        if (!e.tabla_id) {
            avisos.push({ tipo: "sorteo_sin_rifa", evento_id: e.id, grupo_id: e.grupo_id, grupo_nombre: e.grupo_nombre, valor: valor(e) });
        } else if (precioDe.has(e.tabla_id) && precioDe.get(e.tabla_id) !== valor(e)) {
            avisos.push({ tipo: "rifa_de_otro_precio", evento_id: e.id, grupo_id: e.grupo_id, grupo_nombre: e.grupo_nombre,
                valor: valor(e), precio_rifa: precioDe.get(e.tabla_id), tabla_id: e.tabla_id });
        }
    }
    for (const [grupoId, evs] of porGrupo) {
        if (evs.length > 1) avisos.push({ tipo: "grupo_ambiguo", grupo_id: grupoId, grupo_nombre: evs[0].grupo_nombre,
            sorteos: evs.map((e) => ({ evento_id: e.id, valor: valor(e) })) });
    }
    res.json({ ok: true, modo: modoMotor(), avisos });
}));

router.get("/", exigirUsuario, ruta(async (req, res) => {
    const lista = await rifas.listarRifas(req.usuarioId, { incluirArchivadas: req.query.archivadas === "1" });
    res.json({ ok: true, modo: modoMotor(), rifas: lista });
}));

router.get("/:id", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    const [{ filas }, grupos] = await Promise.all([
        rifas.leerNumeros(req.usuarioId, req.rifa.id),
        rifas.gruposDeRifa(req.usuarioId, req.rifa.id)
    ]);
    res.json({ ok: true, modo: modoMotor(), rifa: req.rifa, numeros: filas, grupos });
}));

router.get("/:id/archivo", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    const ciclo = req.query.ciclo ? Number(req.query.ciclo) : null;
    res.json({ ok: true, archivo: await rifas.leerArchivo(req.usuarioId, req.rifa.id, { ciclo }) });
}));

// --------------------------------------------------------------- preparación

router.post("/", exigirUsuario, ruta(async (req, res) => {
    const b = req.body || {};
    const precio = Number(b.precio);
    const cifras = Number(b.cifras ?? 2);
    if (typeof b.nombre !== "string" || !b.nombre.trim() || !Number.isInteger(precio) || precio <= 0 || !Number.isInteger(cifras)) {
        return res.status(400).json({ ok: false, motivo: "datos_invalidos", error: "Nombre, precio y cifras son obligatorios." });
    }
    const cantidad = b.cantidad == null ? null : Number(b.cantidad);
    responder(res, await rifas.crearRifa(req.usuarioId, {
        nombre: b.nombre.trim(), precio, cifras, cantidad, codigo: b.codigo || null, config: b.config || {}
    }, quien(req)));
}));

router.patch("/:id", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    const permitidos = ["nombre", "codigo", "activa", "visible", "config", "precio", "cifras", "cantidad"];
    const cambios = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
    responder(res, await rifas.actualizar(req.usuarioId, req.rifa.id, cambios, quien(req)));
}));

router.post("/:id/archivar", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.archivar(req.usuarioId, req.rifa.id, quien(req)));
}));

router.post("/:id/restaurar", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.restaurar(req.usuarioId, req.rifa.id, quien(req)));
}));

router.delete("/:id", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.eliminar(req.usuarioId, req.rifa.id, quien(req)));
}));

router.post("/:id/grupos", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    const grupoId = typeof req.body?.grupo_id === "string" ? req.body.grupo_id.trim() : "";
    if (!grupoId) return res.status(400).json({ ok: false, motivo: "sin_grupo" });
    responder(res, await rifas.vincularGrupo(req.usuarioId, grupoId, req.rifa.id, { predeterminada: req.body?.predeterminada === true }, quien(req)));
}));

router.delete("/:id/grupos/:grupoId", exigirUsuario, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.desvincularGrupo(req.usuarioId, req.params.grupoId, req.rifa.id, quien(req)));
}));

// -------------------------------------------------- operaciones sobre números

router.post("/:id/reservar", exigirUsuario, exigirMotorNuevo, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.reservar(req.usuarioId, req.rifa.id, numerosDelCuerpo(req), datosComprador(req.body),
        quien(req), { rifa: req.rifa, todoONada: req.body?.todo_o_nada === true }), req.rifa.cifras);
}));

router.post("/:id/pagar", exigirUsuario, exigirMotorNuevo, cargarRifa, ruta(async (req, res) => {
    const datos = {};
    if (typeof req.body?.metodo_pago === "string") datos.metodo_pago = req.body.metodo_pago.slice(0, 60);
    if (typeof req.body?.observaciones === "string") datos.observaciones = req.body.observaciones.slice(0, 1000);
    responder(res, await rifas.pagar(req.usuarioId, req.rifa.id, numerosDelCuerpo(req), datos, quien(req), { rifa: req.rifa }), req.rifa.cifras);
}));

router.post("/:id/liberar", exigirUsuario, exigirMotorNuevo, cargarRifa, ruta(async (req, res) => {
    responder(res, await rifas.liberar(req.usuarioId, req.rifa.id, numerosDelCuerpo(req), {}, quien(req), {
        rifa: req.rifa,
        incluirPagados: req.body?.incluir_pagados === true,
        incluirBloqueados: req.body?.incluir_bloqueados === true
    }), req.rifa.cifras);
}));

router.post("/:id/bloquear", exigirUsuario, exigirMotorNuevo, cargarRifa, ruta(async (req, res) => {
    const hasta = typeof req.body?.hasta === "string" && !Number.isNaN(Date.parse(req.body.hasta)) ? req.body.hasta : null;
    responder(res, await rifas.bloquear(req.usuarioId, req.rifa.id, numerosDelCuerpo(req), quien(req), { rifa: req.rifa, hasta }), req.rifa.cifras);
}));

// Reinicio de ESTA rifa (solo ella). Con un sorteo en curso en sus grupos
// no se reinicia: primero se cierra o se sustituye el sorteo.
router.post("/:id/reiniciar", exigirUsuario, exigirMotorNuevo, cargarRifa, ruta(async (req, res) => {
    const enCurso = await sorteosEnCurso(req.usuarioId, req.rifa.id);
    if (enCurso.length > 0) {
        return res.status(409).json({
            ok: false, motivo: "sorteo_en_curso",
            error: "Hay un sorteo en curso en un grupo de esta rifa. Ciérralo antes de reiniciarla.",
            sorteos: enCurso.map(e => ({ id: e.id, grupo_id: e.grupo_id, grupo_nombre: e.grupo_nombre || null }))
        });
    }
    responder(res, await rifas.reiniciar(req.usuarioId, req.rifa.id, req.body?.confirmacion, quien(req, req.body?.motivo || "reinicio desde el panel")));
}));

module.exports = router;
module.exports.sorteosEnCurso = sorteosEnCurso;
