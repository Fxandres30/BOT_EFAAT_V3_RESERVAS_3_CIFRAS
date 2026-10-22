// ==========================================================================
// routes/bloqueados.js — panel "Bloqueados" (bloqueo automático de
// WhatsApp: no puede usar el bot, no puede reservar, y se expulsa
// automáticamente de cualquier grupo administrado por el bot).
// ==========================================================================
// Mismo patrón que routes/contactos.js: rutas delgadas, usuarioId siempre
// explícito en query/body, sin sesión de servidor propia. Toda la lógica
// real vive en bot/funciones/bloqueo/bloqueadosRepo.js — no se reimplementa
// aquí.
// ==========================================================================

const router = require("express").Router();

// SEGURIDAD (2026-10): el usuario sale del token de Supabase validado por
// exigirUsuario (req.usuarioId), NUNCA del usuarioId que manda el navegador
// (antes cualquiera podía pedir los datos de otro cliente cambiando ese
// parámetro). Un usuarioId del cliente, si llega, se ignora.
const { exigirUsuario } = require("../middleware/autenticacionUsuario");

const {
    crearBloqueo,
    desbloquear,
    listarBloqueados,
    obtenerBloqueoDeContacto
} = require("../bot/funciones/bloqueo/bloqueadosRepo");

const manager = require("../services/baileys/manager");

// Bloqueo NATIVO de WhatsApp (sock.updateBlockStatus) — best-effort, NUNCA
// del que depende el bloqueo real: el bloqueo EFAAT (tabla "bloqueados" +
// expulsión automática de grupos, ver bloqueoParticipantesGrupo.js) sigue
// funcionando exactamente igual aunque esto falle, no haya sesión activa, o
// Baileys no exponga el método.
function construirJidNativo({ telefono, lid, jid }) {

    if (jid) return jid;
    if (lid) return lid;
    if (telefono) return `57${telefono}@s.whatsapp.net`;

    return null;

}

async function aplicarBloqueoNativo(bloqueado, accion, usuarioId) {

    try {

        const jidNativo = construirJidNativo(bloqueado || {});
        if (!jidNativo) return;

        // Solo con el WhatsApp activo del MISMO cliente (multisesión): nunca
        // con el de otro cliente conectado al mismo proceso.
        const sock = manager.getSocketActivoDe(usuarioId);
        if (!sock || typeof sock.updateBlockStatus !== "function") return;

        await sock.updateBlockStatus(jidNativo, accion);

    } catch (err) {

        console.error(`⚠️ [BLOQUEADOS] no se pudo aplicar bloqueo nativo (${accion}) — el bloqueo interno no se ve afectado:`, err?.message);

    }

}

function statusParaMotivo(motivo) {

    if (motivo === "migracion_pendiente") return 503;
    if (motivo === "no_existe" || motivo === "bloqueo_no_existe") return 404;
    if (motivo === "falta_usuario_id" || motivo === "sin_identificador" || motivo === "faltan_parametros") return 400;

    return 500;

}

// GET /bloqueados?usuarioId=... — lista completa (activos e históricos)
// para el panel "Bloqueados".
router.get("/", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;

        const resultado = await listarBloqueados(usuarioId);

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json({ success: false, error: resultado.motivo });
        }

        res.json({ success: true, bloqueados: resultado.bloqueados });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en GET /bloqueados:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// GET /bloqueados/contacto?usuarioId=...&telefono=...&lid=... — para el
// badge "🚫 CONTACTO BLOQUEADO" del detalle de contacto.
router.get("/contacto", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { telefono, lid } = req.query;

        const resultado = await obtenerBloqueoDeContacto(usuarioId, { telefono: telefono || null, lid: lid || null });

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json({ success: false, error: resultado.motivo });
        }

        res.json({ success: true, bloqueado: resultado.bloqueado });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en GET /bloqueados/contacto:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// POST /bloqueados — "🚫 BLOQUEAR CONTACTO". Body: { usuarioId, telefono?,
// lid?, jid?, nombre?, motivo?, bloqueadoPor? } — al menos uno de
// telefono/lid/jid.
router.post("/", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { telefono, lid, jid, nombre, motivo, bloqueadoPor } = req.body || {};

        const resultado = await crearBloqueo({ usuarioId, telefono, lid, jid, nombre, motivo, bloqueadoPor });

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json(resultado);
        }

        await aplicarBloqueoNativo(resultado.bloqueado, "block", usuarioId);

        res.json(resultado);

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en POST /bloqueados:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /bloqueados/:id/desbloquear — "🔓 DESBLOQUEAR CONTACTO". Body:
// { usuarioId }.
router.post("/:id/desbloquear", exigirUsuario, async (req, res) => {

    try {

        const { id } = req.params;
        const usuarioId = req.usuarioId;

        const resultado = await desbloquear(id, usuarioId);

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json(resultado);
        }

        await aplicarBloqueoNativo(resultado.bloqueado, "unblock", usuarioId);

        res.json(resultado);

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en POST /bloqueados/:id/desbloquear:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

module.exports = router;
