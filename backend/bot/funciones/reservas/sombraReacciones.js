// ==========================================================================
// bot/funciones/reservas/sombraReacciones.js — FASE O5: REACCIONES ✅/❌ a
// las reservas en MODO SOMBRA.
//
// reaccionReserva.reaccionarAlMensaje sigue siendo el ÚNICO que reacciona.
// Cuando el motor llegó a decidir (reacción enviada, fallo al enviarla o
// interruptor apagado) llama aquí y el orquestador decide por su cuenta si
// habría reaccionado y con qué emoji. El emoji lo decide el negocio
// (decidirReaccion, en detectarReserva): el orquestador recibe el mismo y
// decide interruptor y canal.
//
// La sombra NO reacciona (sin `envios`), NO marca el mensaje como
// reaccionado (no toca el conjunto del motor) y NO usa la caché del
// interruptor (lee sin caché con leerInterruptorReacciones; por eso, en los
// 30 s de caché tras un cambio en el panel, puede ver un valor distinto:
// se informa como «interruptor_distinto»). Nunca lanza. Sin la variable
// MENSAJES_ORQUESTADOR_REACCION=shadow no hace nada, ni siquiera lee.
// ==========================================================================

"use strict";

const { crearOrquestador } = require("../../../shared/mensajes");
const { resolverModo, MODOS } = require("../../../shared/mensajes/modos");
const { huella } = require("../../../shared/mensajes/etapas/registro");

const ORIGEN = "reaccion";

function crearAdaptadorReacciones() {
    return {
        habilitado: async (s) => {
            const { leerInterruptorReacciones } = require("./reaccionReserva");
            return leerInterruptorReacciones(s.usuarioId);
        }
    };
}

async function compararReaccionEnSombra({ ctx, emoji, resultado, entorno = process.env, log = console.log } = {}) {

    try {
        const modoConfigurado = resolverModo(ORIGEN, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const usuarioId = ctx?.session?.usuarioId || null;
        const base = {
            origen: ORIGEN, tipo: "reaccion_reserva", modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O5: solo sombra" } : {}),
            usuarioId, destino: huella(ctx?.chat?.remoteJid), emoji
        };

        // Sin cliente de sesión el motor da el interruptor por activado sin
        // leer nada: no hay decisión que el orquestador pueda repetir.
        if (!usuarioId) {
            const entrada = { ...base, coincide: null, motivo: "no_comparable:sin_usuario_de_sesion" };
            log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
            return entrada;
        }

        const orquestador = crearOrquestador({
            adaptadores: { [ORIGEN]: crearAdaptadorReacciones() },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios`: imposible reaccionar desde aquí.
        });

        const r = await orquestador.procesar({
            origen: ORIGEN, tipo: "reaccion_reserva", usuarioId,
            sesion: { sock: ctx.sock },
            destino: { jid: ctx.chat?.remoteJid },
            reaccion: { key: ctx.message?.key, emoji }
        }, { modo: MODOS.SHADOW });

        const actualReacciona = resultado.motivo === "enviada" || resultado.motivo === "fallo_envio";
        const orqReacciona = r.estado === "sombra";
        let motivo = null;
        if (r.estado === "error") motivo = `error_orquestador:${r.motivo}`;
        else if (actualReacciona !== orqReacciona) motivo = r.motivo === "interruptor_apagado" || resultado.motivo === "interruptor_apagado" ? "interruptor_distinto" : `decision_distinta:${r.motivo || r.estado}`;

        const entrada = {
            ...base,
            actual: { reacciona: actualReacciona, motivo: resultado.motivo },
            orquestador: { reacciona: orqReacciona, estado: r.estado, motivo: r.motivo || null, canal: r.canal || null },
            coincide: motivo === null,
            motivo
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen: ORIGEN, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = { compararReaccionEnSombra, crearAdaptadorReacciones };
