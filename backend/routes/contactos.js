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

// SEGURIDAD (2026-10): el usuario sale del token de Supabase validado por
// exigirUsuario (req.usuarioId), NUNCA del usuarioId que manda el navegador
// (antes cualquiera podía pedir los datos de otro cliente cambiando ese
// parámetro). Un usuarioId del cliente, si llega, se ignora.
const { exigirUsuario } = require("../middleware/autenticacionUsuario");

const supabase = require("../lib/supabase");

const { listarContactos } = require("../bot/funciones/usuarios/listarContactos");
const { obtenerPerfilContacto } = require("../bot/funciones/usuarios/obtenerPerfilContacto");
const { agregarTelefonoContacto } = require("../bot/funciones/usuarios/agregarTelefonoContacto");

// GET /contactos?usuarioId=... — directorio completo del tenant, más
// recientes primero (ver listarContactos.js para el criterio de orden).
router.get("/", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;

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
router.get("/:id", exigirUsuario, async (req, res) => {

    try {

        const { id } = req.params;
        const usuarioId = req.usuarioId;

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
router.post("/:id/telefono", exigirUsuario, async (req, res) => {

    try {

        const { id } = req.params;
        const { telefono } = req.body || {};

        if (!telefono) {
            return res.status(400).json({ ok: false, motivo: "faltan_parametros" });
        }

        // El contacto debe pertenecer al directorio de ESTE cliente; si no,
        // se responde como si no existiera.
        const { data: relacion, error: errorRelacion } = await supabase
            .from("contactos_tenant")
            .select("usuario_global_id")
            .eq("usuario_id", req.usuarioId)
            .eq("usuario_global_id", id)
            .maybeSingle();

        if (errorRelacion || !relacion) {
            return res.status(404).json({ ok: false, motivo: "contacto_no_existe" });
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
