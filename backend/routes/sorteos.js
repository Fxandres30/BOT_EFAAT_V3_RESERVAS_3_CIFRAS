// ==========================================================================
// routes/sorteos.js — API del panel para sorteos programados, plantillas y
// cuentas de pago.
//
// TODAS las rutas exigen token de servicio + sesión real del usuario
// (middleware/autenticacionUsuario.js). El usuario sale SIEMPRE del token
// (req.usuarioId); cualquier usuarioId que venga en el cuerpo o la URL se
// ignora. Un recurso de otro usuario responde 404, como si no existiera.
// ==========================================================================

const router = require("express").Router();
const { exigirUsuario } = require("../middleware/autenticacionUsuario");
const servicio = require("../sorteos/servicio");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(exigirUsuario);

const ESTADO_HTTP = {
    validacion: 400,
    confirmacion_requerida: 400,
    no_encontrado: 404,
    version_cambiada: 409,
    estado_invalido: 409,
    ya_publicado: 409,
    bloqueado: 409,
    conflicto: 409,
    nombre_duplicado: 409,
    migracion_pendiente: 503
};

function responder(res, r, exito = 200) {

    if (r?.ok) return res.status(exito).json({ ok: true, data: r.data, ...(r.aviso ? { aviso: r.aviso } : {}), ...(r.meta ? { meta: r.meta } : {}) });

    const { ok, ...detalle } = r || {};
    // Nunca se reenvía al navegador un mensaje interno de base de datos.
    if (detalle.motivo === "error_supabase") delete detalle.error;

    return res.status(ESTADO_HTTP[r?.motivo] || 500).json({ ok: false, ...detalle });

}

function conId(handler) {
    return async (req, res) => {
        if (!UUID.test(req.params.id || "")) return res.status(404).json({ ok: false, motivo: "no_encontrado" });
        try {
            await handler(req, res);
        } catch (err) {
            console.error("❌ [SORTEOS API]", err?.message);
            res.status(500).json({ ok: false, motivo: "error_interno" });
        }
    };
}

function seguro(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            console.error("❌ [SORTEOS API]", err?.message);
            res.status(500).json({ ok: false, motivo: "error_interno" });
        }
    };
}

// --------------------------------------------------- grupos y catálogos ---
router.get("/grupos", seguro(async (req, res) => responder(res, await servicio.gruposParaFormulario(req.usuarioId))));

// ------------------------------------------- calendario de loterías (025) ---
// Antes que "/:id": "loterias" no es un UUID, pero así queda explícito.
router.get("/loterias", seguro(async (req, res) => responder(res, await servicio.loterias.listar(req.usuarioId))));
router.post("/loterias", seguro(async (req, res) => responder(res, await servicio.loterias.crear(req.usuarioId, req.body || {}), 201)));
router.patch("/loterias/:id", conId(async (req, res) => responder(res, await servicio.loterias.actualizar(req.usuarioId, req.params.id, req.body || {}))));
router.get("/loterias/:id/horario", conId(async (req, res) => responder(res, await servicio.loterias.horario(req.usuarioId, req.params.id, String(req.query.fecha || "")))));

// ----------------------------------------------------------- plantillas ---
router.get("/plantillas", seguro(async (req, res) => responder(res, await servicio.listarPlantillas(req.usuarioId))));
router.post("/plantillas", seguro(async (req, res) => responder(res, await servicio.crearPlantilla(req.usuarioId, req.body || {}), 201)));
router.patch("/plantillas/:id", conId(async (req, res) => responder(res, await servicio.actualizarPlantilla(req.usuarioId, req.params.id, req.body || {}))));

// ------------------------------------------------------ cuentas de pago ---
router.get("/cuentas", seguro(async (req, res) => responder(res, await servicio.listarCuentas(req.usuarioId))));
router.post("/cuentas", seguro(async (req, res) => responder(res, await servicio.crearCuenta(req.usuarioId, req.body || {}), 201)));
router.patch("/cuentas/:id", conId(async (req, res) => responder(res, await servicio.actualizarCuenta(req.usuarioId, req.params.id, req.body || {}))));

// -------------------------------------------------------------- sorteos ---
router.get("/", seguro(async (req, res) => responder(res, await servicio.listarSorteos(req.usuarioId))));
router.post("/", seguro(async (req, res) => responder(res, await servicio.crearSorteo(req.usuarioId, req.body || {}), 201)));
router.get("/:id", conId(async (req, res) => responder(res, await servicio.obtenerSorteo(req.usuarioId, req.params.id))));
router.put("/:id", conId(async (req, res) => responder(res, await servicio.editar(req.usuarioId, req.params.id, req.body || {}))));
router.get("/:id/vista-previa", conId(async (req, res) => responder(res, await servicio.vistaPrevia(req.usuarioId, req.params.id))));
router.post("/:id/confirmar", conId(async (req, res) => responder(res, await servicio.confirmar(req.usuarioId, req.params.id, req.body || {}))));
router.post("/:id/cancelar", conId(async (req, res) => responder(res, await servicio.cancelar(req.usuarioId, req.params.id))));
router.post("/:id/grupos/reintentar", conId(async (req, res) => responder(res, await servicio.reintentarGrupo(req.usuarioId, req.params.id, String(req.body?.grupo_id || "")))));

module.exports = router;
