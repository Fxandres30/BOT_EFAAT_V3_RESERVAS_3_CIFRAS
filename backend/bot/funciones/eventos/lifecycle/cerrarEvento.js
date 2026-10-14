const supabase = require("../../../../lib/supabase");
const { cerrarGrupoDetallado } = require("../grupos/cerrarGrupo");

// Columna inexistente: la migración 023 (estado de cierre por grupo) todavía
// no se aplicó. El cierre NUNCA depende de esas columnas: sin ellas se
// comporta exactamente como antes.
const COLUMNA_INEXISTENTE = "42703";

// Reintentos: los 3 primeros fallos se reintentan en cada ciclo del worker
// (30 s); después, con espera creciente hasta 30 min, para no saturar la
// cola de IQ con un grupo donde el bot no tiene permisos.
const REINTENTOS_INMEDIATOS = 3;
const ESPERA_BASE_MS = 30 * 1000;
const ESPERA_MAXIMA_MS = 30 * 60 * 1000;

function esperaAntesDeReintentar(fila, ahora = Date.now()) {

    const intentos = Number(fila?.cierre_intentos) || 0;

    if (intentos < REINTENTOS_INMEDIATOS || !fila?.cierre_ultimo_intento_en) return 0;

    const espera = Math.min(ESPERA_BASE_MS * 2 ** (intentos - REINTENTOS_INMEDIATOS + 1), ESPERA_MAXIMA_MS);
    const transcurrido = ahora - new Date(fila.cierre_ultimo_intento_en).getTime();

    return Math.max(0, espera - transcurrido);

}

// Registro best-effort del fallo de cierre de UN grupo. Nunca lanza.
async function registrarFalloCierre(fila, error) {

    const intentos = (Number(fila.cierre_intentos) || 0) + 1;

    const cambios = {
        cierre_estado: intentos >= 10 ? "requiere_revision" : "fallido",
        cierre_intentos: intentos,
        cierre_ultimo_error: String(error || "WhatsApp no confirmó el cierre").slice(0, 500),
        cierre_ultimo_intento_en: new Date().toISOString()
    };

    try {

        const { error: errorUpdate } = await supabase.from("eventos_bot").update(cambios).eq("id", fila.id);

        if (!errorUpdate) {
            Object.assign(fila, cambios);
        } else if (errorUpdate.code !== COLUMNA_INEXISTENTE) {
            console.log("⚠️ No se pudo registrar el fallo de cierre:", errorUpdate.message);
        }

    } catch (err) {

        console.log("⚠️ No se pudo registrar el fallo de cierre:", err?.message);

    }

}

// ==========================================================================
// Cierra el GRUPO REAL de WhatsApp de UNA fila de eventos_bot puntual y, si
// WhatsApp confirma, marca ESA fila como cerrada. No propaga a hermanos —
// eso lo hace cerrarEvento() más abajo, llamando a esta misma función para
// cada uno. Es exactamente la lógica que ya tenía cerrarEvento() antes de
// este cambio, sin ninguna diferencia de comportamiento para un evento sin
// hermanos (el caso de siempre).
// ==========================================================================
async function cerrarFilaDeEvento({ sock, fila, motivo }) {

    if (!fila) return false;

    if (!fila.activo) return true;

    // ============================================================
    // 1. CERRAR EL GRUPO EN WHATSAPP PRIMERO
    // ============================================================
    // Antes se marcaba el evento como cerrado en Supabase ANTES de
    // confirmar WhatsApp. Si WhatsApp devolvía rate-overlimit, la BD
    // quedaba en "cerrado", el worker ya no encontraba el evento
    // (activo=false) y nunca reintentaba -> BD y WhatsApp divergentes
    // para siempre.
    //
    // Ahora: si WhatsApp NO confirma el cierre, NO se toca el evento.
    // Sigue con activo=true y el worker lo reintenta en el próximo ciclo
    // (cerrarGrupo/groupSettingUpdate es idempotente).

    let resultado = { ok: false, error: null };

    try {

        resultado = await cerrarGrupoDetallado({
            sock,
            grupoId: fila.grupo_id
        });

    } catch (error) {

        console.log("❌ Error cerrando grupo");
        console.dir(error, { depth: null });

        resultado = { ok: false, error: error?.message || String(error) };

    }

    if (!resultado.ok) {

        console.log(`⏳ Evento ${fila.id}: WhatsApp no confirmó el cierre del grupo — NO se marca cerrado, se reintentará (activo=true). Motivo: ${resultado.error}`);

        await registrarFalloCierre(fila, resultado.error);

        return false;

    }

    // ============================================================
    // 2. GRUPO CONFIRMADO CERRADO -> PERSISTIR EL ESTADO
    // ============================================================

    const cierreBase = {

        activo: false,
        abierto: false,
        estado: "cerrado",
        actualizado_en: new Date().toISOString()

    };

    let { error } = await supabase
        .from("eventos_bot")
        .update({
            ...cierreBase,
            cierre_estado: "cerrado",
            cierre_motivo: String(motivo || "").slice(0, 200),
            cierre_ultimo_error: null,
            cierre_ultimo_intento_en: new Date().toISOString(),
            cerrado_en: new Date().toISOString()
        })
        .eq("id", fila.id);

    // Sin la migración 023: se guarda exactamente lo de siempre.
    if (error?.code === COLUMNA_INEXISTENTE) {
        ({ error } = await supabase.from("eventos_bot").update(cierreBase).eq("id", fila.id));
    }

    if (error) {

        console.log("❌ Error cerrando evento");
        console.dir(error, { depth: null });

        return false;

    }

    console.log(`🔒 Evento ${fila.id} cerrado (${motivo})`);

    return true;

}

// ==========================================================================
// Otras filas de eventos_bot (de otros grupos) que representan el MISMO
// sorteo real (misma identidad_evento_real, mismo tenant) y siguen activas.
// Decisión aprobada explícitamente: "el cierre es del evento real, no del
// grupo" — si Grupo A cierra, los grupos B/C que anunciaron el MISMO sorteo
// deben cerrarse también, para que ninguno siga aceptando reservas de un
// evento que ya cerró en otro. Ver bot/funciones/eventos/identidadEventoReal.js.
//
// Si identidad_evento_real todavía no existe (evento previo a la migración
// 015_identidad_evento_real.sql), no hay nada que buscar: se comporta
// exactamente igual que antes de este cambio (solo cierra el grupo propio).
// ==========================================================================
async function buscarGruposHermanosActivos(fila) {

    if (!fila.identidad_evento_real) return [];

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("identidad_evento_real", fila.identidad_evento_real)
        .eq("usuario_id", fila.usuario_id)
        .eq("activo", true);

    if (error) {

        console.log("❌ Error buscando grupos hermanos del mismo evento real");
        console.dir(error, { depth: null });

        return [];

    }

    return data || [];

}

async function cerrarEvento({

    sock,
    evento,
    motivo

}) {

    if (!evento) return false;

    if (!evento.activo) return true;

    const cerradoPropio = await cerrarFilaDeEvento({ sock, fila: evento, motivo });

    if (!cerradoPropio) return false;

    // ============================================================
    // 3. PROPAGAR EL CIERRE A LOS GRUPOS HERMANOS DEL MISMO EVENTO REAL
    // ============================================================
    // Cada hermano se cierra con la MISMA función segura de arriba: si
    // WhatsApp no confirma el cierre de un hermano puntual, ESE hermano
    // simplemente queda activo=true — el worker lo reintenta en su próximo
    // ciclo normal (hora_cierre/verificarTodosPagados ya aislados por
    // evento real, así que vuelve a evaluar "cerrar" igual, sin necesitar
    // ningún mecanismo de reconciliación nuevo). Un fallo propagando a un
    // hermano NUNCA revierte el cierre ya confirmado del grupo que originó
    // la acción.
    try {

        const hermanos = await buscarGruposHermanosActivos(evento);

        for (const hermano of hermanos) {

            await cerrarFilaDeEvento({

                sock,
                fila: hermano,
                motivo: `${motivo} (evento compartido, propagado desde grupo ${evento.grupo_id})`

            });

        }

    } catch (error) {

        console.error("❌ Error propagando cierre a grupos hermanos del mismo evento real:", error?.message);

    }

    return true;

}

module.exports = {
    cerrarEvento,
    cerrarFilaDeEvento,
    esperaAntesDeReintentar
};
