// ==========================================================================
// Validación ESTRICTA del evento que envía el navegador. Lista blanca:
// cualquier campo desconocido, tipo inesperado o valor fuera de rango hace
// que el evento se rechace entero — no se "limpia" ni se acepta a medias.
//
// Campos permitidos (y nada más):
//   t   tipo: page_view | heartbeat | idle | exit
//   v   visitor_id (uuid)
//   s   session_id (uuid)
//   p   página (ruta; se guarda SOLO el pathname — la query string puede
//       llevar tokens, p. ej. /tablas/imprimir?token=...)
//   r   referrer (opcional; se guarda solo origen + ruta)
//   w,h pantalla (opcionales, enteros)
//   tc  navigator.maxTouchPoints (opcional, entero)
// ==========================================================================

const { UUID } = require("./config");

const TIPOS = new Set(["page_view", "heartbeat", "idle", "exit"]);

const CAMPOS = new Set(["t", "v", "s", "p", "r", "w", "h", "tc"]);

// Rutas que nunca se registran: la vista de impresión que abre Puppeteer,
// el propio panel privado y las APIs internas.
const EXCLUIDAS = ["/tablas/imprimir", "/analitica-privada", "/api"];

const TAMANO_MAXIMO = 2048;

function rechazo(motivo) {
    return { ok: false, motivo };
}

function normalizarPagina(valor) {

    if (typeof valor !== "string" || !valor.startsWith("/") || valor.startsWith("//") || valor.length > 512) {
        return null;
    }

    let ruta;

    try {
        ruta = new URL(valor, "http://x").pathname;
    } catch {
        return null;
    }

    if (ruta.length > 300 || /[\u0000-\u001f]/.test(ruta)) return null;

    // "/sesiones/" y "/sesiones" son la misma página.
    return ruta.length > 1 ? ruta.replace(/\/+$/, "") : ruta;

}

function normalizarReferrer(valor) {

    if (valor === undefined || valor === null || valor === "") return { ok: true, valor: null };

    if (typeof valor !== "string" || valor.length > 1024) return { ok: false };

    try {
        const u = new URL(valor);
        if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: true, valor: null };
        return { ok: true, valor: `${u.origin}${u.pathname}`.slice(0, 300) };
    } catch {
        return { ok: false };
    }

}

function enteroOpcional(valor, min, max) {

    if (valor === undefined || valor === null) return { ok: true, valor: null };

    if (!Number.isInteger(valor) || valor < min || valor > max) return { ok: false };

    return { ok: true, valor };

}

function validarEvento(cuerpo) {

    if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
        return rechazo("cuerpo_invalido");
    }

    if (JSON.stringify(cuerpo).length > TAMANO_MAXIMO) {
        return rechazo("demasiado_grande");
    }

    for (const clave of Object.keys(cuerpo)) {
        if (!CAMPOS.has(clave)) return rechazo("campo_no_permitido");
    }

    if (!TIPOS.has(cuerpo.t)) return rechazo("tipo_invalido");

    if (typeof cuerpo.v !== "string" || !UUID.test(cuerpo.v)) return rechazo("visitor_invalido");
    if (typeof cuerpo.s !== "string" || !UUID.test(cuerpo.s)) return rechazo("sesion_invalida");

    const pagina = normalizarPagina(cuerpo.p);
    if (!pagina) return rechazo("pagina_invalida");

    if (EXCLUIDAS.some(prefijo => pagina === prefijo || pagina.startsWith(`${prefijo}/`))) {
        return { ok: true, ignorar: true };
    }

    const referrer = normalizarReferrer(cuerpo.r);
    if (!referrer.ok) return rechazo("referrer_invalido");

    const ancho = enteroOpcional(cuerpo.w, 1, 20000);
    const alto = enteroOpcional(cuerpo.h, 1, 20000);
    const tactil = enteroOpcional(cuerpo.tc, 0, 32);

    if (!ancho.ok || !alto.ok || !tactil.ok) return rechazo("pantalla_invalida");

    return {
        ok: true,
        ignorar: false,
        evento: {
            tipo: cuerpo.t,
            visitorId: cuerpo.v.toLowerCase(),
            sessionId: cuerpo.s.toLowerCase(),
            pagina,
            referrer: referrer.valor,
            ancho: ancho.valor,
            alto: alto.valor,
            tactil: tactil.valor ?? 0
        }
    };

}

module.exports = { validarEvento, TAMANO_MAXIMO };
