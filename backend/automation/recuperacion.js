// ==========================================================================
// REGLAS COMUNES DE RECUPERACIÓN (F4-G, 06/11/2026).
//
// Los caminos que completan lo que una caída dejó a medias comparten estas
// reglas; cada uno conserva su disparador:
//   sorteos/recuperacionPublicacion.js  destinos «publicando» atascados
//   workerEventos                        grupos que no se pudieron abrir
//   motorEventos.recuperarCiclos         ciclos y mensajes de apertura
//   reclamos de C2/K3/K4                 reclamos «en curso» abandonados
//
// Nunca se decide solo por el tiempo: el tiempo dice cuándo MIRAR; lo que se
// hace lo decide el estado persistido (el registro del envío en
// automation_actions, el reclamo, el estado del destino y de la fila).
// ==========================================================================

"use strict";

// Umbrales (todos en un solo sitio, con su motivo).
const UMBRALES = Object.freeze({
    // Un destino «publicando» lleva captura de imagen + envío por la cola de
    // WhatsApp (reintentos con espera por rate-overlimit): menos de 10 min
    // puede ser una publicación viva.
    PUBLICACION_ATASCADA_MS: 10 * 60 * 1000,
    // Reclamo K3: cubre esa misma publicación completa.
    RECLAMO_PUBLICACION_MS: 10 * 60 * 1000,
    // Reclamo C2: cubre solo escrituras en la base (sustituciones + guardar).
    RECLAMO_ACTIVACION_MS: 2 * 60 * 1000,
    // Reclamo K4: un INSERT del borrador.
    RECLAMO_CREACION_MS: 60 * 1000,
    // Ciclos (motorEventos): margen para no tocar un ciclo que se está
    // abriendo ahora, tolerancia del mensaje de apertura (no se anuncia tarde)
    // y antigüedad máxima (datos históricos, no se reanudan).
    CICLO_MARGEN_MS: 2 * 60 * 1000,
    CICLO_TOLERANCIA_APERTURA_MS: 15 * 60 * 1000,
    CICLO_ANTIGUEDAD_MAXIMA_MS: 24 * 60 * 60 * 1000
});
// (El cierre de grupo de F3 conserva su propio umbral de 5 min, sin cambios.)

// Estado de un ENVÍO según su registro del ExecutionGuard (que se escribe
// «en_progreso» ANTES de enviar y «ok»/«error» después).
const ENVIO = Object.freeze({
    NO_INICIADO: "no_iniciado",   // sin registro: nada salió; se puede intentar
    CONFIRMADO: "confirmado",     // ok: llegó (o el intento terminó bien); nunca se repite
    INCIERTO: "incierto",         // en_progreso: la caída fue DURANTE el envío
    FALLIDO: "fallido"            // error: el envío falló y lo registró
});

function estadoDelEnvio(registro) {
    if (!registro) return ENVIO.NO_INICIADO;
    if (registro.estado === "ok") return ENVIO.CONFIRMADO;
    if (registro.estado === "error") return ENVIO.FALLIDO;
    return ENVIO.INCIERTO;
}

// Política de un envío INCIERTO: WhatsApp (Baileys) no ofrece una forma
// fiable de comprobar si un mensaje concreto llegó a un grupo, y el registro
// no puede distinguir «se envió y se cayó» de «se cayó antes». Por eso NUNCA
// se reenvía solo: queda en revisión y lo decide una persona («Reintentar»
// abre otra clave). Solo se envía de nuevo lo NO_INICIADO.
const reenviable = (estado) => estado === ENVIO.NO_INICIADO;

// Cómo se retoma un reclamo ajeno: tras un error, o si lleva «en curso» más
// que su umbral (el proceso que lo tenía murió).
const retomarAbandonado = (umbralMs) => Object.freeze({ trasError: true, enProgresoVencidoMs: umbralMs });

// Reclamo PROPIO de un destino de programación: un destino solo lo toma un
// proceso a la vez (repo.reclamarGrupo, compare-and-swap sobre su estado), así
// que si el mismo destino vuelve a trabajarlo y encuentra su reclamo «en
// curso», el intento anterior murió: se retoma sin esperar. (-1: «más antiguo
// que -1 ms» = siempre, también con el reloj detenido.)
const RETOMAR_PROPIO = Object.freeze({ trasError: true, enProgresoVencidoMs: -1 });

const edadMs = (instante, ahora = Date.now()) => ahora - (Date.parse(instante || "") || 0);

module.exports = { UMBRALES, ENVIO, estadoDelEnvio, reenviable, retomarAbandonado, RETOMAR_PROPIO, edadMs };
