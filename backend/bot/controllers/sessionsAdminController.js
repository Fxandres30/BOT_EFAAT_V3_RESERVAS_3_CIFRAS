// ==========================================================================
// sessionsAdminController.js — administración de sesiones para paneles
// externos (BANN apps/api), servidor-a-servidor, detrás del token de
// servicio (middleware/tokenServicio.js).
//
// ADITIVO: no reemplaza nada existente. Reutiliza la MISMA infraestructura:
//   - fuente de verdad: tabla `sesiones` (la misma que usa el panel Next);
//   - control de sockets: el ÚNICO SessionManager (services/baileys/manager);
//   - QR: el que ya guarda services/baileys/qr.js en `sesiones.qr`;
//   - lease distribuido: services/baileys/lease.js (solo lectura aquí).
// No crea sesiones paralelas, ni QR propio, ni otro manager.
//
// Aislamiento: toda operación exige `usuarioId` (tenant legado) y verifica
// que la sesión le pertenece. Una sesión ajena responde 404 (no se revela
// su existencia).
//
// Datos sensibles: el QR solo sale por GET /:id/qr (nunca en listados) y
// nunca se devuelven credenciales ni el owner_id del lease.
// ==========================================================================

const fs = require("fs");
const path = require("path");

const supabase = require("../../lib/supabase");
const manager = require("../../services/baileys/manager");
const lease = require("../../services/baileys/lease");
const baileysService = require("../../services/baileysService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Misma carpeta que usa services/baileys/socket.js (useMultiFileAuthState).
const AUTH_ROOT = path.resolve(__dirname, "../../auth");

const COLUMNAS = "id, usuario_id, nombre, telefono, estado, activa, principal, created_at, qr, qr_expira_en";

const NOMBRE_MAX = 80;

// Margen para que terminen escrituras de credenciales en vuelo (mutex de
// useMultiFileAuthState) antes de borrar auth/<id>.
const MARGEN_ESCRITURAS_MS = Number(process.env.SESSIONS_DELETE_GRACE_MS) || 1500;

function esperar(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}

class ErrorHttp extends Error {

    constructor(status, code, mensaje) {

        super(mensaje);
        this.status = status;
        this.code = code;

    }

}

function responderError(res, err) {

    if (err instanceof ErrorHttp) {

        return res.status(err.status).json({ success: false, code: err.code, error: err.message });

    }

    console.error("❌ [SESSIONS ADMIN]", err?.message);

    return res.status(500).json({ success: false, code: "ERROR_INTERNO", error: "Error interno." });

}

function leerUsuarioId(req) {

    const usuarioId = (req.query && req.query.usuarioId) || (req.body && req.body.usuarioId);

    if (!usuarioId || !UUID.test(String(usuarioId))) {

        throw new ErrorHttp(400, "USUARIO_ID_INVALIDO", "Falta usuarioId o no es válido.");

    }

    return String(usuarioId);

}

function leerSessionId(req) {

    const { id } = req.params;

    if (!id || !UUID.test(id)) {

        throw new ErrorHttp(400, "SESSION_ID_INVALIDO", "El id de sesión no es válido.");

    }

    return id;

}

function leerNombre(valor, { obligatorio }) {

    const nombre = String(valor ?? "").trim();

    if (!nombre) {

        if (obligatorio) throw new ErrorHttp(422, "NOMBRE_OBLIGATORIO", "El nombre es obligatorio.");

        return "Nueva sesión";

    }

    if (nombre.length > NOMBRE_MAX) {

        throw new ErrorHttp(422, "NOMBRE_DEMASIADO_LARGO", `El nombre admite máximo ${NOMBRE_MAX} caracteres.`);

    }

    return nombre;

}

async function obtenerPropia(sessionId, usuarioId) {

    const { data, error } = await supabase
        .from("sesiones")
        .select(COLUMNAS)
        .eq("id", sessionId)
        .maybeSingle();

    if (error) throw error;

    if (!data || data.usuario_id !== usuarioId) {

        throw new ErrorHttp(404, "SESSION_NOT_FOUND", "Sesión no encontrada.");

    }

    return data;

}

async function leasesDe(ids) {

    if (!ids.length) return new Map();

    const { data, error } = await supabase
        .from("sesiones_lease")
        .select("session_id, owner_id, lease_until, heartbeat_at")
        .in("session_id", ids);

    if (error) {

        // El lease es informativo para el panel: si falla, la sesión se
        // devuelve igual (sin runtime.lease) en vez de fallar el listado.
        console.error("⚠️ [SESSIONS ADMIN] no se pudo leer sesiones_lease:", error.message);

        return new Map();

    }

    return new Map((data || []).map(f => [f.session_id, f]));

}

function describirLease(fila) {

    if (!fila) return null;

    return {
        vigente: new Date(fila.lease_until).getTime() > Date.now(),
        deEstaInstancia: fila.owner_id === lease.OWNER_ID,
        heartbeatAt: fila.heartbeat_at
    };

}

function publico(fila, filaLease) {

    return {
        id: fila.id,
        usuarioId: fila.usuario_id,
        nombre: fila.nombre,
        telefono: fila.telefono || null,
        estado: fila.estado,
        activa: !!fila.activa,
        principal: !!fila.principal,
        creadoEn: fila.created_at,
        qrDisponible: fila.estado === "esperando_qr" && !!fila.qr,
        qrExpiraEn: fila.qr_expira_en || null,
        runtime: {
            socketEnEstaInstancia: manager.has(fila.id),
            esSesionActivaDelBot: manager.isActive(fila.id),
            lease: describirLease(filaLease)
        }
    };

}

// La sesión la opera OTRA instancia (lease vigente de otro proceso): esta
// instancia no tiene su socket ni su carpeta auth/<id>.
function leaseDeOtraInstancia(filaLease) {

    const info = describirLease(filaLease);

    return !!(info && info.vigente && !info.deEstaInstancia);

}

// GET /sessions?usuarioId=
async function listar(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);

        const { data, error } = await supabase
            .from("sesiones")
            .select(COLUMNAS)
            .eq("usuario_id", usuarioId)
            .order("created_at", { ascending: true });

        if (error) throw error;

        const leases = await leasesDe((data || []).map(f => f.id));

        res.json({ success: true, sesiones: (data || []).map(f => publico(f, leases.get(f.id))) });

    } catch (err) {

        responderError(res, err);

    }

}

// GET /sessions/:id?usuarioId=
async function obtener(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const sessionId = leerSessionId(req);

        const fila = await obtenerPropia(sessionId, usuarioId);
        const leases = await leasesDe([sessionId]);

        res.json({ success: true, sesion: publico(fila, leases.get(sessionId)) });

    } catch (err) {

        responderError(res, err);

    }

}

// POST /sessions { usuarioId, nombre } — mismo alta que hace el panel Next
// (services/sessions/createSession.ts), ahora del lado del servidor.
async function crear(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const nombre = leerNombre(req.body?.nombre, { obligatorio: false });

        const { data, error } = await supabase
            .from("sesiones")
            .insert({
                usuario_id: usuarioId,
                nombre,
                estado: "desconectado",
                principal: false
            })
            .select(COLUMNAS)
            .single();

        if (error) throw error;

        console.log("🆕 [SESSIONS ADMIN] sesión creada:", data.id);

        res.status(201).json({ success: true, sesion: publico(data, null) });

    } catch (err) {

        responderError(res, err);

    }

}

// PATCH /sessions/:id { usuarioId, nombre } — solo el nombre.
async function renombrar(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const sessionId = leerSessionId(req);
        const nombre = leerNombre(req.body?.nombre, { obligatorio: true });

        await obtenerPropia(sessionId, usuarioId);

        const { data, error } = await supabase
            .from("sesiones")
            .update({ nombre })
            .eq("id", sessionId)
            .eq("usuario_id", usuarioId)
            .select(COLUMNAS)
            .single();

        if (error) throw error;

        // Mantener coherentes los logs de trazabilidad del socket vivo.
        const sock = manager.get(sessionId);
        if (sock?.context) sock.context.nombreSesion = nombre;

        const leases = await leasesDe([sessionId]);

        res.json({ success: true, sesion: publico(data, leases.get(sessionId)) });

    } catch (err) {

        responderError(res, err);

    }

}

// GET /sessions/:id/qr?usuarioId= — el QR real que Baileys generó y
// services/baileys/qr.js guardó. Nunca se cachea.
async function qr(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const sessionId = leerSessionId(req);

        const fila = await obtenerPropia(sessionId, usuarioId);

        res.set("Cache-Control", "no-store");

        const disponible = fila.estado === "esperando_qr" && !!fila.qr;

        res.json({
            success: true,
            estado: fila.estado,
            qr: disponible ? fila.qr : null,
            qrExpiraEn: disponible ? fila.qr_expira_en : null
        });

    } catch (err) {

        responderError(res, err);

    }

}

// POST /sessions/:id/reconnect { usuarioId }
//
// Reconecta SIN cerrar sesión en WhatsApp (sin logout, sin QR nuevo):
//   - con socket vinculado vivo: sock.end() -> connection "close" sin código
//     -> rama de "desconexión temporal" EXISTENTE de desconectado.js (misma
//     reconexión con backoff y las mismas credenciales en disco);
//   - sin socket: arranque normal con manager.start() (igual que /connect).
async function reconectar(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const sessionId = leerSessionId(req);

        await obtenerPropia(sessionId, usuarioId);

        const leases = await leasesDe([sessionId]);

        if (leaseDeOtraInstancia(leases.get(sessionId))) {

            throw new ErrorHttp(409, "LEASE_NO_DISPONIBLE", "La sesión está siendo operada por otra instancia del backend.");

        }

        const sock = manager.get(sessionId);

        if (sock && !sock.user) {

            throw new ErrorHttp(409, "EN_VINCULACION", "La sesión está esperando el escaneo del QR; no hay nada que reconectar.");

        }

        if (sock) {

            console.log("♻️ [SESSIONS ADMIN] reconexión manual (sin logout):", sessionId);

            await sock.end(new Error("Reconexión manual solicitada desde el panel"));

            return res.json({ success: true, sessionId, accion: "reinicio_socket" });

        }

        const data = await baileysService.connect(sessionId);

        if (data.success === false && data.code === "SESSION_NOT_FOUND") {

            throw new ErrorHttp(404, "SESSION_NOT_FOUND", "Sesión no encontrada.");

        }

        if (data.success === false && data.code === "LEASE_NO_DISPONIBLE") {

            throw new ErrorHttp(409, "LEASE_NO_DISPONIBLE", "La sesión está siendo operada por otra instancia del backend.");

        }

        res.json({ success: true, sessionId, accion: "arranque" });

    } catch (err) {

        responderError(res, err);

    }

}

async function borrarCarpetaAuth(sessionId) {

    const carpeta = path.join(AUTH_ROOT, sessionId);

    // Defensa en profundidad: sessionId ya es un UUID validado, pero la
    // ruta final debe quedar exactamente en AUTH_ROOT/<id>.
    if (path.relative(AUTH_ROOT, carpeta) !== sessionId) {

        throw new Error("Ruta de credenciales fuera de la carpeta auth.");

    }

    const existia = fs.existsSync(carpeta);

    await fs.promises.rm(carpeta, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });

    return { existia, eliminada: !fs.existsSync(carpeta) };

}

// DELETE /sessions/:id?usuarioId=
//
// Orden:
//   1. desconectar el socket (manager.stop: logout en WhatsApp, cancela
//      reintentos pendientes, libera lease, failover si era la activa);
//   2. eliminar la fila de `sesiones` (sesiones_lease cae en cascada);
//   3. eliminar auth/<id>.
// Solo la instancia dueña de la sesión puede borrarla: la carpeta auth/<id>
// vive en SU disco. Si el lease es de otra instancia -> 409, nada se toca.
async function eliminar(req, res) {

    try {

        const usuarioId = leerUsuarioId(req);
        const sessionId = leerSessionId(req);

        await obtenerPropia(sessionId, usuarioId);

        const leases = await leasesDe([sessionId]);

        if (leaseDeOtraInstancia(leases.get(sessionId))) {

            throw new ErrorHttp(409, "LEASE_NO_DISPONIBLE", "La sesión está siendo operada por otra instancia del backend; elimínala desde esa instancia.");

        }

        console.log("🗑️ [SESSIONS ADMIN] eliminando sesión:", sessionId);

        // 1. Desconectar.
        const sock = manager.get(sessionId);

        await manager.stop(sessionId);

        if (sock?.ev?.removeAllListeners) {

            // Ninguna escritura de credenciales nueva sobre la carpeta que
            // se va a borrar.
            sock.ev.removeAllListeners("creds.update");

        }

        await esperar(MARGEN_ESCRITURAS_MS);

        // 2. Eliminar la fila.
        const { error } = await supabase
            .from("sesiones")
            .delete()
            .eq("id", sessionId)
            .eq("usuario_id", usuarioId);

        if (error) {

            console.error("❌ [SESSIONS ADMIN] sesión desconectada pero la fila no se pudo eliminar:", sessionId, error.message);

            throw new ErrorHttp(500, "FILA_NO_ELIMINADA", "La sesión se desconectó pero no se pudo eliminar su registro.");

        }

        // 3. Limpiar credenciales.
        let auth;

        try {

            auth = await borrarCarpetaAuth(sessionId);

        } catch (err) {

            console.error("❌ [SESSIONS ADMIN] fila eliminada pero auth/<id> no se pudo borrar:", sessionId, err.message);

            return res.status(500).json({
                success: false,
                code: "AUTH_NO_ELIMINADO",
                error: "La sesión se eliminó pero su carpeta de credenciales no se pudo borrar.",
                sessionId
            });

        }

        if (!auth.eliminada) {

            return res.status(500).json({
                success: false,
                code: "AUTH_NO_ELIMINADO",
                error: "La sesión se eliminó pero su carpeta de credenciales sigue existiendo.",
                sessionId
            });

        }

        console.log("✅ [SESSIONS ADMIN] sesión eliminada:", sessionId, { authExistia: auth.existia });

        res.json({ success: true, sessionId, authEliminado: true, authExistia: auth.existia });

    } catch (err) {

        responderError(res, err);

    }

}

module.exports = {
    listar,
    obtener,
    crear,
    renombrar,
    qr,
    reconectar,
    eliminar,
    // expuesto para pruebas
    _AUTH_ROOT: AUTH_ROOT
};
