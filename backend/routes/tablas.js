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
const operaciones = require("../services/operacionesCompartir");
const compartirManual = require("../services/compartirManual");
const gruposSorteo = require("../sorteos/gruposSorteo");
const repoSorteos = require("../sorteos/repo");

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

// GRUPOS DEL SORTEO (04/11): si el sorteo activo de la tabla nació en el
// panel, sus grupos son los de su programación (sorteos/gruposSorteo.js),
// la MISMA fuente que «Editar». «Cambiar grupos» los cambia ahí y un grupo
// nuevo recibe ESTE sorteo con el publicador (evento del grupo + anuncio),
// no solo la imagen. null = sorteo detectado en WhatsApp (sin programación).
async function gruposDeLaProgramacion(usuarioId, evento) {
    const p = await gruposSorteo.programacionDeIdentidad(usuarioId, evento?.identidad_evento_real);
    if (!p) return null;
    const g = await repoSorteos.gruposDelSorteo(usuarioId, p.id);
    if (!g.ok) return null;
    return { id: p.id, grupos: g.data.filter(x => x.estado !== "cancelado") };
}

// Grupos donde el sorteo (identidad) está ACTIVO de verdad (eventos_bot).
async function gruposConElSorteoActivo(usuarioId, evento) {
    if (!evento?.identidad_evento_real) return new Set(evento?.grupo_id ? [evento.grupo_id] : []);
    const { data, error } = await supabase.from("eventos_bot").select("grupo_id")
        .eq("usuario_id", usuarioId).eq("activo", true).eq("identidad_evento_real", evento.identidad_evento_real);
    if (error) return null;
    return new Set((data || []).map(f => f.grupo_id).filter(Boolean));
}

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

        const programacion = await gruposDeLaProgramacion(usuarioId, t.evento);
        const { validos, invalidos } = destinos.clasificar(programacion ? programacion.grupos.map(g => g.grupo_id) : (guardados.data || []), disponibles.data);
        const texto = await destinos.textoParaCompartir(usuarioId, t.evento);
        // Sin el mensaje del sorteo no hay vista previa: nunca se muestra
        // (ni se envía) otro texto en su lugar.
        if (!texto.ok) return res.status(503).json({ ok: false, motivo: "texto_no_disponible", mensaje: texto.mensaje || null });
        const activos = await gruposConElSorteoActivo(usuarioId, t.evento);

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
                // false: el mensaje del sorteo está desactivado (solo imagen).
                texto_activo: texto.activo !== false,
                // Fuente única: el mensaje guardado (con {{variables}}) del que
                // sale `texto`. Editarlo aquí cambia ESE mensaje (PUT
                // /tablas/compartir/mensaje), no una copia para un envío.
                mensaje: {
                    plantilla: texto.plantilla,
                    revision: texto.revision,
                    fuente: texto.fuente,
                    editable: texto.fuente === "panel" || texto.fuente === "detectado" || texto.fuente === "habitual"
                },
                // Envío en curso de esta tabla (p. ej. tras cerrar la ventana).
                operacion_activa: operaciones.activaDe(usuarioId, precio),
                grupos: disponibles.data,
                seleccion: validos.map(g => g.grupo_id),
                invalidos,
                persistencia: programacion ? true : guardados.persistencia,
                // Sorteo del panel: la selección ES la de sus grupos (también
                // la de «Editar»). Estado del sorteo en cada grupo disponible.
                sorteo_programado_id: programacion?.id || null,
                estado_grupos: Object.fromEntries(disponibles.data.map(g => {
                    const fila = programacion?.grupos.find(x => x.grupo_id === g.grupo_id);
                    const activo = activos?.has(g.grupo_id) || false;
                    return [g.grupo_id, activo ? "activo" : fila ? (fila.estado === "pendiente" ? "pendiente" : "error") : "sin_sorteo"];
                })),
                sesion_conectada: Boolean(socketDe(usuarioId)),
                ...imagenAntigua
            }
        });

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir/vista-previa:", err.message);
        res.status(500).json({ ok: false, motivo: "error_interno" });

    }

});

// PUT /tablas/compartir/mensaje — { precio, plantilla, base_plantilla } —
// cambia EL mensaje de publicación del sorteo activo de la tabla (el mismo
// que «Editar sorteo activo», con sorteosActivos.editar: misma validación
// de variables y límite). `base_plantilla` = lo que el panel mostró: si el
// mensaje cambió entretanto, 409 y no se pisa. No envía nada. Devuelve la
// nueva vista previa (texto ya generado) para que lo visto = lo enviado.
router.put("/compartir/mensaje", exigirUsuario, async (req, res) => {

    try {

        const usuarioId = req.usuarioId;
        const { precio, plantilla, base_plantilla: basePlantilla } = req.body || {};
        if (typeof plantilla !== "string" || typeof basePlantilla !== "string") return res.status(400).json({ ok: false, motivo: "faltan_parametros" });
        const t = await tablaYEvento(usuarioId, precio);
        if (!t.evento) return res.status(t.status).json(t.cuerpo);

        const sorteosActivos = require("../sorteos/sorteosActivos");
        const actual = await sorteosActivos.obtener(usuarioId, t.evento.id);
        if (!actual.ok) return res.status(actual.motivo === "no_encontrado" ? 404 : actual.motivo === "estado_invalido" ? 409 : 500).json({ ok: false, motivo: actual.motivo, mensaje: actual.mensaje || null });

        // Lo que el panel mostró como mensaje guardado. En un sorteo del
        // panel sin texto propio es la plantilla de su estilo.
        const vigente = actual.data.origen === "panel" ? actual.data.publicacion_texto : actual.data.publicacion;
        if ((basePlantilla || "") !== (vigente || "")) {
            return res.status(409).json({ ok: false, motivo: "version_cambiada", mensaje: "El mensaje del sorteo cambió desde que abriste esta ventana (otra pestaña o «Editar»). Vuelve a abrirla para ver el mensaje actual." });
        }

        const r = await sorteosActivos.editar(usuarioId, t.evento.id, {
            publicacion: plantilla,
            base: { premios: actual.data.premios, hora_cierre: actual.data.hora_cierre, publicacion: actual.data.publicacion }
        });
        if (!r.ok) {
            const status = r.motivo === "validacion" ? 400 : r.motivo === "version_cambiada" ? 409 : r.motivo === "migracion_pendiente" ? 503 : 500;
            return res.status(status).json({ ok: false, motivo: r.motivo, mensaje: r.mensaje || null, errores: r.errores || null, migracion: r.migracion || null });
        }

        const texto = await destinos.textoParaCompartir(usuarioId, t.evento);
        if (!texto.ok) return res.status(503).json({ ok: false, motivo: "texto_no_disponible", mensaje: texto.mensaje || null });
        res.json({ ok: true, data: { texto: texto.texto, origen_texto: texto.origen, texto_activo: texto.activo !== false, mensaje: { plantilla: texto.plantilla, revision: texto.revision, fuente: texto.fuente, editable: true }, aviso: r.aviso || null } });

    } catch (err) {

        console.error("❌ [TABLAS] error en /compartir/mensaje:", err.message);
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

        // Sorteo del panel activo en la tabla: se cambian SUS grupos (misma
        // operación que «Editar»; también copia los destinos). No publica.
        const config = await obtenerConfiguracionCliente(usuarioId, Number(precio));
        const evento = config ? await obtenerEventoActivoReal(config.tabla, usuarioId) : null;
        const programacion = evento ? await gruposDeLaProgramacion(usuarioId, evento) : null;
        if (programacion) {
            const c = await gruposSorteo.cambiarGrupos(usuarioId, programacion.id, ids, { origen: "tablas" });
            if (!c.ok) return res.status(409).json({ ok: false, motivo: c.motivo, mensaje: c.mensaje || null });
            return res.json({ ok: true, data: { seleccion: ids, agregados: c.data.agregados, quitados: c.data.quitados, desactivados: c.data.desactivados, por_publicar: c.data.por_publicar, avisos: c.data.avisos } });
        }

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
// grupos?, texto?, guardar_destinos?, evento_id?, asincrono? }. `evento_id` (lo manda
// «Compartir sorteo manual»): el sorteo revisado en el panel; si el activo
// de la tabla ya es otro, no se envía (409 sorteo_cambio). `imagen`: captura PNG (data URL) del
// `div` de la tabla visible en el panel. Sin `grupos`: los guardados.
// COMPATIBILIDAD TEMPORAL: si `imagen` NO viene (panel publicado antes de la
// captura en el navegador), se genera con Puppeteer como antes, con las
// mismas validaciones. Si viene y no es un PNG válido: 400, nunca Puppeteer.
//
// OPERACIONES (04/11, services/operacionesCompartir.js): cada envío es una
// operación con id = solicitudId, progreso real por grupo y cancelación.
//   - asincrono: true (panel actual): tras validar responde 202 con la
//     operación y el envío sigue en segundo plano; el panel consulta
//     GET /tablas/compartir/operaciones/:id y puede cancelarla. Cerrar la
//     ventana no la cancela. La misma solicitud repetida devuelve la MISMA
//     operación (no envía otra vez).
//   - sin asincrono (panel anterior): igual que siempre, responde al final.
// MENSAJE: se toma UNA instantánea del mensaje del sorteo al empezar
// (destinosCompartir.textoParaCompartir, la fuente única) y todos los
// grupos de la operación reciben ese texto. `texto` solo lo manda el panel
// anterior (texto editado para ese envío): se respeta por compatibilidad en
// los grupos que ya tienen el sorteo.
async function compartirConDestinos(req, res) {

    const usuarioId = req.usuarioId;
    const { precio, solicitudId, grupos, texto, guardar_destinos: guardar } = req.body || {};
    const asincrono = req.body?.asincrono === true;

    if (!SOLICITUD.test(String(solicitudId))) return res.status(400).json({ ok: false, enviado: false, motivo: "faltan_parametros" });

    // Reintento de la MISMA solicitud: su operación, sin enviar nada más.
    const previa = operaciones.obtener(usuarioId, String(solicitudId));
    if (previa && asincrono) return res.status(200).json({ ok: true, operacion: previa, repetida: true });

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

        // Sorteo del panel: sus grupos (la misma fuente que «Editar»).
        const delSorteo = await gruposDeLaProgramacion(usuarioId, t.evento);
        const guardados = delSorteo
            ? { ok: true, data: delSorteo.grupos.length ? delSorteo.grupos.map(g => g.grupo_id) : null, persistencia: true }
            : await destinos.obtenerDestinos(usuarioId, precio);
        if (!guardados.ok) return res.status(500).json({ ok: false, enviado: false, motivo: "error_destinos" });
        if (!guardados.data) return res.status(409).json({ ok: false, enviado: false, motivo: "sin_destinos", persistencia: guardados.persistencia });

        const { validos, invalidos } = destinos.clasificar(guardados.data, disponibles.data);
        if (invalidos.length || !validos.length) return res.status(409).json({ ok: false, enviado: false, motivo: "destinos_no_disponibles", invalidos });
        elegidos = validos;

    }

    const sock = socketDe(usuarioId);
    if (!sock) return res.status(409).json({ ok: false, enviado: false, motivo: "sin_sesion_activa", ...(aviso ? { aviso } : {}) });

    const clave = `${usuarioId}:${Number(precio)}`;
    if (enviosEnCurso.has(clave)) {
        const enCurso = operaciones.activaDe(usuarioId, precio);
        return res.status(409).json({ ok: false, enviado: false, motivo: "envio_en_curso", ...(enCurso ? { operacion: enCurso } : {}) });
    }
    enviosEnCurso.add(clave);

    // Instantánea del mensaje aprobado para ESTA operación (fuente única).
    let anuncio;
    try {
        anuncio = await destinos.textoParaCompartir(usuarioId, t.evento);
    } catch (err) {
        anuncio = { ok: false, mensaje: err?.message };
    }
    if (!anuncio.ok) {
        enviosEnCurso.delete(clave);
        return res.status(503).json({ ok: false, enviado: false, motivo: "texto_no_disponible", mensaje: anuncio.mensaje || null });
    }

    const op = operaciones.crear({
        id: String(solicitudId),
        usuarioId,
        precio,
        grupos: elegidos,
        anuncio: { texto: anuncio.activo === false ? "" : anuncio.texto, activo: anuncio.activo !== false, revision: anuncio.revision, origen: anuncio.origen }
    });

    const trabajo = ejecutarCompartir({ usuarioId, precio, t, sock, elegidos, grupos, guardar, texto, solicitudId: String(solicitudId), imagen, aviso, anuncio, op })
        .catch((err) => {
            console.error("❌ [COMPARTIR TABLA] error en la operación:", err?.message);
            operaciones.terminar(op, { motivo: "error_interno", mensaje: "Error interno durante el envío." });
            return { status: 500, cuerpo: { ok: false, enviado: false, motivo: "error_interno" } };
        })
        .finally(() => enviosEnCurso.delete(clave));

    if (asincrono) return res.status(202).json({ ok: true, operacion: operaciones.vista(op) });

    const r = await trabajo;
    return res.status(r.status).json(r.cuerpo);

}

// Trabajo de una operación: el reparto de siempre (grupos sin el sorteo ->
// publicador; grupos con el sorteo -> compartirEnGrupos), con progreso y
// cancelación. Devuelve la respuesta del formato anterior { status, cuerpo }
// y deja la operación terminada.
async function ejecutarCompartir({ usuarioId, precio, t, sock, elegidos, grupos, guardar, texto, solicitudId, imagen, aviso, anuncio, op }) {

    const fallo = (status, cuerpo, mensaje) => {
        operaciones.terminar(op, { motivo: cuerpo.motivo, mensaje: mensaje || cuerpo.mensaje || null, aviso: cuerpo.aviso || null });
        return { status, cuerpo };
    };

    if (!imagen) {
        operaciones.etapa(op, "Preparando la imagen de la tabla…");
        for (const g of elegidos) operaciones.marcarGrupo(op, g.grupo_id, "preparando");
        try {
            imagen = await capturarImagenTabla(Number(precio), usuarioId, t.evento.id ?? null);
        } catch (err) {
            console.error("❌ [COMPARTIR TABLA] no se pudo generar la imagen (panel anterior):", err?.message);
            return fallo(502, { ok: false, enviado: false, motivo: "error_imagen", ...(aviso ? { aviso } : {}) }, "No se pudo generar la imagen de la tabla. No se envió nada.");
        }
        for (const g of elegidos) {
            const fila = op.grupos.find(x => x.grupo_id === g.grupo_id);
            if (fila) fila.estado = "en_cola";
        }
    }

    // Sorteo del panel: la selección guardada ES la de sus grupos. Los
    // grupos donde el sorteo todavía no está activo lo RECIBEN con el
    // publicador (evento del grupo con la misma identidad y tabla, grupo
    // abierto y anuncio una vez); a los demás se les comparte la tabla.
    let programacion = await gruposDeLaProgramacion(usuarioId, t.evento);
    const avisos = aviso ? [aviso] : [];
    const resultadosNuevos = [];
    let paraCompartir = elegidos;

    if (programacion) {
        if (grupos !== undefined && guardar === true) {
            const c = await gruposSorteo.cambiarGrupos(usuarioId, programacion.id, elegidos.map(g => g.grupo_id), { origen: "tablas" });
            if (!c.ok) return fallo(409, { ok: false, enviado: false, motivo: c.motivo, mensaje: c.mensaje || null });
            avisos.push(...c.data.avisos);
            programacion = await gruposDeLaProgramacion(usuarioId, t.evento);
        }
        const activos = await gruposConElSorteoActivo(usuarioId, t.evento);
        if (!activos || !programacion) return fallo(500, { ok: false, enviado: false, motivo: "error_grupos" }, "No se pudieron leer los grupos del sorteo. No se envió nada.");
        const sinSorteo = elegidos.filter(g => !activos.has(g.grupo_id));
        paraCompartir = elegidos.filter(g => activos.has(g.grupo_id));
        for (const g of sinSorteo) { const f = op.grupos.find(x => x.grupo_id === g.grupo_id); if (f) f.tipo = "activar"; }

        if (sinSorteo.length) {
            const pendientes = sinSorteo.filter(g => programacion.grupos.some(x => x.grupo_id === g.grupo_id && x.estado === "pendiente"));
            const otros = sinSorteo.filter(g => !pendientes.includes(g));
            if (pendientes.length) {
                // Activar el sorteo en grupos nuevos es UN paso del publicador:
                // la cancelación se mira antes de empezarlo; una vez empezado
                // termina (nunca deja un grupo con el evento activo y sin anuncio).
                if (operaciones.cancelada(op)) {
                    for (const g of pendientes) operaciones.marcarGrupo(op, g.grupo_id, "cancelado", { detalle: "El grupo sigue agregado al sorteo, pendiente de publicar: no recibió nada." });
                    resultadosNuevos.push(...pendientes.map(g => ({ ...g, estado: "cancelado", activado: false })));
                } else {
                    operaciones.etapa(op, `Activando el sorteo en ${pendientes.length} grupo(s) nuevo(s)…`);
                    const pub = await gruposSorteo.publicarGruposNuevos(usuarioId, programacion.id, {
                        imagen,
                        anuncio: { texto: op.anuncio.texto, activo: op.anuncio.activo },
                        observar: {
                            alPreparar: (gid) => operaciones.marcarGrupo(op, gid, "preparando"),
                            alEnviar: (gid) => operaciones.marcarGrupo(op, gid, "enviando")
                        }
                    });
                    const filas = pub.ok ? pub.data.grupos : [];
                    for (const g of pendientes) {
                        const f = filas.find(x => x.grupo_id === g.grupo_id);
                        const r = f?.estado === "publicado"
                            ? { ...g, estado: "enviado", activado: true }
                            : { ...g, estado: "fallido", activado: false, error: pub.ok ? (f?.error || f?.ultimo_error || "No se publicó el sorteo en el grupo.") : (pub.mensaje || pub.motivo) };
                        resultadosNuevos.push(r);
                        operaciones.marcarGrupo(op, g.grupo_id, r.estado === "enviado" ? "enviado" : "error", { error: r.error || null, detalle: r.activado ? "Sorteo activado en el grupo y anuncio enviado." : null });
                    }
                }
            }
            for (const g of otros) {
                const r = { ...g, estado: "fallido", activado: false, error: "El sorteo no está activo en este grupo y su publicación quedó con error: reinténtala desde Sorteos (Programados o Publicar ahora)." };
                resultadosNuevos.push(r);
                operaciones.marcarGrupo(op, g.grupo_id, "error", { error: r.error });
            }
        }
    } else {
        // Sorteo detectado en WhatsApp: sin programación no se puede
        // activar en otro grupo desde aquí. Se comparte como siempre y se
        // avisa de los grupos donde no se registrarán reservas.
        const activos = await gruposConElSorteoActivo(usuarioId, t.evento);
        const fuera = activos ? elegidos.filter(g => !activos.has(g.grupo_id)) : [];
        if (fuera.length) avisos.push(`El sorteo no está activo en ${fuera.map(g => g.nombre || g.grupo_id).join(", ")}: se envía la imagen, pero ahí no se registrarán reservas. Este sorteo se detectó en WhatsApp: para activarlo en otro grupo usa «Editar» → «Gestionar desde el panel» y luego agrega el grupo.`);
    }

    let resultados = [...resultadosNuevos];
    if (paraCompartir.length) {
        // Panel anterior con texto editado para este envío; si no, la
        // instantánea del mensaje del sorteo (la misma de la vista previa).
        const caption = destinos.textoEditado(texto) ?? op.anuncio.texto;
        if (destinos.textoEditado(texto)) op.anuncio = { ...op.anuncio, texto: caption, origen: "editado_en_envio" };
        operaciones.etapa(op, `Enviando la tabla a ${paraCompartir.length} grupo(s)…`);
        const r = await compartirEnGrupos({
            evento: t.evento, sock, grupos: paraCompartir, caption, solicitudId, imagen,
            control: {
                cancelado: () => operaciones.cancelada(op),
                alIniciar: (g) => operaciones.marcarGrupo(op, g.grupo_id, "enviando"),
                alTerminar: (x) => operaciones.marcarGrupo(op, x.grupo_id,
                    x.estado === "enviado" || x.estado === "ya_enviado" ? "enviado" : x.estado === "cancelado" ? "cancelado" : "error",
                    {
                        error: x.estado === "en_curso" ? "Este grupo ya se estaba enviando en un intento anterior de esta misma solicitud: revisa el grupo antes de reintentar." : (x.error || null),
                        detalle: x.estado === "ya_enviado" ? "Ya se había enviado en esta misma solicitud: no se duplicó." : null
                    })
            }
        });
        if (!r.ok && !resultadosNuevos.length) return fallo(502, { ok: false, enviado: false, motivo: r.motivo, ...(avisos.length ? { aviso: avisos.join(" ") } : {}) }, mensajeFallo(r.motivo));
        if (r.ok) resultados = [...r.resultados, ...resultados];
    }

    const hechos = resultados.filter(x => x.estado === "enviado" || x.estado === "ya_enviado").length;
    const cancelados = resultados.filter(x => x.estado === "cancelado").length;
    operaciones.terminar(op, { aviso: avisos.length ? avisos.join(" ") : null });
    return {
        status: 200,
        cuerpo: {
            ok: true, enviado: hechos > 0, enviados: hechos, fallidos: resultados.length - hechos - cancelados, cancelados, resultados,
            operacion_id: op.id,
            ...(avisos.length ? { aviso: avisos.join(" ") } : {})
        }
    };

}

function mensajeFallo(motivo) {
    if (motivo === "sin_sesion_activa") return "Tu WhatsApp se desconectó. No se envió nada.";
    if (motivo === "imagen_invalida") return "La imagen de la tabla no es válida. No se envió nada.";
    return "No se pudo enviar. No se envió nada.";
}

// GET /tablas/compartir/operaciones?precio= — operaciones recientes del
// cliente (la en curso primero): el panel la recupera al volver a abrir.
router.get("/compartir/operaciones", exigirUsuario, (req, res) => {
    const precio = req.query.precio;
    if (precio !== undefined && !precioValido(precio)) return res.status(400).json({ ok: false, motivo: "faltan_parametros" });
    const lista = operaciones.listar(req.usuarioId, { precio: precio ?? null });
    res.json({ ok: true, data: { activa: lista.find(o => !o.terminada) || null, recientes: lista.slice(0, 10) } });
});

// GET /tablas/compartir/operaciones/:id — progreso real de una operación.
router.get("/compartir/operaciones/:id", exigirUsuario, (req, res) => {
    if (!SOLICITUD.test(req.params.id)) return res.status(404).json({ ok: false, motivo: "no_encontrada" });
    const op = operaciones.obtener(req.usuarioId, req.params.id);
    if (!op) return res.status(404).json({ ok: false, motivo: "no_encontrada" });
    res.json({ ok: true, data: op });
});

// POST /tablas/compartir/operaciones/:id/cancelar — idempotente. Detiene
// los grupos que no han empezado; el que ya está en WhatsApp termina y se
// informa. Nunca retira lo ya publicado.
router.post("/compartir/operaciones/:id/cancelar", exigirUsuario, (req, res) => {
    if (!SOLICITUD.test(req.params.id)) return res.status(404).json({ ok: false, motivo: "no_encontrada" });
    const r = operaciones.cancelar(req.usuarioId, req.params.id);
    if (!r.ok) return res.status(404).json(r);
    res.json({ ok: true, data: r.data, ya_solicitada: Boolean(r.ya_solicitada), ya_terminada: Boolean(r.ya_terminada) });
});

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
// { contactoId | nuevoContacto: { nombre, telefono }, eventoId | (sorteoProgramadoId + grupoId) | sinSorteo, motivo, observaciones, solicitudId }
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
        sinSorteo: b.sinSorteo === true,
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
// otrosSorteoAutorizados: al LIBERAR, números de otro sorteo que el
// administrador incluyó (pagar no lo necesita: una reserva válida se paga
// venga de donde venga).
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
        sinSorteo: b.sinSorteo === true,
        metodoPago: b.metodoPago,
        motivo: b.motivo,
        observaciones: b.observaciones,
        confirmar: b.confirmar === true,
        otrosSorteoAutorizados: b.otrosSorteoAutorizados,
        solicitudId: b.solicitudId
    });
}));

module.exports = router;
