#!/usr/bin/env node
// ==========================================================================
// scripts/pruebas/ejecutar.js: EJECUTOR SEGURO de las pruebas de EFAAT.
//
//   npm test                      (raíz: backend + frontend)
//   npm test --prefix backend     (solo backend)
//   npm test --prefix frontend    (solo frontend)
//   node scripts/pruebas/ejecutar.js backend frontend [filtro] [--entorno] [--lista]
//
// Garantías (nada de esto depende de que cada prueba se proteja sola):
//   1. Cada archivo corre en su propio proceso con un entorno AISLADO:
//      EFAAT_PRUEBAS=1 (lib/supabase.js bloquea el cliente real) y toda
//      variable sensible sustituida por un valor inofensivo ANTES de que
//      dotenv lea backend/.env (dotenv nunca sobrescribe una variable que ya
//      existe). Supabase y el panel apuntan a 127.0.0.1:9 (puerto inexistente).
//   2. Bloqueo de red (bloqueoRed.js, precargado con `node -r`): ninguna
//      conexión sale de la máquina. Un intento cuenta como fallo.
//   3. No corre E2E (backend/tests/e2e) ni pruebas que necesitan un entorno
//      real (Chromium + panel, Postgres en memoria) salvo con --entorno.
//
// Resultado: exit 0 solo si no hay fallos INESPERADOS. Los fallos ya
// conocidos (lista CONOCIDAS, con su motivo) se muestran aparte y no tumban
// la ejecución; si uno de ellos empieza a pasar, se avisa para quitarlo.
// ==========================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const BLOQUEO_RED = path.join(__dirname, "bloqueoRed.js");
const MARCA_RED = "[BLOQUEO RED]";
const TIEMPO_MAX_MS = 120000;

const PAQUETES = {
    backend: { dir: "backend/tests", patron: /\.test\.js$/, excluir: [/[\\/]e2e[\\/]/] },
    frontend: { dir: "frontend/tests", patron: /\.test\.mjs$/, excluir: [] }
};

// Necesitan un entorno real local: solo con --entorno.
const REQUIEREN_ENTORNO = {
    "backend/tests/sorteos/capturaRealSorteo.test.js": "abre Chromium contra el panel real (FRONTEND_URL)",
    "backend/tests/seguridad/cuadriculaClienteSqlReal.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/caracterizacion/estadoSorteosSqlReal.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifas/motorRifasSql.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifas/migracionDatosSql.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifas/reinstalarFunciones053.test.js": "necesita PGlite (PGLITE_MODULE) y git",
    "backend/tests/rifasApp/repositorioRifas.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifasApp/botRifas.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifasApp/rutasRifas.test.js": "necesita PGlite (PGLITE_MODULE)",
    "backend/tests/rifas/concurrenciaRifas.test.js": "necesita un Postgres local desechable (PG_MODULE + PG_PRUEBAS_URL)"
};

// Fallos conocidos y documentados (docs/pruebas/LINEA_BASE.md). No ocultan
// nada: se ejecutan siempre y se informan aparte.
const CONOCIDAS = {
    "backend/tests/sorteos/independenciaPorPrecio.test.js": "describe la cuadrícula por precio (opción B), que todavía no existe"
};

// Variables con efecto fuera de la máquina o en producción: siempre
// sustituidas. El resto del entorno (PATH, etc.) se conserva.
const ENTORNO_AISLADO = {
    EFAAT_PRUEBAS: "1",
    NODE_ENV: "test",
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "clave-de-pruebas",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "clave-de-pruebas",
    GEMINI_API_KEY: "",
    SESSIONS_API_TOKEN: "token-de-pruebas",
    BOT_API_TOKEN: "token-de-pruebas",
    BOT_API_URL: "http://127.0.0.1:9",
    TABLA_SHARE_SECRET: "secreto-de-pruebas",
    FRONTEND_URL: "http://127.0.0.1:9",
    INACTIVIDAD_MODO: "simulacion",
    INACTIVIDAD_CONFIRMAR_EXPULSIONES: "NO",
    BLOQUEO_EXPULSION_MODO: "desactivado",
    BLOQUEO_EXPULSION_CONFIRMAR: "NO",
    // LEASE_OWNER_ID NO se fija: lease.js lo genera por proceso (ubicación +
    // host + pid + uuid) y las pruebas de reinicio dependen de eso. Se borra
    // del entorno heredado (ver entornoParaPruebas).
    LEASE_LOCATION: "LOCAL",
    EFAAT_CONFIRMAR_PRODUCCION: "NO",
    EFAAT_CONFIRMAR_WHATSAPP: "NO"
};
const SENSIBLE = /SUPABASE|GEMINI|TOKEN|SECRET|KEY|PASSWORD|SMTP|DATABASE_URL|VERCEL/i;

function entornoParaPruebas() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!SENSIBLE.test(k)) env[k] = v;
    delete env.LEASE_OWNER_ID;
    Object.assign(env, ENTORNO_AISLADO);
    const previo = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : "";
    // NODE_OPTIONS (y no `-r` en los argumentos) para que también lo hereden
    // los procesos node que lance una prueba. Barras normales: válidas en Windows.
    env.NODE_OPTIONS = `${previo}--require="${BLOQUEO_RED.split(path.sep).join("/")}"`;
    return env;
}

function buscar(dir, patron, excluir, salida = []) {
    if (!fs.existsSync(dir)) return salida;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.name === "node_modules") continue;
        if (e.isDirectory()) buscar(p, patron, excluir, salida);
        else if (patron.test(e.name) && !excluir.some(r => r.test(p))) salida.push(p);
    }
    return salida;
}

const relativo = (p) => path.relative(RAIZ, p).split(path.sep).join("/");

function main() {
    const args = process.argv.slice(2);
    const conEntorno = args.includes("--entorno");
    const soloLista = args.includes("--lista");
    let paquetes = args.filter(a => PAQUETES[a]);
    if (!paquetes.length) paquetes = Object.keys(PAQUETES);
    const filtros = args.filter(a => !a.startsWith("--") && !PAQUETES[a]);

    const archivos = paquetes.flatMap(p => {
        const c = PAQUETES[p];
        return buscar(path.join(RAIZ, c.dir), c.patron, c.excluir).sort();
    }).map(relativo).filter(f => !filtros.length || filtros.some(t => f.includes(t)));

    const omitidas = archivos.filter(f => REQUIEREN_ENTORNO[f] && !conEntorno);
    const aEjecutar = archivos.filter(f => !omitidas.includes(f));

    if (soloLista) {
        for (const f of aEjecutar) console.log(f);
        return 0;
    }

    console.log(`EFAAT · ejecutor seguro de pruebas · ${aEjecutar.length} archivo(s) · red externa BLOQUEADA · Supabase real BLOQUEADO`);

    const env = entornoParaPruebas();
    const resultados = [];
    const inicio = Date.now();

    for (const f of aEjecutar) {
        const t0 = Date.now();
        const r = spawnSync(process.execPath, [f], { cwd: RAIZ, env, encoding: "utf8", timeout: TIEMPO_MAX_MS, maxBuffer: 64 * 1024 * 1024 });
        const salida = `${r.stdout || ""}${r.stderr || ""}`;
        const red = salida.split("\n").filter(l => l.includes(MARCA_RED));
        const tiempoAgotado = r.error && r.error.code === "ETIMEDOUT";
        const ok = r.status === 0 && !red.length && !tiempoAgotado;
        resultados.push({ f, ok, ms: Date.now() - t0, red, salida, codigo: r.status, tiempoAgotado });
        const marca = ok ? "✅" : CONOCIDAS[f] ? "⚠️" : "❌";
        console.log(`${marca} ${f} (${((Date.now() - t0) / 1000).toFixed(1)} s)${red.length ? ` · ${red.length} intento(s) de red bloqueado(s)` : ""}${tiempoAgotado ? " · TIEMPO AGOTADO" : ""}`);
    }

    const inesperados = resultados.filter(r => !r.ok && !CONOCIDAS[r.f]);
    const conocidosFallando = resultados.filter(r => !r.ok && CONOCIDAS[r.f]);
    const conocidosPasando = resultados.filter(r => r.ok && CONOCIDAS[r.f]);

    for (const r of inesperados) {
        console.log(`\n────── ❌ ${r.f} (código ${r.codigo}${r.tiempoAgotado ? ", tiempo agotado" : ""})`);
        for (const l of r.red) console.log(l);
        console.log(r.salida.trim().split("\n").slice(-30).join("\n"));
    }

    console.log("\n════════════════════════════════════════");
    console.log(`Archivos: ${resultados.length} · ✅ ${resultados.filter(r => r.ok).length} · ❌ inesperados ${inesperados.length} · ⚠️ conocidos ${conocidosFallando.length} · ⏭️ requieren entorno ${omitidas.length} · ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
    for (const r of conocidosFallando) console.log(`⚠️ conocido: ${r.f} — ${CONOCIDAS[r.f]}`);
    for (const r of conocidosPasando) console.log(`ℹ️ ${r.f} ya PASA: quítalo de CONOCIDAS en scripts/pruebas/ejecutar.js`);
    for (const f of omitidas) console.log(`⏭️ ${f} — ${REQUIEREN_ENTORNO[f]} (usa --entorno)`);
    console.log("════════════════════════════════════════");

    return inesperados.length ? 1 : 0;
}

process.exitCode = main();
