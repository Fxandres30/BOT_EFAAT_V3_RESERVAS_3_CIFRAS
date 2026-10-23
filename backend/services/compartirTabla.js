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
// Pipeline: resolver imagen real (Puppeteer sobre la página real del
// panel, /tablas/imprimir/[precio]) + texto real (catálogo global de
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
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
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
async function capturarImagenTabla(precio, usuarioId, eventoId = null) {

    const { token } = generarTokenImprimir(precio, usuarioId, eventoId);
    const url = `${FRONTEND_URL}/tablas/imprimir/${precio}?token=${token}`;

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
        await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });

        await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });

        const contenedor = await page.waitForSelector("[data-tabla-imprimir]", { timeout: 15000 });

        if (!contenedor) {
            throw new Error("La vista de impresión no renderizó el contenedor esperado.");
        }

        const buffer = await contenedor.screenshot({ type: "png" });

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
// Captura la imagen UNA vez y la envía con `caption` a cada grupo, en serie.
// Cada envío pasa por el ExecutionGuard con la clave de ESTA solicitud
// (solicitudId, generado por el panel al pulsar): reintentar la misma
// petición nunca reenvía a un grupo ya hecho; una pulsación nueva sí
// publica de nuevo. Nunca lanza.
// -> { ok, motivo?, resultados: [{ grupo_id, nombre, estado: enviado|ya_enviado|en_curso|fallido, error? }] }
async function compartirEnGrupos({ evento, sock, grupos, caption, solicitudId }) {

    if (!evento?.valor || !evento.usuario_id) return { ok: false, motivo: "evento_invalido", resultados: [] };
    if (!sock) return { ok: false, motivo: "sin_sesion_activa", resultados: [] };

    let imagen;

    try {
        imagen = await capturarImagenTabla(Number(evento.valor), evento.usuario_id, evento.id ?? null);
    } catch (err) {
        console.error("❌ [COMPARTIR TABLA] no se pudo generar la imagen:", err?.message);
        return { ok: false, motivo: "error_imagen", resultados: [] };
    }

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

            if (r.ejecutada) resultados.push({ ...g, estado: "enviado" });
            else if (r.motivo === "ya_ok") resultados.push({ ...g, estado: "ya_enviado" });
            else if (r.motivo === "ya_en_progreso") resultados.push({ ...g, estado: "en_curso" });
            else if (r.motivo === "ya_error") resultados.push({ ...g, estado: "fallido", error: "Este envío ya falló antes; pulsa «Compartir» otra vez para reintentarlo." });
            else if (r.motivo === "fallo_ejecucion") resultados.push({ ...g, estado: "fallido", error: r.error?.message || "WhatsApp rechazó el envío." });
            else resultados.push({ ...g, estado: "fallido", error: r.motivo === "error_insert" ? "No se pudo registrar el envío: no se envió." : `No se envió (${r.motivo}).` });

        } catch (err) {
            resultados.push({ ...g, estado: "fallido", error: err?.message || "Error desconocido." });
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
