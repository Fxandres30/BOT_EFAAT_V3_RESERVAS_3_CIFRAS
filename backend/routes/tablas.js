// ==========================================================================
// routes/tablas.js — endpoints reales del botón "Compartir" del panel de
// tablas. Toda la lógica real vive en services/compartirTabla.js (única
// implementación, reutilizada también por automation/scheduler.js para
// INITIAL_TABLE) — este archivo solo resuelve HTTP y qué evento aplica.
// ==========================================================================

const router = require("express").Router();

// SEGURIDAD (2026-10): el usuario sale del token de Supabase validado por
// exigirUsuario (req.usuarioId), NUNCA del usuarioId que manda el navegador
// (antes cualquiera podía pedir los datos de otro cliente cambiando ese
// parámetro). Un usuarioId del cliente, si llega, se ignora.
const { exigirUsuario } = require("../middleware/autenticacionUsuario");

const supabase = require("../lib/supabase");
// Precio -> tabla física SEGÚN EL CLIENTE (tablas_cliente, migración 027;
// sin ella, la configuración base de siempre).
const { obtenerConfiguracionCliente, inicializarCliente, prepararCuadricula } = require("../bot/funciones/eventos/tablasCliente");
const tablaEventoRepo = require("../automation/repo/tablaEvento");
const { compartirTabla, verificarTokenImprimirDetalle } = require("../services/compartirTabla");
const { disenoDelEvento } = require("../sorteos/repo");
const { normalizarConfigDiseno } = require("../sorteos/disenoTabla");

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

        // El dueño de la tabla (y el evento, si lo hay) salen del token
        // firmado, nunca de la URL.
        const firmado = precio ? verificarTokenImprimirDetalle(precio, token) : null;
        const usuarioId = firmado?.usuarioId || null;

        if (!usuarioId) {
            return res.status(401).json({ error: "Token inválido o expirado." });
        }

        const config = await obtenerConfiguracionCliente(usuarioId, precio);

        if (!config) {
            return res.status(404).json({ error: "No existe una tabla configurada para este precio." });
        }

        // Solo número + estado — nunca nombre/teléfono/contacto real: esta
        // imagen se difunde a un grupo completo, no es una vista admin.
        const { numerosDisponibles, numerosOcupados } = await tablaEventoRepo.obtenerNumeros(config.tabla, usuarioId);

        // Estilo: el guardado en el SORTEO programado de ese evento (el
        // mismo que se vio en la vista previa); si el evento no viene de un
        // sorteo programado, el diseño activo de la tabla de ese precio.
        // Sin diseño o si no es válido: null (la página usa el de por defecto).
        let diseno;

        if (firmado.eventoId) {
            const r = await disenoDelEvento(usuarioId, firmado.eventoId);
            if (r.ok && r.data) diseno = r.data.config ?? null;
        }

        if (diseno === undefined) {
            const { data: visual } = await supabase
                .from("tabla_configuracion_visual")
                .select("config")
                .eq("usuario_id", usuarioId)
                .eq("precio", precio)
                .maybeSingle();
            diseno = visual?.config;
        }

        res.json({
            numerosDisponibles,
            numerosOcupados,
            cifras: config.cifras,
            cantidad: config.cantidad,
            diseno: normalizarConfigDiseno(diseno)
        });

    } catch (err) {

        console.error("❌ [TABLAS] error en /imprimir-datos:", err.message);
        res.status(500).json({ error: "Error interno." });

    }

});

// POST /tablas/compartir — { precio, usuarioId } — botón manual del panel.
// Resuelve el evento REAL activo de esa tabla para ese usuario y ejecuta
// exactamente la misma función que usa la automatización (Scheduler).
router.post("/compartir", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { precio } = req.body || {};

        if (!precio || !usuarioId) {
            return res.status(400).json({ enviado: false, motivo: "faltan_parametros" });
        }

        const config = await obtenerConfiguracionCliente(usuarioId, precio);

        if (!config) {
            return res.status(404).json({ enviado: false, motivo: "tabla_no_configurada" });
        }

        const evento = await obtenerEventoActivoReal(config.tabla, usuarioId);

        if (!evento) {
            return res.status(404).json({ enviado: false, motivo: "sin_evento_activo" });
        }

        // Con el WhatsApp activo DE ESTE cliente (multisesión): nunca con el
        // de otro cliente conectado al mismo proceso.
        const sock = require("../services/baileys/manager").getSocketActivoDe(usuarioId);

        if (!sock) {
            return res.status(409).json({ enviado: false, motivo: "sin_sesion_activa" });
        }

        const resultado = await compartirTabla({ evento, sock });

        res.json(resultado);

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir:", err.message);
        res.status(500).json({ enviado: false, motivo: "error_interno", error: err.message });

    }

});

// POST /tablas/inicializar — primer acceso del cliente al panel: crea sus
// configuraciones (precios base del código) y su cuadrícula 00-99 en cada
// tabla física, de forma idempotente. El cliente sale del token; el cuerpo
// se ignora entero.
const HTTP_INICIALIZAR = { migracion_pendiente: 503, parte_a_pendiente: 503, restriccion_unica: 409 };

router.post("/inicializar", exigirUsuario, async (req, res) => {

    try {

        const r = await inicializarCliente(req.usuarioId);

        if (r.ok) return res.json({ ok: true, data: r.data });

        res.status(HTTP_INICIALIZAR[r.motivo] || 500).json({ ok: false, motivo: r.motivo, ...(r.migracion ? { migracion: r.migracion } : {}) });

    } catch (err) {

        console.error("❌ [TABLAS] error en /inicializar:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /tablas/:precio/preparar — el panel no ve ninguna fila de su
// cuadrícula. El backend cuenta las filas REALES del cliente del token y,
// solo si no tiene ninguna, pide la inicialización segura (027). Responde
// el estado real o el motivo por el que no se pudo (migración pendiente,
// unicidad sobre numero, error de lectura...) para que el panel no lo
// muestre como "tabla vacía, reinicia". Nunca reinicia ni borra.
const HTTP_PREPARAR = { ...HTTP_INICIALIZAR, sin_usuario: 401, tabla_no_configurada: 404, error_lectura: 500 };

router.post("/:precio/preparar", exigirUsuario, async (req, res) => {

    try {

        if (!/^\d{1,7}$/.test(String(req.params.precio))) {
            return res.status(400).json({ ok: false, motivo: "parametros_invalidos" });
        }

        const r = await prepararCuadricula(req.usuarioId, req.params.precio);

        if (r.ok) return res.json(r);

        res.status(HTTP_PREPARAR[r.motivo] || 500).json(r);

    } catch (err) {

        console.error("❌ [TABLAS] error en /preparar:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// ==========================================================================
// Intervención MANUAL sobre un número (services/reservaManual.js): buscar
// contactos, ver el contexto del número, reservar, registrar el pago,
// liberar y desbloquear. El cliente y el operador salen del token
// (exigirUsuario); un usuarioId, operador o estado enviado por el navegador
// se ignora. Ninguna de estas rutas envía mensajes de WhatsApp.
// ==========================================================================

const reservaManual = require("../services/reservaManual");

const operadorDe = (req) => ({ id: req.usuarioId, email: req.usuarioEmail || null });

const HTTP_RESERVA_MANUAL = {
    tabla_no_configurada: 404, numero_inexistente: 404, contacto_no_existe: 404,
    no_disponible: 409, estado_cambio: 409, no_reservado: 409, ya_libre: 409,
    sin_sorteo: 409, sorteo_cerrado: 409, telefono_no_vinculable: 409, telefono_ambiguo: 409,
    pago_sin_telefono: 409, grupo_no_autorizado: 403, sin_usuario: 401
};

function responderManual(res, r) {
    if (r.ok) return res.json(r);
    const status = HTTP_RESERVA_MANUAL[r.motivo] || (String(r.motivo).startsWith("error") ? 500 : 400);
    return res.status(status).json(r);
}

const NUMERO_VALIDO = /^\d{1,4}$/;

function manejar(nombre, fn) {
    return async (req, res) => {
        try {
            if (req.params.numero !== undefined && !NUMERO_VALIDO.test(req.params.numero)) {
                return res.status(400).json({ ok: false, motivo: "numero_invalido", mensaje: "Número inválido." });
            }
            responderManual(res, await fn(req));
        } catch (err) {
            console.error(`❌ [TABLAS] error en ${nombre}:`, err.message);
            res.status(500).json({ ok: false, motivo: "error_interno", mensaje: "Error interno." });
        }
    };
}

// GET /tablas/contactos/buscar?q= — directorio del cliente, por nombre o teléfono.
router.get("/contactos/buscar", exigirUsuario, manejar("buscar contactos", (req) =>
    reservaManual.buscarContactos({ usuarioId: req.usuarioId, q: String(req.query.q || "").slice(0, 80) })
));

// GET /tablas/:precio/numeros/:numero — estado real, sorteo, grupos,
// acciones permitidas e historial (auditoría) del número.
router.get("/:precio/numeros/:numero", exigirUsuario, manejar("contexto de número", (req) =>
    reservaManual.contextoNumero({ usuarioId: req.usuarioId, precio: req.params.precio, numero: req.params.numero })
));

// POST /tablas/:precio/numeros/:numero/reservar
// { contactoId | nuevoContacto: { nombre, telefono }, eventoId, motivo, observaciones, solicitudId }
router.post("/:precio/numeros/:numero/reservar", exigirUsuario, manejar("reserva manual", (req) => {
    const b = req.body || {};
    return reservaManual.reservarManual({
        usuarioId: req.usuarioId,
        operador: operadorDe(req),
        precio: req.params.precio,
        numero: req.params.numero,
        contactoId: b.contactoId || null,
        nuevoContacto: b.nuevoContacto || null,
        eventoId: b.eventoId || null,
        motivo: b.motivo,
        observaciones: b.observaciones,
        solicitudId: b.solicitudId
    });
}));

// POST /tablas/:precio/numeros/:numero/pagar — { metodoPago, observaciones, motivo, solicitudId }
router.post("/:precio/numeros/:numero/pagar", exigirUsuario, manejar("pago manual", (req) => {
    const b = req.body || {};
    return reservaManual.pagarManual({
        usuarioId: req.usuarioId,
        operador: operadorDe(req),
        precio: req.params.precio,
        numero: req.params.numero,
        metodoPago: b.metodoPago,
        observaciones: b.observaciones,
        motivo: b.motivo,
        solicitudId: b.solicitudId
    });
}));

// POST /tablas/:precio/numeros/:numero/liberar — { confirmar: true, motivo, observaciones, solicitudId }
// Libera una reserva, anula un pago o desbloquea, según el estado real.
router.post("/:precio/numeros/:numero/liberar", exigirUsuario, manejar("liberar número", (req) => {
    const b = req.body || {};
    return reservaManual.liberarManual({
        usuarioId: req.usuarioId,
        operador: operadorDe(req),
        precio: req.params.precio,
        numero: req.params.numero,
        confirmar: b.confirmar === true,
        motivo: b.motivo,
        observaciones: b.observaciones,
        solicitudId: b.solicitudId
    });
}));

module.exports = router;
