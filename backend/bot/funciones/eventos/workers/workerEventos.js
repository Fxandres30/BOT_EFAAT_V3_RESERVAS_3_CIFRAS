const supabase = require("../../../../lib/supabase");
const politicaGrupos = require("../../grupos/politicaGrupos");
const { procesarSorteo } = require("../lifecycle/procesarSorteo");
const { claveSorteo } = require("../sorteoReal");
const { reconciliarAperturaGrupo } = require("../grupos/reconciliarApertura");

// Escaneo incremental de identidades: mismo disparador que detectarEvento.js
// (solo tras confirmar apertura), aplicado aquí a la ruta de reconciliación.
const { escanearGrupo } = require("../../usuarios/escanerIdentidadesLifecycle");
const { verificarHoraCierre } = require("../lifecycle/verificarHoraCierre");

async function workerEventos(sock) {

    try {

        // Aislamiento por cliente: este socket solo actúa sobre los sorteos
        // de SU tenant. Falla cerrado (multisesión, 2026-10-21): un socket
        // sin tenant no actúa sobre nada y un evento sin usuario_id no lo
        // toca ningún socket (antes los procesaban todos los sockets a la
        // vez). Auditoría 14/10: 0 eventos sin usuario_id. El filtro va en
        // la consulta: con N sesiones, cada una lee solo lo suyo.
        const tenant = sock?.context?.usuarioId || null;

        if (!tenant) {

            console.error("❌ [WORKER EVENTOS] socket sin dueño (usuario_id): no se procesa ningún sorteo.");

            return;

        }

        const { data: eventos, error } = await supabase
            .from("eventos_bot")
            .select("*")
            .eq("activo", true)
            .eq("usuario_id", tenant);

        if (error) {

            console.error("❌ Error obteniendo eventos");
            console.error(error);

            return;

        }

        if (!eventos || eventos.length === 0) {

            return;

        }

        // Solo sorteos de SUS grupos autorizados (politicaGrupos.js). Sin
        // poder leer la autorización no se actúa sobre ninguno (falla cerrado).
        const autorizados = await politicaGrupos.gruposAutorizadosDe(tenant);

        if (!autorizados) {

            console.error("❌ [WORKER EVENTOS] autorización de grupos desconocida: no se procesa ningún sorteo en este ciclo.");

            return;

        }

        // Resguardo por si la consulta devolviera algo ajeno.
        const delTenant = (eventos || []).filter(e => e.usuario_id === tenant && autorizados.has(e.grupo_id));

        // ============================================================
        // RECONCILIACIÓN DE APERTURA
        // ============================================================
        // Eventos activos cuyo grupo quedó SIN abrir en WhatsApp
        // (abierto=false). No aplica a eventos que ya deberían estar
        // cerrándose. Usa la MISMA cola de IQ y el MISMO worker.
        //
        // Se trabaja POR GRUPO, no por fila: un sorteo publicado en varios
        // grupos tiene una fila por grupo, y dos filas del mismo grupo
        // comparten una sola apertura. reconciliarAperturaGrupo decide si
        // intentar (espera por grupo ante rechazos de permisos, estado real
        // con groupMetadata) — ver grupos/reconciliarApertura.js.

        const pendientesPorGrupo = new Map();

        for (const evento of delTenant) {

            if (evento.abierto === false && !verificarHoraCierre(evento)) {

                if (!pendientesPorGrupo.has(evento.grupo_id)) pendientesPorGrupo.set(evento.grupo_id, []);
                pendientesPorGrupo.get(evento.grupo_id).push(evento);

            }

        }

        for (const [grupoId, filasGrupo] of pendientesPorGrupo) {

            try {

                const { resultado } = await reconciliarAperturaGrupo({ sock, grupoId });

                if (resultado !== "abierto" && resultado !== "ya_abierto") continue;

                let sincronizadas = 0;

                for (const evento of filasGrupo) {

                    // Mientras se esperaba turno en la cola (espaciado
                    // + posible backoff) pudo haberse cruzado la hora
                    // de cierre. Si ya se cruzó, NO marcar abierto=true:
                    // el bucle de cierre de abajo (sin cambios) lo va a
                    // cerrar de inmediato de todas formas.
                    if (verificarHoraCierre(evento)) {

                        console.log(`⏭️ Evento ${evento.id}: el grupo está abierto en WhatsApp pero el evento ya venció mientras esperaba turno en la cola — lo procesa el cierre normal.`);
                        continue;

                    }

                    const { error: errorUpdate } = await supabase
                        .from("eventos_bot")
                        .update({ abierto: true })
                        .eq("id", evento.id);

                    if (errorUpdate) {

                        console.error(`❌ No se pudo registrar abierto=true del evento ${evento.id} (se reintentará):`, errorUpdate.message);
                        continue;

                    }

                    evento.abierto = true;
                    sincronizadas++;

                    console.log(`🔓 Reconciliado: grupo del evento ${evento.id} abierto en WhatsApp`);

                }

                // Escaneo incremental de ESE grupo (una vez por grupo) —
                // solo tras confirmar la apertura. No bloqueante.
                const sessionIdParaEscaner = sock?.context?.sessionId || null;

                if (sincronizadas > 0 && sessionIdParaEscaner) {

                    escanearGrupo(sessionIdParaEscaner, sock, grupoId).catch(err => {

                        console.error(`❌ [ESCÁNER IDENTIDADES] error tras reconciliar apertura del grupo ${grupoId}:`, err?.message);

                    });

                }

            } catch (e) {

                console.error(`❌ Reintento de apertura de los eventos ${filasGrupo.map(f => f.id).join(", ")}:`, e?.message);

            }

        }

        // CIERRE — UNA evaluación por SORTEO lógico (no por grupo): las filas
        // de eventos_bot que comparten tenant + identidad_evento_real son el
        // mismo sorteo con una sola tabla de números. Ver procesarSorteo.js.
        const sorteos = new Map();

        for (const evento of delTenant) {
            const clave = claveSorteo(evento);
            if (!sorteos.has(clave)) sorteos.set(clave, []);
            sorteos.get(clave).push(evento);
        }

        for (const [clave, filas] of sorteos) {

            try {

                await procesarSorteo({
                    sock,
                    filas
                });

            } catch (error) {

                console.error(`❌ Error procesando sorteo ${clave}`);
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
