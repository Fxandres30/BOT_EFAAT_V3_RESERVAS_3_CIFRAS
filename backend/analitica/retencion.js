// ==========================================================================
// Retención de IP: cada 6 h (y 1 min después de arrancar) anonimiza las IP
// con más de 30 días (config.DIAS_RETENCION_IP) mediante
// public.analitica_anonimizar_ips. Idempotente: si corren a la vez las
// instancias LOCAL y VPS, la segunda simplemente no encuentra filas.
//
// Si pg_cron está habilitado en Supabase, la migración 020 además lo
// programa dentro de la base — ambos mecanismos pueden convivir.
// ==========================================================================

const supabase = require("../lib/supabase");

const config = require("./config");

const CADA_MS = 6 * 60 * 60 * 1000;
const PRIMERA_MS = 60 * 1000;

let temporizador = null;

async function ejecutarRetencion() {

    try {

        const { data, error } = await supabase.rpc("analitica_anonimizar_ips", {
            p_dias: config.DIAS_RETENCION_IP
        });

        if (error) {
            // Tabla/función aún no creada (migración 020 sin ejecutar): no es fatal.
            console.log("⚠️ [ANALITICA] Retención de IP no aplicada:", error.message);
            return null;
        }

        if (data > 0) console.log(`🧹 [ANALITICA] IPs anonimizadas: ${data}`);

        return data;

    } catch (err) {

        console.log("⚠️ [ANALITICA] Retención de IP falló:", err.message);
        return null;

    }

}

function iniciarRetencion() {

    if (temporizador) return;

    const primera = setTimeout(ejecutarRetencion, PRIMERA_MS);
    temporizador = setInterval(ejecutarRetencion, CADA_MS);

    // No mantener vivo el proceso solo por esto.
    primera.unref?.();
    temporizador.unref?.();

}

module.exports = { iniciarRetencion, ejecutarRetencion };
