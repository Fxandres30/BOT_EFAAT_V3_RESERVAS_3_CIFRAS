// ==========================================================================
// PRUEBAS SQL — migración 027 (tablas_cliente + inicializar_tablas_cliente)
// en Postgres real en memoria (PGlite), sobre la Parte A REAL.
//
//   - Sin la Parte A, la 027 aborta y no crea nada.
//   - Cuenta PRINCIPAL (ya tiene sus 2 cuadrículas completas, con reservas y
//     pagos): su cuadrícula queda idéntica, fila por fila y campo por campo.
//   - Clientes A y B: 8 configuraciones propias (los precios base de
//     configEvento.js) y su cuadrícula 00-99 en cada tabla física.
//   - Repetir la inicialización no duplica nada.
//   - A no lee ni modifica las configuraciones ni las cuadrículas de B ni de
//     la principal (y al revés). Borrar una configuración no borra reservas.
//   - Solo service_role puede inicializar.
//   - Cuadrícula incompleta, restricción única sobre numero y Parte A
//     revertida: no se toca nada.
//
// No toca Supabase. Necesita PGlite (ver docs/activacion/ACTIVACION.md):
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/migracion027.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  PGlite no disponible — prueba SQL omitida (ver cabecera).");
    process.exit(0);
}

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = f => fs.readFileSync(path.join(RAIZ, f), "utf8");

const PARTE_A = leer("docs/activacion/propuesta_rls_tablas_antiguas.sql");
const M027 = leer("backend/supabase_migrations/027_tablas_cliente.sql");
const M033 = leer("backend/supabase_migrations/033_cuadricula_por_cliente.sql");
const { configuracionesBase } = require(path.join(RAIZ, "backend/bot/funciones/eventos/configEvento.js"));

const PRINCIPAL = "aaaaaaaa-0000-4000-8000-00000000000a";
const A = "a1a1a1a1-0000-4000-8000-0000000000a1";
const B = "b2b2b2b2-0000-4000-8000-0000000000b2";
const T5K = '"5k_15k_reservas_2_cifras"';
const BASE = JSON.stringify(configuracionesBase());

const COLUMNAS_RESERVA = `
    id serial primary key, numero text, estado text, usuario_id uuid,
    comprador text, contacto text, contacto_lower text, nombre text, telefono text, lib text,
    grupo_id text, grupo_nombre text, evento_id text, nombre_evento text,
    fecha_reserva text, hora_reserva text, fecha_pago text, hora_pago text,
    temporal_por text, bloqueado_hasta timestamptz, usuario_global_id uuid,
    telefono_bot text, ip_reserva text, identidad_evento_real text`;

// Cuadrícula de la principal: 00-99 con reservas y pagos reales de ejemplo.
const CUADRICULA_PRINCIPAL = (tabla) => `
    insert into public.${tabla} (numero, estado, usuario_id, comprador, contacto, identidad_evento_real)
    select lpad(g::text, 2, '0'),
           case when g % 7 = 0 then 'pagado' when g % 5 = 0 then 'reservado' else 'libre' end,
           '${PRINCIPAL}',
           case when g % 5 = 0 or g % 7 = 0 then 'Cliente ' || g end,
           case when g % 5 = 0 or g % 7 = 0 then '300000' || lpad(g::text, 4, '0') end,
           case when g % 5 = 0 or g % 7 = 0 then 'sorteo-principal' end
    from generate_series(0, 99) as g;`;

const ENTORNO = ({ unicoPorNumero = false } = {}) => `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    insert into auth.users (id) values ('${PRINCIPAL}'), ('${A}'), ('${B}');

    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, tabla text, activo boolean);
    create table public.sesiones (
        id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text,
        estado text default 'desconectado', activa boolean default false, principal boolean default false,
        preferida boolean default false, qr text, telefono text);
    create table public.reservas_dos_cifras (${COLUMNAS_RESERVA});
    create table public.${T5K} (${COLUMNAS_RESERVA});
    ${unicoPorNumero ? `alter table public.${T5K} add constraint numero_unico unique (numero);` : ""}
    insert into public.eventos_bot (usuario_id, grupo_id, tabla, activo) values ('${PRINCIPAL}', 'g@g.us', '5k_15k_reservas_2_cifras', true);
    ${CUADRICULA_PRINCIPAL("reservas_dos_cifras")}
    ${CUADRICULA_PRINCIPAL(T5K)}
`;

const abiertas = [];

async function crearDb({ parteA = true, m027 = true, unicoPorNumero = false } = {}) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO({ unicoPorNumero }));
    if (parteA) await db.exec(PARTE_A);
    if (m027) await db.exec(M027);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const inicializar = (db, usuario, rol = "service_role") =>
    como(db, rol, null, `select public.inicializar_tablas_cliente('${usuario}', '${BASE}'::jsonb) as r`).then(f => f[0].r);

// Instantánea completa (todas las columnas) de las filas de un cliente.
async function cuadricula(db, usuario) {
    const r = {};
    for (const t of ["reservas_dos_cifras", T5K]) {
        r[t] = (await db.query(`select * from public.${t} where usuario_id = '${usuario}' order by numero, id`)).rows;
    }
    return JSON.stringify(r);
}

const configs = async (db, usuario) =>
    (await db.query(`select precio, tabla_fisica, cifras, cantidad, activa from public.tablas_cliente where usuario_id = '${usuario}' order by precio`)).rows;

const contar = async (db, sql) => Number((await db.query(sql)).rows[0].n);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("los precios base salen del código: los 8 de configEvento.js, en sus 2 tablas físicas", () => {
    const base = configuracionesBase();
    assert.deepStrictEqual(base.map(c => c.precio), [1000, 1500, 2000, 3000, 5000, 7000, 10000, 15000]);
    assert.deepStrictEqual([...new Set(base.map(c => c.tabla))].sort(), ["5k_15k_reservas_2_cifras", "reservas_dos_cifras"]);
    assert.ok(base.every(c => c.cifras === 2 && c.cantidad === 100));
});

prueba("027 SIN la Parte A: aborta y no crea nada", async () => {
    const db = await crearDb({ parteA: false, m027: false });
    await assert.rejects(db.exec(M027), /Parte A/);
    await db.exec("rollback");   // lo que hace el SQL Editor al fallar
    assert.strictEqual((await db.query("select to_regclass('public.tablas_cliente') as t")).rows[0].t, null);
    assert.strictEqual((await db.query("select count(*)::int as n from pg_proc where proname = 'inicializar_tablas_cliente'")).rows[0].n, 0);
});

prueba("027 es idempotente y aplicarla no cambia ninguna cuadrícula", async () => {
    const db = await crearDb({ m027: false });
    const antes = await cuadricula(db, PRINCIPAL);
    await db.exec(M027);
    await db.exec(M027);
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes);
    assert.strictEqual(await contar(db, "select count(*) as n from public.tablas_cliente"), 0, "no crea configuraciones por sí sola");
});

prueba("cuenta PRINCIPAL: sus 2 cuadrículas quedan idénticas (campo por campo); sus 8 precios = los actuales", async () => {
    const db = await crearDb();
    const antes = await cuadricula(db, PRINCIPAL);
    const r = await inicializar(db, PRINCIPAL);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.cuadriculas.map(c => c.estado), ["existente", "existente"]);
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes, "ni una fila nueva, ni un campo cambiado");
    const cfg = await configs(db, PRINCIPAL);
    assert.deepStrictEqual(cfg.map(c => [c.precio, c.tabla_fisica]), configuracionesBase().map(c => [c.precio, c.tabla]));
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T5K}`), 100, "nadie más en la tabla");
});

prueba("clientes A y B: 8 configuraciones propias y su cuadrícula 00-99 en cada tabla física", async () => {
    const db = await crearDb();
    const antes = await cuadricula(db, PRINCIPAL);
    for (const u of [A, B]) {
        const r = await inicializar(db, u);
        assert.strictEqual(r.configuraciones_creadas, 8);
        assert.deepStrictEqual(r.cuadriculas.map(c => [c.estado, c.filas]), [["creada", 100], ["creada", 100]]);
        assert.strictEqual((await configs(db, u)).length, 8);
        for (const t of ["reservas_dos_cifras", T5K]) {
            const filas = (await db.query(`select numero, estado from public.${t} where usuario_id = '${u}' order by numero`)).rows;
            assert.strictEqual(filas.length, 100);
            assert.strictEqual(filas[0].numero, "00");
            assert.strictEqual(filas[99].numero, "99");
            assert.ok(filas.every(f => f.estado === "libre"));
        }
    }
    const ids = await db.query(`select usuario_id, count(distinct id)::int as n from public.tablas_cliente group by 1`);
    assert.strictEqual(ids.rows.length, 2, "configuraciones independientes de A y de B");
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes, "la principal sigue idéntica");
});

prueba("repetir la inicialización no crea duplicados", async () => {
    const db = await crearDb();
    await inicializar(db, A);
    const antes = await cuadricula(db, A);
    for (let i = 0; i < 3; i++) {
        const r = await inicializar(db, A);
        assert.strictEqual(r.configuraciones_creadas, 0);
        assert.deepStrictEqual(r.cuadriculas.map(c => c.estado), ["existente", "existente"]);
    }
    assert.strictEqual(await cuadricula(db, A), antes);
    assert.strictEqual(await contar(db, `select count(*) as n from public.tablas_cliente where usuario_id = '${A}'`), 8);
});

prueba("A no lee ni modifica configuraciones de B ni de la principal (y al revés)", async () => {
    const db = await crearDb();
    for (const u of [PRINCIPAL, A, B]) await inicializar(db, u);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.tablas_cliente")).length, 8);
    assert.ok((await como(db, "authenticated", A, "select usuario_id from public.tablas_cliente")).every(f => f.usuario_id === A));
    assert.strictEqual((await como(db, "authenticated", A, `update public.tablas_cliente set activa = false where usuario_id = '${B}' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", B, `delete from public.tablas_cliente where usuario_id = '${PRINCIPAL}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", A, `insert into public.tablas_cliente (usuario_id, precio, tabla_fisica, cifras, cantidad) values ('${B}', 4000, 'reservas_dos_cifras', 2, 100)`), /row-level security/);
    await assert.rejects(como(db, "authenticated", A, `update public.tablas_cliente set usuario_id = '${B}' where usuario_id = '${A}'`), /row-level security/);
    await assert.rejects(como(db, "anon", null, "select * from public.tablas_cliente"), /permission denied/);
    assert.strictEqual(await contar(db, `select count(*) as n from public.tablas_cliente where usuario_id = '${PRINCIPAL}' and activa`), 8);
});

prueba("A no lee ni modifica las cuadrículas de B ni de la principal (Parte A)", async () => {
    const db = await crearDb();
    for (const u of [A, B]) await inicializar(db, u);
    const antes = await cuadricula(db, PRINCIPAL);
    const vistas = await como(db, "authenticated", A, `select distinct usuario_id from public.${T5K}`);
    assert.deepStrictEqual(vistas.map(f => f.usuario_id), [A]);
    for (const dueno of [PRINCIPAL, B]) {
        const r = await como(db, "authenticated", A, `update public.${T5K} set estado = 'pagado' where usuario_id = '${dueno}' returning id`);
        assert.strictEqual(r.length, 0);
    }
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes);
});

prueba("cada cliente gestiona sus configuraciones; borrar una no borra reservas ni la cuadrícula", async () => {
    const db = await crearDb();
    await inicializar(db, A);
    await db.exec(`update public.${T5K} set estado = 'reservado', comprador = 'X' where usuario_id = '${A}' and numero = '07'`);
    const antes = await cuadricula(db, A);
    assert.strictEqual((await como(db, "authenticated", A, "update public.tablas_cliente set activa = false where precio = 7000 returning precio")).length, 1);
    assert.strictEqual((await como(db, "authenticated", A, "delete from public.tablas_cliente where precio = 5000 returning precio")).length, 1);
    await como(db, "authenticated", A, `insert into public.tablas_cliente (usuario_id, precio, tabla_fisica, cifras, cantidad) values ('${A}', 4000, '5k_15k_reservas_2_cifras', 2, 100)`);
    await assert.rejects(como(db, "authenticated", A, `insert into public.tablas_cliente (usuario_id, precio, tabla_fisica, cifras, cantidad) values ('${A}', 9000, 'otra_tabla', 2, 100)`), /check/i);
    await assert.rejects(como(db, "authenticated", A, `insert into public.tablas_cliente (usuario_id, precio, tabla_fisica, cifras, cantidad) values ('${A}', 3000, 'reservas_dos_cifras', 2, 100)`), /duplicate|unique/i);
    assert.strictEqual(await cuadricula(db, A), antes, "reservas y cuadrícula intactas");
    const r = await inicializar(db, A);
    assert.strictEqual(r.configuraciones_creadas, 1, "solo repone la base que faltaba (5000); respeta la desactivada y la añadida");
    assert.strictEqual(await contar(db, `select count(*) as n from public.tablas_cliente where usuario_id = '${A}' and precio = 7000 and not activa`), 1);
});

prueba("solo service_role inicializa: authenticated y anon no pueden (ni para sí mismos)", async () => {
    const db = await crearDb();
    await assert.rejects(inicializar(db, A, "authenticated"), /permission denied/);
    await assert.rejects(inicializar(db, A, "anon"), /permission denied/);
    assert.strictEqual(await contar(db, "select count(*) as n from public.tablas_cliente"), 0);
});

prueba("usuario inexistente o configuraciones vacías: error y nada creado", async () => {
    const db = await crearDb();
    await assert.rejects(inicializar(db, "cccccccc-0000-4000-8000-00000000000c"), /usuario inexistente/);
    await assert.rejects(como(db, "service_role", null, `select public.inicializar_tablas_cliente('${A}', '[]'::jsonb)`), /vacías/);
    assert.strictEqual(await contar(db, "select count(*) as n from public.tablas_cliente"), 0);
});

prueba("cuadrícula INCOMPLETA de un cliente: no se completa ni se toca; se informa", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('01', 'reservado', '${A}'), ('02', 'libre', '${A}')`);
    const r = await inicializar(db, A);
    const dos = r.cuadriculas.find(c => c.tabla === "reservas_dos_cifras");
    assert.deepStrictEqual([dos.estado, dos.filas], ["incompleta", 2]);
    assert.strictEqual(await contar(db, `select count(*) as n from public.reservas_dos_cifras where usuario_id = '${A}'`), 2);
});

prueba("BLOQUEO: con unicidad solo sobre numero la 027 NO se aplica (exige la 033) y la principal queda intacta", async () => {
    const db = await crearDb({ unicoPorNumero: true, m027: false });
    const antes = await cuadricula(db, PRINCIPAL);
    await assert.rejects(db.exec(M027), /Aplica antes la 033/);
    await db.exec("rollback");
    assert.strictEqual((await db.query("select to_regclass('public.tablas_cliente') as t")).rows[0].t, null, "nada creado");
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes);
});

prueba("con la 033 aplicada, la misma base acepta la 027 y A recibe su cuadrícula con los números de la principal", async () => {
    const db = await crearDb({ unicoPorNumero: true, m027: false });
    const antes = await cuadricula(db, PRINCIPAL);
    await db.exec(M033);
    await db.exec(M027);
    const r = await inicializar(db, A);
    assert.ok(r.ok && r.cuadriculas.every(c => c.estado === "creada"), JSON.stringify(r));
    assert.strictEqual(await cuadricula(db, PRINCIPAL), antes);
});

prueba("Parte A revertida después de la 027: la función no crea nada (parte_a_pendiente)", async () => {
    const db = await crearDb();
    await db.exec(`alter table public.${T5K} disable row level security`);
    const r = await inicializar(db, A);
    assert.deepStrictEqual(r, { ok: false, motivo: "parte_a_pendiente" });
    assert.strictEqual(await contar(db, "select count(*) as n from public.tablas_cliente"), 0);
});

prueba("vuelta atrás de la 027: quita tabla y función; las cuadrículas siguen", async () => {
    const db = await crearDb();
    await inicializar(db, A);
    const principal = await cuadricula(db, PRINCIPAL);
    const reversion = M027.split("-- Reversión")[1].split("\n").filter(l => /^--\s{3}\S/.test(l)).map(l => l.replace(/^--\s{3}/, "")).join("\n");
    await db.exec(reversion);
    assert.strictEqual((await db.query("select to_regclass('public.tablas_cliente') as t")).rows[0].t, null);
    assert.strictEqual(await cuadricula(db, PRINCIPAL), principal);
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T5K} where usuario_id = '${A}'`), 100);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    for (const db of abiertas) await db.close().catch(() => {});
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
