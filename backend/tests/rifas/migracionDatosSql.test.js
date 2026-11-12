// ==========================================================================
// 051 + 052 sobre una RÉPLICA del estado real de producción (leído el
// 12/11/2026, solo lectura): 2 clientes × 8 precios en tablas_cliente, las 2
// cuadrículas antiguas con sus 26 columnas reales, 72 ocupados (70 pagados +
// 2 reservados) del cliente A en reservas_dos_cifras, todos del sorteo de
// $1.000 ya cerrado; grupos autorizados (A: 4 activos + 1 inactivo; B: 3);
// sorteos programados fallidos y uno pendiente de B ($2.000).
//
// Demuestra que tras la migración cada tabla es una rifa INDEPENDIENTE:
// reiniciar o reservar en $1.500 no toca $1.000 ni $2.000, aunque antes
// compartieran las mismas filas físicas.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/rifas/migracionDatosSql.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
const M051 = leer("backend/supabase_migrations/051_vinculos_tabla_id.sql");
const M052 = leer("backend/supabase_migrations/052_migracion_datos_rifas.sql");

const A = "2491cbd0-0000-4000-8000-00000000000a";
const B = "e5d98ce7-0000-4000-8000-00000000000b";
const EV_1000 = "42c49149-f04b-488b-af28-e6a36503159b";
const PRECIOS = [1000, 1500, 2000, 3000, 5000, 7000, 10000, 15000];
const DOS = (p) => p <= 2000;

const COLUMNAS = `id bigserial primary key, numero text not null, estado text, comprador text, creado_en timestamptz default now(),
    contacto text, bloqueado_hasta timestamptz, temporal_por text, contacto_lower text, ip_reserva text, lib text,
    grupo_id text, grupo_nombre text, evento_id uuid, nombre_evento text, fecha_reserva date, hora_reserva time,
    fecha_pago date, hora_pago time, usuario_id uuid, telefono_bot text, lid text, telefono text, nombre text,
    usuario_global_id uuid, identidad_evento_real text, unique (usuario_id, numero)`;

let ok = 0;
const paso = (t) => { ok++; console.log(`✅ ${t}`); };
async function esperarError(promesa, patron, nombre) {
    let error = null;
    try { await promesa; } catch (e) { error = e; }
    assert.ok(error, `${nombre}: se esperaba un error`);
    assert.match(error.message, patron, `${nombre}: ${error.message}`);
}

async function base() {
    const db = new PGlite();
    await db.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        create schema auth; grant usage on schema auth to anon, authenticated, service_role;
        create table auth.users (id uuid primary key);
        insert into auth.users values ('${A}'), ('${B}');
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        create publication supabase_realtime;

        create table public.reservas_dos_cifras (${COLUMNAS});
        create table public."5k_15k_reservas_2_cifras" (${COLUMNAS});
        create table public.tablas_cliente (usuario_id uuid, precio integer, tabla_fisica text, cifras integer, cantidad integer,
            activa boolean default true, primary key (usuario_id, precio));
        create table public.eventos_bot (id uuid primary key, grupo_id text, estado text, valor text, tabla text, usuario_id uuid,
            grupo_nombre text, activo boolean, abierto boolean, identidad_evento_real text, cierre_estado text, cierre_motivo text,
            creado_en timestamp default now());
        create table public.sorteos_programados (id uuid primary key default gen_random_uuid(), usuario_id uuid, estado text,
            config jsonb, tabla text, publicar_en timestamptz);
        create table public.reservas_actividad (id uuid primary key default gen_random_uuid(), usuario_id uuid not null, tabla text not null,
            numero text, evento_id uuid, tipo text);
        create table public.reservas_archivo (id uuid primary key default gen_random_uuid(), usuario_id uuid not null, tabla text not null,
            numero text not null, estado text not null, fila jsonb not null);
        create table public.grupos_autorizados (id uuid primary key default gen_random_uuid(), usuario_id uuid, grupo_id text, activo boolean);
    `);
    for (const u of [A, B]) {
        for (const t of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
            await db.exec(`insert into public."${t}" (numero, estado, usuario_id)
                           select lpad(n::text, 2, '0'), 'libre', '${u}' from generate_series(0, 99) n`);
        }
        for (const p of PRECIOS) {
            await db.query("insert into public.tablas_cliente values ($1, $2, $3, 2, 100, true)",
                [u, p, DOS(p) ? "reservas_dos_cifras" : "5k_15k_reservas_2_cifras"]);
        }
    }
    // 72 ocupados reales: 70 pagados + 2 reservados del sorteo de $1.000 (cerrado).
    await db.query(`insert into public.eventos_bot values ($1, 'g-a1', 'cerrado', '1000', 'reservas_dos_cifras', $2, 'Andres Mercado',
                    false, false, 'ident-1000', 'cerrado', 'hora', now())`, [EV_1000, A]);
    await db.query(`update public.reservas_dos_cifras set
        estado = case when numero::int < 70 then 'pagado' else 'reservado' end,
        comprador = 'Comprador ' || numero, nombre = 'Comprador ' || numero, telefono = '30000000' || numero,
        lid = 'lid-' || numero, lib = 'lib-' || numero, contacto = '30000000' || numero, ip_reserva = '10.0.0.' || numero::int,
        grupo_id = 'g-a1', grupo_nombre = 'Andres Mercado', evento_id = $1, identidad_evento_real = 'ident-1000',
        nombre_evento = 'Lotería', fecha_reserva = '2026-11-10', hora_reserva = '10:49:00',
        fecha_pago = case when numero::int < 70 then date '2026-11-10' end, hora_pago = case when numero::int < 70 then time '12:00:00' end
        where usuario_id = $2 and numero::int < 72`, [EV_1000, A]);
    // Otros sorteos cerrados (5K de A y 2K de B), sin números ocupados.
    await db.query(`insert into public.eventos_bot values (gen_random_uuid(), 'g-a2', 'cerrado', '5000', '5k_15k_reservas_2_cifras', $1,
                    'Grupo A2', false, false, 'ident-5000', 'cerrado', 'hora', now()),
                    (gen_random_uuid(), 'g-b1', 'cerrado', '2000', 'reservas_dos_cifras', $2, 'Grupo B1', false, false, 'ident-b-2000',
                    'cerrado', 'hora', now())`, [A, B]);
    await db.query(`insert into public.sorteos_programados (usuario_id, estado, config, tabla, publicar_en) values
        ($1, 'fallido', '{"valor": 5000}', '5k_15k_reservas_2_cifras', now() - interval '20 days'),
        ($2, 'programado', '{"valor": 2000}', 'reservas_dos_cifras', now() + interval '5 hours')`, [A, B]);
    await db.query(`insert into public.grupos_autorizados (usuario_id, grupo_id, activo) values
        ($1, 'g-a1', true), ($1, 'g-a2', true), ($1, 'g-a3', true), ($1, 'g-a4', true), ($1, 'g-a5', false),
        ($2, 'g-b1', true), ($2, 'g-b2', true), ($2, 'g-a1', true)`, [A, B]);   // g-a1 compartido por A y B
    await db.exec(M032);
    await db.exec(M050);
    return db;
}

const huellaLegado = async (db) => (await db.query(`select
    md5((select string_agg(t::text, '|' order by t.id) from public.reservas_dos_cifras t)) a,
    md5((select string_agg(t::text, '|' order by t.id) from public."5k_15k_reservas_2_cifras" t)) b,
    md5((select string_agg(t::text, '|' order by t.usuario_id, t.precio) from public.tablas_cliente t)) c`)).rows[0];

(async () => {
    const db = await base();
    const rpc = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
    const rifa = async (u, p) => (await db.query(
        "select t.* from public.rifas_migracion_mapa m join public.tablas_rifas t on t.id = m.tabla_id where m.usuario_id = $1 and m.precio = $2", [u, p])).rows[0];
    const ocupados = async (id) => (await db.query("select count(*)::int n from public.numeros_rifa where tabla_id = $1 and estado <> 'libre'", [id])).rows[0].n;

    // --------------------------------------------------------------- 051 ---
    await esperarError(db.exec(M052), /faltan la 050\/051/, "052 sin 051");
    await db.exec("rollback");
    await db.exec(M051);
    const cols = (await db.query(`select table_name from information_schema.columns where column_name = 'tabla_id'
        and table_name in ('eventos_bot', 'sorteos_programados', 'reservas_actividad', 'reservas_archivo') order by 1`)).rows.map((f) => f.table_name);
    assert.deepStrictEqual(cols, ["eventos_bot", "reservas_actividad", "reservas_archivo", "sorteos_programados"]);
    await esperarError(db.exec(M051), /ya aplicada/, "051 dos veces");
    await db.exec("rollback");
    paso("051: tabla_id (con FK compuesta) en eventos_bot, sorteos_programados, reservas_actividad y reservas_archivo; no se re-aplica");

    // ------------------------------------------------------- guardias 052 ---
    await db.query("update public.eventos_bot set activo = true, estado = 'activo', cierre_estado = null where valor = '5000'");
    await esperarError(db.exec(M052), /hay sorteos vigentes/, "sorteo vigente");
    await db.exec("rollback");
    await db.query("update public.eventos_bot set activo = false, estado = 'cerrado', cierre_estado = 'cerrado' where valor = '5000'");
    await db.query("update public.sorteos_programados set publicar_en = now() + interval '10 minutes' where estado = 'programado'");
    await esperarError(db.exec(M052), /a menos de 30 min/, "programado inminente");
    await db.exec("rollback");
    await db.query("update public.sorteos_programados set publicar_en = now() + interval '5 hours' where estado = 'programado'");
    await db.exec(`create function public.aviso() returns trigger language plpgsql as $$ begin return new; end $$;
                   create trigger aviso_cambio after update on public.eventos_bot for each row execute function public.aviso();`);
    await esperarError(db.exec(M052), /triggers AFTER UPDATE/, "trigger after update");
    await db.exec("rollback");
    await db.exec("drop trigger aviso_cambio on public.eventos_bot");
    await db.query("update public.reservas_dos_cifras set evento_id = null where usuario_id = $1 and numero = '05'", [A]);
    await esperarError(db.exec(M052), /no se puede atribuir a una sola rifa/, "ocupado sin sorteo");
    await db.exec("rollback");
    await db.query("update public.reservas_dos_cifras set evento_id = $1 where usuario_id = $2 and numero = '05'", [EV_1000, A]);
    assert.strictEqual((await db.query("select count(*)::int n from public.tablas_rifas")).rows[0].n, 0, "las guardias no dejan nada");
    paso("guardias de la 052: sorteo vigente, programado a <30 min, trigger AFTER UPDATE y ocupado sin sorteo atribuible → se detiene sin dejar nada");

    // ------------------------------------------------------------ migrar ---
    const antes = await huellaLegado(db);
    const informe = (await db.exec(M052)).at(-1).rows;
    assert.deepStrictEqual(await huellaLegado(db), antes, "las tablas antiguas no cambian");
    assert.strictEqual(informe.length, 16);
    paso("052 aplicada: 16 rifas (2 clientes × 8 precios); cuadrículas antiguas y tablas_cliente idénticas (md5)");

    const ids = new Set(informe.map((f) => f.tabla_id));
    assert.strictEqual(ids.size, 16);
    for (const f of informe) {
        assert.strictEqual(Number(f.numeros), 100, `${f.precio}`);
        assert.strictEqual(await ocupados(f.tabla_id), 0, "toda rifa nueva empieza libre");
    }
    assert.deepStrictEqual(informe.filter((f) => f.archivados > 0).map((f) => [f.usuario_id, f.precio, f.archivados, f.ciclo]),
        [[A, 1000, 72, 2]]);
    paso("cada tabla es su propia rifa con 100 números libres; solo $1.000 de A tiene historial (72) y empieza su ciclo 2");

    const r1000 = await rifa(A, 1000);
    const arch = (await db.query(`select numero, estado, ciclo, fila from public.numeros_rifa_archivo where tabla_id = $1 order by numero`, [r1000.id])).rows;
    assert.strictEqual(arch.length, 72);
    assert.strictEqual(arch.filter((f) => f.estado === "pagado").length, 70);
    assert.strictEqual(arch.filter((f) => f.estado === "reservado").length, 2);
    assert.ok(arch.every((f) => f.ciclo === 1 && f.fila.tabla_legado === "reservas_dos_cifras"));
    const f7 = arch.find((f) => f.numero === 7).fila.legado;
    assert.deepStrictEqual([f7.comprador, f7.telefono, f7.lid, f7.lib, f7.ip_reserva, f7.fecha_pago, f7.hora_pago, f7.nombre_evento],
        ["Comprador 07", "3000000007", "lid-07", "lib-07", "10.0.0.7", "2026-11-10", "12:00:00", "Lotería"]);
    // Las 72 filas antiguas COMPLETAS (las 26 columnas) están, idénticas, en el historial.
    const legado = (await db.query(`select to_jsonb(t) as j from public.reservas_dos_cifras t
                                     where usuario_id = $1 and estado <> 'libre' order by numero`, [A])).rows.map((f) => f.j);
    assert.strictEqual(legado.length, 72);
    assert.deepStrictEqual(arch.map((f) => f.fila.legado), legado, "cada fila archivada es idéntica a la original");
    assert.ok(legado.every((f) => Object.keys(f).length === 26), "todas las columnas de la cuadrícula antigua");
    // Ninguna rifa nueva hereda datos de nadie.
    assert.strictEqual((await db.query(`select count(*)::int n from public.numeros_rifa
        where comprador is not null or telefono is not null or lid is not null or lib is not null or pagado_en is not null
           or reservado_en is not null or evento_id is not null`)).rows[0].n, 0);
    const aud = (await db.query(`select count(*)::int n, count(distinct numero)::int d, min(estado_nuevo) e from public.reservas_auditoria
                                  where accion = 'migrar' and tabla_id = $1 and usuario_id = $2`, [r1000.id, A])).rows[0];
    assert.deepStrictEqual([aud.n, aud.d, aud.e], [72, 72, "archivado"]);
    paso("los 72 ocupados quedan como historial íntegro (comprador, teléfono, LID, LIB, IP, fechas) con su auditoría 'migrar'; ningún pago se pierde");

    // ----------------------------------- independencia real entre precios ---
    const r1500 = await rifa(A, 1500), r2000 = await rifa(A, 2000), rB1000 = await rifa(B, 1000);
    assert.deepStrictEqual((await rpc("rifa_reservar", [A, r1500.id, [25, 26], '{"comprador":"Ana"}', '{"origen":"bot"}', false])).reservados, [25, 26]);
    assert.strictEqual(await ocupados(r1000.id), 0);
    assert.strictEqual(await ocupados(r2000.id), 0);
    assert.strictEqual(await ocupados(rB1000.id), 0);
    assert.deepStrictEqual((await rpc("rifa_reservar", [A, r1000.id, [25], '{"comprador":"Beto"}', '{"origen":"bot"}', false])).reservados, [25],
        "el 25 de $1.000 es otro número distinto del 25 de $1.500");
    const rein = await rpc("rifa_reiniciar", [A, r1500.id, "REINICIAR", '{"origen":"manual"}']);
    assert.strictEqual(rein.archivados, 2);
    assert.strictEqual(await ocupados(r1500.id), 0);
    assert.strictEqual(await ocupados(r1000.id), 1, "reiniciar $1.500 NO toca $1.000");
    assert.strictEqual((await db.query("select count(*)::int n from public.numeros_rifa_archivo where tabla_id = $1", [r1000.id])).rows[0].n, 72,
        "ni su historial");
    paso("reservar y reiniciar $1.500 no afecta a $1.000 ni a $2.000 (antes eran las mismas filas físicas); el 25 de cada precio es independiente");

    // ----------------------------------------------------- grupos y sorteos ---
    const vinc = (await db.query(`select usuario_id::text u, count(distinct grupo_id)::int g, count(*)::int n from public.grupos_rifa
                                   where activo group by 1 order by 1`)).rows;
    assert.deepStrictEqual(vinc.map((f) => [f.u, f.g, f.n]), [[A, 4, 32], [B, 3, 24]], "solo grupos autorizados ACTIVOS, a todas sus rifas");
    assert.strictEqual((await rpc("rifa_resolver", [A, "g-a1", null, 1500])).tabla_id, r1500.id);
    assert.strictEqual((await rpc("rifa_resolver", [A, "g-a1", null, null])).motivo, "ambigua", "sin precio ni código NO elige");
    assert.strictEqual((await rpc("rifa_resolver", [B, "g-a1", null, 1000])).tabla_id, rB1000.id, "grupo compartido: B resuelve SU rifa");
    assert.strictEqual((await rpc("rifa_resolver", [A, "g-a5", null, 1000])).motivo, "sin_rifa", "grupo inactivo: no se vincula");
    paso("grupos: los autorizados activos quedan vinculados; el bot resuelve por precio SOLO entre los vinculados; grupo compartido sin cruces");

    const ev = (await db.query("select valor, usuario_id::text u, tabla_id from public.eventos_bot order by valor")).rows;
    assert.ok(ev.every((e) => e.tabla_id), "todos los sorteos atribuibles quedan vinculados");
    assert.strictEqual(ev.find((e) => e.valor === "1000").tabla_id, r1000.id);
    const prog = (await db.query("select estado, tabla_id from public.sorteos_programados where estado = 'programado'")).rows[0];
    assert.strictEqual(prog.tabla_id, (await rifa(B, 2000)).id);
    await esperarError(db.query("update public.eventos_bot set tabla_id = $1 where usuario_id = $2", [r1000.id, B]), /foreign key|violates/,
        "sorteo de B apuntando a rifa de A");
    paso("eventos y programados apuntan a la rifa de su cliente y precio (el programado de $2.000 de B incluido); la FK impide cruzar clientes");

    await esperarError(db.exec(M052), /ya hay rifas/, "052 dos veces");
    await db.exec("rollback");
    const r = await rpc("rifa_eliminar", [A, r1000.id, '{"origen":"manual"}']);
    assert.strictEqual(r.motivo, "tiene_historial");
    paso("la 052 no se repite; la rifa con historial migrado no se puede eliminar (D4: solo archivar)");

    console.log(`\n${ok} comprobaciones superadas.`);
})().catch((e) => { console.error("❌", e.message); if (e.position) console.error("posición", e.position); process.exit(1); });
