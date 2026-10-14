// ==========================================================================
// PRUEBAS SQL — migraciones 023 (estado de cierre por grupo) y 024 (sorteos
// programados, plantillas, cuentas) contra Postgres REAL en memoria
// (PGlite). Verifica RLS por propietario con auth.uid() simulado igual que
// Supabase (claim "sub" del JWT), idempotencia y que no se toquen datos.
//
// Mismo criterio que tests/inactividad/migracion022.test.js:
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/sorteos/migraciones023y024.test.js
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

const DIR = path.join(__dirname, "..", "..", "supabase_migrations");
const M023 = fs.readFileSync(path.join(DIR, "023_estado_cierre_por_grupo.sql"), "utf8");
const M024 = fs.readFileSync(path.join(DIR, "024_sorteos_programados.sql"), "utf8");

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
    -- Igual que Supabase: auth.uid() = claim "sub" del JWT de la petición.
    create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.eventos_bot (id uuid primary key default gen_random_uuid(), grupo_id text, usuario_id uuid, activo boolean, estado text);
    insert into public.eventos_bot (grupo_id, usuario_id, activo, estado) values ('g1@g.us', '${A}', true, 'abierto');
`;

async function crearDb() {
    const db = new PGlite();
    await db.exec(ENTORNO);
    await db.exec(M023);
    await db.exec(M024);
    return db;
}

async function como(db, rol, usuario, sql, params) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try {
        return (await db.query(sql, params)).rows;
    } finally {
        await db.exec("reset role;");
    }
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("023: añade columnas de cierre sin tocar filas; constraint NOT VALID; idempotente", async () => {
    const db = await crearDb();
    const filas = (await db.query("select activo, estado, cierre_estado, cierre_intentos from public.eventos_bot")).rows;
    assert.deepStrictEqual(filas, [{ activo: true, estado: "abierto", cierre_estado: null, cierre_intentos: 0 }]);
    await assert.rejects(db.exec(`update public.eventos_bot set cierre_estado = 'inventado'`), /check/i);
    await db.exec(`update public.eventos_bot set cierre_estado = 'fallido', cierre_intentos = 2`);
    await db.exec(M023);
    assert.strictEqual((await db.query("select cierre_intentos from public.eventos_bot")).rows[0].cierre_intentos, 2);
});

prueba("024: cuatro tablas con RLS activo y 4 políticas cada una", async () => {
    const db = await crearDb();
    const t = (await db.query(`select tablename, rowsecurity from pg_tables where tablename in ('cuentas_pago','plantillas_sorteo','sorteos_programados','sorteos_programados_grupos') order by 1`)).rows;
    assert.strictEqual(t.length, 4);
    assert.ok(t.every(x => x.rowsecurity));
    const p = (await db.query(`select tablename, count(*)::int n from pg_policies where tablename in ('cuentas_pago','plantillas_sorteo','sorteos_programados','sorteos_programados_grupos') group by 1`)).rows;
    assert.ok(p.length === 4 && p.every(x => x.n === 4), JSON.stringify(p));
});

prueba("024 RLS: cada cliente solo ve, crea, modifica y borra lo suyo", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.cuentas_pago (usuario_id, nombre, numero) values ('${A}', 'Nequi A', '1'), ('${B}', 'Nequi B', '2')`);

    const deA = await como(db, "authenticated", A, "select nombre from public.cuentas_pago order by nombre");
    assert.deepStrictEqual(deA.map(x => x.nombre), ["Nequi A"]);

    await assert.rejects(
        como(db, "authenticated", A, `insert into public.cuentas_pago (usuario_id, nombre, numero) values ('${B}', 'colada', '9')`),
        /row-level security/i, "A no puede crear filas a nombre de B"
    );

    const cambiadas = await como(db, "authenticated", A, `update public.cuentas_pago set numero = 'robado' where nombre = 'Nequi B' returning id`);
    assert.strictEqual(cambiadas.length, 0, "A no puede modificar la cuenta de B");

    await assert.rejects(
        como(db, "authenticated", A, `update public.cuentas_pago set usuario_id = '${B}' where nombre = 'Nequi A'`),
        /row-level security/i, "A no puede regalar su fila a otro"
    );

    const borradas = await como(db, "authenticated", A, `delete from public.cuentas_pago where nombre = 'Nequi B' returning id`);
    assert.strictEqual(borradas.length, 0);

    assert.strictEqual((await db.query(`select numero from public.cuentas_pago where nombre = 'Nequi B'`)).rows[0].numero, "2");
});

prueba("024 RLS: anon no ve nada; sin sesión (sin sub) tampoco; service_role sí", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.sorteos_programados (usuario_id, config, tabla, cifras, cantidad_numeros, publicar_en) values ('${A}', '{}', 't', 2, 100, now())`);
    await assert.rejects(como(db, "anon", null, "select * from public.sorteos_programados"), /permission denied/i);
    assert.strictEqual((await como(db, "authenticated", null, "select * from public.sorteos_programados")).length, 0);
    assert.strictEqual((await como(db, "service_role", null, "select * from public.sorteos_programados")).length, 1);
});

prueba("024: restricciones (estado, cifras, grupo único por sorteo, nombre de plantilla único por cliente)", async () => {
    const db = await crearDb();
    const s = (await db.query(`insert into public.sorteos_programados (usuario_id, config, tabla, cifras, cantidad_numeros, publicar_en) values ('${A}', '{}', 't', 2, 100, now()) returning id`)).rows[0].id;
    await assert.rejects(db.exec(`update public.sorteos_programados set estado = 'inventado'`), /check/i);
    await assert.rejects(db.exec(`insert into public.sorteos_programados (usuario_id, config, tabla, cifras, cantidad_numeros, publicar_en) values ('${A}', '{}', 't', 4, 100, now())`), /check/i);
    await db.exec(`insert into public.sorteos_programados_grupos (sorteo_id, usuario_id, grupo_id) values ('${s}', '${A}', 'g1@g.us')`);
    await assert.rejects(db.exec(`insert into public.sorteos_programados_grupos (sorteo_id, usuario_id, grupo_id) values ('${s}', '${A}', 'g1@g.us')`), e => e.code === "23505");
    await db.exec(`insert into public.plantillas_sorteo (usuario_id, nombre) values ('${A}', 'Noche'), ('${B}', 'Noche')`);
    await assert.rejects(db.exec(`insert into public.plantillas_sorteo (usuario_id, nombre) values ('${A}', 'Noche')`), e => e.code === "23505");
});

prueba("024: idempotente (segunda aplicación sin errores ni pérdida de datos)", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.cuentas_pago (usuario_id, nombre, numero) values ('${A}', 'Nequi A', '1')`);
    await db.exec(M024);
    assert.strictEqual((await db.query("select count(*)::int n from public.cuentas_pago")).rows[0].n, 1);
    const p = (await db.query(`select count(*)::int n from pg_policies where tablename = 'cuentas_pago'`)).rows[0].n;
    assert.strictEqual(p, 4, "no duplica políticas");
});

(async () => {

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            console.log(`❌ ${nombre}`);
            console.log(String(err && err.stack || err));
        }
    }

    console.log("\n============================");
    console.log(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    console.log("============================");

    process.exit(falla ? 1 : 0);

})();
