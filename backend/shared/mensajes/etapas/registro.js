// ==========================================================================
// shared/mensajes/etapas/registro.js — registro del resultado.
//
// Una entrada estructurada por solicitud procesada, en cualquier modo. Nunca
// guarda el texto ni el JID completos (contienen datos personales): solo una
// huella SHA-256 corta del texto, su longitud y el tipo de destino.
//
// El destino de las entradas se inyecta (`sumidero`). En O1 no hay ninguno
// persistente: memoria (pruebas) o nada. La tabla mensajes_envios propuesta
// en el diseño requiere migración y autorización (O2 o posterior).
// ==========================================================================

"use strict";

const crypto = require("crypto");

function huella(texto) {
    if (typeof texto !== "string" || !texto) return null;
    return crypto.createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

function tipoDestino(jid) {
    const j = String(jid || "");
    if (j.endsWith("@g.us")) return "grupo";
    if (j.endsWith("@s.whatsapp.net") || j.endsWith("@lid")) return "privado";
    return j ? "otro" : null;
}

function construirEntrada({ solicitud, modo, resultado, inicio, ahora = Date.now() }) {
    return {
        instante: new Date(ahora).toISOString(),
        origen: solicitud?.origen || null,
        tipo: solicitud?.tipo || null,
        usuarioId: solicitud?.usuarioId || null,
        modo,
        estado: resultado.estado,
        motivo: resultado.motivo || null,
        fuente: resultado.fuente || null,
        plantillaId: resultado.plantillaId || null,
        clave: solicitud?.claveEnvioUnico || null,
        canal: resultado.canal || null,
        destino: tipoDestino(solicitud?.destino?.jid),
        huellaTexto: huella(resultado.texto),
        longitud: typeof resultado.texto === "string" ? resultado.texto.length : null,
        duracionMs: inicio != null ? Math.max(0, ahora - inicio) : null
    };
}

function crearRegistroMemoria() {
    const entradas = [];
    return { entradas, registrar: (e) => { entradas.push(e); } };
}

const registroNulo = { registrar: () => {} };

module.exports = { construirEntrada, crearRegistroMemoria, registroNulo, huella, tipoDestino };
