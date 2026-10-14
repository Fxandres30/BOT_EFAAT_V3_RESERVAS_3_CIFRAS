const router = require("express").Router();

const {

    connect,
    disconnect,
    status,

    setActive,
    getActive,
    setPreferred,

    escanerIdentidadesDryRun,
    diagnosticoTelefonosLid,
    backfillContactos,
    estadoBackfillContactos,
    gruposDisponibles

} = require("../bot/controllers/sessionsController");

const { saludSesiones } = require("../bot/controllers/saludSesionesController");

// SEGURIDAD (2026-10): /sessions/* estaba abierto a cualquiera que llegara
// al puerto del backend (el token de servicio se desmontó de server.js el
// 2026-09-26) y el panel no identificaba al usuario: cualquiera podía
// desconectar o activar la sesión de otro cliente.
//   - rutas del PANEL: token de servicio + sesión real de Supabase
//     (exigirUsuario) + la sesión de WhatsApp debe ser del usuario;
//   - rutas de ADMINISTRACIÓN (BANN apps/api, servidor-a-servidor): token
//     de servicio, como estaban documentadas.
const { exigirUsuario } = require("../middleware/autenticacionUsuario");
const { exigirTokenServicio } = require("../middleware/tokenServicio");
const { exigirSesionPropia, exigirActivaPropia } = require("../middleware/autorizacionSesiones");

const delCuerpo = req => req.body?.sessionId;
const deParams = req => req.params.id;

router.post("/connect", exigirUsuario, exigirSesionPropia(delCuerpo), connect);

router.post("/disconnect", exigirUsuario, exigirSesionPropia(delCuerpo), disconnect);

router.get("/status/:id", exigirUsuario, exigirSesionPropia(deParams), status);

// Salud real de las sesiones del usuario (panel /sesiones). Solo lectura.
router.get("/salud", exigirUsuario, saludSesiones);

// NUEVAS RUTAS

router.post("/active", exigirUsuario, exigirSesionPropia(delCuerpo), setActive);

router.get("/active", exigirUsuario, exigirActivaPropia({ sinActivaComoVacio: true }), getActive);

router.post("/preferred", exigirUsuario, exigirSesionPropia(delCuerpo), setPreferred);

// Escáner de identidades — solo lectura, DRY-RUN. Ver controlador.
router.get("/active/escaner-identidades", exigirUsuario, exigirActivaPropia(), escanerIdentidadesDryRun);

// Diagnóstico puntual LID/teléfono — solo lectura. Ver controlador y
// bot/funciones/usuarios/identityScanner/diagnosticoTelefonosLid.js.
router.get("/active/diagnostico-telefonos-lid", exigirUsuario, exigirActivaPropia(), diagnosticoTelefonosLid);

// Backfill activo de Contactos — dispara AHORA el escaneo completo real
// (escribe en "usuarios" y en contactos_tenant, migración 018). Ver
// controlador para el detalle exacto de qué reutiliza.
router.post("/active/backfill-contactos", exigirUsuario, exigirActivaPropia(), backfillContactos);

// Solo lectura — estado del escaneo ("idle"|"scanning"|"syncing"|"error"),
// para que el panel pueda hacer polling sin re-disparar el escaneo.
router.get("/active/estado-backfill-contactos", exigirUsuario, exigirActivaPropia(), estadoBackfillContactos);

// Fase 4D (panel de Automatización, "+ Autorizar grupo") — solo lectura,
// nunca escribe en Supabase. Ver controlador para el porqué de reutilizar
// manager.get()/groupQueue en vez de crear otro sistema de sesiones.
router.get("/:id/grupos-disponibles", exigirUsuario, exigirSesionPropia(deParams), gruposDisponibles);

// Administración de sesiones para paneles externos (BANN apps/api) —
// aditivo, servidor-a-servidor, detrás del token de servicio (server.js).
// Reutiliza la tabla `sesiones` y el SessionManager existentes. Van DESPUÉS
// de las rutas anteriores para no alterar su orden de coincidencia
// (/active, /status/:id).
const admin = require("../bot/controllers/sessionsAdminController");

router.get("/", exigirTokenServicio, admin.listar);
router.post("/", exigirTokenServicio, admin.crear);
router.get("/:id/qr", exigirTokenServicio, admin.qr);
router.post("/:id/reconnect", exigirTokenServicio, admin.reconectar);
router.get("/:id", exigirTokenServicio, admin.obtener);
router.patch("/:id", exigirTokenServicio, admin.renombrar);
router.delete("/:id", exigirTokenServicio, admin.eliminar);

module.exports = router;