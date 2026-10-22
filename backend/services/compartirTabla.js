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

function firmarImprimir(precio, usuarioId, expira) {
    return crypto.createHmac("sha256", SECRETO).update(`${precio}.${usuarioId}.${expira}`).digest("hex");
}

function generarTokenImprimir(precio, usuarioId) {

    if (!usuarioId || !USUARIO_VALIDO.test(String(usuarioId))) {
        throw new Error("No se puede generar el enlace de impresión sin el dueño de la tabla.");
    }

    const expira = Date.now() + EXPIRACION_MS;
    const firma = firmarImprimir(precio, usuarioId, expira);

    return { token: `${expira}.${usuarioId}.${firma}`, expira };

}

// Devuelve el usuarioId firmado en el token, o null si no es válido.
function verificarTokenImprimir(precio, token) {

    if (!token || typeof token !== "string") return null;

    const partes = token.split(".");
    if (partes.length !== 3) return null;

    const [expiraTexto, usuarioId, firma] = partes;
    const expira = Number(expiraTexto);

    if (!Number.isFinite(expira) || !firma || !USUARIO_VALIDO.test(usuarioId)) return null;
    if (Date.now() > expira) return null;

    const firmaEsperada = firmarImprimir(precio, usuarioId, expira);

    // Comparación en tiempo constante — mismo criterio de seguridad ya
    // usado en el proyecto para secretos de dispositivo (backend/pagos).
    const bufA = Buffer.from(firma);
    const bufB = Buffer.from(firmaEsperada);

    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB) ? usuarioId : null;

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
async function capturarImagenTabla(precio, usuarioId) {

    const { token } = generarTokenImprimir(precio, usuarioId);
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
            capturarImagenTabla(precio, evento.usuario_id),
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

module.exports = {
    compartirTabla,
    capturarImagenTabla,
    construirTextoCompartir,
    generarTokenImprimir,
    verificarTokenImprimir
};
