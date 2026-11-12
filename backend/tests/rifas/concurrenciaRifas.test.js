// ==========================================================================
// Motor único de rifas (050) — CONCURRENCIA REAL contra un Postgres local.
//
// PGlite tiene una sola conexión: no puede demostrar dos reservas a la vez.
// Esta prueba abre decenas de conexiones reales y dispara las operaciones al
// mismo tiempo sobre las funciones de la 050:
//   a) 60 reservas simultáneas del MISMO número de la misma rifa -> 1 gana;
//   b) A y B reservan a la vez su propio 25 -> ambos ganan, sin cruces;
//   c) lotes solapados en orden ascendente y descendente -> sin interbloqueos
//      y cada número con un solo dueño;
//   d) 30 pagos simultáneos del mismo número -> un solo pago auditado;
//   e) reservas mientras se reinicia la rifa -> ninguna reserva se pierde ni
//      queda a medias (o queda viva o queda archivada).
//
// Uso (SOLO un Postgres local y desechable; nunca Supabase):
//   PG_MODULE=<carpeta>/node_modules/pg \
//   PG_PRUEBAS_URL=postgres://postgres@127.0.0.1:55432/postgres \
//       node backend/tests/rifas/concurrenciaRifas.test.js
// Crea una base efaat_prueba_rifas_<marca>, la usa y la borra al terminar.
// Se niega a correr contra cualquier host que no sea 127.0.0.1/localhost.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pg;
try {
    pg = require(process.env.PG_MODULE || "pg");
} catch {
    console.log("⏭️  módulo pg no disponible — prueba de concurrencia omitida.");
    process.exit(0);
}
const URL_BASE = process.env.PG_PRUEBAS_URL;
if (!URL_BASE) {
    console.log("⏭️  PG_PRUEBAS_URL no definida — prueba de concurrencia omitida.");
    process.exit(0);
}
const destino = new URL(URL_BASE);
if (!["127.0.0.1", "localhost", "[::1]"].includes(destino.hostname)) {
    console.error(`❌ PG_PRUEBAS_URL apunta a ${destino.hostname}: esta prueba solo corre contra un Postgres local.`);
    process.exit(1);
}

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
const M032 = leer("backend/supabase_migrations/032_auditoria_reservas.sql");
const M050 = leer("backend/supabase_migrations/050_motor_rifas_centralizado.sql");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const BASE = `efaat_prueba_rifas_${Date.now()}`;
const BOT = JSON.stringify({ origen: "bot" });

const ENTORNO = `
    do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

let ok = 0;
const paso = (t) => { ok++; console.log(`✅ ${t}`); };

(async () => {
    const admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`create database ${BASE}`);
    const urlPrueba = new URL(URL_BASE); urlPrueba.pathname = `/${BASE}`;

    // Cada conexión actúa como el backend (service_role).
    const pool = new pg.Pool({ connectionString: urlPrueba.toString(), max: 70 });
    pool.on("connect", (c) => c.query("set role service_role"));

    try {
        const prep = new pg.Client({ connectionString: urlPrueba.toString() });
        await prep.connect();
        await prep.query(ENTORNO);
        await prep.query(M032);
        await prep.query(M050);
        await prep.end();

        const rpc = async (fn, args) => {
            const marcas = args.map((_, i) => `$${i + 1}`).join(", ");
            return (await pool.query(`select public.${fn}(${marcas}) as r`, args)).rows[0].r;
        };
        const fila = async (tabla, n) => (await pool.query(
            "select estado, comprador from public.numeros_rifa where tabla_id = $1 and numero = $2", [tabla, n])).rows[0];

        const RIFA_A = (await rpc("rifa_crear", [A, "A 5K", 5000, 2, 100, "{}", null, BOT])).tabla_id;
        const RIFA_B = (await rpc("rifa_crear", [B, "B 5K", 5000, 2, 100, "{}", null, BOT])).tabla_id;

        // Abre todas las conexiones antes de disparar, para que choquen de verdad.
        await Promise.all(Array.from({ length: 65 }, () => pool.query("select 1")));

        // ---------------------------------------------------------------- a ---
        const intentos = await Promise.all(Array.from({ length: 60 }, (_, i) =>
            rpc("rifa_reservar", [A, RIFA_A, [25], JSON.stringify({ comprador: `C${i}` }), BOT, false])));
        const ganadores = intentos.filter((r) => r.ok);
        assert.strictEqual(ganadores.length, 1, `ganadores: ${ganadores.length}`);
        assert.strictEqual(intentos.filter((r) => !r.ok && r.no_disponibles[0] === 25).length, 59);
        const final = await fila(RIFA_A, 25);
        assert.strictEqual(final.estado, "reservado");
        const auditOk = (await pool.query(
            "select count(*)::int n from public.reservas_auditoria where tabla_id = $1 and numero = '25' and accion = 'reservar' and resultado = 'ok'", [RIFA_A])).rows[0].n;
        assert.strictEqual(auditOk, 1);
        assert.strictEqual((await pool.query(
            "select count(*)::int n from public.reservas_auditoria where tabla_id = $1 and numero = '25' and codigo = 'no_disponible'", [RIFA_A])).rows[0].n, 59);
        paso(`a) 60 reservas simultáneas del 25: gana una (${final.comprador}), 59 reciben «no_disponible», 1 sola auditoría ok`);

        // ---------------------------------------------------------------- b ---
        await rpc("rifa_liberar", [A, RIFA_A, [25], "{}", BOT, "{}"]);
        const cruzadas = await Promise.all(Array.from({ length: 40 }, (_, i) => i % 2
            ? rpc("rifa_reservar", [A, RIFA_A, [25], JSON.stringify({ comprador: `A${i}` }), BOT, false])
            : rpc("rifa_reservar", [B, RIFA_B, [25], JSON.stringify({ comprador: `B${i}` }), BOT, false])));
        assert.strictEqual(cruzadas.filter((r) => r.ok).length, 2);
        assert.match((await fila(RIFA_A, 25)).comprador, /^A/);
        assert.match((await fila(RIFA_B, 25)).comprador, /^B/);
        paso("b) A y B reservan a la vez su propio 25: exactamente un ganador en cada rifa, sin cruces");

        // ---------------------------------------------------------------- c ---
        const lotes = Array.from({ length: 40 }, (_, i) => {
            const base = Array.from({ length: 10 }, (_, k) => 40 + ((i * 3 + k) % 20));
            return i % 2 ? base : base.slice().reverse();
        });
        const resLotes = await Promise.all(lotes.map((nums, i) =>
            rpc("rifa_reservar", [A, RIFA_A, nums, JSON.stringify({ comprador: `L${i}` }), BOT, false])));
        const reservadosPorLote = resLotes.flatMap((r) => r.reservados);
        assert.strictEqual(new Set(reservadosPorLote).size, reservadosPorLote.length, "un número en dos lotes");
        const enBase = (await pool.query(
            "select numero from public.numeros_rifa where tabla_id = $1 and numero between 40 and 59 and estado = 'reservado' order by numero", [RIFA_A])).rows.map((f) => f.numero);
        assert.deepStrictEqual(enBase, Array.from({ length: 20 }, (_, k) => 40 + k));
        assert.deepStrictEqual(reservadosPorLote.slice().sort((x, y) => x - y), enBase);
        paso("c) 40 lotes solapados (ascendentes y descendentes) sin interbloqueos: 20 números, cada uno con un solo dueño");

        // ---------------------------------------------------------------- d ---
        const pagos = await Promise.all(Array.from({ length: 30 }, () => rpc("rifa_pagar", [A, RIFA_A, [40], "{}", BOT])));
        assert.strictEqual(pagos.filter((r) => r.ok).length, 1);
        assert.strictEqual((await pool.query(
            "select count(*)::int n from public.reservas_auditoria where tabla_id = $1 and numero = '40' and accion = 'pagar' and resultado = 'ok'", [RIFA_A])).rows[0].n, 1);
        paso("d) 30 pagos simultáneos del mismo número: un solo pago, una sola auditoría ok");

        // ---------------------------------------------------------------- e ---
        const RIFA_E = (await rpc("rifa_crear", [A, "Reinicio", 1000, 2, 100, "{}", null, BOT])).tabla_id;
        const mezcla = await Promise.all([
            ...Array.from({ length: 30 }, (_, i) => rpc("rifa_reservar", [A, RIFA_E, [i], JSON.stringify({ comprador: `E${i}` }), BOT, false])),
            rpc("rifa_reiniciar", [A, RIFA_E, "REINICIAR", BOT]),
            ...Array.from({ length: 30 }, (_, i) => rpc("rifa_reservar", [A, RIFA_E, [i + 30], JSON.stringify({ comprador: `E${i + 30}` }), BOT, false]))
        ]);
        const ganadas = mezcla.filter((r) => r.reservados).flatMap((r) => r.reservados);
        const vivas = (await pool.query("select numero from public.numeros_rifa where tabla_id = $1 and estado = 'reservado'", [RIFA_E])).rows.map((f) => f.numero);
        const archivadas = (await pool.query("select numero from public.numeros_rifa_archivo where tabla_id = $1", [RIFA_E])).rows.map((f) => f.numero);
        assert.strictEqual(vivas.length + archivadas.length, ganadas.length, "cada reserva ganada está viva o archivada");
        assert.ok(vivas.every((n) => !archivadas.includes(n)), "ninguna reserva viva y archivada a la vez");
        const reinicio = mezcla.find((r) => r.ciclo);
        assert.strictEqual(reinicio.archivados, archivadas.length);
        paso(`e) reservas durante un reinicio: ${archivadas.length} archivadas + ${vivas.length} vivas = ${ganadas.length} ganadas, ninguna perdida`);

        console.log(`\n${ok} comprobaciones de concurrencia superadas.`);
    } finally {
        await pool.end();
        await admin.query(`drop database if exists ${BASE}`);
        await admin.end();
    }
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
