// ==========================================================================
// PRUEBAS — aislamiento entre clientes en las rutas del backend que usa el
// panel: /sessions/*, /contactos, /bloqueados, /tablas/compartir.
//
// Antes: /sessions/* no exigía nada (cualquiera que llegara al puerto podía
// desconectar o activar la sesión de otro cliente) y /contactos,
// /bloqueados y /tablas/compartir confiaban en el usuarioId que mandaba el
// navegador. Ahora el usuario sale del token de Supabase y cada sesión de
// WhatsApp solo la maneja su dueño.
//
// Servidor HTTP real (express) con las rutas reales; Supabase, controladores
// y repositorios son dobles en memoria que registran quién los llamó.
//
//     node backend/tests/seguridad/rutasMultiusuario.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const tokenServicio = require("../../middleware/tokenServicio");
const path = require("path");
const http = require("http");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const ruta = r => path.join(RAIZ, r);

function inyectar(rutaRel, exportsObj) {
    const abs = ruta(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SES_A = "11111111-0000-4000-8000-000000000001";
const SES_B = "22222222-0000-4000-8000-000000000002";
const CONTACTO_A = "c0000000-0000-4000-8000-00000000000a";
const CONTACTO_B = "c0000000-0000-4000-8000-00000000000b";

const fake = crearFake();
fake.tokens["jwt-A"] = A;
fake.tokens["jwt-B"] = B;
fake.tablas.sesiones = [
    { id: SES_A, usuario_id: A, nombre: "bot A", estado: "conectado", activa: true },
    { id: SES_B, usuario_id: B, nombre: "bot B", estado: "desconectado", activa: false }
];
fake.tablas.sesiones_lease = [];
fake.tablas.contactos_tenant = [
    { usuario_id: A, usuario_global_id: CONTACTO_A },
    { usuario_id: B, usuario_global_id: CONTACTO_B }
];
fake.tablas.eventos_bot = [
    { id: "ev-a", tabla: "t_prueba", usuario_id: A, activo: true, creado_en: "2026-10-14T10:00:00Z" },
    { id: "ev-b", tabla: "t_prueba", usuario_id: B, activo: true, creado_en: "2026-10-14T10:00:00Z" }
];

inyectar("lib/supabase.js", fake.client);

// Registro de llamadas a la lógica real (controladores / repositorios).
const llamadas = [];
const anotar = (nombre, extra = {}) => llamadas.push({ nombre, ...extra });
const ultima = nombre => [...llamadas].reverse().find(l => l.nombre === nombre);

const sockActivo = { context: { sessionId: SES_A }, updateBlockStatus: async (jid, accion) => anotar("bloqueoNativo", { accion }) };
const managerFalso = {
    getActiveSession: () => SES_A,
    getActiveSocket: () => sockActivo,
    has: id => id === SES_A,
    get: id => (id === SES_A ? sockActivo : null)
};
inyectar("services/baileys/manager.js", managerFalso);

const controlador = nombre => (req, res) => { anotar(nombre, { usuarioId: req.usuarioId, sessionId: req.body?.sessionId || req.params?.id }); res.json({ success: true, nombre }); };
inyectar("bot/controllers/sessionsController.js", {
    connect: controlador("connect"),
    disconnect: controlador("disconnect"),
    status: controlador("status"),
    setActive: controlador("setActive"),
    getActive: controlador("getActive"),
    setPreferred: controlador("setPreferred"),
    escanerIdentidadesDryRun: controlador("escaner"),
    diagnosticoTelefonosLid: controlador("diagnostico"),
    backfillContactos: controlador("backfill"),
    estadoBackfillContactos: controlador("estadoBackfill"),
    gruposDisponibles: controlador("gruposDisponibles")
});
inyectar("bot/controllers/sessionsAdminController.js", {
    listar: controlador("admin.listar"), crear: controlador("admin.crear"), qr: controlador("admin.qr"),
    reconectar: controlador("admin.reconectar"), obtener: controlador("admin.obtener"),
    renombrar: controlador("admin.renombrar"), eliminar: controlador("admin.eliminar")
});

inyectar("bot/funciones/usuarios/listarContactos.js", { listarContactos: async ({ usuarioId }) => { anotar("listarContactos", { usuarioId }); return { contactos: [] }; } });
inyectar("bot/funciones/usuarios/obtenerPerfilContacto.js", { obtenerPerfilContacto: async ({ usuarioId, contactoId }) => { anotar("perfil", { usuarioId, contactoId }); return null; } });
inyectar("bot/funciones/usuarios/agregarTelefonoContacto.js", { agregarTelefonoContacto: async ({ contactoId }) => { anotar("agregarTelefono", { contactoId }); return { ok: true }; } });

inyectar("bot/funciones/bloqueo/bloqueadosRepo.js", {
    listarBloqueados: async usuarioId => { anotar("listarBloqueados", { usuarioId }); return { ok: true, bloqueados: [] }; },
    obtenerBloqueoDeContacto: async usuarioId => { anotar("bloqueoContacto", { usuarioId }); return { ok: true, bloqueado: null }; },
    crearBloqueo: async ({ usuarioId }) => { anotar("crearBloqueo", { usuarioId }); return { ok: true, bloqueado: { telefono: "3000000000" } }; },
    desbloquear: async (id, usuarioId) => { anotar("desbloquear", { usuarioId }); return { ok: true, bloqueado: { telefono: "3000000000" } }; }
});

inyectar("bot/funciones/eventos/configEvento.js", { obtenerConfiguracion: () => ({ tabla: "t_prueba", cifras: 2, cantidad: 100 }) });
inyectar("automation/repo/tablaEvento.js", { obtenerNumeros: async () => ({}) });
inyectar("services/compartirTabla.js", { compartirTabla: async ({ evento }) => { anotar("compartirTabla", { eventoId: evento.id }); return { enviado: true }; }, verificarTokenImprimir: () => false });

const express = require("express");
const app = express();
app.use(express.json());
app.use("/sessions", require("../../routes/sessions"));
app.use("/contactos", require("../../routes/contactos"));
app.use("/bloqueados", require("../../routes/bloqueados"));
app.use("/tablas", require("../../routes/tablas"));
app.use("/sorteos", require("../../routes/sorteos"));

let base;

function pedir(metodo, camino, { jwt, servicio = true, cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { "Content-Type": "application/json" };
        if (servicio) headers["x-service-token"] = process.env.SESSIONS_API_TOKEN;
        if (jwt) headers.Authorization = `Bearer ${jwt}`;
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let datos = "";
            res.on("data", c => { datos += c; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(datos); } catch { /* texto */ }
                resolve({ status: res.status || res.statusCode, json });
            });
        });
        req.on("error", reject);
        if (cuerpo !== undefined) req.write(JSON.stringify(cuerpo));
        req.end();
    });
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ── /sessions ────────────────────────────────────────────────────────────

prueba("sin token de servicio -> 401 y no se ejecuta nada", async () => {
    const n = llamadas.length;
    const r = await pedir("POST", "/sessions/disconnect", { jwt: "jwt-A", servicio: false, cuerpo: { sessionId: SES_A } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(llamadas.length, n);
});

prueba("sin sesión de usuario (solo token de servicio) -> 401 en rutas del panel", async () => {
    const r = await pedir("POST", "/sessions/disconnect", { cuerpo: { sessionId: SES_A } });
    assert.strictEqual(r.status, 401);
    assert.ok(!ultima("disconnect"));
});

prueba("token de usuario inválido -> 401", async () => {
    const r = await pedir("POST", "/sessions/connect", { jwt: "jwt-falso", cuerpo: { sessionId: SES_A } });
    assert.strictEqual(r.status, 401);
});

prueba("B NO puede desconectar, activar, conectar ni marcar preferida la sesión de A (404, sin ejecutar)", async () => {
    for (const camino of ["/sessions/disconnect", "/sessions/active", "/sessions/connect", "/sessions/preferred"]) {
        const n = llamadas.length;
        const r = await pedir("POST", camino, { jwt: "jwt-B", cuerpo: { sessionId: SES_A } });
        assert.strictEqual(r.status, 404, camino);
        assert.strictEqual(llamadas.length, n, `${camino} no debe ejecutarse`);
    }
});

prueba("A sí puede manejar SU sesión", async () => {
    const r = await pedir("POST", "/sessions/disconnect", { jwt: "jwt-A", cuerpo: { sessionId: SES_A } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(ultima("disconnect").usuarioId, A);
});

prueba("status y grupos-disponibles de una sesión ajena -> 404", async () => {
    assert.strictEqual((await pedir("GET", `/sessions/status/${SES_A}`, { jwt: "jwt-B" })).status, 404);
    assert.strictEqual((await pedir("GET", `/sessions/${SES_A}/grupos-disponibles`, { jwt: "jwt-B" })).status, 404);
    assert.strictEqual((await pedir("GET", `/sessions/${SES_A}/grupos-disponibles`, { jwt: "jwt-A" })).status, 200);
});

prueba("GET /sessions/active: la sesión activa es de A -> B recibe null (nunca la fila ajena)", async () => {
    const n = llamadas.length;
    const r = await pedir("GET", "/sessions/active", { jwt: "jwt-B" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json, null);
    assert.strictEqual(llamadas.length, n);
});

prueba("/sessions/active/* (backfill, escáner) solo para el dueño de la sesión activa", async () => {
    assert.strictEqual((await pedir("POST", "/sessions/active/backfill-contactos", { jwt: "jwt-B" })).status, 404);
    assert.strictEqual((await pedir("POST", "/sessions/active/backfill-contactos", { jwt: "jwt-A" })).status, 200);
    assert.strictEqual((await pedir("GET", "/sessions/active/escaner-identidades", { jwt: "jwt-B" })).status, 404);
});

prueba("eliminar sesión desde el panel: B NO puede eliminar la de A (404, sin ejecutar)", async () => {
    const n = llamadas.length;
    const r = await pedir("DELETE", `/sessions/propias/${SES_A}`, { jwt: "jwt-B" });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(llamadas.length, n);
});

prueba("eliminar sesión desde el panel: sin sesión de usuario -> 401; sin token de servicio -> 401", async () => {
    const n = llamadas.length;
    assert.strictEqual((await pedir("DELETE", `/sessions/propias/${SES_A}`, {})).status, 401);
    assert.strictEqual((await pedir("DELETE", `/sessions/propias/${SES_A}`, { jwt: "jwt-A", servicio: false })).status, 401);
    assert.strictEqual(llamadas.length, n);
});

prueba("eliminar sesión desde el panel: A elimina SU sesión con el usuario de su token (aunque mande otro usuarioId)", async () => {
    const r = await pedir("DELETE", `/sessions/propias/${SES_A}?usuarioId=${B}`, { jwt: "jwt-A" });
    assert.strictEqual(r.status, 200);
    const l = ultima("admin.eliminar");
    assert.strictEqual(l.usuarioId, A);
    assert.strictEqual(l.sessionId, SES_A);
});

prueba("rutas de administración (BANN): solo token de servicio; sin él -> 401", async () => {
    assert.strictEqual((await pedir("GET", "/sessions/", { servicio: false })).status, 401);
    assert.strictEqual((await pedir("DELETE", `/sessions/${SES_A}`, { servicio: false })).status, 401);
    assert.strictEqual((await pedir("GET", "/sessions/", {})).status, 200);
});

prueba("SESSIONS_API_TOKEN ausente en el backend pero BOT_API_TOKEN en el panel del MISMO servidor: se usa ese; otro token -> 401; nunca abierto", async () => {
    const token = process.env.SESSIONS_API_TOKEN;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-con-token-"));
    fs.writeFileSync(path.join(dir, ".env.local"), "NEXT_PUBLIC_X=1\nBOT_API_TOKEN=token-del-panel\n");
    tokenServicio._configurarPrueba({ dir });
    delete process.env.SESSIONS_API_TOKEN;
    try {
        const salud = (tokenServicioEnviado) => new Promise((resolve, reject) => {
            const req = http.request(base + "/sessions/salud", { method: "GET", headers: { "x-service-token": tokenServicioEnviado, Authorization: "Bearer jwt-A" } }, res => {
                res.resume(); res.on("end", () => resolve(res.statusCode));
            });
            req.on("error", reject); req.end();
        });
        assert.strictEqual(await salud("token-del-panel"), 200, "el panel funciona sin configurar nada más");
        assert.strictEqual(await salud("otro-token"), 401, "otro token -> 401");
        assert.strictEqual((await pedir("GET", "/sessions/salud", { jwt: "jwt-A", servicio: false })).status, 401, "sin token -> 401");
        assert.strictEqual((await pedir("GET", "/sessions/salud", { servicio: false })).status, 401, "sin token ni usuario -> 401");
    } finally {
        process.env.SESSIONS_API_TOKEN = token;
        tokenServicio._configurarPrueba();
    }
});

// Producción 2026-10-14: backend desplegado SIN SESSIONS_API_TOKEN.
prueba("SIN token en ningún lado (backend ni panel): 503 en /sessions/salud, /active, /connect y /sorteos/loterias, sin ejecutar nada; con él, vuelven a funcionar", async () => {
    const token = process.env.SESSIONS_API_TOKEN;
    const n = llamadas.length;
    const vacio = fs.mkdtempSync(path.join(os.tmpdir(), "panel-sin-token-"));
    tokenServicio._configurarPrueba({ dir: vacio });
    delete process.env.SESSIONS_API_TOKEN;
    try {
        const pedidos = [
            ["GET", "/sessions/salud"], ["GET", "/sessions/active"], ["POST", "/sessions/connect", { sessionId: SES_A }],
            ["POST", "/sessions/active", { sessionId: SES_A }], ["GET", "/sorteos/loterias"], ["GET", "/sorteos/grupos"], ["GET", "/sessions/"]
        ];
        for (const [metodo, camino, cuerpo] of pedidos) {
            const r = await pedir(metodo, camino, { jwt: "jwt-A", servicio: false, cuerpo });
            assert.strictEqual(r.status, 503, `${metodo} ${camino}`);
            assert.strictEqual(r.json.code, "TOKEN_SERVICIO_NO_CONFIGURADO");
        }
        assert.strictEqual(llamadas.length, n, "falla cerrado: no se ejecutó nada");
    } finally {
        process.env.SESSIONS_API_TOKEN = token;
        tokenServicio._configurarPrueba();
    }
    assert.strictEqual((await pedir("GET", "/sessions/salud", { jwt: "jwt-A" })).status, 200);
    assert.strictEqual((await pedir("GET", "/sessions/active", { jwt: "jwt-A" })).status, 200);
    assert.strictEqual((await pedir("POST", "/sessions/active", { jwt: "jwt-A", cuerpo: { sessionId: SES_A } })).status, 200, "seleccionar sesión propia");
    assert.strictEqual((await pedir("POST", "/sessions/connect", { jwt: "jwt-A", cuerpo: { sessionId: SES_A } })).status, 200, "conectar sesión propia");
    const lot = await pedir("GET", "/sorteos/loterias", { jwt: "jwt-A" });
    assert.ok(lot.status !== 503 && lot.status !== 401, `/sorteos/loterias pasa la autenticación (${lot.status})`);
    assert.strictEqual((await pedir("GET", "/sorteos/loterias", { servicio: false, jwt: "jwt-A" })).status, 401, "sin el token del panel sigue cerrado");
});

prueba("GET /sessions/salud devuelve SOLO las sesiones del usuario, sin datos internos del lease", async () => {
    const rA = await pedir("GET", "/sessions/salud", { jwt: "jwt-A" });
    assert.strictEqual(rA.status, 200);
    assert.deepStrictEqual(rA.json.sesiones.map(s => s.sessionId), [SES_A]);
    const rB = await pedir("GET", "/sessions/salud", { jwt: "jwt-B" });
    assert.deepStrictEqual(rB.json.sesiones.map(s => s.sessionId), [SES_B]);
    assert.strictEqual(rB.json.sesiones[0].estado, "desconectada");
    assert.ok(!JSON.stringify(rA.json).includes("owner_id"));
    assert.strictEqual((await pedir("GET", "/sessions/salud", {})).status, 401);
});

// ── /contactos ───────────────────────────────────────────────────────────

prueba("/contactos usa el usuario del TOKEN e ignora el usuarioId del navegador", async () => {
    const r = await pedir("GET", `/contactos?usuarioId=${A}`, { jwt: "jwt-B" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(ultima("listarContactos").usuarioId, B);
    await pedir("GET", `/contactos/${CONTACTO_A}?usuarioId=${A}`, { jwt: "jwt-B" });
    assert.strictEqual(ultima("perfil").usuarioId, B);
    assert.strictEqual((await pedir("GET", "/contactos", {})).status, 401);
});

prueba("POST /contactos/:id/telefono: contacto de otro cliente -> 404 sin escribir", async () => {
    const n = llamadas.filter(l => l.nombre === "agregarTelefono").length;
    const r = await pedir("POST", `/contactos/${CONTACTO_A}/telefono`, { jwt: "jwt-B", cuerpo: { telefono: "3001234567" } });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(llamadas.filter(l => l.nombre === "agregarTelefono").length, n);
    const ok = await pedir("POST", `/contactos/${CONTACTO_A}/telefono`, { jwt: "jwt-A", cuerpo: { telefono: "3001234567" } });
    assert.strictEqual(ok.status, 200);
});

// ── /bloqueados ──────────────────────────────────────────────────────────

prueba("/bloqueados: lista, consulta, bloqueo y desbloqueo con el usuario del token", async () => {
    await pedir("GET", `/bloqueados?usuarioId=${A}`, { jwt: "jwt-B" });
    assert.strictEqual(ultima("listarBloqueados").usuarioId, B);
    await pedir("GET", `/bloqueados/contacto?usuarioId=${A}&telefono=300`, { jwt: "jwt-B" });
    assert.strictEqual(ultima("bloqueoContacto").usuarioId, B);
    await pedir("POST", "/bloqueados", { jwt: "jwt-B", cuerpo: { usuarioId: A, telefono: "3000000000" } });
    assert.strictEqual(ultima("crearBloqueo").usuarioId, B);
    await pedir("POST", "/bloqueados/x/desbloquear", { jwt: "jwt-B", cuerpo: { usuarioId: A } });
    assert.strictEqual(ultima("desbloquear").usuarioId, B);
});

prueba("bloqueo nativo de WhatsApp: solo con la sesión activa del MISMO cliente", async () => {
    const antes = llamadas.filter(l => l.nombre === "bloqueoNativo").length;
    await pedir("POST", "/bloqueados", { jwt: "jwt-B", cuerpo: { telefono: "3000000000" } });
    assert.strictEqual(llamadas.filter(l => l.nombre === "bloqueoNativo").length, antes, "B no bloquea con el WhatsApp de A");
    await pedir("POST", "/bloqueados", { jwt: "jwt-A", cuerpo: { telefono: "3000000000" } });
    assert.strictEqual(llamadas.filter(l => l.nombre === "bloqueoNativo").length, antes + 1);
});

// ── /tablas/compartir ────────────────────────────────────────────────────

prueba("/tablas/compartir comparte el evento del usuario del token, no el del usuarioId enviado", async () => {
    const r = await pedir("POST", "/tablas/compartir", { jwt: "jwt-B", cuerpo: { precio: 5000, usuarioId: A } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(ultima("compartirTabla").eventoId, "ev-b");
    assert.strictEqual((await pedir("POST", "/tablas/compartir", { cuerpo: { precio: 5000, usuarioId: A } })).status, 401);
});

(async () => {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    const err = console.error; const log = console.log;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        console.error = () => {}; console.log = () => {};
        try { await fn(); console.error = err; console.log = log; ok++; console.log(`✅ ${n}`); }
        catch (e) { console.error = err; console.log = log; falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
