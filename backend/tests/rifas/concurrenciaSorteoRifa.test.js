// ==========================================================================
// CASO G — reserva y publicación (reinicio de la rifa) A LA VEZ, contra un
// Postgres REAL local y desechable (PGlite tiene una sola conexión).
//
// En cada ronda una rifa tiene 10 números pagados de un sorteo CERRADO; se
// revisa el reinicio (huella) y se disparan a la vez la APLICACIÓN del
// reinicio (rifa_reiniciar_sorteo, 054) y 5 reservas nuevas (rifa_reservar).
// Invariantes (sin reinicios parciales):
//   - o el reinicio se aplicó entero (10 archivados, 0..9 libres, ciclo+1 y
//     las reservas posteriores marcadas con el ciclo nuevo),
//   - o no se aplicó nada (tabla_cambio: 10 pagados intactos, 0 archivados);
//   - las 5 reservas SIEMPRE quedan vivas (ninguna se archiva ni se pierde);
//   - ninguna otra rifa cambia.
//
// Uso (SOLO un Postgres local y desechable; nunca Supabase):
//   PG_MODULE=<carpeta>/node_modules/pg \
//   PG_PRUEBAS_URL=postgres://postgres@127.0.0.1:55433/postgres \
//       node backend/tests/rifas/concurrenciaSorteoRifa.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pg;
try {
    pg = require(process.env.PG_MODULE || "pg");
} catch {
    console.log("⏭️  módulo pg no disponible — prueba omitida.");
    process.exit(0);
}
const URL_BASE = process.env.PG_PRUEBAS_URL;
if (!URL_BASE) {
    console.log("⏭️  PG_PRUEBAS_URL no definida — prueba omitida.");
    process.exit(0);
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(URL_BASE).hostname)) {
    console.error("❌ PG_PRUEBAS_URL debe ser un Postgres local.");
    process.exit(1);
}

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, "backend/supabase_migrations", p), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const BASE = `efaat_prueba_sorteo_rifa_${Date.now()}`;
const RONDAS = 25;

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
    insert into auth.users values ('${A}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    do $$ begin
        if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
    end $$;
`;

const TABLAS_BASE = `
    create table public.reservas_dos_cifras (
        id bigserial primary key, numero text, estado text default 'libre', usuario_id uuid,
        identidad_evento_real text, evento_id uuid, nombre_evento text, comprador text, contacto text,
        contacto_lower text, lib text, grupo_id text, grupo_nombre text, telefono_bot text,
        fecha_reserva date, hora_reserva text, fecha_pago date, hora_pago text, temporal_por text,
        bloqueado_hasta timestamptz, ip_reserva text, usuario_global_id uuid, nombre text, telefono text);
    create table public."5k_15k_reservas_2_cifras" (like public.reservas_dos_cifras including all);
    create table public.eventos_bot (
        id uuid primary key default gen_random_uuid(), usuario_id uuid, tabla text, activo boolean,
        estado text, identidad_evento_real text, nombre_evento text, valor text);
    create table public.sorteos_programados (
        id uuid primary key default gen_random_uuid(), usuario_id uuid not null,
        estado text not null default 'borrador', tabla text, identidad_evento_real text,
        config jsonb not null default '{}'::jsonb);
    create table public.reservas_actividad (id uuid primary key default gen_random_uuid(), usuario_id uuid);
`;

let ok = 0;
const paso = (t) => { ok++; console.log(`✅ ${t}`); };

(async () => {
    const admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`create database ${BASE}`);
    const url = new URL(URL_BASE); url.pathname = `/${BASE}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
    pool.on("connect", (c) => c.query("set role service_role"));

    try {
        const prep = new pg.Client({ connectionString: url.toString() });
        await prep.connect();
        for (const sql of [ENTORNO, leer("032_auditoria_reservas.sql"), leer("050_motor_rifas_centralizado.sql"), TABLAS_BASE,
            leer("030_reinicio_tabla_seguro.sql"), leer("051_vinculos_tabla_id.sql"), leer("054_sorteos_por_rifa.sql")]) {
            await prep.query(sql);
        }
        await prep.end();

        const rpc = async (fn, args) => {
            const marcas = args.map((_, i) => `$${i + 1}`).join(", ");
            return (await pool.query(`select public.${fn}(${marcas}) as r`, args)).rows[0].r;
        };
        const BOT = JSON.stringify({ origen: "bot" });
        const SISTEMA = JSON.stringify({ origen: "sistema" });
        const TESTIGO = (await rpc("rifa_crear", [A, "Testigo", 1000, 2, 100, "{}", null, BOT])).tabla_id;
        await rpc("rifa_reservar", [A, TESTIGO, [1, 2, 3], JSON.stringify({ comprador: "testigo" }), BOT, false]);
        const testigo = async () => JSON.stringify((await pool.query(
            "select numero, estado, version from public.numeros_rifa where tabla_id = $1 order by numero", [TESTIGO])).rows);
        const testigoAntes = await testigo();

        await Promise.all(Array.from({ length: 15 }, () => pool.query("select 1")));

        let aplicados = 0;
        let rechazados = 0;

        for (let ronda = 0; ronda < RONDAS; ronda++) {

            const R = (await rpc("rifa_crear", [A, `Ronda ${ronda}`, 2000, 2, 100, "{}", null, BOT])).tabla_id;
            await pool.query(`insert into public.eventos_bot (usuario_id, tabla, tabla_id, activo, estado, identidad_evento_real, nombre_evento, valor)
                              values ($1, 'reservas_dos_cifras', $2, false, 'cerrado', $3, 'Cerrado', '2000')`, [A, R, `viejo-${ronda}`]);
            const viejos = Array.from({ length: 10 }, (_, i) => i);
            await rpc("rifa_reservar", [A, R, viejos, JSON.stringify({ comprador: "viejo", identidad_evento_real: `viejo-${ronda}` }), BOT, false]);
            await rpc("rifa_pagar", [A, R, viejos, "{}", BOT]);

            const revision = await rpc("rifa_reiniciar_sorteo", [A, R, null, null, false, false, SISTEMA]);
            assert.strictEqual(revision.ok, true, JSON.stringify(revision));
            assert.strictEqual(revision.liberables, 10);

            // A la vez: la publicación aplica el reinicio y llegan 5 reservas.
            const nuevos = [50, 51, 52, 53, 54];
            // El orden de llegada varía por ronda (retardos de 0 a ~6 ms a
            // cada lado) para cubrir los dos desenlaces bajo concurrencia.
            const espera = (ms) => new Promise(res => setTimeout(res, ms));
            const retardoReinicio = ronda % 3 === 0 ? 4 : 0;
            const retardoReservas = ronda % 3 === 1 ? 6 : ronda % 3 === 2 ? 2 : 0;
            const pReinicio = espera(retardoReinicio).then(() => rpc("rifa_reiniciar_sorteo", [A, R, revision.huella, null, true, false, SISTEMA]));
            const pReservas = nuevos.map((n, i) => espera(retardoReservas + (i % 2)).then(() =>
                rpc("rifa_reservar", [A, R, [n], JSON.stringify({ comprador: `nuevo${i}`, identidad_evento_real: `nuevo-${ronda}` }), BOT, false])));
            const [reinicio, ...reservas] = await Promise.all([pReinicio, ...pReservas]);

            assert.ok(reservas.every(x => x.ok), JSON.stringify(reservas));

            const { rows: estados } = await pool.query(
                "select numero, estado, ciclo from public.numeros_rifa where tabla_id = $1 and estado <> 'libre' order by numero", [R]);
            const { rows: [arch] } = await pool.query("select count(*)::int as n from public.numeros_rifa_archivo where tabla_id = $1", [R]);
            const { rows: [rifa] } = await pool.query("select ciclo from public.tablas_rifas where id = $1", [R]);
            const pagados = estados.filter(e => e.estado === "pagado").length;
            const vivos = estados.filter(e => nuevos.includes(e.numero) && e.estado === "reservado");

            assert.strictEqual(vivos.length, 5, `ronda ${ronda}: reservas nuevas perdidas`);
            if (reinicio.ok) {
                aplicados++;
                assert.deepStrictEqual([arch.n, pagados, rifa.ciclo, reinicio.archivados], [10, 0, 2, 10], `ronda ${ronda}`);
                assert.ok(vivos.every(e => e.ciclo === 2), `ronda ${ronda}: una reserva posterior quedó con el ciclo viejo`);
            } else {
                rechazados++;
                assert.strictEqual(reinicio.motivo, "tabla_cambio", JSON.stringify(reinicio));
                assert.deepStrictEqual([arch.n, pagados, rifa.ciclo], [0, 10, 1], `ronda ${ronda}`);
            }
        }

        assert.strictEqual(await testigo(), testigoAntes);
        paso(`G. ${RONDAS} rondas reserva ∥ publicación: ${aplicados} reinicios completos y ${rechazados} rechazados por la huella; nunca a medias, ninguna reserva perdida, la otra rifa intacta`);

        // Un UPDATE/DELETE sin WHERE en la 030 corregida o en la 054 fallaría
        // con pg-safeupdate; aquí al menos se ejecutan de punta a punta.
        const legado = await rpc("reiniciar_tabla_cliente", [A, "reservas_dos_cifras", null, null, false, false]);
        assert.strictEqual(legado.ok, true, JSON.stringify(legado));
        paso("030 corregida por la 054: la revisión del motor legado se ejecuta en un Postgres real");

    } finally {
        await pool.end();
        await admin.query(`drop database if exists ${BASE}`);
        await admin.end();
    }

    console.log(`\n${ok} comprobaciones correctas.`);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
