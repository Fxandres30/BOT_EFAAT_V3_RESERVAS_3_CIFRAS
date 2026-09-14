const baileysService = require("../../services/baileysService");
const manager = require("../../services/baileys/manager");
const supabase = require("../../lib/supabase");

const fs = require("fs");
const path = require("path");

const {
    escanearIdentidades,
    formatearReporteTexto
} = require("../funciones/usuarios/escanerIdentidades");

const {
    ejecutarDiagnosticoTelefonosLid
} = require("../funciones/usuarios/identityScanner/diagnosticoTelefonosLid");

const {
    escanearTodosLosGrupos,
    obtenerEstadoIdentitySync
} = require("../funciones/usuarios/escanerIdentidadesLifecycle");

const {
    groupFetchAllParticipating
} = require("../../services/baileys/groupQueue");


async function connect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Conectar:", sessionId);

        const data = await baileysService.connect(sessionId);

        if (data.success === false && data.code === "SESSION_NOT_FOUND") {

            return res.status(404).json(data);

        }

        // La sesión está funcionando en la otra instancia (LOCAL/VPS) —
        // no es un 404 (la sesión existe) ni un 500 (no hubo error real).
        if (data.success === false && data.code === "LEASE_NO_DISPONIBLE") {

            return res.status(409).json(data);

        }

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function disconnect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Desconectar:", sessionId);

        const data = await baileysService.disconnect(sessionId);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function status(req, res) {

    try {

        const { id } = req.params;

        const data = await baileysService.status(id);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function setActive(req, res) {

    try {

        const { sessionId } = req.body;

        // Selección manual real del usuario desde el panel -> también
        // se marca como sesión preferida (Fase 5.1).
        const ok = await manager.setActive(sessionId, { preferida: true });

        if (!ok) {

            return res.status(404).json({
                success: false
            });

        }

        res.json({
            success: true
        });

    }

    catch (err) {

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

}

async function getActive(req, res) {

    const { data } = await supabase
        .from("sesiones")
        .select("*")
        .eq("activa", true)
        .maybeSingle();

    res.json(data);

}

// Marca una sesión como preferida sin exigir que esté conectada
// (botón "Hacer principal" sobre una sesión desconectada).
async function setPreferred(req, res) {

    try {

        const { sessionId } = req.body;

        const ok = await manager.marcarPreferidaManual(sessionId);

        if (!ok) {

            return res.status(404).json({
                success: false
            });

        }

        res.json({
            success: true
        });

    }

    catch (err) {

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

}

// ==========================================================================
// Escáner de identidades — DRY-RUN de solo lectura.
//
// Existe SOLO porque un script de terminal separado (node ...) no puede
// acceder al socket de Baileys ya conectado en la memoria de ESTE proceso
// (manager es un singleton en memoria; dos procesos de Node no comparten
// memoria). Esta ruta corre el escaneo DENTRO de este proceso, donde el
// socket real sí existe, sin reconectar ni tocar credenciales.
//
// NUNCA escribe en Supabase, NUNCA toca "usuarios", NUNCA importa — solo
// llama a escanearIdentidades() (ver bot/funciones/usuarios/escanerIdentidades.js)
// y guarda el reporte en backend/reportes_identidad/.
// ==========================================================================
async function escanerIdentidadesDryRun(req, res) {

    try {

        const sock = manager.getActiveSocket();

        if (!sock) {

            return res.status(409).json({
                success: false,
                error: "No hay una sesión activa conectada (manager.getActiveSocket() es null)."
            });

        }

        const resultado = await escanearIdentidades({ sock });

        const dirReportes = path.resolve(__dirname, "../../reportes_identidad");

        if (!fs.existsSync(dirReportes)) {
            fs.mkdirSync(dirReportes, { recursive: true });
        }

        const nombreArchivo = `escaner-${resultado.generadoEn.replace(/[:.]/g, "-")}.json`;
        const rutaArchivo = path.join(dirReportes, nombreArchivo);

        fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2), "utf8");

        console.log(formatearReporteTexto(resultado));
        console.log(`📄 Reporte guardado en: ${rutaArchivo}`);

        res.json({
            success: true,
            ruta: rutaArchivo,
            texto: formatearReporteTexto(resultado),
            resultado
        });

    } catch (error) {

        console.error("❌ Error en escanerIdentidadesDryRun");
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

}

// ==========================================================================
// diagnosticoTelefonosLid(req, res) — diagnóstico puntual, 100% READ-ONLY
// (auditoría de identidad, sección "por qué tan pocos teléfonos").
//
// Mismo patrón EXACTO que escanerIdentidadesDryRun() de arriba:
// manager.getActiveSocket() (409 si no hay sesión), corre el diagnóstico,
// guarda el reporte en reportes_identidad/, lo imprime en la consola de
// ESTE proceso (que ya tiene el sock real) y responde el JSON.
//
// NUNCA escribe en Supabase, NUNCA toca "usuarios"/reservas, NUNCA llama a
// obtenerUsuarioGlobal/resolverIdentidad/escanearGrupo/importarIdentidades,
// NUNCA modifica identityScanner/identityResolver ni la sesión/credenciales
// de WhatsApp — ver bot/funciones/usuarios/identityScanner/
// diagnosticoTelefonosLid.js para el detalle de qué hace.
// ==========================================================================
async function diagnosticoTelefonosLid(req, res) {

    try {

        const sock = manager.getActiveSocket();

        if (!sock) {

            return res.status(409).json({
                success: false,
                error: "No hay una sesión activa conectada (manager.getActiveSocket() es null)."
            });

        }

        const resultado = await ejecutarDiagnosticoTelefonosLid(sock);

        const dirReportes = path.resolve(__dirname, "../../reportes_identidad");

        if (!fs.existsSync(dirReportes)) {
            fs.mkdirSync(dirReportes, { recursive: true });
        }

        const nombreArchivo = `diagnostico_telefonos_lid_${resultado.generadoEn.replace(/[:.]/g, "-")}.json`;
        const rutaArchivo = path.join(dirReportes, nombreArchivo);

        fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2), "utf8");

        console.log(resultado.resumenTexto);
        console.log(`📄 Reporte guardado en: ${rutaArchivo}`);

        res.json({
            success: true,
            ruta: rutaArchivo,
            ...resultado
        });

    } catch (error) {

        console.error("❌ Error en diagnosticoTelefonosLid");
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

}

// ==========================================================================
// backfillContactos(req, res) — dispara AHORA el escaneo completo real de
// identidades (Identity Scanner + import) para la sesión activa, en vez de
// esperar al escaneo periódico (cada 6h) o al próximo reinicio del bot.
//
// NO es un mecanismo nuevo: reutiliza tal cual
// escanerIdentidadesLifecycle.js::escanearTodosLosGrupos(sessionId, sock)
// — la MISMA función que ya corre automáticamente al conectar cada sesión
// y cada 6 horas (ver iniciarEscanerIdentidades). Esta ruta solo la
// dispara manualmente sobre la sesión activa AHORA MISMO. No se reimplementa
// ninguna extracción/resolución de identidad aquí.
//
// SÍ escribe en Supabase (a diferencia de escanerIdentidadesDryRun de
// arriba): resuelve/crea filas reales en "usuarios" (vía
// obtenerUsuarioGlobal, con las mismas garantías de siempre: nunca
// sobrescribe, nunca duplica, detecta conflicto) y, ahora que existe
// contactos_tenant (migración 018, pendiente de aplicar en Supabase),
// registra la relación tenant/contacto usando sock.context.usuarioId —
// nunca un tenant inventado. Si la migración 018 todavía no se aplicó,
// registrarContactoTenant() falla en silencio (solo loguea) y la
// resolución de identidad en "usuarios" sigue funcionando igual — ver su
// cabecera en obtenerUsuarioGlobal.js.
// ==========================================================================
async function backfillContactos(req, res) {

    try {

        const sessionId = manager.getActiveSession();
        const sock = manager.getActiveSocket();

        if (!sock || !sessionId) {

            return res.status(409).json({
                success: false,
                estado: "sin_sesion",
                error: "No hay una sesión activa conectada (manager.getActiveSocket() es null)."
            });

        }

        // Se consulta el estado ANTES de intentar disparar el escaneo —
        // evita depender de adivinar POR QUÉ escanearTodosLosGrupos()
        // devolvió null (el guard interno, escaneoCompletoEnCurso, no se
        // toca ni se debilita: esto solo permite responder con un mensaje
        // claro en vez de un 409 genérico cuando la razón real es "ya hay
        // uno corriendo", que no es un error funcional.
        if (obtenerEstadoIdentitySync(sessionId) === "scanning" || obtenerEstadoIdentitySync(sessionId) === "syncing") {

            return res.status(202).json({
                success: true,
                yaEnCurso: true,
                estado: obtenerEstadoIdentitySync(sessionId),
                sessionId,
                mensaje: "Ya hay un escaneo completo en curso para esta sesión — no es un error, espera a que termine (puede tardar varios minutos con ~2.800 participantes)."
            });

        }

        const resultado = await escanearTodosLosGrupos(sessionId, sock);

        if (!resultado) {

            // Con el chequeo de arriba, llegar aquí ya casi siempre significa
            // "la sesión dejó de ser vigente justo en este instante" (carrera
            // real, no el caso común) — se distingue igual del caso anterior.
            return res.status(409).json({
                success: false,
                estado: obtenerEstadoIdentitySync(sessionId),
                error: "El escaneo no se ejecutó (la sesión dejó de estar activa justo al intentar escanear). Revisa los logs del bot."
            });

        }

        res.json({

            success: true,
            estado: obtenerEstadoIdentitySync(sessionId),
            sessionId,
            usuarioIdTenant: sock.context?.usuarioId || null,

            estadisticas: resultado.resultado.estadisticas,

            importado: {
                nuevos: resultado.resultadoImport.nuevos,
                enriquecidos: resultado.resultadoImport.enriquecidos,
                conflictos: resultado.resultadoImport.conflictos,
                errores: resultado.resultadoImport.errores,
                total: resultado.resultadoImport.total
            }

        });

    } catch (error) {

        console.error("❌ Error en backfillContactos");
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

}

// ==========================================================================
// estadoBackfillContactos(req, res) — GET de solo lectura, para que el
// panel pueda hacer polling del progreso del escaneo SIN volver a
// dispararlo (a diferencia de POST /active/backfill-contactos, que sí lo
// dispara si no hay uno en curso). Reutiliza tal cual
// obtenerEstadoIdentitySync(sessionId) — "idle" | "scanning" | "syncing" |
// "error" — no inventa un estado paralelo.
// ==========================================================================
function estadoBackfillContactos(req, res) {

    const sessionId = manager.getActiveSession();

    if (!sessionId) {

        return res.json({ success: true, sessionId: null, estado: "sin_sesion" });

    }

    res.json({
        success: true,
        sessionId,
        estado: obtenerEstadoIdentitySync(sessionId)
    });

}

// ==========================================================================
// gruposDisponibles(req, res) — Fase 4D (panel de Automatización, "+
// Autorizar grupo").
//
// Reutiliza infraestructura EXISTENTE, sin crear otro sistema de
// sesiones: manager.get(id) (mismo que ya usa status()) para obtener el
// socket real de ESA sesión, y groupQueue.groupFetchAllParticipating()
// (extensión mínima de la cola IQ existente, ver services/baileys/
// groupQueue.js) para listar TODOS los grupos reales en los que participa
// esa cuenta de WhatsApp — nunca un grupo inventado ni derivado de otra
// tabla.
//
// NUNCA escribe nada en Supabase — es de solo lectura, la lista es
// dinámica (se pide "no guardar automáticamente todos los grupos").
// ==========================================================================
async function gruposDisponibles(req, res) {

    try {

        const { id } = req.params;

        const sock = manager.get(id);

        if (!sock) {

            return res.status(409).json({
                success: false,
                error: `La sesión ${id} no tiene un socket conectado ahora mismo.`
            });

        }

        const metadata = await groupFetchAllParticipating(sock);

        const grupos = Object.values(metadata || {}).map((g) => ({
            id: g.id,
            nombre: g.subject || g.id
        }));

        res.json({
            success: true,
            sessionId: id,
            grupos
        });

    } catch (error) {

        console.error("❌ Error en gruposDisponibles");
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

}

module.exports = {

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

};