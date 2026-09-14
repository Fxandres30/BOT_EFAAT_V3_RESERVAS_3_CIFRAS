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

router.post("/connect", connect);

router.post("/disconnect", disconnect);

router.get("/status/:id", status);

// NUEVAS RUTAS

router.post("/active", setActive);

router.get("/active", getActive);

router.post("/preferred", setPreferred);

// Escáner de identidades — solo lectura, DRY-RUN. Ver controlador.
router.get("/active/escaner-identidades", escanerIdentidadesDryRun);

// Diagnóstico puntual LID/teléfono — solo lectura. Ver controlador y
// bot/funciones/usuarios/identityScanner/diagnosticoTelefonosLid.js.
router.get("/active/diagnostico-telefonos-lid", diagnosticoTelefonosLid);

// Backfill activo de Contactos — dispara AHORA el escaneo completo real
// (escribe en "usuarios" y en contactos_tenant, migración 018). Ver
// controlador para el detalle exacto de qué reutiliza.
router.post("/active/backfill-contactos", backfillContactos);

// Solo lectura — estado del escaneo ("idle"|"scanning"|"syncing"|"error"),
// para que el panel pueda hacer polling sin re-disparar el escaneo.
router.get("/active/estado-backfill-contactos", estadoBackfillContactos);

// Fase 4D (panel de Automatización, "+ Autorizar grupo") — solo lectura,
// nunca escribe en Supabase. Ver controlador para el porqué de reutilizar
// manager.get()/groupQueue en vez de crear otro sistema de sesiones.
router.get("/:id/grupos-disponibles", gruposDisponibles);

module.exports = router;