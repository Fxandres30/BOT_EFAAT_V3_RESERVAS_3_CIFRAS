// ==========================================================================
// Comprueba con QUÉ ROL se conecta el backend a Supabase, SIN mostrar la
// clave ni conectarse a nada.
//
//   node scripts/verificarRolSupabase.js
//
// Lee SUPABASE_SERVICE_ROLE_KEY del entorno del proceso o de backend/.env
// (el mismo origen que lib/supabase.js) y muestra solo:
//   - clave JWT antigua: el claim "role" de su payload (debe ser service_role);
//   - clave nueva de Supabase: su tipo por el prefijo (sb_secret_ = rol
//     service_role; sb_publishable_ = rol anon).
// La firma no se comprueba (no hace falta para saber el rol declarado).
//
// Por qué importa: tras parte_f_permisos_lease.sql solo service_role puede
// ejecutar las funciones de lease. Si el backend usara otra clave, el bot
// no podría adquirir el lease y no crearía el socket de WhatsApp.
// Solo lectura: no cambia nada.
// ==========================================================================

const fs = require("fs");
const path = require("path");

const ARCHIVO = path.resolve(__dirname, "..", ".env");

function desdeArchivo(nombre) {
    try {
        for (const linea of fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)) {
            const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && m[1] === nombre) return m[2].replace(/^(['"])(.*)\1$/, "$2");
        }
    } catch {
        // sin archivo: se usa solo el entorno del proceso
    }
    return undefined;
}

// Devuelve { rol, origen } sin exponer nunca la clave.
function rolDeClave(clave) {

    if (!clave) return { rol: null, detalle: "no definida" };
    if (clave.startsWith("sb_secret_")) return { rol: "service_role", detalle: "clave secreta nueva (sb_secret_)" };
    if (clave.startsWith("sb_publishable_")) return { rol: "anon", detalle: "clave PÚBLICA nueva (sb_publishable_)" };

    const partes = clave.split(".");
    if (partes.length !== 3) return { rol: null, detalle: "formato no reconocido" };

    try {
        const payload = JSON.parse(Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        return { rol: typeof payload.role === "string" ? payload.role : null, detalle: "JWT" };
    } catch {
        return { rol: null, detalle: "JWT ilegible" };
    }

}

if (require.main === module) {

    const enProceso = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const clave = enProceso !== undefined ? enProceso : desdeArchivo("SUPABASE_SERVICE_ROLE_KEY");
    const origen = enProceso !== undefined ? "entorno del proceso" : "backend/.env";
    const { rol, detalle } = rolDeClave(clave);

    console.log(`SUPABASE_SERVICE_ROLE_KEY (${origen}): ${detalle}`);
    console.log(`  rol declarado: ${rol || "desconocido"}`);

    if (rol === "service_role") {
        console.log("  ✅ correcto: el backend puede seguir usando las funciones de lease tras la Parte F.");
    } else {
        console.log("  ❌ NO es service_role: NO aplicar parte_f_permisos_lease.sql en esta instancia (el bot no podría conectar).");
        process.exitCode = 1;
    }

}

module.exports = { rolDeClave };
