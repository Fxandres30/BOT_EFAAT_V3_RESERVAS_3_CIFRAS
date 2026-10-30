// ==========================================================================
// compartirTabla.js — ÚNICA lógica real de "compartir la tabla" (imagen +
// texto real por WhatsApp). Usada tanto por el botón manual del panel
// (backend/routes/tablas.js) como por el Scheduler automático
// (automation/scheduler.js, INITIAL_TABLE) — misma función, sin duplicar.
//
// Vive en backend/services/ (neutral, como services/baileys/) para que
// tanto bot/ como automation/ puedan requerirla sin cruzar el límite
// documentado "automation/ nunca requiere nada bajo bot/".
//
// Pipeline: resolver imagen real (Puppeteer abre la página real del panel,
// /tablas/imprimir/[precio], con los datos entregados en el proceso, y
// ejecuta allí capturarTabla, la captura del botón «Compartir»; sin enlace
// firmado ni TABLA_SHARE_SECRET) + texto real (catálogo global de
// variables, backend/shared/variables) -> enviar por WhatsApp (Baileys,
// services/baileys/send.js, sin duplicar el envío).
// ==========================================================================

const crypto = require("crypto");
const puppeteer = require("puppeteer");

const { sendImage } = require("./baileys/send");
const { construirContextoGlobal } = require("../shared/variables/contextoVariables");
const { resolverVariable } = require("../shared/variables/resolverVariables");
const executionGuard = require("../automation/executionGuard");

const SECRETO = process.env.TABLA_SHARE_SECRET;
const EXPIRACION_MS = 5 * 60 * 1000; // enlace de un solo uso conceptual, vida corta

// Texto predefinido de la tabla, acordado explícitamente con el usuario
// (no inventado): usa el catálogo global de variables (Fase 1/2 — ya
// existente, sin duplicar lógica de sustitución).
const PLANTILLA_TEXTO_COMPARTIR =
    "🎰 {{evento}}\n💰 Número: ${{precio}}\n⏰ Cierra: {{hora}}\n🎟️ {{cantidad_disponibles}} números disponibles\n¡Aparta el tuyo! 👇";

// SEGURIDAD (2026-10-21): el token lleva y firma al DUEÑO de la tabla
// (evento.usuario_id). Antes solo firmaba el precio y /tablas/imprimir-datos
// devolvía la cuadrícula mezclada de todos los clientes. Formato:
// "<expira>.<usuarioId>.<firma>" (un UUID no contiene puntos).
const USUARIO_VALIDO = /^[0-9a-f-]{36}$/i;

// ESTILO POR SORTEO (2026-10-21): el token puede firmar además el EVENTO
// ("<expira>.<usuarioId>.<eventoId>.<firma>") para que la imagen use el
// estilo guardado en ESE sorteo programado y no el de la tabla del precio.
// El formato sin evento sigue siendo válido.
const EVENTO_VALIDO = /^[0-9A-Za-z-]{1,64}$/;

function firmarImprimir(precio, usuarioId, expira, eventoId = null) {
    const datos = eventoId ? `${precio}.${usuarioId}.${eventoId}.${expira}` : `${precio}.${usuarioId}.${expira}`;
    return crypto.createHmac("sha256", SECRETO).update(datos).digest("hex");
}

function generarTokenImprimir(precio, usuarioId, eventoId = null) {

    if (!usuarioId || !USUARIO_VALIDO.test(String(usuarioId))) {
        throw new Error("No se puede generar el enlace de impresión sin el dueño de la tabla.");
    }

    const evento = eventoId != null && EVENTO_VALIDO.test(String(eventoId)) ? String(eventoId) : null;
    const expira = Date.now() + EXPIRACION_MS;
    const firma = firmarImprimir(precio, usuarioId, expira, evento);

    return { token: evento ? `${expira}.${usuarioId}.${evento}.${firma}` : `${expira}.${usuarioId}.${firma}`, expira };

}

// { usuarioId, eventoId|null } firmados en el token, o null si no es válido.
function verificarTokenImprimirDetalle(precio, token) {

    if (!token || typeof token !== "string") return null;

    const partes = token.split(".");
    if (partes.length !== 3 && partes.length !== 4) return null;

    const [expiraTexto, usuarioId] = partes;
    const eventoId = partes.length === 4 ? partes[2] : null;
    const firma = partes[partes.length - 1];
    const expira = Number(expiraTexto);

    if (!Number.isFinite(expira) || !firma || !USUARIO_VALIDO.test(usuarioId)) return null;
    if (eventoId !== null && !EVENTO_VALIDO.test(eventoId)) return null;
    if (Date.now() > expira) return null;

    const firmaEsperada = firmarImprimir(precio, usuarioId, expira, eventoId);

    // Comparación en tiempo constante — mismo criterio de seguridad ya
    // usado en el proyecto para secretos de dispositivo (backend/pagos).
    const bufA = Buffer.from(firma);
    const bufB = Buffer.from(firmaEsperada);

    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB) ? { usuarioId, eventoId } : null;

}

// Devuelve el usuarioId firmado en el token, o null si no es válido.
function verificarTokenImprimir(precio, token) {
    return verificarTokenImprimirDetalle(precio, token)?.usuarioId || null;
}

function construirTextoCompartir(evento) {

    const contexto = construirContextoGlobal({ evento });

    return PLANTILLA_TEXTO_COMPARTIR.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, nombre) => {

        const valor = resolverVariable(nombre, contexto);

        return valor !== "" ? valor : "";

    });

}

// capturarImagenTabla(precio, usuarioId) -> Buffer PNG de la tabla real (misma
// cuadrícula que ve el admin, sin datos personales — la vista de
// impresión solo pinta número+estado, igual que la celda cerrada del
// panel real: el nombre/teléfono del cliente nunca aparece en la cara de
// la celda, solo en el modal de detalle, que esta captura nunca abre).
//
// SIN ENLACE FIRMADO (2026-10-22): los datos de la tabla se leen aquí, en
// el proceso, y se entregan a la página interceptando su petición a
// /api/tablas/imprimir. Así no hace falta TABLA_SHARE_SECRET ni ningún
// token, y la cuadrícula nunca viaja por un endpoint público. El "token"
// de la URL es solo el parámetro que la página exige para renderizar: no
// autoriza nada (si la intercepción fallara, el backend lo rechazaría y no
// habría imagen).
const RUTA_DATOS_PAGINA = "/api/tablas/imprimir";

// UNA SOLA CAPTURA (UX-04): el servidor no dibuja ni fotografía la tabla.
// La página de impresión expone window.__efaatCapturarTabla, que llama a
// la MISMA función del botón «Compartir» (frontend/services/tablas/
// capturarTabla.ts: html-to-image sobre la cuadrícula, fondo de la tarjeta,
// su margen y pixelRatio 2). Chromium solo abre la página, la ejecuta y
// recoge el PNG, que pasa por la misma validación que el de «Compartir»
// (destinosCompartir.imagenPng). Ventana de 900 px = ANCHO_IMPRESION de
// TablaImprimible: la cuadrícula queda con el ancho del panel (672 px).
const ANCHO_VENTANA = 900;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

// Panel que abre Chromium. Sin valor por defecto: antes, sin FRONTEND_URL
// se abría http://localhost:3000, que en el servidor no es el panel.
function urlDelPanel() {
    const valor = String(process.env.FRONTEND_URL || "").trim();
    if (!valor) throw new Error("Falta FRONTEND_URL: el servidor no sabe dónde está el panel de EFAAT para generar la imagen de la tabla.");
    let url;
    try { url = new URL(valor); } catch { throw new Error(`FRONTEND_URL no es una dirección válida («${valor}»).`); }
    if (process.env.NODE_ENV === "production" && LOCAL.test(url.hostname)) {
        throw new Error(`FRONTEND_URL apunta a ${url.host}, que en producción no es el panel de EFAAT: debe ser la dirección pública del panel.`);
    }
    return url.origin;
}

// `datos` (opcional): los datos ya resueltos de la tabla (los de
// datosTablaImprimir). Lo usa la prueba de imagen del «Sorteo instantáneo»
// (sorteos/servicio.probarImagen) para ver, ANTES de publicar, la misma
// imagen con el diseño guardado en el sorteo; la página y la captura son
// las de siempre.
async function capturarImagenTabla(precio, usuarioId, eventoId = null, { datos: datosDados = null } = {}) {

    if (!usuarioId || !USUARIO_VALIDO.test(String(usuarioId))) {
        throw new Error("No se puede generar la imagen sin el dueño de la tabla.");
    }

    // Perezoso: lee tablas del cliente (bot/funciones/eventos) solo al capturar.
    const { datosTablaImprimir } = require("./datosTablaImprimir");
    const datos = datosDados
        ? { ok: true, data: datosDados }
        : await datosTablaImprimir(usuarioId, Number(precio), eventoId != null && EVENTO_VALIDO.test(String(eventoId)) ? String(eventoId) : null);

    if (!datos.ok) throw new Error(datos.error);

    const panel = urlDelPanel();
    const cuerpoDatos = JSON.stringify(datos.data);
    const url = `${panel}/tablas/imprimir/${Number(precio)}?token=directo`;

    // Flags defensivos estándar para Chromium headless en un VPS/entorno
    // virtualizado sin GPU (Windows o Linux) — mitigación conocida para el
    // crash "STATUS_STACK_BUFFER_OVERRUN" (0xC0000409) que Chromium puede
    // producir al intentar usar aceleración por GPU donde no existe.
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-dev-shm-usage"
        ]
    });

    try {

        const page = await browser.newPage();
        // La resolución la fija capturarTabla (pixelRatio 2), no la ventana.
        await page.setViewport({ width: ANCHO_VENTANA, height: 1000, deviceScaleFactor: 1 });

        await page.setRequestInterception(true);
        page.on("request", (req) => {
            let ruta = "";
            try { ruta = new URL(req.url()).pathname; } catch { /* URL no estándar: se deja pasar */ }
            if (ruta === RUTA_DATOS_PAGINA) {
                req.respond({ status: 200, contentType: "application/json", body: cuerpoDatos });
            } else {
                req.continue();
            }
        });

        // Sin tabla en la página casi siempre es FRONTEND_URL apuntando a otra
        // web (otro proyecto o un panel antiguo): el error dice qué panel se
        // abrió (solo el host, público) para poder corregirlo.
        try {
            await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });
            await page.waitForSelector("[data-tabla-imprimir][data-captura-lista]", { timeout: 15000 });
        } catch (err) {
            throw new Error(`${err?.message || err} (panel abierto por el servidor: ${new URL(panel).host}; debe ser el panel de EFAAT, revisa FRONTEND_URL)`);
        }

        // La captura de «Compartir», ejecutada en la página.
        const dataUrl = await page.evaluate(() => window.__efaatCapturarTabla());

        const { imagenPng } = require("./destinosCompartir");
        const buffer = imagenPng(dataUrl);
        if (!buffer) throw new Error("El panel no devolvió una imagen PNG válida de la tabla.");

        return buffer;

    } finally {

        await browser.close();

    }

}

// compartirTabla({ evento, sock, idempotencia? }) — evento es SIEMPRE un
// objeto ya resuelto y real (mismo contrato que engine.js: nunca se
// inventa un evento aquí). Nunca lanza: devuelve siempre { enviado,
// motivo? }.
//
// `idempotencia` es opcional a propósito: el Scheduler (automático) SÍ la
// pasa (una sola publicación real por event_session, protegida por el
// mismo ExecutionGuard que ya usa el resto de Automation); el botón manual
// del panel NO la pasa — un admin que pulsa "Compartir" espera que se
// reenvíe cada vez, no que la segunda pulsación quede bloqueada como
// "duplicado".
async function compartirTabla({ evento, sock, idempotencia = null }) {

    if (!evento || !evento.grupo_id || !evento.valor) {
        return { enviado: false, motivo: "evento_invalido" };
    }

    // Sin dueño no se sabe qué cuadrícula mostrar: nunca se publica la de
    // otro cliente ni una mezcla.
    if (!evento.usuario_id) {
        return { enviado: false, motivo: "evento_sin_propietario" };
    }

    const ejecutar = async () => {

        const precio = Number(evento.valor);

        const [imagen, texto] = await Promise.all([
            capturarImagenTabla(precio, evento.usuario_id, evento.id ?? null),
            Promise.resolve(construirTextoCompartir(evento))
        ]);

        await sendImage({ sock, jid: evento.grupo_id, image: imagen, caption: texto });

        return { enviado: true };

    };

    try {

        if (!idempotencia) {
            return await ejecutar();
        }

        const resultado = await executionGuard.ejecutarUnaVez({

            claveIdempotencia: idempotencia.claveIdempotencia,
            eventSessionId: idempotencia.eventSessionId,
            grupoId: evento.grupo_id,
            usuarioId: evento.usuario_id,
            tipoAccion: idempotencia.tipoAccion || "INITIAL_TABLE",

            ejecutar

        });

        if (resultado.ejecutada) {
            return { enviado: true };
        }

        return { enviado: false, motivo: resultado.motivo };

    } catch (err) {

        console.error("❌ [COMPARTIR TABLA] error:", err?.message);
        return { enviado: false, motivo: "error_envio", error: err?.message };

    }

}

// compartirEnGrupos — botón «Compartir» con grupos elegidos por el cliente.
// `imagen` es la captura PNG del `div` de la tabla visible en el panel (ya
// validada por destinosCompartir.imagenPng): se envía tal cual, con
// `caption`, a cada grupo, en serie. Aquí no se genera ninguna imagen.
// Cada envío pasa por el ExecutionGuard con la clave de ESTA solicitud
// (solicitudId, generado por el panel al pulsar): reintentar la misma
// petición nunca reenvía a un grupo ya hecho; una pulsación nueva sí
// publica de nuevo. Nunca lanza. También lo usa la publicación de sorteos
// programados (sorteos/publicador.js), con una solicitud fija por sorteo y
// grupo: `motivo` (el del ExecutionGuard, o "excepcion") le dice si el
// anuncio seguro NO salió o si su estado es incierto.
// -> { ok, motivo?, resultados: [{ grupo_id, nombre, estado: enviado|ya_enviado|en_curso|fallido, motivo, error? }] }
async function compartirEnGrupos({ evento, sock, grupos, caption, solicitudId, imagen }) {

    if (!evento?.valor || !evento.usuario_id) return { ok: false, motivo: "evento_invalido", resultados: [] };
    if (!sock) return { ok: false, motivo: "sin_sesion_activa", resultados: [] };
    if (!Buffer.isBuffer(imagen) || !imagen.length) return { ok: false, motivo: "imagen_invalida", resultados: [] };

    const resultados = [];

    for (const g of grupos) {

        try {

            const r = await executionGuard.ejecutarUnaVez({
                claveIdempotencia: `TABLA_COMPARTIR:${evento.usuario_id}:${Number(evento.valor)}:${solicitudId}:${g.grupo_id}`,
                grupoId: g.grupo_id,
                usuarioId: evento.usuario_id,
                tipoAccion: "TABLA_COMPARTIR",
                ejecutar: () => sendImage({ sock, jid: g.grupo_id, image: imagen, caption })
            });

            const motivo = r.ejecutada ? "ejecutada" : r.motivo;

            if (r.ejecutada) resultados.push({ ...g, estado: "enviado", motivo });
            else if (r.motivo === "ya_ok") resultados.push({ ...g, estado: "ya_enviado", motivo });
            else if (r.motivo === "ya_en_progreso") resultados.push({ ...g, estado: "en_curso", motivo });
            else if (r.motivo === "ya_error") resultados.push({ ...g, estado: "fallido", motivo, error: "Este envío ya falló antes; pulsa «Compartir» otra vez para reintentarlo." });
            else if (r.motivo === "fallo_ejecucion") resultados.push({ ...g, estado: "fallido", motivo, error: r.error?.message || "WhatsApp rechazó el envío." });
            else resultados.push({ ...g, estado: "fallido", motivo, error: r.motivo === "error_insert" ? "No se pudo registrar el envío: no se envió." : `No se envió (${r.motivo}).` });

        } catch (err) {
            resultados.push({ ...g, estado: "fallido", motivo: "excepcion", error: err?.message || "Error desconocido." });
        }

    }

    return { ok: true, resultados };

}

module.exports = {
    compartirTabla,
    compartirEnGrupos,
    capturarImagenTabla,
    construirTextoCompartir,
    generarTokenImprimir,
    verificarTokenImprimir,
    verificarTokenImprimirDetalle
};
