const router = require("express").Router();

const {

    connect,
    disconnect,
    status,

    setActive,
    getActive,
    setPreferred,

    escanerIdentidadesDryRun

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

module.exports = router;