// ==========================================================================
// Calendario de loterías (migración 025) + grupos del formulario.
//   - calendario.js: festivos de Colombia y horario sugerido (puro).
//   - loterias.js: catálogo por cliente, siembra sin horarios, aislamiento.
//   - servicio de sorteos: loteria_id propio/ajeno, grupos ajenos.
//   - routes/sorteos.js: /loterias y /grupos por HTTP.
//   - SQL real de 025 en PGlite (si PGLITE_MODULE está disponible).
//
//     node backend/tests/sorteos/calendarioLoterias.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
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
process.env.SESSIONS_API_TOKEN = "token-servicio-pruebas";

const calendario = require(r("sorteos/calendario.js"));
const loterias = require(r("sorteos/loterias.js"));
const servicio = require(r("sorteos/servicio.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = "cccccccc-0000-4000-8000-00000000000c";

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: A, grupo_id: "g3@g.us", activo: false },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true },
        { usuario_id: C, grupo_id: "gc@g.us", activo: false }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", activa: true }];
    t.eventos_bot = [];
    t["5k_15k_reservas_2_cifras"] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
}

// Mañana a las 08:00 de Colombia.
function manana() {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const d = new Date(`${hoy}T13:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
}

const entrada = (extra = {}) => ({
    modalidad: "dos_cifras", nombre: "Sinuano Día", hora_fin: "22:30", valor: 5000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us", "g2@g.us"], cuentas: ["cuenta-a1"],
    publicar_en: manana().toISOString(), mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [], ...extra
});

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------ calendario ---
prueba("festivos de Colombia 2026 = calendario oficial (fijos, Emiliani y Pascua)", () => {
    assert.deepStrictEqual([...calendario.festivosColombia(2026).keys()], [
        "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08",
        "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16",
        "2026-12-08", "2026-12-25"
    ]);
    assert.strictEqual(calendario.festivoDe("2025-06-30") !== null, true, "2025: San Pedro y Sagrado Corazón caen el mismo lunes");
    assert.strictEqual(calendario.diaSemana("2026-10-18"), 7);
});

prueba("horario: sin días ni hora configurados -> no inventa hora y avisa", () => {
    const h = calendario.horarioPara({ dias: [], hora: null, horas_por_dia: {}, regla_festivo: "sin_regla" }, "2026-10-15").data;
    assert.strictEqual(h.hora, null);
    assert.ok(h.avisos.some(a => /no tiene horario/.test(a)));
    assert.ok(h.avisos.some(a => /no tiene días/.test(a)));
});

prueba("horario: hora habitual, excepción por día y día que no se juega", () => {
    const l = { dias: [1, 2, 3, 4, 5, 6, 7], hora: "14:30", horas_por_dia: { 7: "20:00" }, regla_festivo: "hora_habitual" };
    assert.strictEqual(calendario.horarioPara(l, "2026-10-15").data.hora, "14:30");          // jueves
    const dom = calendario.horarioPara(l, "2026-10-18").data;                                 // domingo
    assert.strictEqual(dom.hora, "20:00");
    assert.strictEqual(dom.origen, "dia");
    const sinDomingo = calendario.horarioPara({ ...l, dias: [1, 2, 3, 4, 5, 6], horas_por_dia: {} }, "2026-10-18").data;
    assert.strictEqual(sinDomingo.hora, null);
    assert.strictEqual(sinDomingo.juega, false);
    assert.ok(sinDomingo.avisos[0].includes("domingo"));
});

prueba("horario: domingo sin regla configurada avisa", () => {
    const h = calendario.horarioPara({ dias: [], hora: "14:30", horas_por_dia: {} }, "2026-10-18").data;
    assert.ok(h.avisos.some(a => /domingo/.test(a)));
});

prueba("horario: festivo según la regla (sin regla avisa; no se juega; habitual; especial)", () => {
    const base = { dias: [1, 2, 3, 4, 5, 6, 7], hora: "14:30", horas_por_dia: {} };
    const festivo = "2026-10-12";   // Día de la Raza (lunes)
    const sinRegla = calendario.horarioPara({ ...base, regla_festivo: "sin_regla" }, festivo).data;
    assert.strictEqual(sinRegla.festivo, "Día de la Raza");
    assert.strictEqual(sinRegla.hora, null);
    assert.strictEqual(sinRegla.hora_del_dia, "14:30");
    assert.ok(sinRegla.avisos.some(a => /no tiene una regla para festivos/.test(a)));
    assert.strictEqual(calendario.horarioPara({ ...base, regla_festivo: "no_se_juega" }, festivo).data.juega, false);
    assert.strictEqual(calendario.horarioPara({ ...base, regla_festivo: "hora_habitual" }, festivo).data.hora, "14:30");
    assert.strictEqual(calendario.horarioPara({ ...base, regla_festivo: "hora_especial", hora_festivo: "21:00" }, festivo).data.hora, "21:00");
    assert.strictEqual(calendario.horarioPara(base, "15-10-2026").ok, false);
});

// --------------------------------------------------------------- catálogo ---
prueba("catálogo: se siembra UNA vez por cliente, solo nombres, sin horarios inventados", async () => {
    escenario();
    const l1 = await loterias.listar(A);
    assert.ok(l1.ok);
    assert.strictEqual(l1.data.length, loterias.CATALOGO_INICIAL.length);
    assert.ok(l1.data.every(l => l.hora === null && l.dias.length === 0 && l.regla_festivo === "sin_regla"));
    for (const nombre of ["Antioqueñita Día", "Antioqueñita Tarde", "Dorado Noche", "Samán de la Suerte", "Pijao de Oro", "Super Astro Luna", "La Culona Noche", "Paisa Lotto", "SuperMillonaria"]) {
        assert.ok(l1.data.some(l => l.etiqueta === nombre), nombre);
    }
    const l2 = await loterias.listar(A);
    assert.strictEqual(l2.data.length, l1.data.length, "no se duplica");
    assert.strictEqual(fake.tablas.loterias_catalogo.filter(f => f.usuario_id === A).length, l1.data.length);
});

prueba("catálogo: editar horario y reglas; validaciones; nombre duplicado", async () => {
    escenario();
    const sinuano = (await loterias.listar(A)).data.find(l => l.etiqueta === "Sinuano Día");
    const e = await loterias.actualizar(A, sinuano.id, { dias: [1, 2, 3, 4, 5, 6], hora: "14:30", regla_festivo: "hora_habitual", notas: "Condición del listado" });
    assert.ok(e.ok, JSON.stringify(e));
    assert.deepStrictEqual(e.data.dias, [1, 2, 3, 4, 5, 6]);
    assert.strictEqual(e.data.hora, "14:30");
    assert.strictEqual((await loterias.actualizar(A, sinuano.id, { regla_festivo: "hora_especial" })).motivo, "validacion");
    assert.strictEqual((await loterias.actualizar(A, sinuano.id, { hora: "25:00" })).motivo, "validacion");
    assert.strictEqual((await loterias.actualizar(A, sinuano.id, { dias: [0, 8] })).motivo, "validacion");
    assert.strictEqual((await loterias.crear(A, { nombre: "Sinuano", modalidad: "Día" })).motivo, "nombre_duplicado");
    const nueva = await loterias.crear(A, { nombre: "Lotería de Prueba", categoria: "tradicional", dias: [5], hora: "22:40" });
    assert.ok(nueva.ok);
    assert.strictEqual(nueva.data.categoria, "tradicional");
    const h = await loterias.horario(A, sinuano.id, "2026-10-15");
    assert.strictEqual(h.data.hora, "14:30");
    assert.strictEqual(h.data.loteria, "Sinuano Día");
});

prueba("catálogo: aislamiento — B no ve, edita ni consulta horarios del catálogo de A", async () => {
    escenario();
    const deA = (await loterias.listar(A)).data[0];
    const deB = await loterias.listar(B);
    assert.ok(!deB.data.some(l => l.id === deA.id));
    assert.strictEqual((await loterias.actualizar(B, deA.id, { hora: "10:00" })).motivo, "no_encontrado");
    assert.strictEqual((await loterias.horario(B, deA.id, "2026-10-15")).motivo, "no_encontrado");
    assert.strictEqual((await loterias.obtener(A, deA.id)).data.hora, null, "A intacto");
});

prueba("catálogo: tabla inexistente (025 sin aplicar) -> migracion_pendiente 025", async () => {
    escenario();
    fake.control.fallarTabla = "loterias_catalogo";
    const real = fake.client.from;
    fake.client.from = (t) => {
        if (t !== "loterias_catalogo") return real(t);
        return { select: () => ({ eq: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) }) };
    };
    const r1 = await loterias.listar(A);
    fake.client.from = real;
    assert.strictEqual(r1.motivo, "migracion_pendiente");
    assert.strictEqual(r1.migracion, "025");
});

// ------------------------------------------------- sorteos con la lotería ---
prueba("sorteo: guarda loteria_id propio, varios grupos; editar conserva y no duplica", async () => {
    escenario();
    const sinuano = (await loterias.listar(A)).data.find(l => l.etiqueta === "Sinuano Día");
    const s = await servicio.crearSorteo(A, entrada({ loteria_id: sinuano.id }));
    assert.ok(s.ok, JSON.stringify(s));
    assert.strictEqual(s.data.config.loteria_id, sinuano.id);
    assert.deepStrictEqual(s.data.grupos.map(g => g.grupo_id).sort(), ["g1@g.us", "g2@g.us"]);
    const e = await servicio.editar(A, s.data.id, { ...entrada({ loteria_id: sinuano.id, hora_fin: "21:00" }), version: 1 });
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual(e.data.config.loteria_id, sinuano.id);
    assert.strictEqual(e.data.config.hora_fin, "21:00");
    assert.strictEqual(fake.tablas.sorteos_programados.length, 1);
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.filter(g => g.sorteo_id === s.data.id).length, 2);
});

prueba("sorteo: nombre personalizado sin lotería sigue funcionando", async () => {
    escenario();
    const s = await servicio.crearSorteo(A, entrada({ nombre: "Rifa especial", loteria_id: null }));
    assert.ok(s.ok);
    assert.strictEqual(s.data.config.loteria_id, null);
});

prueba("sorteo: lotería AJENA o grupo AJENO -> rechazado, nada guardado", async () => {
    escenario();
    const deB = (await loterias.listar(B)).data[0];
    const r1 = await servicio.crearSorteo(A, entrada({ loteria_id: deB.id }));
    assert.strictEqual(r1.motivo, "validacion");
    assert.ok(r1.errores.some(e => e.campo === "loteria_id"));
    const r2 = await servicio.crearSorteo(A, entrada({ grupos: ["g1@g.us", "gb@g.us"] }));
    assert.strictEqual(r2.motivo, "validacion");
    assert.ok(r2.errores.some(e => e.campo === "grupos"));
    const r3 = await servicio.crearSorteo(A, entrada({ grupos: ["g3@g.us"] }));
    assert.strictEqual(r3.motivo, "validacion", "un grupo desautorizado tampoco vale");
    assert.strictEqual((fake.tablas.sorteos_programados || []).length, 0);
});

// ---------------------------------------------------------------- grupos ---
prueba("grupos del formulario: con grupos / sin grupos / registrados pero inactivos", async () => {
    escenario();
    const a = await servicio.gruposParaFormulario(A);
    assert.deepStrictEqual(a.data.map(g => g.grupo_id).sort(), ["g1@g.us", "g2@g.us"]);
    assert.deepStrictEqual(a.meta, { registrados: 3, autorizados: 2 });
    const sinNada = await servicio.gruposParaFormulario("dddddddd-0000-4000-8000-00000000000d");
    assert.deepStrictEqual([sinNada.data.length, sinNada.meta.registrados], [0, 0]);
    const c = await servicio.gruposParaFormulario(C);
    assert.deepStrictEqual([c.data.length, c.meta.registrados, c.meta.autorizados], [0, 1, 0]);
});

// ------------------------------------------------------------------ HTTP ---
prueba("HTTP: /loterias, /loterias/:id/horario y /grupos (meta); 401 sin sesión; 404 ajeno", async () => {
    escenario();
    const app = express();
    app.use(express.json());
    delete require.cache[r("routes/sorteos.js")];
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const base = `http://127.0.0.1:${server.address().port}/sorteos`;
    const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-pruebas", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });
    try {
        assert.strictEqual((await fetch(`${base}/loterias`, { headers: h(null) })).status, 401);
        const lista = await (await fetch(`${base}/loterias`, { headers: h("jwt-A") })).json();
        assert.ok(lista.ok && lista.data.length > 0);
        const id = lista.data.find(l => l.etiqueta === "Sinuano Día").id;
        const patch = await (await fetch(`${base}/loterias/${id}`, { method: "PATCH", headers: h("jwt-A"), body: JSON.stringify({ dias: [4], hora: "14:30" }) })).json();
        assert.ok(patch.ok);
        const horario = await (await fetch(`${base}/loterias/${id}/horario?fecha=2026-10-15`, { headers: h("jwt-A") })).json();
        assert.strictEqual(horario.data.hora, "14:30");
        assert.strictEqual((await fetch(`${base}/loterias/${id}/horario?fecha=2026-10-15`, { headers: h("jwt-B") })).status, 404);
        const grupos = await (await fetch(`${base}/grupos`, { headers: h("jwt-A") })).json();
        assert.deepStrictEqual(grupos.meta, { registrados: 3, autorizados: 2 });
        assert.strictEqual((await fetch(`${base}/grupos`, { headers: h("jwt-falso") })).status, 401);
    } finally {
        server.close();
    }
});

// ------------------------------------------------------- SQL real (025) ---
prueba("migración 025 en Postgres real (PGlite): idempotente, restricciones y RLS por propietario", async () => {
    let PGlite;
    try { ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite")); } catch { console.log("   ⏭️  PGlite no disponible: parte SQL omitida"); return; }
    const sql = fs.readFileSync(r("supabase_migrations/025_calendario_loterias.sql"), "utf8");
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
            grant usage on schema public to anon, authenticated, service_role;
            alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
            create schema auth; grant usage on schema auth to anon, authenticated, service_role;
            create table auth.users (id uuid primary key);
            create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            grant execute on function auth.uid() to anon, authenticated, service_role;
            insert into auth.users values ('${A}'), ('${B}');`);
        await db.exec(sql);
        await db.exec(sql);
        await db.exec(`insert into public.loterias_catalogo (usuario_id, nombre, modalidad, dias, hora) values ('${A}', 'Sinuano', 'Día', '{1,2,3}', '14:30'), ('${B}', 'Chontico', 'Noche', '{}', null);`);
        let error = null;
        try { await db.exec(`insert into public.loterias_catalogo (usuario_id, nombre, dias) values ('${A}', 'Mala', '{8}')`); } catch (e) { error = e; }
        assert.ok(error, "día 8 rechazado");
        error = null;
        try { await db.exec(`insert into public.loterias_catalogo (usuario_id, nombre, modalidad) values ('${A}', 'Sinuano', 'Día')`); } catch (e) { error = e; }
        assert.ok(error, "duplicado rechazado");
        const como = async (rol, sub, q) => {
            await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${sub || ""}', false);`);
            try { return (await db.query(q)).rows; } finally { await db.exec("reset role;"); }
        };
        assert.deepStrictEqual((await como("authenticated", A, "select nombre from public.loterias_catalogo")).map(x => x.nombre), ["Sinuano"]);
        error = null;
        try { await como("anon", null, "select * from public.loterias_catalogo"); } catch (e) { error = e; }
        assert.ok(error && /permission denied/.test(error.message), "anon sin acceso");
        assert.strictEqual((await como("service_role", null, "select * from public.loterias_catalogo")).length, 2);
    } finally {
        await db.close();
    }
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
