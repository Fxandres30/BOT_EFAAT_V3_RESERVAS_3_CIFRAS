// ==========================================================================
// routes/contactos.js — panel "Contactos" (directorio central de usuarios
// que el bot conoce, reemplaza a /chats como pantalla principal del panel).
// ==========================================================================
// Mismo patrón que routes/tablas.js: rutas delgadas, usuarioId siempre
// explícito en query/body (el panel ya lo conoce vía supabase.auth en el
// navegador — mismo criterio que POST /tablas/compartir), sin sesión de
// servidor propia. Toda la lógica real vive en
// bot/funciones/usuarios/{listarContactos,obtenerPerfilContacto,
// agregarTelefonoContacto}.js — no se reimplementa aquí.
// ==========================================================================

const router = require("express").Router();

const { listarContactos } = require("../bot/funciones/usuarios/listarContactos");
const { obtenerPerfilContacto } = require("../bot/funciones/usuarios/obtenerPerfilContacto");
const { agregarTelefonoContacto } = require("../bot/funciones/usuarios/agregarTelefonoContacto");

// GET /contactos?usuarioId=... — directorio completo del tenant, más
// recientes primero (ver listarContactos.js para el criterio de orden).
router.get("/", async (req, res) => {

    try {

        const { usuarioId } = req.query;

        if (!usuarioId) {
            return res.status(400).json({ success: false, error: "Falta usuarioId." });
        }

        const { contactos } = await listarContactos({ usuarioId });

        res.json({ success: true, contactos });

    } catch (err) {

        console.error("❌ [CONTACTOS] error en GET /contactos:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// GET /contactos/:id?usuarioId=... — perfil: identidad + reservas + pagos +
// actividad + mensajes recientes (los que se puedan acotar de forma segura
// a este tenant — ver obtenerPerfilContacto.js).
router.get("/:id", async (req, res) => {

    try {

        const { id } = req.params;
        const { usuarioId } = req.query;

        if (!usuarioId) {
            return res.status(400).json({ success: false, error: "Falta usuarioId." });
        }

        const perfil = await obtenerPerfilContacto({ usuarioId, contactoId: id });

        if (!perfil) {
            return res.status(404).json({ success: false, error: "Contacto no encontrado para este tenant." });
        }

        res.json({ success: true, ...perfil });

    } catch (err) {

        console.error("❌ [CONTACTOS] error en GET /contactos/:id:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// POST /contactos/:id/telefono — { telefono } — "Agregar teléfono" del
// panel. Nunca crea un contacto nuevo, nunca sobrescribe, nunca duplica
// (ver agregarTelefonoContacto.js).
router.post("/:id/telefono", async (req, res) => {

    try {

        const { id } = req.params;
        const { telefono } = req.body || {};

        if (!telefono) {
            return res.status(400).json({ ok: false, motivo: "faltan_parametros" });
        }

        const resultado = await agregarTelefonoContacto({ contactoId: id, telefono });

        if (!resultado.ok) {

            const status = resultado.motivo === "contacto_no_existe" ? 404 : 409;
            return res.status(status).json(resultado);

        }

        res.json(resultado);

    } catch (err) {

        console.error("❌ [CONTACTOS] error en POST /contactos/:id/telefono:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

module.exports = router;
