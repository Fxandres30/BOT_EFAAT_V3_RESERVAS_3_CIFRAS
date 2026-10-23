// ==========================================================================
// PRUEBA SQL — revisión previa a autorizar las Partes A y D (Fase 2).
// Postgres real en memoria (PGlite), NUNCA la base de producción.
//
//   1. Vueltas atrás: la de A y la de D devuelven permisos y RLS al estado
//      exacto anterior (con los permisos por defecto de Supabase).
//   2. Casos de producción que la prueba de la Fase 1 no cubría: permisos
//      por columna previos, PUBLIC con escritura, qr NOT NULL, una política
//      previa con el mismo nombre que las de la propuesta.
//   3. docs/activacion/diagnostico_rls_solo_lectura.sql: cada bloque corre,
//      no puede escribir, y los resultados "esperados" que documenta se
//      cumplen antes y después de A + D.
//   4. Hallazgo de la migración 004 (funciones de lease sin REVOKE),
//      reproducido con su SQL real.
//
// LÍMITE: esquema replicado; los resultados reales solo los da el
// diagnóstico ejecutado a mano en el SQL Editor de producción.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/revisionActivacionRls.test.js
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
const leer = r => fs.readFileSync(path.join(RAIZ, r), "utf8");

const PARTE_A = leer("docs/activacion/propuesta_rls_tablas_antiguas.sql");
const PARTE_D = leer("docs/activacion/parte_d_sesiones_columnas.sql");
const DIAGNOSTICO = leer("docs/activacion/diagnostico_rls_solo_lectura.sql");
const MIGRACION_004 = leer("backend/supabase_migrations/004_lease_sesiones.sql");

// Bloque "VUELTA ATRÁS" comentado de un archivo: las líneas "--   <sql>"
// (no las "--   -- comentario") a partir del marcador, descomentadas.
function vueltaAtras(texto, marcador, hasta) {
    const desde = texto.split(marcador)[1];
    const bloque = hasta ? desde.split(hasta)[0] : desde;
    return bloque.split("\n")
        .filter(l => /^--\s{3,}\S/.test(l) && !/^--\s+--/.test(l))
        .map(l => l.replace(/^--\s{3}/, ""))
        .join("\n");
}

// Reversión segura de A (auditoría integral 2026-10-22): archivo propio.
// Desactiva la RLS; NUNCA devuelve permisos a anon ni a PUBLIC, y con más de
// una cuenta retira también a authenticated (sin RLS vería lo de todos).
const VUELTA_A = leer("docs/activacion/reversion_parte_a.sql");
const VUELTA_D = vueltaAtras(PARTE_D, "-- VUELTA ATRÁS (una transacción");

const BLOQUES_DIAGNOSTICO = DIAGNOSTICO.split("set transaction read only;").slice(1)
    .map(b => "set transaction read only;" + b.split("\n-- ====")[0]);

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SES_A = "11111111-0000-4000-8000-000000000001";
const SES_B = "22222222-0000-4000-8000-000000000002";
const TABLAS = ["eventos_bot", "sesiones", "reservas_dos_cifras", "5k_15k_reservas_2_cifras"];

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, tabla text, activo boolean, hora_cierre text);
    create table public.sesiones (
        id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text,
        estado text default 'desconectado', activa boolean default false, principal boolean default false,
        qr text, telefono text, created_at timestamptz default now());
    create table public.reservas_dos_cifras (id serial primary key, numero text, estado text, usuario_id uuid, comprador text, identidad_evento_real text, evento_id text);
    create table public."5k_15k_reservas_2_cifras" (id serial primary key, numero text, estado text, usuario_id uuid, comprador text, identidad_evento_real text, evento_id text);
    create table public.mensajes_grupos_sorteos (id serial primary key, grupo_id text, usuario_id uuid, texto text);
    create table public.grupos_autorizados (id uuid primary key default gen_random_uuid(), usuario_id uuid not null, grupo_id text not null, activo boolean not null default true, unique (usuario_id, grupo_id));

    insert into public.eventos_bot (usuario_id, grupo_id, activo, hora_cierre) values ('${A}', 'gA', false, '14:00');
    insert into public.sesiones (id, usuario_id, nombre, estado, activa, principal) values
        ('${SES_A}', '${A}', 'bot A', 'conectado', true, true), ('${SES_B}', '${B}', 'bot B', 'desconectado', false, false);
    insert into public."5k_15k_reservas_2_cifras" (numero, estado, usuario_id) values ('00', 'libre', '${A}'), ('01', 'pagado', '${A}');
    insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('00', 'reservado', '${A}');
`;

const abiertas = [];
async function crearDb(extra = "") {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    if (extra) await db.exec(extra);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

// Estado comparable: RLS + permisos de tabla y de columna de anon/authenticated/PUBLIC.
async function foto(db) {
    const { rows } = await db.query(`
        select c.relname as t, c.relrowsecurity as rls,
            (select string_agg(x, ',' order by x) from (select (case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) || ':' || a.privilege_type as x
               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated')) y) as tabla,
            (select string_agg(att.attname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ',' order by att.attname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type)
               from pg_attribute att cross join lateral aclexplode(att.attacl) a
              where att.attrelid = c.oid and att.attacl is not null) as columnas
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by 1`, [TABLAS]);
    return rows;
}

// Lo que necesitan el panel y el bot: la foto sin anon ni PUBLIC. La Parte A
// retira además TRUNCATE/REFERENCES/TRIGGER a authenticated (TRUNCATE salta
// la RLS) y la reversión no los devuelve: tampoco cuentan.
function sinAnon(filas) {
    const fuera = x => !/^(anon|PUBLIC):/.test(x) && !/:(anon|PUBLIC|-):/.test(x)
        && !/^authenticated:(TRUNCATE|REFERENCES|TRIGGER)$/.test(x);
    return filas.map(f => ({ ...f,
        tabla: (f.tabla || "").split(",").filter(fuera).join(","),
        columnas: (f.columnas || "").split(",").filter(fuera).join(",") }));
}

async function bloque(db, sql) {
    const res = await db.exec(sql);
    return res[res.length - 1].rows;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ── 1. Vueltas atrás ─────────────────────────────────────────────────────

prueba("vuelta atrás de A con VARIAS cuentas: sin RLS, y ni anon ni otro cliente leen lo ajeno (el panel pierde el acceso directo)", async () => {
    const db = await crearDb();
    assert.ok(VUELTA_A.includes("disable row level security") && !/grant/i.test(VUELTA_A), "la reversión no concede nada");
    await db.exec(PARTE_A);
    await db.exec(VUELTA_A);
    assert.ok((await foto(db)).every(f => f.rls === false && !/(anon|authenticated|PUBLIC):/.test(f.tabla || "")), JSON.stringify(await foto(db)));
    await assert.rejects(como(db, "anon", null, "select * from public.sesiones"), /permission denied/i, "anon NO vuelve a leer");
    await assert.rejects(como(db, "authenticated", B, `select * from public."5k_15k_reservas_2_cifras"`), /permission denied/i, "B no lee lo de A");
    assert.strictEqual((await como(db, "service_role", null, "select * from public.sesiones")).length, 2, "el bot sigue");
});

prueba("vuelta atrás de A con UNA cuenta: sin RLS y con los permisos de panel y bot; anon sigue SIN acceso", async () => {
    const db = await crearDb(`delete from auth.users where id = '${B}'; delete from public.sesiones where usuario_id = '${B}';`);
    const antes = await foto(db);
    await db.exec(PARTE_A);
    assert.notDeepStrictEqual(await foto(db), antes);
    await db.exec(VUELTA_A);
    assert.deepStrictEqual(sinAnon(await foto(db)), sinAnon(antes));
    assert.ok((await foto(db)).every(f => f.rls === false));
    await assert.rejects(como(db, "anon", null, "select * from public.sesiones"), /permission denied/i, "anon NO vuelve a leer");
});

prueba("vuelta atrás de A: deja sus políticas (inactivas) y NO toca políticas ajenas", async () => {
    const db = await crearDb(`create policy "ajena" on public.mensajes_grupos_sorteos for select using (true);`);
    await db.exec(PARTE_A);
    await db.exec(VUELTA_A);
    const pol = (await db.query("select tablename, policyname from pg_policies order by 1, 2")).rows;
    assert.ok(pol.some(p => p.policyname === "ajena"), "la política ajena sigue");
    assert.ok(pol.some(p => p.policyname === "panel lee sus sesiones"), "las de A quedan, sin efecto con RLS desactivado");
});

prueba("vuelta atrás de D: permisos de sesiones idénticos a tras-A (también los de columna); trigger y función eliminados", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    const trasA = await foto(db);
    await db.exec(PARTE_D);
    await db.exec(VUELTA_D);
    assert.deepStrictEqual(await foto(db), trasA);
    const quedan = (await db.query("select count(*)::int n from pg_proc where proname = 'sesiones_alta_desde_panel'")).rows[0].n;
    assert.strictEqual(quedan, 0);
    await como(db, "authenticated", B, `update public.sesiones set activa = true where id = '${SES_B}'`);
});

prueba("orden de vuelta atrás D -> A (una cuenta) devuelve el estado original de panel y bot (anon sigue cerrado)", async () => {
    const db = await crearDb(`delete from auth.users where id = '${B}'; delete from public.sesiones where usuario_id = '${B}';`);
    const antes = await foto(db);
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    await db.exec(VUELTA_D); await db.exec(VUELTA_A);
    assert.deepStrictEqual(sinAnon(await foto(db)), sinAnon(antes));
    await assert.rejects(como(db, "anon", null, "select * from public.eventos_bot"), /permission denied/i);
});

// ── 2. Casos de producción ───────────────────────────────────────────────

prueba("D con un permiso por COLUMNA previo (update activa): Postgres lo revoca junto con el de tabla", async () => {
    const db = await crearDb(`grant update (activa) on public.sesiones to authenticated;`);
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    await assert.rejects(como(db, "authenticated", B, `update public.sesiones set activa = true where id = '${SES_B}'`), /permission denied/i);
});

prueba("PUBLIC con escritura en sesiones: la Parte A (revisada 22/10) la retira y D se aplica sin herencia", async () => {
    const db = await crearDb(`grant update on public.sesiones to public;`);
    await db.exec(PARTE_A);
    const publico = (await db.query(`select count(*)::int n from pg_class c cross join lateral aclexplode(c.relacl) a
                                      where c.relname = 'sesiones' and a.grantee = 0`)).rows[0].n;
    assert.strictEqual(publico, 0, "PUBLIC ya no tiene permisos tras A");
    await db.exec(PARTE_D);
    // Sin la herencia de PUBLIC, el panel no puede cambiar activa (lo impide D).
    await assert.rejects(como(db, "authenticated", B, `update public.sesiones set activa = true where id = '${SES_B}'`), /permission denied/i);
});

prueba("D sigue abortando si PUBLIC conserva escritura (p. ej. aplicada sin la Parte A revisada)", async () => {
    const db = await crearDb(`grant update on public.sesiones to public;`);
    await db.exec(PARTE_A);
    await db.exec(`grant update on public.sesiones to public;`);
    let error = null;
    try { await db.exec(PARTE_D); } catch (e) { error = e; }
    assert.ok(error && /PUBLIC tiene permisos de escritura/.test(error.message), String(error && error.message));
    await db.exec("rollback;");
    assert.strictEqual((await db.query("select count(*)::int n from pg_trigger where tgname = 'sesiones_alta_desde_panel'")).rows[0].n, 0);
});

prueba("D con qr y telefono NOT NULL (default '') en producción: «Nueva sesión» sigue funcionando", async () => {
    const db = await crearDb(`
        update public.sesiones set qr = '', telefono = '';
        alter table public.sesiones alter column qr set default '', alter column qr set not null,
                                    alter column telefono set default '', alter column telefono set not null;`);
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    await como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${B}', 'Nueva sesión', 'desconectado', false)`);
    const n = (await db.query("select estado, activa, qr from public.sesiones where nombre = 'Nueva sesión'")).rows[0];
    assert.deepStrictEqual(n, { estado: "desconectado", activa: false, qr: "" });
});

prueba("D sin la columna 'preferida' (opcional): se aplica igual y el alta funciona", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    await como(db, "authenticated", A, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${A}', 'x', 'conectado', true)`);
    assert.deepStrictEqual((await db.query("select estado, principal from public.sesiones where nombre = 'x'")).rows[0], { estado: "desconectado", principal: false });
});

prueba("ADVERTENCIA documentada: una política previa con el MISMO nombre que la propuesta se reemplaza sin abortar", async () => {
    const db = await crearDb(`alter table public.sesiones enable row level security;
        create policy "panel lee sus sesiones" on public.sesiones for select using (true);`);
    await db.exec(PARTE_A);
    const pol = (await db.query(`select qual from pg_policies where policyname = 'panel lee sus sesiones'`)).rows[0];
    assert.match(pol.qual, /auth\.uid/, "quedó la de la propuesta: la anterior se perdió (guardar D2 antes)");
});

prueba("usuario_id de tipo text en producción: A falla y no aplica NADA (transacción entera)", async () => {
    const db = await crearDb(`alter table public.eventos_bot alter column usuario_id type text;`);
    const antes = await foto(db);
    let error = null;
    try { await db.exec(PARTE_A); } catch (e) { error = e; }
    assert.ok(error, "debe fallar");
    await db.exec("rollback;");
    assert.deepStrictEqual(await foto(db), antes);
});

// ── 3. Diagnóstico de solo lectura ───────────────────────────────────────

prueba(`diagnóstico: los ${BLOQUES_DIAGNOSTICO.length} bloques se ejecutan en Postgres sin error`, async () => {
    const db = await crearDb();
    assert.ok(BLOQUES_DIAGNOSTICO.length >= 18, `bloques: ${BLOQUES_DIAGNOSTICO.length}`);
    for (const b of BLOQUES_DIAGNOSTICO) {
        try { await db.exec(b); } catch (e) { throw new Error(`falla el bloque:\n${b.slice(0, 300)}\n→ ${e.message}`); }
    }
});

prueba("diagnóstico: ningún bloque escribe nada y la protección read-only rechaza escrituras", async () => {
    const db = await crearDb();
    // Sin comentarios ni literales ('INSERT' en has_table_privilege no es una escritura).
    const sentencias = b => b.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    for (const b of BLOQUES_DIAGNOSTICO) assert.doesNotMatch(sentencias(b), /\b(insert|update|delete|alter|drop|grant|revoke|create|truncate|copy|call|do)\b/i, b.slice(0, 200));
    await assert.rejects(db.exec("set transaction read only; delete from public.sesiones;"), /read-only transaction/i);
    assert.strictEqual((await db.query("select count(*)::int n from public.sesiones")).rows[0].n, 2);
});

prueba("diagnóstico ANTES: guardia de A sin políticas ajenas, 0 sin dueño, anon con acceso, objetos de D inexistentes", async () => {
    const db = await crearDb();
    const b = t => BLOQUES_DIAGNOSTICO.find(x => x.includes(t));
    assert.deepStrictEqual(await bloque(db, b("as politicas_ajenas")), [{ politicas_ajenas: null }]);
    const nulos = await bloque(db, b("as sin_dueno"));
    assert.ok(nulos.filter(r => r.tabla !== "mensajes_grupos_sorteos").every(r => Number(r.sin_dueno) === 0));
    const efectivos = await bloque(db, b("as upd_nombre"));
    assert.ok(efectivos.filter(r => r.rol === "anon").every(r => r.leer === true), "hoy anon lee todo");
    assert.deepStrictEqual(await bloque(db, b("as existe_funcion")), [{ existe_funcion: false, existe_trigger: false }]);
    assert.deepStrictEqual(await bloque(db, b("not in ('usuario_id', 'nombre', 'estado', 'principal')")), [], "D7b: el alta no se rompería");
});

prueba("diagnóstico DESPUÉS de A + D: anon sin acceso; authenticated solo renombra sesiones; service_role intacto", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    const ef = await bloque(db, BLOQUES_DIAGNOSTICO.find(x => x.includes("as upd_nombre")));
    const de = (rol, tabla) => ef.find(r => r.rol === rol && r.tabla === tabla);
    for (const t of TABLAS) assert.strictEqual(de("anon", t).leer, false, t);
    assert.deepStrictEqual(
        [de("authenticated", "sesiones").upd_nombre, de("authenticated", "sesiones").upd_activa, de("authenticated", "sesiones").upd_usuario, de("authenticated", "sesiones").borrar],
        [true, false, false, false]);
    assert.strictEqual(de("authenticated", "5k_15k_reservas_2_cifras").actualizar_tabla, true, "el panel sigue pudiendo pagar/liberar");
    assert.strictEqual(de("service_role", "sesiones").borrar, true);
    const cols = await bloque(db, BLOQUES_DIAGNOSTICO.find(x => x.includes("att.attname                                                       as columna")));
    assert.deepStrictEqual(cols.filter(c => c.rol === "authenticated").map(c => `${c.columna}:${c.permisos}`).sort(),
        ["estado:INSERT", "nombre:INSERT, UPDATE", "principal:INSERT", "usuario_id:INSERT"]);
    assert.deepStrictEqual(await bloque(db, BLOQUES_DIAGNOSTICO.find(x => x.includes("as existe_funcion"))), [{ existe_funcion: true, existe_trigger: true }]);
});

// ── 4. Hallazgo: funciones de lease (migración 004) ──────────────────────

prueba("HALLAZGO 004 (reproducido en local): anon puede leer el dueño del lease, liberarlo y quedárselo -> el bot no renueva", async () => {
    const db = await crearDb();
    await db.exec(MIGRACION_004);
    // El bot (service_role) tiene el lease de la sesión de A.
    const bot = await como(db, "service_role", null, `select * from public.lease_sesiones_acquire('${SES_A}', 'vps-1', 60)`);
    assert.strictEqual(bot[0].adquirido, true);
    // Un anónimo, sin iniciar sesión, solo con el session_id:
    const espia = await como(db, "anon", null, `select owner_id from public.lease_sesiones_acquire('${SES_A}', 'x', 1)`);
    assert.strictEqual(espia[0].owner_id, "vps-1", "acquire revela el dueño del lease");
    await como(db, "anon", null, `select public.lease_sesiones_release('${SES_A}', 'vps-1')`);
    const robo = await como(db, "anon", null, `select adquirido from public.lease_sesiones_acquire('${SES_A}', 'atacante', 86400)`);
    assert.strictEqual(robo[0].adquirido, true);
    const latido = await como(db, "service_role", null, `select renovado from public.lease_sesiones_heartbeat('${SES_A}', 'vps-1', 60)`);
    assert.strictEqual(latido[0].renovado, false, "el bot pierde el lease");
    // Ni la Parte A ni la D lo impiden:
    await db.exec(PARTE_A); await db.exec(PARTE_D);
    const sigue = await como(db, "anon", null, `select owner_id from public.lease_sesiones_acquire('${SES_A}', 'y', 1)`);
    assert.strictEqual(sigue[0].owner_id, "atacante");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    await Promise.allSettled(abiertas.map(db => db.close()));
    process.exit(falla ? 1 : 0);
})();
