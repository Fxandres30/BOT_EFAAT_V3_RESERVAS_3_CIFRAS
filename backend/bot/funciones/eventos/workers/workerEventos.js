const supabase = require("../../../../lib/supabase");
const { procesarEvento } = require("../lifecycle/procesarEvento");
const { abrirGrupo } = require("../grupos/abrirGrupo");

// Escaneo incremental de identidades: mismo disparador que detectarEvento.js
// (solo tras confirmar apertura), aplicado aquí a la ruta de reconciliación.
const { escanearGrupo } = require("../../usuarios/escanerIdentidadesLifecycle");
const { verificarHoraCierre } = require("../lifecycle/verificarHoraCierre");

async function workerEventos(sock) {

    try {

        const { data: eventos, error } = await supabase
            .from("eventos_bot")
            .select("*")
            .eq("activo", true);

        if (error) {

            console.error("❌ Error obteniendo eventos");
            console.error(error);

            return;

        }

        if (!eventos || eventos.length === 0) {

            return;

        }

        // ============================================================
        // RECONCILIACIÓN DE APERTURA
        // ============================================================
        // Eventos activos cuyo grupo quedó SIN abrir en WhatsApp
        // (abierto=false, por rate-overlimit al detectar el evento).
        // Reintento idempotente (groupSettingUpdate("not_announcement")
        // sobre un grupo ya abierto es un no-op correcto). No aplica a
        // eventos que ya deberían estar cerrándose. Usa la MISMA cola de
        // IQ y el MISMO worker: no añade timers ni listeners.

        for (const evento of eventos) {

            if (evento.abierto === false && !verificarHoraCierre(evento)) {

                try {

                    const abierto = await abrirGrupo({
                        sock,
                        grupoId: evento.grupo_id
                    });

                    if (abierto) {

                        // Mientras se esperaba turno en la cola (espaciado
                        // + posible backoff) pudo haberse cruzado la hora
                        // de cierre. Si ya se cruzó, NO marcar abierto=true:
                        // el bucle de cierre de abajo (sin cambios) lo va a
                        // cerrar de inmediato de todas formas. Evita
                        // "abrir y cerrar en el mismo tick" y un log
                        // confuso. NO cambia la lógica de cierre ni
                        // verificarHoraCierre — solo evita una escritura
                        // innecesaria.
                        if (verificarHoraCierre(evento)) {

                            console.log(`⏭️ Evento ${evento.id}: se abrió en WhatsApp pero ya venció mientras esperaba turno en la cola — lo procesa el cierre normal.`);

                        } else {

                            await supabase
                                .from("eventos_bot")
                                .update({ abierto: true })
                                .eq("id", evento.id);

                            evento.abierto = true;

                            console.log(`🔓 Reconciliado: grupo del evento ${evento.id} abierto en WhatsApp`);

                            // Escaneo incremental de ESE grupo — solo tras
                            // confirmar la apertura. No bloqueante.
                            const sessionIdParaEscaner = sock?.context?.sessionId || null;

                            if (sessionIdParaEscaner) {

                                escanearGrupo(sessionIdParaEscaner, sock, evento.grupo_id).catch(err => {

                                    console.error(`❌ [ESCÁNER IDENTIDADES] error tras reconciliar apertura del grupo ${evento.grupo_id}:`, err?.message);

                                });

                            }

                        }

                    }

                } catch (e) {

                    console.error(`❌ Reintento de apertura del evento ${evento.id}:`, e?.message);

                }

            }

        }

        // Procesar eventos sin imprimir logs cada minuto
        for (const evento of eventos) {

            try {

                await procesarEvento({
                    sock,
                    evento
                });

            } catch (error) {

                console.error(`❌ Error procesando evento ${evento.id}`);
                console.error(error);

            }

        }

    } catch (error) {

        console.error("❌ Error en workerEventos");
        console.error(error);

    }

}

module.exports = {
    workerEventos
};
