// ==========================================================================
// auditoriaReservas.js — registro INMUTABLE de las operaciones sobre números
// (reservas_auditoria, migración 032). Lo escribe SOLO el backend:
//
//   - reservarNumeros.js: cada reserva que de verdad se guardó (bot o panel).
//   - services/reservaManual.js: pagos, liberaciones, desbloqueos y TODOS
//     los rechazos/errores de una intervención manual.
//
// Best-effort y nunca lanza: si la migración 032 no está aplicada, la
// operación real sigue igual y se avisa UNA sola vez en el log (no en cada
// reserva del bot).
// ==========================================================================

const supabase = require("../../../lib/supabase");

const TABLA = "reservas_auditoria";

// Tabla inexistente (Postgres o caché de esquema de PostgREST).
const CODIGOS_SIN_MIGRACION = new Set(["42P01", "PGRST205"]);

let avisadoSinMigracion = false;

const LIMITES = { motivo: 500, observaciones: 1000, metodo_pago: 60, solicitud_id: 80, error: 500 };

function recortar(fila) {

    const salida = { ...fila };

    for (const [campo, max] of Object.entries(LIMITES)) {
        if (typeof salida[campo] === "string" && salida[campo].length > max) salida[campo] = salida[campo].slice(0, max);
    }

    // La base fija la fecha; el llamador nunca la decide.
    delete salida.creado_en;
    delete salida.id;

    return salida;

}

// filas: objeto o arreglo con las columnas de reservas_auditoria. Devuelve
// true si quedó guardado.
async function registrarAuditoria(filas) {

    const lista = (Array.isArray(filas) ? filas : [filas]).filter(f => f && f.usuario_id && f.numero);

    if (lista.length === 0) return false;

    try {

        const { error } = await supabase.from(TABLA).insert(lista.map(recortar));

        if (!error) return true;

        if (CODIGOS_SIN_MIGRACION.has(error.code)) {
            if (!avisadoSinMigracion) {
                avisadoSinMigracion = true;
                console.warn("⚠️ [AUDITORÍA] reservas_auditoria no existe todavía (falta aplicar supabase_migrations/032_auditoria_reservas.sql): las operaciones siguen, sin auditoría.");
            }
            return false;
        }

        console.error("❌ [AUDITORÍA] no se pudo registrar:", error.code || error.message);
        return false;

    } catch (err) {

        console.error("❌ [AUDITORÍA] excepción registrando:", err?.message);
        return false;

    }

}

// Historial de UN número del cliente, más reciente primero. { ok, filas,
// migracionPendiente? } — nunca lanza.
async function historialNumero({ usuarioId, tabla, numero, limite = 20 }) {

    if (!usuarioId || !tabla || !numero) return { ok: false, filas: [] };

    try {

        const { data, error } = await supabase
            .from(TABLA)
            .select("*")
            .eq("usuario_id", usuarioId)
            .eq("tabla", tabla)
            .eq("numero", numero)
            .order("creado_en", { ascending: false })
            .limit(limite);

        if (error) {
            if (CODIGOS_SIN_MIGRACION.has(error.code)) return { ok: false, filas: [], migracionPendiente: true };
            console.error("❌ [AUDITORÍA] error leyendo historial:", error.code || error.message);
            return { ok: false, filas: [] };
        }

        return { ok: true, filas: data || [] };

    } catch (err) {

        console.error("❌ [AUDITORÍA] excepción leyendo historial:", err?.message);
        return { ok: false, filas: [] };

    }

}

module.exports = { registrarAuditoria, historialNumero, TABLA_AUDITORIA: TABLA };
