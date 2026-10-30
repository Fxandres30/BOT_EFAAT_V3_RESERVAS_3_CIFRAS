// ==========================================================================
// routes/bloqueados.js — panel "Bloqueados" (bloqueo automático de
// WhatsApp: no puede usar el bot, no puede reservar, y se expulsa de los
// grupos autorizados del cliente).
// ==========================================================================
// Mismo patrón que routes/contactos.js: rutas delgadas. La lógica vive en
// bot/funciones/bloqueo/: bloqueadosRepo.js (registro), expulsionesRepo.js
// (tareas por grupo) y procesarExpulsion.js (motor de expulsión).
//
// Tres cosas DISTINTAS que el panel muestra por separado:
//   - bloqueo registrado: fila de "bloqueados" (activo);
//   - bloqueo nativo: sock.updateBlockStatus (best-effort, ver abajo);
//   - expulsión: una tarea por grupo, "expulsado" solo tras verificar con la
//     lista real de participantes.
// Bloquear responde en cuanto el bloqueo queda registrado y las tareas
// creadas; la expulsión sigue en segundo plano (el panel consulta
// GET /bloqueados/:id/expulsiones).
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
    obtenerBloqueoDeContacto,
    listarIntentos,
    registrarBloqueoNativo
} = require("../bot/funciones/bloqueo/bloqueadosRepo");

const expulsiones = require("../bot/funciones/bloqueo/expulsionesRepo");
const { procesarEnSegundoPlano } = require("../bot/funciones/bloqueo/procesarExpulsion");
const { leerConfigExpulsiones } = require("../bot/funciones/bloqueo/configExpulsiones");

const manager = require("../services/baileys/manager");

// Bloqueo NATIVO de WhatsApp (sock.updateBlockStatus) — best-effort, NUNCA
// del que depende el bloqueo real: el bloqueo EFAAT (tabla "bloqueados" +
// expulsión de grupos) sigue funcionando exactamente igual aunque esto falle,
// no haya sesión activa, o Baileys no exponga el método. Su resultado se
// guarda aparte (bloqueados.bloqueo_nativo_estado, migración 040).
function construirJidNativo({ telefono, lid, jid }) {

    if (jid) return jid;
    if (lid) return lid;
    if (telefono) return `57${telefono}@s.whatsapp.net`;

    return null;

}

async function aplicarBloqueoNativo(bloqueado, accion, usuarioId) {

    let estado;
    let error = null;

    try {

        const jidNativo = construirJidNativo(bloqueado || {});

        // Solo con el WhatsApp activo del MISMO cliente (multisesión): nunca
        // con el de otro cliente conectado al mismo proceso.
        const sock = manager.getSocketActivoDe(usuarioId);

        if (!jidNativo) estado = "no_disponible";
        else if (!sock) estado = "sin_sesion";
        else if (typeof sock.updateBlockStatus !== "function") estado = "no_disponible";
        else {
            await sock.updateBlockStatus(jidNativo, accion);
            estado = accion === "block" ? "aplicado" : "retirado";
        }

    } catch (err) {

        estado = "fallido";
        error = err?.message || String(err);
        console.error(`⚠️ [BLOQUEADOS] no se pudo aplicar bloqueo nativo (${accion}) — el bloqueo interno no se ve afectado:`, error);

    }

    if (bloqueado?.id) await registrarBloqueoNativo(bloqueado.id, usuarioId, { estado, error });

    return { estado, error };

}

function statusParaMotivo(motivo) {

    if (motivo === "migracion_pendiente") return 503;
    if (motivo === "no_existe" || motivo === "bloqueo_no_existe") return 404;
    if (motivo === "falta_usuario_id" || motivo === "sin_identificador" || motivo === "faltan_parametros") return 400;

    return 500;

}

function sesionConectada(usuarioId) {
    try { return !!manager.getSocketActivoDe(usuarioId); } catch { return false; }
}

// Lo que el panel necesita saber de la expulsión de UN bloqueo.
function resumenExpulsion(bloqueado, tareas, { migracionPendiente = false } = {}) {
    const vigentes = tareas.filter(t => t.estado !== "cancelado");
    return {
        estado: expulsiones.estadoGeneral(bloqueado, tareas, { migracionPendiente }),
        ...expulsiones.resumirTareas(vigentes),
        migracionPendiente
    };
}

function contextoExpulsion(usuarioId, { migracionPendiente = false } = {}) {
    return {
        modo: leerConfigExpulsiones().modo,
        sesionConectada: sesionConectada(usuarioId),
        migracionPendiente
    };
}

// GET /bloqueados — lista completa (activos e históricos) para el panel
// "Bloqueados", con el resumen de expulsión de cada uno.
router.get("/", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;

        const resultado = await listarBloqueados(usuarioId);

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json({ success: false, error: resultado.motivo });
        }

        const tareas = await expulsiones.listarDeCliente(usuarioId);
        const sinMigracion = !tareas.ok && tareas.motivo === "migracion_pendiente";

        const porBloqueo = new Map();
        for (const t of tareas.tareas || []) {
            if (!porBloqueo.has(t.bloqueado_id)) porBloqueo.set(t.bloqueado_id, []);
            porBloqueo.get(t.bloqueado_id).push(t);
        }

        res.json({
            success: true,
            expulsion: contextoExpulsion(usuarioId, { migracionPendiente: sinMigracion }),
            bloqueados: resultado.bloqueados.map(b => ({
                ...b,
                expulsion: resumenExpulsion(b, porBloqueo.get(b.id) || [], { migracionPendiente: sinMigracion })
            }))
        });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en GET /bloqueados:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// GET /bloqueados/contacto?telefono=...&lid=... — para el badge
// "🚫 CONTACTO BLOQUEADO" del detalle de contacto.
router.get("/contacto", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { telefono, lid } = req.query;

        const resultado = await obtenerBloqueoDeContacto(usuarioId, { telefono: telefono || null, lid: lid || null });

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json({ success: false, error: resultado.motivo });
        }

        let bloqueado = resultado.bloqueado;

        if (bloqueado) {
            const tareas = await expulsiones.listarDeBloqueo(usuarioId, bloqueado.id);
            bloqueado = { ...bloqueado, expulsion: resumenExpulsion(bloqueado, tareas.tareas || [], { migracionPendiente: tareas.motivo === "migracion_pendiente" }) };
        }

        res.json({ success: true, bloqueado });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en GET /bloqueados/contacto:", err.message);
        res.status(500).json({ success: false, error: "Error interno." });

    }

});

// POST /bloqueados — "🚫 BLOQUEAR CONTACTO". Body: { telefono?, lid?, jid?,
// nombre?, motivo?, bloqueadoPor? } — al menos uno de telefono/lid/jid.
// Repetir la petición (doble clic) no duplica el bloqueo, ni las tareas,
// ni el bloqueo nativo.
router.post("/", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { telefono, lid, jid, nombre, motivo, bloqueadoPor } = req.body || {};

        const resultado = await crearBloqueo({ usuarioId, telefono, lid, jid, nombre, motivo, bloqueadoPor });

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json(resultado);
        }

        const nativo = resultado.yaActivo
            ? { estado: resultado.bloqueado?.bloqueo_nativo_estado || null, repetido: true }
            : await aplicarBloqueoNativo(resultado.bloqueado, "block", usuarioId);

        // Un contacto que estaba desbloqueado y se vuelve a bloquear: sus
        // tareas anteriores (canceladas o resueltas) vuelven a empezar.
        const programadas = await expulsiones.programarExpulsiones({
            usuarioId,
            bloqueado: resultado.bloqueado,
            reiniciar: resultado.reactivado && !resultado.yaActivo
        });

        const sinMigracion = !programadas.ok && programadas.motivo === "migracion_pendiente";

        if (!programadas.ok && !sinMigracion) {
            console.error("❌ [BLOQUEADOS] el bloqueo quedó registrado pero no se pudieron crear las tareas de expulsión:", programadas.error || programadas.motivo);
        }

        const enProceso = programadas.ok && programadas.tareas.length > 0 && procesarEnSegundoPlano(usuarioId, { bloqueadoId: resultado.bloqueado.id });

        res.json({
            ...resultado,
            bloqueoNativo: nativo,
            expulsion: {
                ...contextoExpulsion(usuarioId, { migracionPendiente: sinMigracion }),
                ...resumenExpulsion(resultado.bloqueado, programadas.tareas || [], { migracionPendiente: sinMigracion }),
                programada: programadas.ok,
                procesando: !!enProceso,
                motivo: programadas.ok ? programadas.motivo : programadas.motivo || "error_programando"
            }
        });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en POST /bloqueados:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// Bloqueo del cliente del token (404 si es de otro o no existe).
async function bloqueoPropio(req, res) {

    const leido = await expulsiones.leerBloqueo(req.params.id, req.usuarioId);

    if (!leido.ok) {
        res.status(500).json({ ok: false, motivo: "error_supabase" });
        return null;
    }

    if (!leido.bloqueado) {
        res.status(404).json({ ok: false, motivo: "bloqueo_no_existe" });
        return null;
    }

    return leido.bloqueado;

}

// GET /bloqueados/:id/expulsiones — estado por grupo + historial de intentos.
router.get("/:id/expulsiones", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const bloqueado = await bloqueoPropio(req, res);
        if (!bloqueado) return;

        const [tareas, intentos] = await Promise.all([
            expulsiones.listarDeBloqueo(usuarioId, bloqueado.id),
            listarIntentos(usuarioId, bloqueado.id)
        ]);

        const sinMigracion = tareas.motivo === "migracion_pendiente";

        res.json({
            ok: true,
            bloqueado,
            expulsion: {
                ...contextoExpulsion(usuarioId, { migracionPendiente: sinMigracion }),
                ...resumenExpulsion(bloqueado, tareas.tareas || [], { migracionPendiente: sinMigracion })
            },
            grupos: (tareas.tareas || []).map(t => ({
                id: t.id,
                grupo_id: t.grupo_id,
                grupo_nombre: t.grupo_nombre,
                estado: t.estado,
                modo: t.modo,
                origen: t.origen,
                intentos: t.intentos,
                ultimo_status: t.ultimo_status,
                ultimo_error: t.ultimo_error,
                participante_jid: t.participante_jid,
                criterio_identidad: t.criterio_identidad,
                proximo_intento_en: t.proximo_intento_en,
                ultimo_intento_en: t.ultimo_intento_en,
                verificada_en: t.verificada_en,
                solicitada_en: t.solicitada_en
            })),
            intentos: intentos.intentos || []
        });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en GET /bloqueados/:id/expulsiones:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /bloqueados/:id/reintentar — vuelve a intentar SOLO lo no resuelto
// (nunca un grupo ya expulsado/verificado) y crea tareas para los grupos
// autorizados después del bloqueo.
router.post("/:id/reintentar", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const bloqueado = await bloqueoPropio(req, res);
        if (!bloqueado) return;

        if (!bloqueado.activo) return res.status(409).json({ ok: false, motivo: "bloqueo_inactivo" });

        const programadas = await expulsiones.programarExpulsiones({ usuarioId, bloqueado, origen: "reintento" });

        if (!programadas.ok) return res.status(statusParaMotivo(programadas.motivo)).json({ ok: false, motivo: programadas.motivo });

        const reintento = await expulsiones.reintentarDeBloqueo(usuarioId, bloqueado.id);

        if (!reintento.ok) return res.status(statusParaMotivo(reintento.motivo)).json({ ok: false, motivo: reintento.motivo });

        const procesando = procesarEnSegundoPlano(usuarioId, { bloqueadoId: bloqueado.id });

        res.json({ ok: true, reprogramadas: reintento.reprogramadas, procesando, ...contextoExpulsion(usuarioId) });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en POST /bloqueados/:id/reintentar:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /bloqueados/:id/desbloquear — "🔓 DESBLOQUEAR CONTACTO". Cancela
// las expulsiones que aún no terminaron.
router.post("/:id/desbloquear", exigirUsuario, async (req, res) => {

    try {

        const { id } = req.params;
        const usuarioId = req.usuarioId;

        const resultado = await desbloquear(id, usuarioId);

        if (!resultado.ok) {
            return res.status(statusParaMotivo(resultado.motivo)).json(resultado);
        }

        const canceladas = await expulsiones.cancelarDeBloqueo(usuarioId, id);

        const nativo = await aplicarBloqueoNativo(resultado.bloqueado, "unblock", usuarioId);

        res.json({ ...resultado, bloqueoNativo: nativo, expulsionesCanceladas: canceladas.ok ? canceladas.canceladas : 0 });

    } catch (err) {

        console.error("❌ [BLOQUEADOS] error en POST /bloqueados/:id/desbloquear:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

module.exports = router;
