const router = require("express").Router();

const {

    connect,
    disconnect,
    status,

    setActive,
    getActive,
    setPreferred,

    escanerIdentidadesDryRun,
    gruposDisponibles

} = require("../bot/controllers/sessionsController");

router.post("/connect", connect);

router.post("/disconnect", disconnect);

router.get("/status/:id", status);

// NUEVAS RUTAS

router.post("/active", setActive);

router.get("/active", getActive);

router.post("/preferred", setPreferred);

// Escáner de identidades — solo lectura, DRY-RUN. Ver controlador.
router.get("/active/escaner-identidades", escanerIdentidadesDryRun);

// Fase 4D (panel de Automatización, "+ Autorizar grupo") — solo lectura,
// nunca escribe en Supabase. Ver controlador para el porqué de reutilizar
// manager.get()/groupQueue en vez de crear otro sistema de sesiones.
router.get("/:id/grupos-disponibles", gruposDisponibles);

module.exports = router;