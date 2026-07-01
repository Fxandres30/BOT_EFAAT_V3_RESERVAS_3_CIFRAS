const router = require("express").Router();

const {

    connect,
    disconnect,
    status,

    setActive,
    getActive

} = require("../bot/controllers/sessionsController");

router.post("/connect", connect);

router.post("/disconnect", disconnect);

router.get("/status/:id", status);

// NUEVAS RUTAS

router.post("/active", setActive);

router.get("/active", getActive);

module.exports = router;