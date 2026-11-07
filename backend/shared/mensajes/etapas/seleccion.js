// ==========================================================================
// shared/mensajes/etapas/seleccion.js — selección PURA de plantilla.
//
// Reproduce EXACTAMENTE las reglas actuales (fijadas en las pruebas O0):
//   preferencias           = bot/ai/seleccionarPlantilla.js (S1–S3)
//   aleatorio_sin_repetir  = automation/messageSelector.js (AU1–AU3)
//   aleatorio              = Inicio del día en automation/scheduler.js (ID1)
//
// Pura: no lee ni escribe nada. El azar se inyecta (`aleatorio`), para que
// el modo sombra pueda reproducir la misma elección que el motor actual. Los
// cambios de estado (avanzar la rotación) se DEVUELVEN como `efectos`; quien
// los aplica es el adaptador, y solo en modo activo tras un envío correcto.
// ==========================================================================

"use strict";

const SIN_SELECCION = Object.freeze({ plantilla: null, efectos: {} });

function indice(aleatorio, total) {
    return Math.floor(aleatorio() * total);
}

// configuracion_seleccion_mensajes: { modo_seleccion, plantilla_fija_id, rotacion_indice }
function porPreferencias(candidatas, preferencias, aleatorio) {
    if (!Array.isArray(candidatas) || candidatas.length === 0) return SIN_SELECCION;
    const modo = preferencias?.modo_seleccion || "aleatorio";

    if (modo === "fijo") {
        // Fija deshabilitada o borrada: NUNCA se sustituye por otra (S3).
        const fija = candidatas.find(p => p.id === preferencias.plantilla_fija_id);
        return { plantilla: fija || null, efectos: {} };
    }

    if (modo === "rotacion") {
        const total = candidatas.length;
        const base = Number.isInteger(preferencias?.rotacion_indice) ? preferencias.rotacion_indice : 0;
        const actual = ((base % total) + total) % total;
        return { plantilla: candidatas[actual], efectos: { nuevoIndiceRotacion: (actual + 1) % total } };
    }

    return { plantilla: candidatas[indice(aleatorio, candidatas.length)], efectos: {} };
}

// Automatización: sin repetir el último usado CUANDO SEA POSIBLE.
function aleatorioSinRepetir(candidatas, preferencias, aleatorio) {
    if (!Array.isArray(candidatas) || candidatas.length === 0) return SIN_SELECCION;
    let lista = candidatas;
    const ultimo = preferencias?.ultimoUsadoId || null;
    if (candidatas.length > 1 && ultimo) {
        const sinUltimo = candidatas.filter(m => m.id !== ultimo);
        if (sinUltimo.length > 0) lista = sinUltimo;
    }
    return { plantilla: lista[indice(aleatorio, lista.length)], efectos: {} };
}

function aleatorioSimple(candidatas, _preferencias, aleatorio) {
    if (!Array.isArray(candidatas) || candidatas.length === 0) return SIN_SELECCION;
    return { plantilla: candidatas[indice(aleatorio, candidatas.length)], efectos: {} };
}

const ESTRATEGIAS = Object.freeze({
    preferencias: porPreferencias,
    aleatorio_sin_repetir: aleatorioSinRepetir,
    aleatorio: aleatorioSimple
});

// -> { plantilla | null, efectos }
function seleccionar(estrategia, candidatas, preferencias, aleatorio = Math.random) {
    const fn = ESTRATEGIAS[estrategia];
    if (!fn) throw new Error(`Estrategia de selección desconocida: ${estrategia}`);
    return fn(candidatas, preferencias, aleatorio);
}

module.exports = { seleccionar, ESTRATEGIAS };
