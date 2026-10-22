// ==========================================================================
// PRUEBAS SQL — migraciones 028 (mensajes por cliente) y 029 (RLS de chats)
// sobre la 021 REAL, en Postgres en memoria (PGlite). Más el relleno
// opcional docs/activacion/relleno_cliente_mensajes.sql.
//
//   - 028: idempotente; A y B guardan el MISMO mensaje del mismo grupo; el
//     mismo cliente no puede guardarlo dos veces; filas sin cliente no
//     chocan; desaparece el único global de la 021.
//   - 029: aborta sin la 028, sin mensajes recientes o con mensajes recientes
//     sin cliente; aplicada: cada cliente lee solo lo suyo, anon nada,
//     authenticated no escribe; el bot (service_role) no se ve afectado.
//   - Relleno: solo grupos con sorteos de un único cliente; nunca cambia un
//     cliente existente.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/migracion028y029.test.js
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

const M021 = leer("backend/supabase_migrations/021_mensaje_procesado_unico.sql");
const M028 = leer("backend/supabase_migrations/028_mensajes_por_cliente.sql");
const M029 = leer("backend/supabase_migrations/029_rls_mensajes_por_cliente.sql");
const RELLENO = leer("docs/activacion/relleno_cliente_mensajes.sql");
const R1 = RELLENO.split("-- R1.")[1].split("-- R2.")[0].split("\n").slice(1).filter(l => !l.startsWith("--")).join("\n");
const R2 = RELLENO.split("-- R2.")[1].split("-- Vuelta atrás")[0].split("\n").filter(l => l.startsWith("-- ")).map(l => l.slice(3)).filter(l => !/^RELLENO|^Toca SOLO/.test(l)).join("\n");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text);
    create table public.mensajes_grupos_sorteos (
        id serial primary key, mensaje_id text, grupo_id text, usuario_id uuid, texto text,
        timestamp_whatsapp bigint, creado_en timestamptz default now());
    -- Historial anterior: sin cliente, con un duplicado real (como en producción).
    insert into public.mensajes_grupos_sorteos (mensaje_id, grupo_id, texto, creado_en) values
        ('h1', 'gA', 'viejo de A', now() - interval '3 days'),
        ('h1', 'gA', 'viejo de A repetido', now() - interval '3 days'),
        ('h2', 'gB', 'viejo de B', now() - interval '3 days'),
        ('h3', 'gX', 'viejo de grupo compartido', now() - interval '3 days');
    insert into public.eventos_bot (usuario_id, grupo_id) values
        ('${A}', 'gA'), ('${B}', 'gB'), ('${A}', 'gX'), ('${B}', 'gX');
`;

const abiertas = [];
async function crearDb({ con028 = true } = {}) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    await db.exec(M021);
    if (con028) await db.exec(M028);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const insertar = (db, cliente, mensaje, grupo = "gX", hace = "0 minutes") => db.query(
    `insert into public.mensajes_grupos_sorteos (cliente_usuario_id, mensaje_id, grupo_id, texto, creado_en)
     values (${cliente ? `'${cliente}'` : "null"}, '${mensaje}', '${grupo}', 'hola', now() - interval '${hace}') returning id`);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("021 (estado actual): un segundo cliente NO puede guardar el mismo mensaje del grupo", async () => {
    const db = await crearDb({ con028: false });
    await db.query("insert into public.mensajes_grupos_sorteos (mensaje_id, grupo_id) values ('m1', 'gX')");
    await assert.rejects(db.query("insert into public.mensajes_grupos_sorteos (mensaje_id, grupo_id) values ('m1', 'gX')"), /duplicate|unique/i);
});

prueba("028 idempotente: se aplica dos veces y conserva el historial (incluidos duplicados)", async () => {
    const db = await crearDb();
    await db.exec(M028);
    const n = (await db.query("select count(*)::int as n from public.mensajes_grupos_sorteos")).rows[0].n;
    assert.strictEqual(n, 4);
    const idx = (await db.query("select indexname from pg_indexes where tablename = 'mensajes_grupos_sorteos'")).rows.map(r => r.indexname);
    assert.ok(!idx.includes("mensajes_grupos_sorteos_grupo_mensaje_unico_nuevos"), "sin el único global de la 021");
    assert.ok(idx.includes("mensajes_grupos_sorteos_cliente_mensaje_unico"));
    assert.ok(idx.includes("mensajes_grupos_sorteos_grupo_mensaje_idx"), "conserva el índice de búsqueda de la 021");
});

prueba("028: A y B guardan el MISMO mensaje; el mismo cliente no puede dos veces", async () => {
    const db = await crearDb();
    await insertar(db, A, "m1");
    await insertar(db, B, "m1");
    await assert.rejects(insertar(db, A, "m1"), /duplicate|unique/i);
    await insertar(db, null, "m1");   // filas sin cliente no participan del único
});

prueba("029 aborta sin la 028", async () => {
    const db = await crearDb({ con028: false });
    await assert.rejects(db.exec(M029), /falta la migración 028/);
    await db.exec("rollback");
});

prueba("029 aborta si no hubo mensajes en la última hora (sin prueba de que el bot nuevo escriba cliente)", async () => {
    const db = await crearDb();
    await assert.rejects(db.exec(M029), /ningún mensaje en la última hora/);
    await db.exec("rollback");
});

prueba("029 aborta si hay mensajes recientes sin cliente (bot anterior todavía activo)", async () => {
    const db = await crearDb();
    await insertar(db, A, "m1");
    await insertar(db, null, "m2");
    await assert.rejects(db.exec(M029), /sin cliente_usuario_id/);
    await db.exec("rollback");
    assert.strictEqual((await db.query("select relrowsecurity from pg_class where oid = 'public.mensajes_grupos_sorteos'::regclass")).rows[0].relrowsecurity, false);
});

prueba("029 aplicada: A lee solo lo suyo, B solo lo suyo; anon nada; authenticated no escribe; el bot sí", async () => {
    const db = await crearDb();
    await insertar(db, A, "m1");
    await insertar(db, B, "m1");
    await insertar(db, A, "m2", "gA");
    await db.exec(M029);
    const deA = await como(db, "authenticated", A, "select cliente_usuario_id from public.mensajes_grupos_sorteos");
    const deB = await como(db, "authenticated", B, "select cliente_usuario_id from public.mensajes_grupos_sorteos");
    assert.ok(deA.length === 2 && deA.every(f => f.cliente_usuario_id === A));
    assert.ok(deB.length === 1 && deB.every(f => f.cliente_usuario_id === B));
    await assert.rejects(como(db, "anon", null, "select * from public.mensajes_grupos_sorteos"), /permission denied/);
    await assert.rejects(como(db, "authenticated", A, `insert into public.mensajes_grupos_sorteos (cliente_usuario_id, mensaje_id, grupo_id) values ('${B}', 'x', 'gX')`), /permission denied/);
    await assert.rejects(como(db, "authenticated", A, "delete from public.mensajes_grupos_sorteos"), /permission denied/);
    const bot = await como(db, "service_role", null, "select count(*)::int as n from public.mensajes_grupos_sorteos");
    assert.strictEqual(bot[0].n, 7, "el bot ve todo, incluido el historial sin cliente");
});

prueba("relleno: R1 es solo lectura; R2 asigna solo grupos con UN cliente y nunca cambia uno existente", async () => {
    const db = await crearDb();
    await insertar(db, B, "m9", "gA");   // fila con cliente existente en un grupo de A: no se toca
    await db.exec(R1);
    const previa = (await db.query(R1.replace("set transaction read only;", ""))).rows[0];
    assert.deepStrictEqual([Number(previa.se_rellenarian), Number(previa.quedarian_sin_cliente)], [2, 2], "h1 (la más antigua) y h2; la copia de h1 y gX (dos clientes) sin dueño");
    await db.exec(R2);
    const filas = (await db.query("select mensaje_id, grupo_id, cliente_usuario_id from public.mensajes_grupos_sorteos order by id")).rows;
    const de = (m, g) => filas.filter(f => f.mensaje_id === m && f.grupo_id === g).map(f => f.cliente_usuario_id);
    assert.deepStrictEqual(de("h1", "gA"), [A, null], "duplicado histórico: solo la fila más antigua (el único por cliente no se rompe)");
    assert.deepStrictEqual(de("h2", "gB"), [B]);
    assert.deepStrictEqual(de("h3", "gX"), [null], "grupo con dos clientes: sin dueño");
    assert.deepStrictEqual(de("m9", "gA"), [B], "el cliente existente no cambia");
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
