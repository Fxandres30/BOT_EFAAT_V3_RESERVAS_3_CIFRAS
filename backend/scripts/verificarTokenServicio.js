// ==========================================================================
// Comprueba el token de servicio entre panel y backend SIN mostrar su valor.
//
//   node scripts/verificarTokenServicio.js [ruta/al/.env.del/panel]
//
// Muestra, para el backend (entorno del proceso + backend/.env) y para el
// archivo de entorno del panel (por defecto ../frontend/.env.local):
//   - si la variable está definida y su longitud;
//   - una huella (8 primeros caracteres del SHA-256) para comparar a ojo;
//   - si SESSIONS_API_TOKEN (backend) == BOT_API_TOKEN (panel).
// Solo lectura: no cambia nada.
// ==========================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.resolve(__dirname, "..");

function leerEnv(archivo) {
    try {
        const valores = {};
        for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
            const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
        }
        return valores;
    } catch {
        return null;
    }
}

const huella = (v) => crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 8);

function describir(origen, nombre, valor) {
    if (valor === undefined) return console.log(`  ${origen}: ${nombre} NO definida`);
    if (!valor) return console.log(`  ${origen}: ${nombre} definida pero VACÍA`);
    console.log(`  ${origen}: ${nombre} definida · longitud ${valor.length} · huella ${huella(valor)}`);
}

const envBackend = leerEnv(path.join(RAIZ, ".env"));
const archivoPanel = path.resolve(process.argv[2] || path.join(RAIZ, "..", "frontend", ".env.local"));
const envPanel = leerEnv(archivoPanel);

console.log("Backend (lo que usa middleware/tokenServicio.js):");
describir("entorno del proceso", "SESSIONS_API_TOKEN", process.env.SESSIONS_API_TOKEN);
if (envBackend) describir("backend/.env", "SESSIONS_API_TOKEN", envBackend.SESSIONS_API_TOKEN);
else console.log("  backend/.env: no existe o no se puede leer");

console.log(`Panel (${archivoPanel}):`);
if (envPanel) describir("archivo", "BOT_API_TOKEN", envPanel.BOT_API_TOKEN);
else console.log("  no existe o no se puede leer (pasa la ruta del .env del panel como argumento)");

const backend = process.env.SESSIONS_API_TOKEN || envBackend?.SESSIONS_API_TOKEN;
const panel = envPanel?.BOT_API_TOKEN;

console.log("Resultado:");
if (backend && panel && backend !== panel) console.log("  ❌ NO coinciden: el backend rechazará al panel (401). Usa el mismo valor en los dos.");
else if (backend && panel) console.log("  ✅ Coinciden.");
else if (backend) console.log("  ✅ Backend configurado. Si el panel corre en este servidor y no tiene BOT_API_TOKEN, usará el de backend/.env.");
else if (panel) console.log("  ✅ El backend usará el BOT_API_TOKEN del panel de este servidor (recomendado: copiarlo también a backend/.env).");
else console.log("  ❌ No hay token en ningún lado: /sessions, /sorteos, /contactos, /bloqueados y /tablas/compartir responden 503. Ver docs/activacion/TOKEN_SERVICIO.md.");

process.exit((backend || panel) && !(backend && panel && backend !== panel) ? 0 : 1);
