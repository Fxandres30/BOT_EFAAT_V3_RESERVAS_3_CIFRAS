// ==========================================================================
// PRUEBAS (frontend) — «Compartir tabla»: mensaje único y operaciones
// (services/tablas/compartirTabla.ts y las funciones puras de
// components/tablas/CompartirTablaModal.tsx). Sin red: fetch simulado.
//
//   - el panel NUNCA manda un texto propio: el servidor usa el mensaje
//     guardado del sorteo (el mismo de la vista previa);
//   - cada envío pide modo asíncrono (202 + operación) y el resultado abre
//     el PROGRESO real; «envío en curso» muestra el que ya existe;
//   - sin respuesta clara: «Reintentar» con la MISMA solicitud;
//   - progreso, cancelación y edición del mensaje van a sus rutas, con la
//     forma correcta.
//
//     node frontend/tests/tablas/compartirOperaciones.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const llamadas = [];
let respuesta = { status: 200, cuerpo: { ok: true } };
const fetchConSesion = async (url, init = {}) => {
    llamadas.push({ url, metodo: init.method || "GET", cuerpo: init.body ? JSON.parse(init.body) : undefined });
    const r = typeof respuesta === "function" ? respuesta(url) : respuesta;
    return { status: r.status, json: async () => r.cuerpo };
};

function cargarTs(rutaAbs, simulados = {}) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    const modulo = { exports: {} };
    const req = (m) => (m in simulados ? simulados[m] : require(m));
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, req);
    return modulo.exports;
}

const servicio = cargarTs(path.join(FRONT, "services/tablas/compartirTabla.ts"), { "@/lib/fetchConSesion": { fetchConSesion } });
// Del modal solo se usan sus funciones puras: React y la UI no se ejecutan.
const vacio = new Proxy({}, { get: () => () => null });
const modal = cargarTs(path.join(FRONT, "components/tablas/CompartirTablaModal.tsx"), {
    "@/services/tablas/compartirTabla": servicio,
    "@/components/ui": vacio,
    "lucide-react": vacio,
    "react": { useEffect: () => {}, useRef: () => ({}), useState: (v) => [v, () => {}] },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: null }
});

let total = 0;
async function prueba(nombre, fn) { llamadas.length = 0; await fn(); total++; console.log(`✅ ${nombre}`); }

const OP = (extra = {}) => ({
    id: "11111111-1111-4111-8111-111111111111", precio: 5000, estado: "en_curso", etapa: "Enviando…", terminada: false,
    cancelacion_solicitada: false, aviso: null, mensaje_error: null, mensaje: { texto: "Hola", activo: true, revision: 2, origen: "sorteo" },
    totales: { total: 2, enviados: 0, fallidos: 0, cancelados: 0, en_curso: 1, pendientes: 2, porcentaje: 0 }, grupos: [], ...extra
});
const ENVIO = { solicitudId: "11111111-1111-4111-8111-111111111111", imagen: "data:image/png;base64,AAAA", grupos: ["g1@g.us"] };

await prueba("el envío pide modo asíncrono y NO manda texto propio (el servidor usa el mensaje del sorteo)", async () => {
    respuesta = { status: 202, cuerpo: { ok: true, operacion: OP() } };
    const r = await servicio.compartirTabla(5000, ENVIO);
    assert.strictEqual(r.operacion.id, ENVIO.solicitudId);
    assert.strictEqual(llamadas[0].url, "/api/tablas/compartir");
    assert.strictEqual(llamadas[0].cuerpo.asincrono, true);
    assert.ok(!("texto" in llamadas[0].cuerpo), "sin texto alternativo");
});

await prueba("aceptado -> PROGRESO de esa operación (con reintento de la misma solicitud)", async () => {
    const p = modal.panelResultado({ ok: true, enviado: false, operacion: OP() }, ENVIO);
    assert.deepStrictEqual([p.tipo, p.operacion.id, p.reintento.solicitudId], ["progreso", ENVIO.solicitudId, ENVIO.solicitudId]);
});

await prueba("ya había otro envío en curso -> se muestra SU progreso, con aviso, sin iniciar otro", async () => {
    const otra = OP({ id: "22222222-2222-4222-8222-222222222222" });
    const p = modal.panelResultado({ ok: false, enviado: false, motivo: "envio_en_curso", operacion: otra }, ENVIO);
    assert.deepStrictEqual([p.tipo, p.operacion.id, p.reintento], ["progreso", otra.id, undefined]);
    assert.ok(/No se inició otro/.test(p.aviso));
});

await prueba("sin respuesta clara -> resultado con «Reintentar» de la MISMA solicitud; error normal sin reintento", async () => {
    const dudoso = modal.panelResultado({ ok: false, enviado: false, motivo: "sin_respuesta" }, ENVIO);
    assert.deepStrictEqual([dudoso.tipo, dudoso.reintento.solicitudId], ["resultado", ENVIO.solicitudId]);
    const error = modal.panelResultado({ ok: false, enviado: false, motivo: "sin_sesion_activa" }, ENVIO);
    assert.deepStrictEqual([error.tipo, error.reintento], ["resultado", undefined]);
    assert.strictEqual((await modal.enviarCompartir(5000, ENVIO)).motivo, undefined);
    respuesta = () => { throw new Error("red caída"); };
    assert.strictEqual((await modal.enviarCompartir(5000, ENVIO)).motivo, "sin_respuesta");
});

await prueba("progreso, operaciones de la tabla y cancelación van a sus rutas", async () => {
    respuesta = { status: 200, cuerpo: { ok: true, data: OP() } };
    await servicio.consultarOperacion(ENVIO.solicitudId);
    await servicio.operacionesDeTabla(5000);
    await servicio.cancelarOperacion(ENVIO.solicitudId);
    assert.deepStrictEqual(llamadas.map(l => [l.metodo, l.url, l.cuerpo]), [
        ["GET", `/api/tablas/compartir/operaciones?id=${ENVIO.solicitudId}`, undefined],
        ["GET", "/api/tablas/compartir/operaciones?precio=5000", undefined],
        ["POST", "/api/tablas/compartir/operaciones", { id: ENVIO.solicitudId }]
    ]);
});

await prueba("editar el mensaje cambia EL mensaje del sorteo, con la versión vista (base) para no pisar otra edición", async () => {
    respuesta = { status: 409, cuerpo: { ok: false, motivo: "version_cambiada" } };
    const r = await servicio.guardarMensajeCompartir(5000, "Hola {{nombre}}", "Antes {{nombre}}");
    assert.deepStrictEqual(llamadas[0], { url: "/api/tablas/compartir/mensaje", metodo: "PUT", cuerpo: { precio: 5000, plantilla: "Hola {{nombre}}", base_plantilla: "Antes {{nombre}}" } });
    assert.strictEqual(r.motivo, "version_cambiada");
    assert.ok(/cambió desde que abriste/.test(servicio.mensajeCompartir(r.motivo)));
    assert.ok(/No se envió nada/.test(servicio.mensajeCompartir("texto_no_disponible")));
});

console.log(`\nTOTAL: ${total} ✅`);
