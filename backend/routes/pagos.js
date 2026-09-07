const express = require("express");
const router = express.Router();

const autenticarDispositivo = require("../pagos/autenticacionDispositivo");
const { crearMovimiento, listarMovimientos } = require("../pagos/pagosController");

// Ambas rutas requieren credencial de dispositivo válida (ver
// backend/pagos/autenticacionDispositivo.js). No hay ninguna ruta pública
// en /pagos — a diferencia de /sessions, que hoy no tiene ninguna
// autenticación.

router.post("/movimientos", autenticarDispositivo, crearMovimiento);

// Solo para pruebas internas del backend en P1 (ver backend/pagos/README.md).
router.get("/movimientos", autenticarDispositivo, listarMovimientos);

module.exports = router;
