// ==========================================================================
// 053 — reinstalar las funciones del motor con su versión actual.
// Simula producción con la versión ANTIGUA de rifa_liberar (commit 520514d1,
// sin las condiciones atómicas del vencimiento) y comprueba que la 053 la
// sustituye sin tocar datos ni permisos, y que se puede repetir.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/rifas/reinstalarFunciones053.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  PGlite no disponible — prueba SQL omitida.");
    process.exit(0);
}

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
const M032 = leer("backend/supabase_migrations/032_auditoria_reservas.sql");
const M050 = leer("backend/supabase_migrations/050_motor_rifas_centralizado.sql");
const M053 = leer("backend/supabase_migrations/053_reinstalar_funciones_rifas.sql");

// rifa_liberar tal como estaba en el commit 520514d1 (antes del vencimiento atómico).
let LIBERAR_ANTIGUA = null;
try {
    const antigua = execFileSync("git", ["show", "520514d1:backend/supabase_migrations/050_motor_rifas_centralizado.sql"], { cwd: RAIZ, encoding: "utf8" });
    const ini = antigua.indexOf("create function public.rifa_liberar(");
    LIBERAR_ANTIGUA = antigua.slice(ini, antigua.indexOf("\n$$;", ini) + 4).replace("create function", "create or replace function");
} catch {
    console.log("⏭️  sin git o sin el commit 520514d1 — prueba omitida.");
    process.exit(0);
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";

(async () => {
    const db = new PGlite();
    await db.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
        create schema auth; grant usage on schema auth to anon, authenticated, service_role;
        create table auth.users (id uuid primary key); insert into auth.users values ('${A}');
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        create publication supabase_realtime;`);
    await db.exec(M032);
    await db.exec(M050);
    await db.exec(LIBERAR_ANTIGUA);          // «producción» con la versión antigua

    const rpc = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
    const rifa = (await rpc("rifa_crear", [A, "R", 1000, 2, 100, "{}", null, '{"origen":"manual"}'])).tabla_id;
    const reservar = (n) => rpc("rifa_reservar", [A, rifa, [n], '{"comprador":"Nueva","identidad_evento_real":"s1"}', '{"origen":"bot"}', false]);
    const vencer = (n) => rpc("rifa_liberar", [A, rifa, [n], "{}", '{"origen":"sistema"}',
        JSON.stringify({ reservado_antes_de: new Date(Date.now() - 3600_000).toISOString(), identidad_evento_real: "s1" })]);

    await reservar(10);
    assert.deepStrictEqual((await vencer(10)).liberados, [10], "la versión antigua IGNORA las condiciones y libera una reserva nueva (el fallo)");
    console.log("✅ con la versión antigua, el vencimiento libera una reserva recién hecha (fallo reproducido)");

    const antes = (await db.query("select count(*)::int n from public.numeros_rifa")).rows[0].n;
    await db.exec(M053);
    await reservar(11);
    const r = await vencer(11);
    assert.strictEqual(r.ok, false, "tras la 053 la reserva nueva NO se libera");
    assert.strictEqual((await db.query("select estado from public.numeros_rifa where tabla_id = $1 and numero = 11", [rifa])).rows[0].estado, "reservado");
    assert.strictEqual((await db.query("select count(*)::int n from public.numeros_rifa")).rows[0].n, antes, "la 053 no toca filas");
    console.log("✅ tras la 053, rifa_liberar respeta las condiciones atómicas; ninguna fila tocada");

    const exec = (await db.query(`select distinct a.grantee::regrole::text g from pg_proc p, aclexplode(p.proacl) a
                                   where p.proname like 'rifa\\_%' and a.privilege_type = 'EXECUTE' order by 1`)).rows.map((f) => f.g);
    assert.ok(exec.includes("service_role") && !exec.includes("anon") && !exec.includes("authenticated") && !exec.includes("-"), `EXECUTE: ${exec}`);
    const sobrecargas = (await db.query("select proname, count(*)::int n from pg_proc where proname like 'rifa\\_%' group by 1 having count(*) > 1")).rows;
    assert.deepStrictEqual(sobrecargas, [], "no crea versiones duplicadas de ninguna función");
    console.log("✅ permisos iguales a la 050 (solo service_role) y sin funciones duplicadas");

    await db.exec(M053);
    assert.strictEqual((await rpc("rifa_resolver", [A, "g", null, 1000])).motivo, "sin_rifa");
    console.log("✅ la 053 se puede ejecutar dos veces");
    console.log("\n4 comprobaciones superadas.");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
