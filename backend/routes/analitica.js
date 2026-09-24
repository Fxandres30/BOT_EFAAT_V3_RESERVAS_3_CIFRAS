// ==========================================================================
// routes/analitica.js — analítica privada. Toda la lógica vive en
// backend/analitica/controlador.js. Sin configuración propia: usa la
// conexión Supabase existente y Supabase Auth.
//
//   POST /analitica/recolectar         ingestión pública (solo escribe)
//   GET  /analitica/verificar          [admin]
//   GET  /analitica/resumen            [admin] ?preset=hoy|ayer|7d|rango&desde&hasta
//   GET  /analitica/activos            [admin]
//   GET  /analitica/historial          [admin] ?preset...&limite&offset
//   GET  /analitica/sesiones/:id       [admin]
//
// [admin] = Authorization: Bearer <access_token de Supabase Auth> de un
// usuario presente en public.analitica_admins. Si no, 404.
//
// Se monta en server.js ANTES del express.json() global para usar su
// propio límite de cuerpo (8 KB) en vez de los 100 KB por defecto.
// ==========================================================================

const express = require("express");

const c = require("../analitica/controlador");

const router = express.Router();

router.use(express.json({ limit: "8kb" }));

router.post("/recolectar", c.recolectar);

router.get("/verificar", c.exigirAdmin, c.verificar);
router.get("/resumen", c.exigirAdmin, c.resumen);
router.get("/activos", c.exigirAdmin, c.activos);
router.get("/historial", c.exigirAdmin, c.historial);
router.get("/sesiones/:id", c.exigirAdmin, c.detalleSesion);

// Cualquier otra cosa bajo /analitica: 404 indistinguible.
router.use((req, res) => res.status(404).json({ error: "Not found" }));

// Cuerpo demasiado grande / JSON inválido -> 400 sin detalles.
router.use((err, req, res, next) => {
    res.status(err.status === 413 ? 413 : 400).json({ ok: false });
});

module.exports = router;
