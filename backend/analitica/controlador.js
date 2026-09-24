// ==========================================================================
// Handlers HTTP de la analítica privada. El router (routes/analitica.js)
// solo encadena middlewares; toda la lógica está aquí para poder probarla
// con req/res simulados, igual que backend/pagos/pagosController.js.
//
// Regla general: ante CUALQUIER falta de autorización se responde 404 con
// el mismo cuerpo que una ruta inexistente — no se revela que existe.
// ==========================================================================

const supabase = require("../lib/supabase");

const config = require("./config");
const { validarEvento } = require("./validarEvento");
const { parsearUserAgent } = require("./parsearUserAgent");
const { resolverIp } = require("./resolverIp");
const { permitirEvento } = require("./limiteTasa");
const { resolverRango } = require("./rangoFechas");

function noEncontrado(res) {
    return res.status(404).json({ error: "Not found" });
}

// --------------------------------------------------------------------------
// Autorización del panel privado — con la autenticación que YA existe:
//   1. el navegador del administrador envía su access_token de Supabase
//      Auth (el de su sesión normal del panel) como "Authorization: Bearer";
//   2. se verifica contra Supabase (auth.getUser, service role existente);
//   3. el user.id debe estar en public.analitica_admins.
// Cualquier fallo -> 404, igual que una ruta inexistente.
// --------------------------------------------------------------------------
async function exigirAdmin(req, res, next) {

    try {

        const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S{20,4096})$/i);
        if (!m) return noEncontrado(res);

        const { data, error } = await supabase.auth.getUser(m[1]);
        const userId = data?.user?.id;
        if (error || !userId) return noEncontrado(res);

        const admin = await supabase
            .from("analitica_admins")
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle();

        if (admin.error || !admin.data) return noEncontrado(res);

        req.analiticaAdminId = userId;
        next();

    } catch (err) {

        console.error("❌ [ANALITICA] Error verificando administrador:", err.message);
        return noEncontrado(res);

    }

}

// --------------------------------------------------------------------------
// Ingestión: POST /analitica/recolectar  (pública: solo escribe, nunca lee)
//   body: { evento: {t,v,s,p,r,w,h,tc}, contexto: { user_agent, x_forwarded_for } }
//   `contexto` lo construye la ruta de Next con las cabeceras de la
//   petición del navegador; `evento` es lo que envía el tracker.
// --------------------------------------------------------------------------
async function recolectar(req, res) {

    try {

        const cuerpo = req.body || {};
        const contexto = cuerpo.contexto && typeof cuerpo.contexto === "object" ? cuerpo.contexto : {};

        const validado = validarEvento(cuerpo.evento);

        if (!validado.ok) {
            return res.status(400).json({ ok: false, motivo: validado.motivo });
        }

        if (validado.ignorar) {
            return res.status(202).json({ ok: true, ignorado: true });
        }

        const evento = validado.evento;
        const userAgent = typeof contexto.user_agent === "string" ? contexto.user_agent.slice(0, 512) : "";
        const dispositivo = parsearUserAgent(userAgent, evento.tactil);

        // Bots / navegadores automatizados: se aceptan en silencio y no se guardan.
        if (!dispositivo) {
            return res.status(202).json({ ok: true, ignorado: true });
        }

        const ip = resolverIp(contexto.x_forwarded_for);

        if (!permitirEvento({ ip, visitorId: evento.visitorId })) {
            return res.status(429).json({ ok: false, motivo: "rate_limit" });
        }

        const { data, error } = await supabase.rpc("analitica_registrar_evento", {
            p_tipo: evento.tipo,
            p_visitor_id: evento.visitorId,
            p_session_id: evento.sessionId,
            p_pagina: evento.pagina,
            p_referrer: evento.referrer,
            p_user_agent: userAgent || null,
            p_ip: ip,
            p_device_type: dispositivo.deviceType,
            p_operating_system: dispositivo.operatingSystem,
            p_browser: dispositivo.browser,
            p_screen_width: evento.ancho,
            p_screen_height: evento.alto,
            p_timeout_segundos: config.TIMEOUT_SESION_SEGUNDOS,
            p_heartbeat_min_segundos: config.HEARTBEAT_MIN_SEGUNDOS
        });

        if (error) {
            console.error("❌ [ANALITICA] Error registrando evento:", error.message);
            return res.status(500).json({ ok: false });
        }

        if (!data || data.ok !== true) {
            return res.status(409).json({ ok: false, motivo: data?.motivo || "rechazado" });
        }

        // Al navegador solo se le devuelve su propio session_id (por si el
        // servidor lo rotó). Nada de datos de otras sesiones.
        return res.status(200).json({ ok: true, s: data.session_id || evento.sessionId });

    } catch (err) {

        console.error("❌ [ANALITICA] Excepción en recolectar:", err.message);
        return res.status(500).json({ ok: false });

    }

}

function verificar(req, res) {
    return res.status(200).json({ ok: true });
}

// --------------------------------------------------------------------------
// Lecturas (todas tras exigirAdmin)
// --------------------------------------------------------------------------
async function rpcLectura(res, funcion, parametros) {

    const { data, error } = await supabase.rpc(funcion, parametros);

    if (error) {
        console.error(`❌ [ANALITICA] Error en ${funcion}:`, error.message);
        return res.status(500).json({ ok: false });
    }

    return res.status(200).json({ ok: true, datos: data });

}

function rangoDesdeQuery(req) {
    return resolverRango({
        preset: req.query?.preset,
        desde: req.query?.desde,
        hasta: req.query?.hasta
    });
}

async function resumen(req, res) {

    const rango = rangoDesdeQuery(req);
    if (!rango) return res.status(400).json({ ok: false, motivo: "rango_invalido" });

    return rpcLectura(res, "analitica_resumen", {
        p_desde: rango.desde.toISOString(),
        p_hasta: rango.hasta.toISOString(),
        p_activos_segundos: config.ACTIVO_SEGUNDOS
    });

}

async function activos(req, res) {

    return rpcLectura(res, "analitica_activos", {
        p_activos_segundos: config.ACTIVO_SEGUNDOS
    });

}

async function historial(req, res) {

    const rango = rangoDesdeQuery(req);
    if (!rango) return res.status(400).json({ ok: false, motivo: "rango_invalido" });

    const limite = Math.min(Math.max(Number.parseInt(req.query?.limite, 10) || 50, 1), 200);
    const offset = Math.min(Math.max(Number.parseInt(req.query?.offset, 10) || 0, 0), 100000);

    return rpcLectura(res, "analitica_historial", {
        p_desde: rango.desde.toISOString(),
        p_hasta: rango.hasta.toISOString(),
        p_limite: limite,
        p_offset: offset
    });

}

async function detalleSesion(req, res) {

    const id = req.params?.id;

    if (typeof id !== "string" || !config.UUID.test(id)) {
        return res.status(400).json({ ok: false, motivo: "sesion_invalida" });
    }

    const { data, error } = await supabase.rpc("analitica_sesion_detalle", { p_session_id: id.toLowerCase() });

    if (error) {
        console.error("❌ [ANALITICA] Error en analitica_sesion_detalle:", error.message);
        return res.status(500).json({ ok: false });
    }

    if (!data) return res.status(404).json({ ok: false, motivo: "sesion_no_encontrada" });

    return res.status(200).json({ ok: true, datos: data });

}

module.exports = {
    exigirAdmin,
    recolectar,
    verificar,
    resumen,
    activos,
    historial,
    detalleSesion
};
