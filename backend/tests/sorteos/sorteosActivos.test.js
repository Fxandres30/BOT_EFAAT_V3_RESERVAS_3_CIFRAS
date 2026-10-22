// ==========================================================================
// PRUEBAS — sorteo ACTIVO de una tabla, sea cual sea su origen (detectado
// por el bot o creado desde el panel): listar, abrir y editar por su ID.
//
// API HTTP REAL (routes/sorteos.js + exigirUsuario) y servicio REAL;
// Supabase en memoria. Son simulaciones: no tocan la base real.
//
//     node backend/tests/sorteos/sorteosActivos.test.js
// ==========================================================================

process.env.SESSIONS_API_TOKEN = "token-servicio-activos";

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};

const servicio = require(r("sorteos/servicio.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));

// Hoy: 15/10 10:00 Colombia.
const T0 = new Date("2026-10-15T15:00:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T1K = "reservas_dos_cifras";

const EV_DET_G1 = "e0000000-0000-4000-8000-000000000001";
const EV_DET_G2 = "e0000000-0000-4000-8000-000000000002";
const EV_PANEL = "e0000000-0000-4000-8000-000000000003";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";
const EV_CERRADO = "e0000000-0000-4000-8000-0000000000c1";
const SP_PANEL = "50000000-0000-4000-8000-000000000001";

const PREMIOS_DET = [{ tipo: "otro", nombre: "Premio mayor", premio: 100000 }];

function evento(id, usuario, grupo, identidad, extra = {}) {
    return {
        id, usuario_id: usuario, session_id: `ses-${usuario.slice(0, 4)}`, grupo_id: grupo, grupo_nombre: `Grupo ${grupo}`,
        activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
        nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-15",
        valor: 5000, premios: PREMIOS_DET, tabla: T5K, cifras: 2, cantidad_numeros: 100,
        creado_en: "2026-10-15T12:00:00Z", reservados: 1, pagados: 2, ...extra
    };
}

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-a2", usuario_id: A, nombre: "Daviplata A", tipo: "daviplata", numero: "3000000002", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000009", activa: true }
    ];
    t.eventos_bot = [
        // Detectado por el bot en DOS grupos (mismo sorteo, misma identidad).
        evento(EV_DET_G1, A, "g1@g.us", "det-a"),
        evento(EV_DET_G2, A, "g2@g.us", "det-a", { creado_en: "2026-10-15T11:00:00Z" }),
        // Publicado desde el panel ($1.000).
        evento(EV_PANEL, A, "g3@g.us", "pan-a", { nombre_evento: "Lotería Panel", valor: 1000, tabla: T1K, premios: [{ tipo: "otro", nombre: "Seco", premio: 50000 }] }),
        // Otro cliente, mismo grupo y mismo precio.
        evento(EV_B, B, "g1@g.us", "det-b", { nombre_evento: "Secreto de B" }),
        // Cerrado: no es editable.
        evento(EV_CERRADO, A, "g9@g.us", "viejo", { activo: false, estado: "cerrado", valor: 5000 })
    ];
    t.sorteos_programados = [{
        id: SP_PANEL, usuario_id: A, estado: "publicado", version: 1, identidad_evento_real: "pan-a", tabla: T1K, cifras: 2, cantidad_numeros: 100,
        publicar_en: "2026-10-15T13:00:00.000Z", creado_en: "2026-10-14T00:00:00Z",
        config: {
            nombre: "Lotería Panel", hora_fin: "22:30", hora_cierre: "22:26", valor: 1000, fecha_sorteo: "2026-10-15",
            premios: [{ tipo: "otro", nombre: "Seco", premio: 50000 }], cuentas: ["cuenta-a1"], grupos: ["g3@g.us"],
            diseno: { origen: "actual", diseno_id: null, nombre: null, config: null },
            mensajes: { publicacion: "Juega {{nombre}}", aviso_cierre: "" }, recordatorios: [{ minutos_antes_cierre: 30, texto: "Quedan 30" }]
        },
        cuentas_snapshot: [{ id: "cuenta-a1", nombre: "Nequi A", tipo: "nequi", titular: "A", numero: "3000000001", instrucciones: null }]
    }];
    t.sorteos_programados_grupos = [{ id: "60000000-0000-4000-8000-000000000001", sorteo_id: SP_PANEL, usuario_id: A, grupo_id: "g3@g.us", estado: "publicado", evento_bot_id: EV_PANEL }];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    // Reservas y pagos en curso del sorteo detectado de A y del de B.
    const filaA = (n) => t[T5K].find(f => f.usuario_id === A && f.numero === n);
    Object.assign(filaA("01"), { estado: "pagado", identidad_evento_real: "det-a", comprador: "Ana" });
    Object.assign(filaA("02"), { estado: "pagado", identidad_evento_real: "det-a", comprador: "Luis" });
    Object.assign(filaA("03"), { estado: "reservado", identidad_evento_real: "det-a", comprador: "Eva" });
    Object.assign(t[T5K].find(f => f.usuario_id === B && f.numero === "01"), { estado: "pagado", identidad_evento_real: "det-b" });
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-activos", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });
const get = async (camino, jwt = "jwt-A") => { const res = await fetch(base + camino, { headers: h(jwt) }); return { status: res.status, json: await res.json() }; };
const put = async (camino, cuerpo, jwt = "jwt-A") => { const res = await fetch(base + camino, { method: "PUT", headers: h(jwt), body: JSON.stringify(cuerpo) }); return { status: res.status, json: await res.json() }; };

const tablaDe = (u) => JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === u));
const ev = (id) => fake.tablas.eventos_bot.find(e => e.id === id);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. Tabla $5.000: el sorteo DETECTADO por el bot aparece como activo, con sus dos grupos y sus reservas", async () => {
    escenario();
    const r1 = await get("/activos?precio=5000");
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(r1.json.data.length, 1, "un sorteo (dos grupos), sin el de B ni el cerrado");
    const s = r1.json.data[0];
    assert.strictEqual(s.origen, "detectado");
    assert.strictEqual(s.id, EV_DET_G1, "el evento más reciente");
    assert.deepStrictEqual(s.grupos.map(g => g.grupo_id).sort(), ["g1@g.us", "g2@g.us"]);
    assert.deepStrictEqual([s.nombre, s.fecha_evento, s.hora_fin, s.hora_cierre, s.valor], ["Chontico Noche", "2026-10-15", "22:30", "22:26", 5000]);
    assert.deepStrictEqual(s.premios, PREMIOS_DET);
    assert.deepStrictEqual([s.reservados, s.pagados], [1, 2]);
    assert.strictEqual(s.cuentas, null, "los detectados no guardan cuentas (no se inventan)");
    assert.strictEqual(s.campos.nombre.editable, false);
    assert.strictEqual(s.campos.cuentas.editable, false);
    assert.ok(/no guardan cuentas/.test(s.campos.cuentas.motivo));
    assert.strictEqual(s.campos.premios.editable, true);
    assert.strictEqual(s.campos.hora_cierre.editable, true);
    assert.ok(!JSON.stringify(r1.json).includes("Secreto de B"));
});

prueba("2. Lista unificada: detectado ($5.000) y del panel ($1.000); el del panel trae cuentas, estilo y mensajes", async () => {
    escenario();
    const r1 = await get("/activos");
    assert.deepStrictEqual(r1.json.data.map(s => [s.valor, s.origen]).sort(), [[1000, "panel"], [5000, "detectado"]]);
    const panel = r1.json.data.find(s => s.origen === "panel");
    assert.strictEqual(panel.sorteo_programado_id, SP_PANEL);
    assert.deepStrictEqual(panel.cuentas_ids, ["cuenta-a1"]);
    assert.strictEqual(panel.mensajes.publicacion, "Juega {{nombre}}");
    assert.strictEqual(panel.campos.cuentas.editable, true);
    assert.deepStrictEqual((await get("/activos?precio=1000")).json.data.map(s => s.id), [EV_PANEL]);
});

prueba("3. Editar el sorteo DETECTADO de $5.000: mismo ID, todos sus grupos, sin duplicados ni tocar reservas/pagos", async () => {
    escenario();
    const antesTabla = tablaDe(A);
    const totalEventos = fake.tablas.eventos_bot.length;
    const nuevos = [{ nombre: "Premio mayor", premio: 150000 }, { nombre: "Dos últimas", premio: 20000 }];
    const r1 = await put(`/activos/${EV_DET_G1}`, { premios: nuevos, hora_cierre: "22:20", base: { premios: PREMIOS_DET, hora_cierre: "22:26" } });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(r1.json.data.id, EV_DET_G1);
    for (const id of [EV_DET_G1, EV_DET_G2]) {
        assert.strictEqual(ev(id).hora_cierre, "22:20", id);
        assert.strictEqual(ev(id).premios.length, 2, id);
        assert.strictEqual(ev(id).identidad_evento_real, "det-a", "la identidad no cambia");
        assert.strictEqual(ev(id).nombre_evento, "Chontico Noche");
        assert.strictEqual(ev(id).usuario_id, A, "el propietario no cambia");
    }
    assert.strictEqual(fake.tablas.eventos_bot.length, totalEventos, "sin eventos nuevos");
    assert.strictEqual((fake.tablas.sorteos_programados || []).length, 1, "no crea un sorteo programado");
    assert.strictEqual(tablaDe(A), antesTabla, "reservas y pagos intactos");
    assert.strictEqual(ev(EV_B).premios, PREMIOS_DET, "el de B no se toca");
});

prueba("4. Campos peligrosos (lotería, valor, fecha, grupos): rechazados con su motivo y sin cambiar nada", async () => {
    escenario();
    const antes = JSON.stringify(fake.tablas.eventos_bot);
    const b = { premios: PREMIOS_DET, hora_cierre: "22:26" };
    for (const [campo, valor] of [["nombre", "Otra lotería"], ["valor", 7000], ["fecha_evento", "2026-10-16"], ["hora_fin", "23:00"], ["grupos", ["g1@g.us"]]]) {
        const r1 = await put(`/activos/${EV_DET_G1}`, { [campo]: valor, premios: [{ nombre: "X", premio: 1 }], base: b });
        assert.strictEqual(r1.status, 400, campo);
        assert.ok(r1.json.errores.some(e => e.campo === campo && e.mensaje.length > 20), campo);
    }
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), antes);
    // Enviar el MISMO valor que ya tiene (el panel lo reenvía) no es un error.
    const igual = await put(`/activos/${EV_DET_G1}`, { nombre: "Chontico Noche", valor: 5000, premios: [{ nombre: "Nuevo", premio: 1 }], base: b });
    assert.strictEqual(igual.status, 200, JSON.stringify(igual.json));
});

prueba("5. Protecciones: cierre en el pasado o después del sorteo, sin premios, cuentas en un detectado, cambio concurrente", async () => {
    escenario();
    const b = { premios: PREMIOS_DET, hora_cierre: "22:26" };
    assert.ok((await put(`/activos/${EV_DET_G1}`, { hora_cierre: "09:00", base: b })).json.errores.some(e => /futuro/.test(e.mensaje)), "09:00 ya pasó (son las 10:00)");
    assert.ok((await put(`/activos/${EV_DET_G1}`, { hora_cierre: "22:45", base: b })).json.errores.some(e => /posterior a la hora del sorteo/.test(e.mensaje)));
    assert.ok((await put(`/activos/${EV_DET_G1}`, { premios: [], base: b })).json.errores.some(e => e.campo === "premios"));
    assert.ok((await put(`/activos/${EV_DET_G1}`, { cuentas: ["cuenta-a1"], base: b })).json.errores.some(e => e.campo === "cuentas"));
    const viejo = await put(`/activos/${EV_DET_G1}`, { hora_cierre: "22:00", base: { premios: [], hora_cierre: "21:00" } });
    assert.strictEqual(viejo.status, 409);
    assert.strictEqual(viejo.json.motivo, "version_cambiada");
    assert.strictEqual(ev(EV_DET_G1).hora_cierre, "22:26", "nada cambió");
});

prueba("6. Editar el sorteo del PANEL ya publicado: evento y configuración del sorteo, cuentas copiadas, mismo ID", async () => {
    escenario();
    const r1 = await put(`/activos/${EV_PANEL}`, {
        premios: [{ nombre: "Seco", premio: 60000 }], cuentas: ["cuenta-a1", "cuenta-a2"],
        base: { premios: [{ tipo: "otro", nombre: "Seco", premio: 50000 }], hora_cierre: "22:26" }
    });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.strictEqual(ev(EV_PANEL).premios[0].premio, 60000);
    const sp = fake.tablas.sorteos_programados.find(s => s.id === SP_PANEL);
    assert.strictEqual(fake.tablas.sorteos_programados.length, 1, "sin sorteos nuevos");
    assert.strictEqual(sp.config.premios[0].premio, 60000);
    assert.deepStrictEqual(sp.config.cuentas, ["cuenta-a1", "cuenta-a2"]);
    assert.deepStrictEqual(sp.cuentas_snapshot.map(c => c.id), ["cuenta-a1", "cuenta-a2"]);
    assert.strictEqual(sp.identidad_evento_real, "pan-a");
    assert.strictEqual(sp.version, 1, "no vuelve a borrador ni cambia de versión");
    assert.strictEqual(sp.estado, "publicado");
    const ajena = await put(`/activos/${EV_PANEL}`, { cuentas: ["cuenta-b1"], base: { premios: [{ tipo: "otro", nombre: "Seco", premio: 60000 }], hora_cierre: "22:26" } });
    assert.ok(ajena.json.errores.some(e => e.campo === "cuentas"), "una cuenta de otro cliente no vale");
});

prueba("7. Otro cliente: el evento de B no aparece ni se abre ni se edita desde A (404); y al revés", async () => {
    escenario();
    const antesB = JSON.stringify(ev(EV_B));
    assert.strictEqual((await get(`/activos/${EV_B}`)).status, 404);
    assert.strictEqual((await put(`/activos/${EV_B}`, { premios: [{ nombre: "Hack", premio: 1 }], base: { premios: PREMIOS_DET, hora_cierre: "22:26" } })).status, 404);
    assert.strictEqual(JSON.stringify(ev(EV_B)), antesB);
    assert.strictEqual((await get(`/activos/${EV_DET_G1}`, "jwt-B")).status, 404);
    const deB = await get("/activos", "jwt-B");
    assert.deepStrictEqual(deB.json.data.map(s => s.id), [EV_B]);
    assert.strictEqual(deB.json.data[0].nombre, "Secreto de B");
    // Un usuario_id en el cuerpo no cambia nada.
    const conUsuario = await put(`/activos/${EV_DET_G1}`, { usuario_id: B, usuarioId: B, premios: [{ nombre: "Mayor", premio: 5 }], base: { premios: PREMIOS_DET, hora_cierre: "22:26" } });
    assert.strictEqual(conUsuario.status, 200);
    assert.strictEqual(ev(EV_DET_G1).usuario_id, A);
});

prueba("8. Sorteo cerrado: no aparece como activo ni se edita; sin sesión -> 401", async () => {
    escenario();
    assert.ok(!(await get("/activos")).json.data.some(s => s.id === EV_CERRADO));
    const r1 = await put(`/activos/${EV_CERRADO}`, { premios: [{ nombre: "X", premio: 1 }], base: { premios: PREMIOS_DET, hora_cierre: "22:26" } });
    assert.strictEqual(r1.status, 409);
    assert.strictEqual((await get("/activos", null)).status, 401);
});

prueba("9. La detección automática sigue igual: el bot puede volver a guardar el evento editado (mismo id)", async () => {
    escenario();
    await put(`/activos/${EV_DET_G1}`, { premios: [{ nombre: "Editado", premio: 1 }], base: { premios: PREMIOS_DET, hora_cierre: "22:26" } });
    const sock = { context: { usuarioId: A, sessionId: "ses-a", telefono: "573000000000" }, groupMetadata: async () => ({ subject: "Grupo g1", participants: [] }) };
    const guardado = await guardarEvento({
        sock, grupoId: "g1@g.us",
        evento: { nombre: "Chontico Noche", hora: "22:30", horaCierre: "22:26", valor: 5000, premios: PREMIOS_DET, tabla: T5K, cifras: 2, cantidad_numeros: 100 },
        eventoAnterior: ev(EV_DET_G1),
        sorteoVigente: { identidad_evento_real: "det-a", fecha_evento: "2026-10-15" }
    });
    assert.strictEqual(guardado.id, EV_DET_G1);
    assert.strictEqual(fake.tablas.eventos_bot.filter(e => e.usuario_id === A && e.grupo_id === "g1@g.us").length, 1);
});

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    base = `http://127.0.0.1:${server.address().port}/sorteos`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const silencio = {}; for (const m of ["log", "error", "warn", "table", "dir"]) { silencio[m] = console[m]; console[m] = () => {}; }
        try { await fn(); ok++; Object.assign(console, silencio); console.log(`✅ ${n}`); }
        catch (e) { falla++; Object.assign(console, silencio); console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
