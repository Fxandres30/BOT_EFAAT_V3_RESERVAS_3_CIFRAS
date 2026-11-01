// ==========================================================================
// PRUEBAS SQL — migración 042 (preferencias del mensaje de publicación por
// cuenta) contra Postgres REAL en memoria (PGlite): forma de la tabla,
// acceso solo del backend (RLS sin políticas, sin permisos para anon ni
// authenticated), una fila por cuenta, restricción del estilo, upsert del
// backend e idempotencia.
//
// Mismo criterio que migraciones023y024.test.js:
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/sorteos/migracion042.test.js
// Sin PGlite la prueba se omite (exit 0). NUNCA se conecta a Supabase.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;

try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  PGlite no disponible — prueba SQL omitida (ver cabecera del archivo).");
    process.exit(0);
}

const M042 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "042_preferencias_mensaje_sorteo.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const ENTORNO = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function crearDb() {
    const db = new PGlite();
    await db.exec(ENTORNO);
    await db.exec(M042);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try {
        return (await db.query(sql)).rows;
    } finally {
        await db.exec("reset role;");
    }
}

const UPSERT = (usuario, estilo) => `
    insert into public.preferencias_mensaje_sorteo (usuario_id, estilo_predeterminado, actualizado_en)
    values ('${usuario}', '${estilo}', now())
    on conflict (usuario_id) do update set estilo_predeterminado = excluded.estilo_predeterminado, actualizado_en = excluded.actualizado_en`;

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("042: tabla con RLS activa y SIN políticas", async () => {
    const db = await crearDb();
    const t = (await db.query(`select rowsecurity from pg_tables where tablename = 'preferencias_mensaje_sorteo'`)).rows;
    assert.deepStrictEqual(t, [{ rowsecurity: true }]);
    const p = (await db.query(`select count(*)::int n from pg_policies where tablename = 'preferencias_mensaje_sorteo'`)).rows[0].n;
    assert.strictEqual(p, 0);
});

prueba("042: anon y authenticated no leen ni escriben; service_role sí", async () => {
    const db = await crearDb();
    await db.exec(UPSERT(A, "boleto"));
    await assert.rejects(como(db, "anon", null, "select * from public.preferencias_mensaje_sorteo"), /permission denied/i);
    await assert.rejects(como(db, "authenticated", A, "select * from public.preferencias_mensaje_sorteo"), /permission denied/i);
    await assert.rejects(como(db, "authenticated", A, UPSERT(A, "cartel")), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, "select * from public.preferencias_mensaje_sorteo")).length, 1);
});

prueba("042: una fila por cuenta; el upsert del backend actualiza solo la de esa cuenta", async () => {
    const db = await crearDb();
    await db.exec(UPSERT(A, "boleto"));
    await db.exec(UPSERT(B, "cartel"));
    await db.exec(UPSERT(A, "minimalista"));
    const filas = (await db.query("select usuario_id, estilo_predeterminado from public.preferencias_mensaje_sorteo order by usuario_id")).rows;
    assert.deepStrictEqual(filas, [
        { usuario_id: A, estilo_predeterminado: "minimalista" },
        { usuario_id: B, estilo_predeterminado: "cartel" }
    ]);
});

prueba("042: el estilo debe tener forma de identificador; por defecto 'clasico'", async () => {
    const db = await crearDb();
    await assert.rejects(db.exec(UPSERT(A, "Boleto; drop")), /check/i);
    await assert.rejects(db.exec(UPSERT(A, "")), /check/i);
    await db.exec(`insert into public.preferencias_mensaje_sorteo (usuario_id) values ('${B}')`);
    assert.strictEqual((await db.query("select estilo_predeterminado e from public.preferencias_mensaje_sorteo")).rows[0].e, "clasico");
});

prueba("042: borrar la cuenta borra su preferencia (y solo la suya)", async () => {
    const db = await crearDb();
    await db.exec(UPSERT(A, "boleto"));
    await db.exec(UPSERT(B, "cartel"));
    await db.exec(`delete from auth.users where id = '${A}'`);
    const filas = (await db.query("select usuario_id from public.preferencias_mensaje_sorteo")).rows;
    assert.deepStrictEqual(filas, [{ usuario_id: B }]);
});

prueba("042: idempotente (segunda aplicación sin errores ni pérdida de datos)", async () => {
    const db = await crearDb();
    await db.exec(UPSERT(A, "boleto"));
    await db.exec(M042);
    assert.strictEqual((await db.query("select estilo_predeterminado e from public.preferencias_mensaje_sorteo")).rows[0].e, "boleto");
    const p = (await db.query(`select count(*)::int n from pg_policies where tablename = 'preferencias_mensaje_sorteo'`)).rows[0].n;
    assert.strictEqual(p, 0);
});

(async () => {
    let ok = 0;
    let fallos = 0;
    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            fallos++;
            console.log(`❌ ${nombre}\n   ${err.message}`);
        }
    }
    console.log(`\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${fallos}`);
    process.exit(fallos ? 1 : 0);
})();
