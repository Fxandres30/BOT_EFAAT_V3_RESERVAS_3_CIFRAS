// ==========================================================================
// routes/tablas.js — endpoints reales del botón "Compartir" del panel de
// tablas. Toda la lógica real vive en services/compartirTabla.js (única
// implementación, reutilizada también por automation/scheduler.js para
// INITIAL_TABLE) — este archivo solo resuelve HTTP y qué evento aplica.
// ==========================================================================

const router = require("express").Router();

const supabase = require("../lib/supabase");
const { obtenerConfiguracion } = require("../bot/funciones/eventos/configEvento");
const tablaEventoRepo = require("../automation/repo/tablaEvento");
const { compartirTabla, verificarTokenImprimir } = require("../services/compartirTabla");

// Mismo criterio real que frontend/services/tablas/obtenerEventoActivo.ts
// (a lo sumo un evento "activo" por tabla+usuario) — reproducido aquí para
// que el endpoint manual pueda resolver el grupo real sin que el panel
// tenga que conocerlo de antemano.
async function obtenerEventoActivoReal(tabla, usuarioId) {

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("tabla", tabla)
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;

    return data;

}

// GET /tablas/imprimir-datos?precio=&token= — SOLO lo usa Puppeteer
// (compartirTabla.js), nunca el navegador de un cliente real. El token
// firmado (HMAC, corta duración) es lo único que autoriza esta lectura —
// sin él, no se expone ningún dato.
router.get("/imprimir-datos", async (req, res) => {

    try {

        const precio = Number(req.query.precio);
        const token = req.query.token;

        if (!precio || !verificarTokenImprimir(precio, token)) {
            return res.status(401).json({ error: "Token inválido o expirado." });
        }

        const config = obtenerConfiguracion(precio);

        if (!config) {
            return res.status(404).json({ error: "No existe una tabla configurada para este precio." });
        }

        // Solo número + estado — nunca nombre/teléfono/contacto real: esta
        // imagen se difunde a un grupo completo, no es una vista admin.
        const { numerosDisponibles, numerosOcupados } = await tablaEventoRepo.obtenerNumeros(config.tabla);

        res.json({
            numerosDisponibles,
            numerosOcupados,
            cifras: config.cifras,
            cantidad: config.cantidad
        });

    } catch (err) {

        console.error("❌ [TABLAS] error en /imprimir-datos:", err.message);
        res.status(500).json({ error: "Error interno." });

    }

});

// POST /tablas/compartir — { precio, usuarioId } — botón manual del panel.
// Resuelve el evento REAL activo de esa tabla para ese usuario y ejecuta
// exactamente la misma función que usa la automatización (Scheduler).
router.post("/compartir", async (req, res) => {

    try {

        const { precio, usuarioId } = req.body || {};

        if (!precio || !usuarioId) {
            return res.status(400).json({ enviado: false, motivo: "faltan_parametros" });
        }

        const config = obtenerConfiguracion(precio);

        if (!config) {
            return res.status(404).json({ enviado: false, motivo: "tabla_no_configurada" });
        }

        const evento = await obtenerEventoActivoReal(config.tabla, usuarioId);

        if (!evento) {
            return res.status(404).json({ enviado: false, motivo: "sin_evento_activo" });
        }

        const resultado = await compartirTabla({ evento });

        res.json(resultado);

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir:", err.message);
        res.status(500).json({ enviado: false, motivo: "error_interno", error: err.message });

    }

});

module.exports = router;
