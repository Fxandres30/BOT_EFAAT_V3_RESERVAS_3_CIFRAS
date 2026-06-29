const router = require("express").Router();

const {

    connect,

    disconnect,

    status

} = require("../controllers/sessionsController");

router.post("/connect", connect);

router.post("/disconnect", disconnect);

router.get("/status/:id", status);

module.exports = router;