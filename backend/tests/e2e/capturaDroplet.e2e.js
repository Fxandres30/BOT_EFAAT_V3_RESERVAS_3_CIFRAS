// ==========================================================================
// PRUEBA — diagnostico/capturaDroplet.js (lo que se ejecutará en el Droplet)
// contra un panel Next REAL con Chromium real, en el entorno aislado de las
// E2E (Supabase falso; nada real). Se ejecuta el script como PROCESO APARTE,
// igual que en el servidor, y se comprueba:
//   1. FRONTEND_URL correcto  → genera el PNG de la tabla (código 0).
//   2. FRONTEND_URL sin panel → falla y nombra el host abierto (código 1).
//   3. Sin FRONTEND_URL       → lo dice (código 1).
//   4. El script no puede tocar Supabase ni WhatsApp (los bloquea).
//
//     node backend/tests/e2e/capturaDroplet.e2e.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { PANEL, arrancarEntorno, crearPasos } = require("./entornoPanel");

const SCRIPT = path.resolve(__dirname, "../../diagnostico/capturaDroplet.js");
const { paso, terminar } = crearPasos();

function ejecutar(env) {
    const salida = path.join(os.tmpdir(), `efaat-diag-${process.pid}-${Date.now()}.png`);
    const r = spawnSync(process.execPath, [SCRIPT, "--precio", "3000", "--salida", salida], {
        encoding: "utf8",
        // Sin .env real en juego: SUPABASE_URL inalcanzable por si acaso.
        env: { ...process.env, SUPABASE_URL: "http://127.0.0.1:9", ...env },
        timeout: 180000
    });
    return { ...r, salida, texto: `${r.stdout}\n${r.stderr}` };
}

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const ok = ejecutar({ FRONTEND_URL: PANEL });
        assert.strictEqual(ok.status, 0, ok.texto);
        assert.ok(/RESULTADO\s+OK/.test(ok.texto), ok.texto);
        const png = fs.readFileSync(ok.salida);
        assert.ok(png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "PNG válido");
        const [ancho, alto] = [png.readUInt32BE(16), png.readUInt32BE(20)];
        assert.ok(ancho >= 600 && alto >= 600, `${ancho}x${alto}`);
        if (process.env.E2E_CAPTURAS) fs.copyFileSync(ok.salida, path.join(process.env.E2E_CAPTURAS, "diagnostico_droplet.png"));
        fs.rmSync(ok.salida, { force: true });
        paso(`FRONTEND_URL correcto: el diagnóstico genera la imagen real de la tabla (${ancho}x${alto} px) con Chromium`);

        const mal = ejecutar({ FRONTEND_URL: "http://127.0.0.1:3999" });
        assert.strictEqual(mal.status, 1, mal.texto);
        assert.ok(/FALLA/.test(mal.texto) && /127\.0\.0\.1:3999/.test(mal.texto) && /FRONTEND_URL/.test(mal.texto), mal.texto);
        paso("FRONTEND_URL sin panel: falla con código 1 y nombra el host abierto");

        const sin = ejecutar({ FRONTEND_URL: "" });
        assert.strictEqual(sin.status, 1, sin.texto);
        assert.ok(/FALTA FRONTEND_URL/.test(sin.texto), sin.texto);
        paso("Sin FRONTEND_URL: lo dice y termina con código 1");

        const fuente = fs.readFileSync(SCRIPT, "utf8");
        assert.ok(/lib\/supabase\.js", "Supabase"/.test(fuente) && /services\/baileys\/send\.js", "WhatsApp"/.test(fuente), "bloquea Supabase y WhatsApp");
        paso("El diagnóstico bloquea Supabase y WhatsApp antes de cargar nada");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
