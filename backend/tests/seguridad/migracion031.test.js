// ==========================================================================
// PRUEBAS SQL — migración 031 (QR de una sesión para /conectar/<id>) en
// Postgres en memoria (PGlite), con anon SIN acceso a `sesiones` (como
// quedaría tras la Parte A):
//   - anon obtiene qr/estado/expiración de ESA sesión, y nada más;
//   - id inexistente -> null; no lista ni escribe nada.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/migracion031.test.js
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

const M031 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "031_qr_sesion_publica.sql"), "utf8");

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.sesiones (id uuid primary key, usuario_id uuid, nombre text, telefono text, qr text, estado text, qr_expira_en timestamptz, creds jsonb);
    alter table public.sesiones enable row level security;
    revoke all on table public.sesiones from anon;
    insert into public.sesiones values
        ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Ventas A', '573001112233', 'data:image/png;base64,QR-A', 'esperando_qr', now() + interval '2 minutes', '{"secreto": 1}'),
        ('22222222-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Ventas B', '573004445566', 'data:image/png;base64,QR-B', 'conectado', null, '{"secreto": 2}');
`;

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });
let db;

async function como(rol, sql) {
    await db.exec(`set role ${rol};`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

prueba("anon sin acceso a sesiones (como tras la Parte A)", async () => {
    await assert.rejects(como("anon", "select * from public.sesiones"), /permission denied/);
});

prueba("anon obtiene SOLO qr, estado y expiración de esa sesión", async () => {
    const [{ r }] = await como("anon", "select public.qr_sesion_publica('11111111-0000-4000-8000-000000000001') as r");
    assert.deepStrictEqual(Object.keys(r).sort(), ["estado", "qr", "qr_expira_en"]);
    assert.deepStrictEqual([r.qr, r.estado], ["data:image/png;base64,QR-A", "esperando_qr"]);
    assert.ok(!JSON.stringify(r).includes("573001112233") && !JSON.stringify(r).includes("secreto"));
});

prueba("id inexistente o mal formado -> null (no lista otras sesiones)", async () => {
    assert.strictEqual((await como("anon", "select public.qr_sesion_publica('no-existe') as r"))[0].r, null);
    assert.strictEqual((await como("anon", "select public.qr_sesion_publica('%') as r"))[0].r, null);
});

prueba("031 idempotente y sin escritura", async () => {
    await db.exec(M031);
    const antes = JSON.stringify((await db.query("select * from public.sesiones order by id")).rows);
    await como("anon", "select public.qr_sesion_publica('22222222-0000-4000-8000-000000000002')");
    assert.strictEqual(JSON.stringify((await db.query("select * from public.sesiones order by id")).rows), antes);
});

(async () => {
    db = new PGlite();
    await db.exec(ENTORNO);
    await db.exec(M031);
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    await db.close().catch(() => {});
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
