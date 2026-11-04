// ==========================================================================
// diagnostico/capturaDroplet.js — ¿puede ESTE servidor generar la imagen de
// la tabla que se publica en WhatsApp? (FRONTEND_URL + Chromium/Puppeteer)
//
// SOLO LECTURA Y SIN EFECTOS:
//   - Supabase y WhatsApp quedan BLOQUEADOS antes de cargar nada: el script
//     no puede leer ni escribir la base ni enviar ningún mensaje (si algo lo
//     intentara, falla en voz alta).
//   - Usa la MISMA función que el publicador (services/compartirTabla.js →
//     capturarImagenTabla) con una tabla FICTICIA de 100 números y un
//     usuario ficticio (UUID que no existe): abre
//     FRONTEND_URL/tablas/imprimir/<precio> en Chromium, le entrega los datos
//     ficticios y captura el PNG. No firma enlaces ni toca datos reales.
//   - Escribe el PNG en /tmp (o --salida) para revisarlo a ojo.
//
// En el Droplet, desde la carpeta backend y con el MISMO entorno que PM2:
//     node diagnostico/capturaDroplet.js [--precio 3000] [--salida /tmp/x.png]
// Salida: código 0 si la imagen se generó; 1 si no, con el motivo.
// ==========================================================================

const path = require("path");
const fs = require("fs");
const os = require("os");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const RAIZ = path.resolve(__dirname, "..");
const bloquear = (nombre) => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : () => { throw new Error(`${nombre} bloqueado en el diagnóstico`); }) });
for (const [rel, nombre] of [["lib/supabase.js", "Supabase"], ["services/baileys/send.js", "WhatsApp"]]) {
    const abs = path.join(RAIZ, rel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: bloquear(nombre) };
}

const arg = (n, def) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def; };
const precio = Number(arg("--precio", "3000"));
const salida = arg("--salida", path.join(os.tmpdir(), `efaat-captura-diagnostico-${Date.now()}.png`));

function informe(clave, valor) { console.log(`${clave.padEnd(22)} ${valor}`); }

(async () => {

    const url = process.env.FRONTEND_URL || "";
    let host = "(no definida)";
    try { if (url) host = new URL(url).host; } catch { host = `(inválida: ${url.slice(0, 40)})`; }
    informe("FRONTEND_URL (host)", host);
    informe("NODE_ENV", process.env.NODE_ENV || "(no definida)");
    informe("Node", process.version);

    let puppeteer;
    try {
        puppeteer = require("puppeteer");
        informe("Chromium (ruta)", await puppeteer.executablePath());
        const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        informe("Chromium (versión)", await b.version());
        await b.close();
    } catch (err) {
        informe("Chromium", `NO ARRANCA: ${err?.message}`);
        process.exit(1);
    }

    if (!url) { informe("RESULTADO", "FALTA FRONTEND_URL: el publicador no puede generar imágenes."); process.exit(1); }

    // Tabla ficticia: 100 números, algunos reservados y pagados.
    const todos = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
    const datos = {
        numerosDisponibles: todos.slice(10), numerosOcupados: todos.slice(0, 10), numerosPagados: todos.slice(0, 4),
        cifras: 2, cantidad: 100, diseno: null
    };

    const inicio = Date.now();
    try {
        const { capturarImagenTabla } = require(path.join(RAIZ, "services/compartirTabla.js"));
        const png = await capturarImagenTabla(precio, "00000000-0000-4000-8000-00000000d1a9", null, { datos });
        const valido = Buffer.isBuffer(png) && png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
        if (!valido) throw new Error("la captura no devolvió un PNG");
        fs.writeFileSync(salida, png);
        informe("Imagen", `${png.readUInt32BE(16)}x${png.readUInt32BE(20)} px, ${png.length} bytes, ${Date.now() - inicio} ms`);
        informe("Guardada en", salida);
        informe("RESULTADO", "OK: este servidor genera la imagen de la tabla.");
        process.exit(0);
    } catch (err) {
        informe("RESULTADO", `FALLA: ${err?.message || err}`);
        process.exit(1);
    }

})();
