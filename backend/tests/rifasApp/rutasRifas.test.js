// ==========================================================================
// PRUEBAS — routes/rifas.js por HTTP (express real) sobre el SQL REAL
// (032 + 050), con token de servicio y sesión de usuario como en producción.
//
//   1. Sin token de servicio o sin sesión → 401; el usuario sale del token.
//   2. Motor legado: se puede preparar (crear, vincular) pero NO operar números (409).
//   3. Motor nuevo: reservar/pagar/reiniciar por tabla_id; respuestas en texto ("07").
//   4. Otro cliente: 404 en la rifa ajena (lectura y operaciones).
//   5. Reiniciar se bloquea con un sorteo vigente en un grupo de la rifa.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/rutasRifas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const GRUPO = "120363000000000001@g.us";
const SERVICIO = "token-servicio-pruebas";
const TOKENS = { "tok-a": { id: A, email: "a@prueba.test" }, "tok-b": { id: B, email: "b@prueba.test" } };

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

(async () => {
    if (!cargarPGlite()) {
        console.log("⏭️  sin PGlite (PGLITE_MODULE): prueba omitida");
        process.exit(0);
    }
    process.env.SESSIONS_API_TOKEN = SERVICIO;
    process.env.MOTOR_RIFAS = "legado";

    const base = await crearBase({ usuarios: [A, B] });
    await base.pg.exec(`
        create table public.eventos_bot (id uuid primary key, usuario_id uuid, grupo_id text, grupo_nombre text, activo boolean,
            estado text, cierre_estado text, cierre_motivo text, fecha_evento date, tabla_id uuid, creado_en timestamptz default now());
        grant select on public.eventos_bot to service_role;`);
    base.client.auth = {
        getUser: async (token) => (TOKENS[token]
            ? { data: { user: TOKENS[token] }, error: null }
            : { data: { user: null }, error: { message: "invalid JWT" } })
    };
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const express = require(path.join(RAIZ, "node_modules/express"));
    const app = express();
    app.use(express.json());
    app.use("/rifas", require(path.join(RAIZ, "routes/rifas.js")));
    const servidor = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const URL_BASE = `http://127.0.0.1:${servidor.address().port}/rifas`;

    async function pedir(metodo, camino, cuerpo, { token = "tok-a", servicio = SERVICIO } = {}) {
        const res = await fetch(URL_BASE + camino, {
            method: metodo,
            headers: { "Content-Type": "application/json", ...(servicio ? { "x-service-token": servicio } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
        });
        return { status: res.status, json: await res.json() };
    }

    try {
        // ---- 1. autenticación
        assert.strictEqual((await pedir("GET", "", undefined, { servicio: null })).status, 401);
        assert.strictEqual((await pedir("GET", "", undefined, { token: null })).status, 401);
        assert.strictEqual((await pedir("GET", "", undefined, { token: "falso" })).status, 401);
        paso("sin token de servicio, sin sesión o con sesión falsa → 401");

        // ---- 2. legado: preparar sí, operar no
        const c1 = await pedir("POST", "", { nombre: "Tarde", precio: 1500, cifras: 2, usuario_id: B });
        assert.strictEqual(c1.status, 200, JSON.stringify(c1.json));
        const T = c1.json.tabla_id;
        const lista = await pedir("GET", "");
        assert.strictEqual(lista.json.modo, "legado");
        assert.deepStrictEqual(lista.json.rifas.map(r => r.nombre), ["Tarde"]);
        assert.deepStrictEqual((await pedir("GET", "", undefined, { token: "tok-b" })).json.rifas, [], "el usuario_id del cuerpo se ignora: la rifa es de A");
        assert.strictEqual((await pedir("POST", `/${T}/grupos`, { grupo_id: GRUPO })).status, 200);
        const opLegado = await pedir("POST", `/${T}/reservar`, { numeros: ["07"], comprador: "Ana" });
        assert.strictEqual(opLegado.status, 409);
        assert.strictEqual(opLegado.json.motivo, "motor_legado");
        paso("motor legado: crear y vincular grupos sí; reservar no (409 motor_legado); el dueño sale del token");

        // ---- 3. nuevo: operar
        process.env.MOTOR_RIFAS = "nuevo";
        const c2 = await pedir("POST", "", { nombre: "Mañana", precio: 1500 });
        const M = c2.json.tabla_id;
        const r1 = await pedir("POST", `/${T}/reservar`, { numeros: ["07", "7", "abc"], comprador: "Ana", telefono: "573001110000" });
        assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
        assert.deepStrictEqual(r1.json.reservados, ["07"]);
        assert.deepStrictEqual(r1.json.invalidos, ["abc"]);
        const r2 = await pedir("POST", `/${M}/reservar`, { numeros: ["07"], comprador: "Beto" });
        assert.deepStrictEqual(r2.json.reservados, ["07"], "el 07 de otra rifa del mismo precio está libre");
        const p1 = await pedir("POST", `/${T}/pagar`, { numeros: ["07"], metodo_pago: "nequi" });
        assert.deepStrictEqual(p1.json.pagados, ["07"]);
        const det = await pedir("GET", `/${T}`);
        const n07 = det.json.numeros.find(n => n.numero === "07");
        assert.strictEqual(n07.estado, "pagado");
        assert.strictEqual(n07.nombre, "Ana");
        assert.deepStrictEqual(det.json.grupos.map(g => g.grupo_id), [GRUPO]);
        paso("motor nuevo: reservar y pagar por tabla_id; el 07 de dos rifas de $1.500 son independientes");

        // ---- 4. otro cliente
        assert.strictEqual((await pedir("GET", `/${T}`, undefined, { token: "tok-b" })).status, 404);
        assert.strictEqual((await pedir("POST", `/${T}/reservar`, { numeros: ["10"], comprador: "X" }, { token: "tok-b" })).status, 404);
        assert.strictEqual((await pedir("POST", `/${T}/reiniciar`, { confirmacion: "REINICIAR" }, { token: "tok-b" })).status, 404);
        assert.strictEqual((await pedir("GET", "/no-es-uuid")).status, 404);
        paso("otro cliente: 404 al leer, reservar o reiniciar la rifa ajena");

        // ---- 5. reiniciar con sorteo vigente en un grupo de la rifa
        await base.pg.exec(`insert into public.eventos_bot (id, usuario_id, grupo_id, grupo_nombre, activo, tabla_id)
            values ('e1000000-0000-4000-8000-000000000001', '${A}', '${GRUPO}', 'Grupo 1', true, '${T}');`);
        const bloqueado = await pedir("POST", `/${T}/reiniciar`, { confirmacion: "REINICIAR" });
        assert.strictEqual(bloqueado.status, 409);
        assert.strictEqual(bloqueado.json.motivo, "sorteo_en_curso");
        const otraRifa = await pedir("POST", `/${M}/reiniciar`, { confirmacion: "REINICIAR" });
        assert.strictEqual(otraRifa.status, 200, "la otra rifa (sin grupos con sorteo) sí se reinicia");
        assert.strictEqual(otraRifa.json.archivados, 1);
        assert.strictEqual((await pedir("GET", `/${T}`)).json.numeros.find(n => n.numero === "07").estado, "pagado", "reiniciar Mañana no tocó Tarde");
        await base.pg.exec(`update public.eventos_bot set activo = false`);
        const sinConfirmar = await pedir("POST", `/${T}/reiniciar`, { confirmacion: "si" });
        assert.strictEqual(sinConfirmar.json.motivo, "confirmacion_requerida");
        const rein = await pedir("POST", `/${T}/reiniciar`, { confirmacion: "REINICIAR" });
        assert.strictEqual(rein.status, 200);
        assert.strictEqual(rein.json.archivados, 1);
        const archivo = await pedir("GET", `/${T}/archivo`);
        assert.strictEqual(archivo.json.archivo[0].estado, "pagado");
        paso("reiniciar: bloqueado con sorteo vigente; solo la rifa elegida; el pago pasa al historial");

        console.log(`\n${ok}/${ok} correctos`);
    } finally {
        servidor.close();
    }
    process.exit(0);
})().catch((e) => {
    console.error("❌", e.stack || e.message);
    process.exit(1);
});
