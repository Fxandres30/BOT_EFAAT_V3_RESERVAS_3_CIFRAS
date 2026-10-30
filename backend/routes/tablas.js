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
const { obtenerConfiguracionCliente, listarConfiguracionesCliente, inicializarCliente, prepararCuadricula } = require("../bot/funciones/eventos/tablasCliente");
const { compartirTabla, compartirEnGrupos, capturarImagenTabla, verificarTokenImprimirDetalle } = require("../services/compartirTabla");
const { datosTablaImprimir } = require("../services/datosTablaImprimir");
const destinos = require("../services/destinosCompartir");
const compartirManual = require("../services/compartirManual");

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

// GET /tablas/imprimir-datos?precio=&token= — lectura con enlace firmado
// (HMAC, corta duración, TABLA_SHARE_SECRET). La captura de «Compartir» YA
// NO la usa: compartirTabla.js entrega los datos a la página directamente.
// Se conserva por compatibilidad; sin el token correcto no expone nada.
router.get("/imprimir-datos", async (req, res) => {

    try {

        const precio = Number(req.query.precio);
        const token = req.query.token;

        // El dueño de la tabla (y el evento, si lo hay) salen del token
        // firmado, nunca de la URL.
        const firmado = precio ? verificarTokenImprimirDetalle(precio, token) : null;
        const usuarioId = firmado?.usuarioId || null;

        if (!usuarioId) {
            return res.status(401).json({ error: "El enlace no es válido o ya caducó. Vuelve a abrirlo desde el panel." });
        }

        const r = await datosTablaImprimir(usuarioId, precio, firmado.eventoId);

        if (!r.ok) return res.status(r.status).json({ error: r.error });

        res.json(r.data);

    } catch (err) {

        console.error("❌ [TABLAS] error en /imprimir-datos:", err.message);
        res.status(500).json({ error: "Error interno." });

    }

});

// ------------------------------------------- «Compartir» con destinos ---
// El panel elige (y guarda) a qué grupos se publica la tabla; después un
// clic envía imagen + texto a esos grupos. Ver services/destinosCompartir.js.

const SOLICITUD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const precioValido = (p) => /^\d{1,7}$/.test(String(p ?? "")) && Number(p) > 0;

// Un envío a la vez por cliente y tabla (dos pestañas, doble clic...).
const enviosEnCurso = new Set();

// Tabla + evento activo del cliente del token, o la respuesta de error.
async function tablaYEvento(usuarioId, precio) {
    if (!precioValido(precio)) return { status: 400, cuerpo: { ok: false, enviado: false, motivo: "faltan_parametros" } };
    const config = await obtenerConfiguracionCliente(usuarioId, Number(precio));
    if (!config) return { status: 404, cuerpo: { ok: false, enviado: false, motivo: "tabla_no_configurada" } };
    const evento = await obtenerEventoActivoReal(config.tabla, usuarioId);
    if (!evento) return { status: 404, cuerpo: { ok: false, enviado: false, motivo: "sin_evento_activo" } };
    return { config, evento };
}

const socketDe = (usuarioId) => require("../services/baileys/manager").getSocketActivoDe(usuarioId);

// GET /tablas/compartir/vista-previa?precio=[&sin_imagen=1] — texto y
// grupos. El panel nuevo pide sin_imagen=1: la imagen es su captura del
// `div` de la tabla visible.
// COMPATIBILIDAD TEMPORAL (panel publicado antes de la captura en el
// navegador): sin sin_imagen=1 se genera la imagen con Puppeteer como
// antes (imagen / error_imagen). Retirar cuando ese panel ya no exista.
// NUNCA envía nada.
router.get("/compartir/vista-previa", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const precio = req.query.precio;
        const t = await tablaYEvento(usuarioId, precio);
        if (!t.evento) return res.status(t.status).json(t.cuerpo);

        const disponibles = await destinos.gruposDisponibles(usuarioId);
        if (!disponibles.ok) return res.status(500).json({ ok: false, motivo: "error_grupos" });

        const guardados = await destinos.obtenerDestinos(usuarioId, precio);
        if (!guardados.ok) return res.status(500).json({ ok: false, motivo: "error_destinos" });

        const { validos, invalidos } = destinos.clasificar(guardados.data || [], disponibles.data);
        const texto = await destinos.textoParaCompartir(usuarioId, t.evento);

        let imagenAntigua = {};
        if (req.query.sin_imagen !== "1") {
            try {
                const png = await capturarImagenTabla(Number(precio), usuarioId, t.evento.id ?? null);
                imagenAntigua = { imagen: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, error_imagen: null };
            } catch (err) {
                console.error("❌ [TABLAS] vista previa (panel anterior) sin imagen:", err?.message);
                imagenAntigua = { imagen: null, error_imagen: "No se pudo generar la imagen de la tabla." };
            }
        }

        res.json({
            ok: true,
            data: {
                precio: Number(precio),
                evento: { id: t.evento.id, nombre: t.evento.nombre_evento || null, hora_fin: t.evento.hora_fin || null, hora_cierre: t.evento.hora_cierre || null },
                texto: texto.texto,
                origen_texto: texto.origen,
                grupos: disponibles.data,
                seleccion: validos.map(g => g.grupo_id),
                invalidos,
                persistencia: guardados.persistencia,
                sesion_conectada: Boolean(socketDe(usuarioId)),
                ...imagenAntigua
            }
        });

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir/vista-previa:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// PUT /tablas/compartir/destinos — { precio, grupos } — solo guarda.
router.put("/compartir/destinos", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { precio, grupos } = req.body || {};
        if (!precioValido(precio)) return res.status(400).json({ ok: false, motivo: "faltan_parametros" });

        const ids = destinos.normalizarGrupos(grupos);
        if (!ids) return res.status(400).json({ ok: false, motivo: "grupos_invalidos" });

        const disponibles = await destinos.gruposDisponibles(usuarioId);
        if (!disponibles.ok) return res.status(500).json({ ok: false, motivo: "error_grupos" });

        const { invalidos } = destinos.clasificar(ids, disponibles.data);
        if (invalidos.length) return res.status(409).json({ ok: false, motivo: "destinos_no_disponibles", invalidos });

        const r = await destinos.guardarDestinos(usuarioId, precio, ids);
        if (!r.ok) return res.status(r.motivo === "migracion_pendiente" ? 503 : 500).json({ ok: false, motivo: r.motivo, ...(r.migracion ? { migracion: r.migracion } : {}) });

        res.json({ ok: true, data: { seleccion: ids } });

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir/destinos:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /tablas/compartir-manual/analizar — { texto, precio? } — «Compartir
// sorteo manual»: qué anuncia el texto (mismo detector del bot), qué tabla
// le corresponde y si el sorteo activo de esa tabla es ese. SOLO LECTURA:
// el envío es POST /tablas/compartir (abajo) con el texto como pie de foto.
router.post("/compartir-manual/analizar", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { texto, precio } = req.body || {};

        if (typeof texto !== "string" || !texto.trim()) return res.status(400).json({ ok: false, motivo: "texto_vacio" });
        if (texto.trim().length > destinos.MAX_TEXTO) return res.status(400).json({ ok: false, motivo: "texto_largo", maximo: destinos.MAX_TEXTO });
        if (precio != null && !precioValido(precio)) return res.status(400).json({ ok: false, motivo: "faltan_parametros" });

        const precios = (await listarConfiguracionesCliente(usuarioId)).map(c => c.precio);

        const data = await compartirManual.analizar({
            texto,
            precios,
            precioElegido: precio ?? null,
            leerSorteo: async (p) => (await tablaYEvento(usuarioId, p)).evento || null,
            // Grupos donde ESTE sorteo está activo: ahí se registran las
            // reservas que lleguen en respuesta a la publicación.
            gruposDelSorteo: async (evento) => {
                if (!evento.identidad_evento_real) return evento.grupo_id ? [evento.grupo_id] : [];
                const { data: filas, error } = await supabase.from("eventos_bot").select("grupo_id")
                    .eq("usuario_id", usuarioId).eq("activo", true).eq("identidad_evento_real", evento.identidad_evento_real);
                if (error) throw error;
                return [...new Set((filas || []).map(f => f.grupo_id).filter(Boolean))];
            }
        });

        res.json({ ok: true, data });

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir-manual/analizar:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// POST /tablas/compartir con solicitudId — { precio, solicitudId, imagen,
// grupos?, texto?, guardar_destinos?, evento_id? }. `evento_id` (lo manda
// «Compartir sorteo manual»): el sorteo revisado en el panel; si el activo
// de la tabla ya es otro, no se envía (409 sorteo_cambio). `imagen`: captura PNG (data URL) del
// `div` de la tabla visible en el panel. Sin `grupos`: los guardados.
// COMPATIBILIDAD TEMPORAL: si `imagen` NO viene (panel publicado antes de la
// captura en el navegador), se genera con Puppeteer como antes, con las
// mismas validaciones. Si viene y no es un PNG válido: 400, nunca Puppeteer.
async function compartirConDestinos(req, res) {

    const usuarioId = req.usuarioId;
    const { precio, solicitudId, grupos, texto, guardar_destinos: guardar } = req.body || {};

    if (!SOLICITUD.test(String(solicitudId))) return res.status(400).json({ ok: false, enviado: false, motivo: "faltan_parametros" });

    const imagenDelPanel = req.body && "imagen" in req.body;
    let imagen = imagenDelPanel ? destinos.imagenPng(req.body.imagen) : null;
    if (imagenDelPanel && !imagen) return res.status(400).json({ ok: false, enviado: false, motivo: "imagen_invalida" });

    const t = await tablaYEvento(usuarioId, precio);
    if (!t.evento) return res.status(t.status).json(t.cuerpo);
    if (req.body.evento_id !== undefined && String(req.body.evento_id) !== String(t.evento.id)) return res.status(409).json({ ok: false, enviado: false, motivo: "sorteo_cambio" });

    const disponibles = await destinos.gruposDisponibles(usuarioId);
    if (!disponibles.ok) return res.status(500).json({ ok: false, enviado: false, motivo: "error_grupos" });

    let elegidos;
    let aviso = null;

    if (grupos !== undefined) {

        const ids = destinos.normalizarGrupos(grupos);
        if (!ids) return res.status(400).json({ ok: false, enviado: false, motivo: "grupos_invalidos" });

        const { validos, invalidos } = destinos.clasificar(ids, disponibles.data);
        if (invalidos.length) return res.status(409).json({ ok: false, enviado: false, motivo: "destinos_no_disponibles", invalidos });
        elegidos = validos;

        if (guardar === true) {
            const g = await destinos.guardarDestinos(usuarioId, precio, ids);
            if (!g.ok) aviso = g.motivo === "migracion_pendiente"
                ? "La selección de grupos todavía no se puede guardar: la próxima vez se volverá a pedir."
                : "No se pudo guardar la selección de grupos: la próxima vez se volverá a pedir.";
        }

    } else {

        const guardados = await destinos.obtenerDestinos(usuarioId, precio);
        if (!guardados.ok) return res.status(500).json({ ok: false, enviado: false, motivo: "error_destinos" });
        if (!guardados.data) return res.status(409).json({ ok: false, enviado: false, motivo: "sin_destinos", persistencia: guardados.persistencia });

        const { validos, invalidos } = destinos.clasificar(guardados.data, disponibles.data);
        if (invalidos.length || !validos.length) return res.status(409).json({ ok: false, enviado: false, motivo: "destinos_no_disponibles", invalidos });
        elegidos = validos;

    }

    const sock = socketDe(usuarioId);
    if (!sock) return res.status(409).json({ ok: false, enviado: false, motivo: "sin_sesion_activa", ...(aviso ? { aviso } : {}) });

    const clave = `${usuarioId}:${Number(precio)}`;
    if (enviosEnCurso.has(clave)) return res.status(409).json({ ok: false, enviado: false, motivo: "envio_en_curso" });
    enviosEnCurso.add(clave);

    try {

        if (!imagen) {
            try {
                imagen = await capturarImagenTabla(Number(precio), usuarioId, t.evento.id ?? null);
            } catch (err) {
                console.error("❌ [COMPARTIR TABLA] no se pudo generar la imagen (panel anterior):", err?.message);
                return res.status(502).json({ ok: false, enviado: false, motivo: "error_imagen", ...(aviso ? { aviso } : {}) });
            }
        }

        const caption = destinos.textoEditado(texto) ?? (await destinos.textoParaCompartir(usuarioId, t.evento)).texto;
        const r = await compartirEnGrupos({ evento: t.evento, sock, grupos: elegidos, caption, solicitudId, imagen });

        if (!r.ok) return res.status(502).json({ ok: false, enviado: false, motivo: r.motivo, ...(aviso ? { aviso } : {}) });

        const hechos = r.resultados.filter(x => x.estado === "enviado" || x.estado === "ya_enviado").length;
        res.json({ ok: true, enviado: hechos > 0, enviados: hechos, fallidos: r.resultados.length - hechos, resultados: r.resultados, ...(aviso ? { aviso } : {}) });

    } finally {
        enviosEnCurso.delete(clave);
    }

}

// POST /tablas/compartir — botón manual del panel. Con `solicitudId`: el
// flujo con destinos elegidos (arriba). Sin él (panel anterior, mientras se
// despliega): el comportamiento de siempre, al grupo del evento activo.
// Resuelve el evento REAL activo de esa tabla para ese usuario y ejecuta
// exactamente la misma función que usa la automatización (Scheduler).
router.post("/compartir", exigirUsuario, async (req, res) => {

    try {

        if (req.body?.solicitudId !== undefined) return await compartirConDestinos(req, res);

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
// { contactoId | nuevoContacto: { nombre, telefono }, eventoId | (sorteoProgramadoId + grupoId), motivo, observaciones, solicitudId }
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
        sorteoProgramadoId: b.sorteoProgramadoId || null,
        grupoId: b.grupoId || null,
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

// POST /tablas/:precio/lote — varios números en UNA operación.
// { accion: "reservar" | "pagar" | "liberar", numeros, ...campos de la acción }.
// numeros: lista; en liberar, [{ numero, estado }] con el estado confirmado.
// otrosSorteoAutorizados: números de otro sorteo que el administrador incluyó.
router.post("/:precio/lote", exigirUsuario, manejar("operación por lote", (req) => {
    const b = req.body || {};
    return reservaManual.operarLote({
        accion: b.accion,
        usuarioId: req.usuarioId,
        operador: operadorDe(req),
        precio: req.params.precio,
        numeros: b.numeros,
        contactoId: b.contactoId || null,
        nuevoContacto: b.nuevoContacto || null,
        eventoId: b.eventoId || null,
        sorteoProgramadoId: b.sorteoProgramadoId || null,
        grupoId: b.grupoId || null,
        metodoPago: b.metodoPago,
        motivo: b.motivo,
        observaciones: b.observaciones,
        confirmar: b.confirmar === true,
        otrosSorteoAutorizados: b.otrosSorteoAutorizados,
        solicitudId: b.solicitudId
    });
}));

module.exports = router;
