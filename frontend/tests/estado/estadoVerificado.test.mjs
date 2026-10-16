// ==========================================================================
// PRUEBAS (frontend) — un fallo al consultar el backend nunca se presenta
// como un estado real:
//   - /sesiones: sin respuesta de GET /sessions/salud, la tarjeta no dice
//     «Conectada» ni «Bot activo» a partir de sesiones.estado;
//   - grupos: solo el 409 del backend significa «desconectada»; 401/503
//     (token de servicio), 5xx, 502 o un fallo de red son «sin verificar», y
//     los grupos autorizados se conservan;
//   - contactos: el cliente nunca ve textos técnicos ni contadores en 0
//     inventados.
//
// Carga los servicios TypeScript REALES del panel (mismo cargador que
// tests/mensajes/plantillasAgotado.test.mjs) y sustituye solo
// "@/lib/fetchConSesion" y "@/services/sessions/getSessions".
//
//     node frontend/tests/estado/estadoVerificado.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// ------------------------------------------------------- dobles de prueba ---

// Respuesta del proxy por URL: { status, body } (body string = no JSON) o
// "red" para simular un fallo de red.
let respuestas = {};
const pedidas = [];

async function fetchConSesion(url) {
    pedidas.push(url);
    const r = respuestas[url];
    if (r === "red" || r === undefined) throw new TypeError("fetch failed");
    return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => (typeof r.body === "string" ? JSON.parse(r.body) : r.body)
    };
}

let sesionesDb = [];
const getSessions = async () => ({ data: sesionesDb, error: null });

// ------------------------------------------------- cargador de módulos TS ---

function cargarTs(rutaAbs, cache = new Map()) {

    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;

    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);

    const requerir = (spec) => {
        if (spec === "@/lib/fetchConSesion") return { fetchConSesion };
        if (spec === "@/services/sessions/getSessions") return { getSessions };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) {
            if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        }
        return require(spec);
    };

    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;

}

const { estadoVisibleSesion } = cargarTs(path.join(FRONT, "services/sessions/estadoVisible.ts"));
const { obtenerGruposDisponibles, clasificarConsultaGrupos } = cargarTs(path.join(FRONT, "services/automatizacion/gruposDisponibles.ts"));
const { mergearGrupos } = cargarTs(path.join(FRONT, "services/automatizacion/mergeGrupos.ts"));
const { obtenerContactos, mensajeErrorContactos } = cargarTs(path.join(FRONT, "services/contactos/obtenerContactos.ts"));

// Palabras que el cliente nunca debe ver (regla del panel).
const TECNICO = /token|backend|api|proxy|http|supabase|socket|lease|migraci/i;

let pasadas = 0;
async function prueba(nombre, fn) {
    await fn();
    pasadas++;
    console.log(`  ✔ ${nombre}`);
}

const saludDe = (estado) => ({
    sessionId: "s1", estado, causas: [], accion: null, conectadoEn: null, listenerEn: null,
    ultimoMensajeRecibidoEn: null, ultimoProcesadoOkEn: null, ultimoError: null,
    erroresSeguidos: 0, recuperaciones: [], lease: null
});

console.log("Sesiones — estado visible");

await prueba("sin respuesta de salud (error): «Sin verificar», nunca «Conectada» ni «Bot activo»", () => {
    const v = estadoVisibleSesion({ salud: null, consulta: "error", estadoGuardado: "conectado", activa: true });
    assert.strictEqual(v.status.label, "Sin verificar");
    assert.notStrictEqual(v.status.kind, "online");
    assert.strictEqual(v.marcaActiva.label, "En uso · sin verificar");
    assert.notStrictEqual(v.marcaActiva.tone, "primary");
    assert.match(v.nota, /Último estado guardado: conectada/);
    assert.doesNotMatch(v.nota, TECNICO);
});

await prueba("antes de la primera respuesta: «Verificando…», sin «Bot activo»", () => {
    const v = estadoVisibleSesion({ salud: null, consulta: "pendiente", estadoGuardado: "conectado", activa: true });
    assert.strictEqual(v.status.label, "Verificando…");
    assert.strictEqual(v.marcaActiva.label, "En uso · verificando");
});

await prueba("salud ok pero sesión ausente del resultado: «Sin verificar»", () => {
    const v = estadoVisibleSesion({ salud: null, consulta: "ok", estadoGuardado: "conectado", activa: false });
    assert.strictEqual(v.status.label, "Sin verificar");
    assert.strictEqual(v.marcaActiva, null);
});

await prueba("con salud real: «Bot activo» solo si está saludable", () => {
    const sana = estadoVisibleSesion({ salud: saludDe("saludable"), consulta: "ok", estadoGuardado: "desconectado", activa: true });
    assert.strictEqual(sana.status.label, "Saludable · escuchando");
    assert.deepStrictEqual(sana.marcaActiva, { tone: "primary", label: "Bot activo" });
    assert.strictEqual(sana.nota, null);

    const degradada = estadoVisibleSesion({ salud: saludDe("degradada"), consulta: "ok", estadoGuardado: "conectado", activa: true });
    assert.deepStrictEqual(degradada.marcaActiva, { tone: "error", label: "Activa · no está procesando" });

    const caida = estadoVisibleSesion({ salud: saludDe("desconectada"), consulta: "ok", estadoGuardado: "conectado", activa: false });
    assert.strictEqual(caida.status.label, "Desconectada");
});

await prueba("QR pedido por el usuario: se sigue mostrando «QR pendiente»", () => {
    const v = estadoVisibleSesion({ salud: null, consulta: "error", estadoGuardado: "esperando_qr", activa: false });
    assert.strictEqual(v.status.label, "QR pendiente");
});

console.log("Grupos — clasificación de la consulta");

await prueba("solo 409 es «desconectada»; 401/503/500/502 son «no_verificable»", () => {
    assert.strictEqual(clasificarConsultaGrupos(200, true), "conectada");
    assert.strictEqual(clasificarConsultaGrupos(409, false), "desconectada");
    for (const s of [401, 404, 500, 502, 503]) assert.strictEqual(clasificarConsultaGrupos(s, false), "no_verificable", `HTTP ${s}`);
});

await prueba("token de servicio ausente (503), red caída y respuesta no JSON → sin verificar; 409 → desconectada; 200 → grupos reales", async () => {

    sesionesDb = [
        { id: "a", nombre: "A", telefono: null },
        { id: "b", nombre: "B", telefono: null },
        { id: "c", nombre: "C", telefono: null },
        { id: "d", nombre: "D", telefono: null },
        { id: "e", nombre: "E", telefono: null }
    ];
    const url = (id) => `/api/sessions/grupos-disponibles?id=${id}`;
    respuestas = {
        [url("a")]: { status: 503, body: { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO", error: "El backend no tiene configurado el token de servicio." } },
        [url("b")]: "red",
        [url("c")]: { status: 502, body: "<html>Bad gateway</html>" },
        [url("d")]: { status: 409, body: { success: false, error: "La sesión d no tiene un socket conectado ahora mismo." } },
        [url("e")]: { status: 200, body: { success: true, grupos: [{ id: "111@g.us", nombre: "Grupo real" }] } }
    };

    const r = Object.fromEntries((await obtenerGruposDisponibles("u1")).map(s => [s.sessionId, s]));

    for (const id of ["a", "b", "c"]) {
        assert.strictEqual(r[id].estado, "no_verificable", id);
        assert.strictEqual(r[id].conectada, false, id);
        assert.doesNotMatch(r[id].error, TECNICO, id);
    }
    assert.strictEqual(r.d.estado, "desconectada");
    assert.doesNotMatch(r.d.error, TECNICO);
    assert.strictEqual(r.e.estado, "conectada");
    assert.deepStrictEqual(r.e.grupos, [{ id: "111@g.us", nombre: "Grupo real" }]);
});

await prueba("los grupos autorizados no se pierden si no se pudo verificar", async () => {

    sesionesDb = [{ id: "a", nombre: "A", telefono: null }];
    respuestas = { "/api/sessions/grupos-disponibles?id=a": { status: 503, body: { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO" } } };

    const sesiones = await obtenerGruposDisponibles("u1");
    const autorizados = [
        { id: "g1", grupo_id: "120363000000000001@g.us", activo: true },
        { id: "g2", grupo_id: "120363000000000002@g.us", activo: false }
    ];
    const { disponibles, historicos } = mergearGrupos(sesiones, autorizados);

    assert.strictEqual(disponibles.length, 0);
    assert.deepStrictEqual(historicos.map(g => g.grupoId).sort(), autorizados.map(a => a.grupo_id).sort());
    assert.deepStrictEqual(historicos.map(g => g.autorizacion.activo), [true, false], "la autorización (activo) queda intacta");
});

console.log("Contactos — errores");

await prueba("503 por token: mensaje sencillo, sin textos técnicos", async () => {
    respuestas = { "/api/contactos?usuarioId=u1": { status: 503, body: { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO", error: "El backend no tiene configurado el token de servicio." } } };
    await assert.rejects(obtenerContactos("u1"), (e) => {
        assert.doesNotMatch(e.message, TECNICO);
        assert.match(e.message, /Siguen guardados/);
        return true;
    });
});

await prueba("respuesta no JSON (502) no rompe: mensaje sencillo", async () => {
    respuestas = { "/api/contactos?usuarioId=u1": { status: 502, body: "<html>Bad gateway</html>" } };
    await assert.rejects(obtenerContactos("u1"), (e) => !TECNICO.test(e.message));
});

await prueba("sesión del usuario caducada: pide volver a iniciar sesión", () => {
    assert.strictEqual(mensajeErrorContactos(401, "sin_sesion"), "Tu sesión expiró. Vuelve a iniciar sesión.");
    assert.doesNotMatch(mensajeErrorContactos(401, "NO_AUTORIZADO"), TECNICO);
});

await prueba("éxito: devuelve los contactos tal cual", async () => {
    respuestas = { "/api/contactos?usuarioId=u1": { status: 200, body: { success: true, contactos: [{ id: "c1" }] } } };
    const r = await obtenerContactos("u1");
    assert.deepStrictEqual(r.contactos, [{ id: "c1" }]);
});

console.log(`\n${pasadas} pruebas OK`);
