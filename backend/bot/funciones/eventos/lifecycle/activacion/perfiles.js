// ==========================================================================
// Perfiles de las ENTRADAS que activan un sorteo en un grupo (F4).
//
// Cada entrada conserva lo que la hace distinta; el núcleo
// (lifecycle/activarEvento.js) elige la secuencia según el perfil:
//   publicacion  anuncio: el panel envía imagen + texto
//                ninguna: el anuncio es el propio mensaje del grupo
//   ciclo        tras_anuncio: el ciclo nace después de enviar el anuncio
//                antes_de_abrir: se registra antes de abrir el grupo y se
//                confirma después (detección de WhatsApp)
//                reanudar: solo completa uno pendiente (F4-G)
//   reintentos   automaticos (publicador) | manuales («Reintentar») | no
// ==========================================================================

"use strict";

const PERFILES = Object.freeze({
    anuncio_whatsapp: Object.freeze({ publicacion: "ninguna", ciclo: "antes_de_abrir", reintentos: "no" }),
    programado: Object.freeze({ publicacion: "anuncio", ciclo: "tras_anuncio", reintentos: "automaticos" }),
    instantaneo: Object.freeze({ publicacion: "anuncio", ciclo: "tras_anuncio", reintentos: "manuales" }),
    grupo_nuevo: Object.freeze({ publicacion: "anuncio", ciclo: "tras_anuncio", reintentos: "manuales" }),
    reintento_manual: Object.freeze({ publicacion: "anuncio", ciclo: "tras_anuncio", reintentos: "manuales" }),
    reanudacion: Object.freeze({ publicacion: "ninguna", ciclo: "reanudar", reintentos: "no" })
});

// Entrada del panel que llega al publicador (solo elige el perfil: las
// cuatro del panel ejecutan hoy la misma secuencia).
function entradaDelPanel({ sorteo, grupo, solicitado }) {
    if (sorteo?.config?.publicacion_inmediata === true) return "instantaneo";
    if ((Number(grupo?.reintentos_manuales) || 0) > 0) return "reintento_manual";
    if (solicitado) return "grupo_nuevo";
    return "programado";
}

module.exports = { PERFILES, entradaDelPanel };
