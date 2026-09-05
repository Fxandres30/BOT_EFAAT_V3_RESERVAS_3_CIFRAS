const baileysService = require("../../services/baileysService");
const manager = require("../../services/baileys/manager");
const supabase = require("../../lib/supabase");

const fs = require("fs");
const path = require("path");

const {
    escanearIdentidades,
    formatearReporteTexto
} = require("../funciones/usuarios/escanerIdentidades");


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

module.exports = {

    connect,
    disconnect,
    status,

    setActive,
    getActive,
    setPreferred,

    escanerIdentidadesDryRun

};