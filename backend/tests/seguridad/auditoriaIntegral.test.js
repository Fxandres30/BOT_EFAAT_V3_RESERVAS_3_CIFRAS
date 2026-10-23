// ==========================================================================
// Auditoría integral del aislamiento multicliente (2026-10-22, §2f).
//
// Aplica los ARCHIVOS REALES en el orden de ACTIVACION.md §2f sobre una base
// que reproduce producción (UNIQUE(numero), políticas públicas abiertas,
// trigger de pago heredado en modo invoker, funciones definer abiertas, sesión
// huérfana con su lease, tablas heredadas sin dueño, permisos por defecto de
// Supabase) con dos clientes: A (cuenta principal con datos) y B (nuevo).
//
// Dos motores, el mismo código de prueba:
//   - PGlite (Postgres 17 compilado a WASM, en memoria, un solo usuario del
//     sistema, como superusuario):
//       PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//           node backend/tests/seguridad/auditoriaIntegral.test.js
//   - PostgreSQL real (servidor local, NUNCA producción): las migraciones las
//     ejecuta un dueño SIN superusuario ni bypassrls (como "postgres" en
//     Supabase) y la concurrencia se prueba con conexiones simultáneas:
//       EFAAT_PG_ADMIN_URL=postgres://postgres@127.0.0.1:55433/postgres \
//       PG_MODULE=<carpeta>/node_modules/pg \
//           node backend/tests/seguridad/auditoriaIntegral.test.js
//     La URL debe apuntar a 127.0.0.1/localhost (la prueba se niega si no).
// No se conecta a ninguna base remota.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const { configuracionesBase } = require(path.join(RAIZ, "backend/bot/funciones/eventos/configEvento.js"));

// ------------------------------------------------------------- motor ---
const URL_ADMIN = process.env.EFAAT_PG_ADMIN_URL || "";
let motor, PGlite, pg;
if (URL_ADMIN) {
    if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_ADMIN)) {
        console.log("⛔ EFAAT_PG_ADMIN_URL no es local: prueba cancelada.");
        process.exit(1);
    }
    pg = require(process.env.PG_MODULE || "pg");
    motor = "postgres";
} else {
    try {
        ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
        motor = "pglite";
    } catch {
        console.log("⏭️  Ni PGlite ni EFAAT_PG_ADMIN_URL — prueba SQL omitida.");
        process.exit(0);
    }
}

const ARCH = {
    limpieza: leer("docs/activacion/limpieza_sesion_huerfana.sql"),
    m031: leer("backend/supabase_migrations/031_qr_sesion_publica.sql"),
    parteA: leer("docs/activacion/propuesta_rls_tablas_antiguas.sql"),
    reversionA: leer("docs/activacion/reversion_parte_a.sql"),
    parteD: leer("docs/activacion/parte_d_sesiones_columnas.sql"),
    m033: leer("backend/supabase_migrations/033_cuadricula_por_cliente.sql"),
    m027: leer("backend/supabase_migrations/027_tablas_cliente.sql"),
    parteB: leer("docs/activacion/parte_b_compradores_semanales.sql"),
    m034: leer("backend/supabase_migrations/034_compradores_por_cliente.sql"),
    asignacion: leer("docs/activacion/asignacion_compradores_historicos.sql"),
    parteG: leer("docs/activacion/parte_g_funciones_definer.sql"),
    m035: leer("backend/supabase_migrations/035_rls_tablas_cliente.sql"),
    parteC: leer("docs/activacion/parte_c_tablas_legado.sql"),
    m029: leer("backend/supabase_migrations/029_rls_mensajes_por_cliente.sql"),
    validacion: leer("docs/activacion/validacion_final_aislamiento_solo_lectura.sql")
};

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const HUERFANO = "8b31d700-0000-4000-8000-000000000000";
const SES_A = "5e55a000-0000-4000-8000-00000000000a";
const SES_B = "5e55b000-0000-4000-8000-00000000000b";
const SES_H = "5e55c000-0000-4000-8000-00000000000c";
const T5K = '"5k_15k_reservas_2_cifras"';
const BASE = JSON.stringify(configuracionesBase());

const COLUMNAS_RESERVA = `
    id serial primary key, numero text not null, estado text, usuario_id uuid,
    comprador text, contacto text, nombre text, telefono text, grupo_id text,
    evento_id text, fecha_pago text, hora_pago text, temporal_por text,
    bloqueado_hasta timestamptz, identidad_evento_real text`;

const ROLES = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`;

const ENTORNO = `
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.sesiones (id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text, telefono text,
        estado text default 'desconectado', principal boolean default false, activa boolean default false,
        preferida boolean default false, qr text, qr_expira_en timestamptz);
    create table public.sesiones_lease (session_id uuid primary key references public.sesiones(id) on delete cascade, owner_id text not null);
    create table public.event_sessions (id serial primary key, usuario_id uuid, session_id uuid references public.sesiones(id) on delete set null);
    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, activo boolean, tabla text, hora_cierre text);
    create table public.reservas_dos_cifras (${COLUMNAS_RESERVA}, constraint reservas_dos_cifras_numero_key unique (numero));
    create table public.${T5K} (${COLUMNAS_RESERVA}, constraint "5k_15k_reservas_2_cifras_numero_key" unique (numero));
    create policy "Enable read access for all users" on public.reservas_dos_cifras for select using (true);
    create policy "Permitir todo" on public.${T5K} for all to public using (true) with check (true);

    create table public.compradores_semanales (id serial primary key, nombre text not null, whatsapp text,
        total_semanal int default 0, entregados_3cifras int default 0);
    create function public.actualizar_compradores_semanales() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            update public.compradores_semanales set total_semanal = total_semanal + 1 where whatsapp = new.telefono;
            if not found then
                insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values (coalesce(new.comprador, 'x'), new.telefono, 1);
            end if;
        end if;
        return new;
    end $$;
    create trigger trg_compradores after update on public.reservas_dos_cifras for each row execute function public.actualizar_compradores_semanales();
    create trigger trg_compradores after update on public.${T5K} for each row execute function public.actualizar_compradores_semanales();

    create function public.asignar_numeros_gratis() returns bigint language sql security definer as $$ select count(*) from public.reservas_dos_cifras $$;
    create function public.sumar_entregados_tres_cifras(p text) returns void language sql security definer as $$
        update public.compradores_semanales set entregados_3cifras = entregados_3cifras + 1 where whatsapp = p $$;
    create function public.lease_sesiones_acquire(p_session uuid, p_owner text) returns boolean language plpgsql security definer as $$
    begin insert into public.sesiones_lease values (p_session, p_owner) on conflict (session_id) do nothing; return found; end $$;

    create table public.plantillas_mensaje (id serial primary key, usuario_id uuid, texto text);
    create policy "acceso total" on public.plantillas_mensaje for all using (true);
    create table public.automation_messages (id serial primary key, usuario_id uuid, texto text);
    alter table public.automation_messages enable row level security;
    create policy "usuarios ven mensajes globales y propios" on public.automation_messages for select using (usuario_id is null or auth.uid() = usuario_id);
    create policy "usuarios crean sus propios mensajes" on public.automation_messages for insert with check (auth.uid() = usuario_id);
    create table public.contactos_tenant (id serial primary key, usuario_id uuid, nombre text);
    create table public.grupos_autorizados (id serial primary key, usuario_id uuid, grupo_id text, unique (usuario_id, grupo_id));
    create table public.inactividad_miembros (id serial primary key, usuario_id uuid, session_id text);
    create table public.usuarios (id serial primary key, telefono text);
    create table public.grupos (jid text primary key, nombre text);
    create table public.registro_usuarios (id serial primary key, ip text);
    create table public.reservas_2_cifras_1000 (id serial primary key, numero text, telefono text);
    create table public.mensajes_grupos_sorteos (id serial primary key, grupo_id text, texto text,
        cliente_usuario_id uuid, creado_en timestamptz default now());

    insert into public.sesiones (id, usuario_id, nombre, estado, principal, activa, qr) values
        ('${SES_A}', '${A}', 'bot A', 'conectado', true, true, null),
        ('${SES_B}', '${B}', 'bot B', 'conectado', true, true, 'QR-B'),
        ('${SES_H}', '${HUERFANO}', 'vieja', 'desconectado', false, false, 'QR-VIEJO');
    insert into public.sesiones_lease values ('${SES_H}', 'VPS-viejo'), ('${SES_A}', 'VPS');
    insert into public.event_sessions (usuario_id, session_id) values ('${A}', '${SES_A}');
    insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${A}', 'gA', false, '5k_15k_reservas_2_cifras');
    insert into public.reservas_dos_cifras (numero, estado, usuario_id) select lpad(g::text, 2, '0'), 'libre', '${A}' from generate_series(0, 99) g;
    insert into public.${T5K} (numero, estado, usuario_id, comprador, telefono)
        select lpad(g::text, 2, '0'), case when g < 50 then 'pagado' when g < 90 then 'reservado' else 'libre' end, '${A}',
               case when g < 90 then 'Comprador ' || g end, case when g < 90 then '300' || lpad(g::text, 7, '0') end
        from generate_series(0, 99) g;
    insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values ('Histórico', '3009999999', 5);
    insert into public.plantillas_mensaje (usuario_id, texto) values ('${A}', 'plantilla A'), ('${B}', 'plantilla B');
    insert into public.automation_messages (usuario_id, texto) values (null, 'global'), ('${A}', 'msg A'), ('${B}', 'msg B');
    insert into public.contactos_tenant (usuario_id, nombre) values ('${A}', 'contacto A'), ('${B}', 'contacto B');
    insert into public.grupos_autorizados (usuario_id, grupo_id) values ('${A}', 'g1@g.us'), ('${B}', 'g1@g.us');
    insert into public.usuarios (telefono) values ('3001112222');
    insert into public.grupos values ('g1@g.us', 'Grupo compartido');
    insert into public.registro_usuarios (ip) values ('10.0.0.1');
    insert into public.reservas_2_cifras_1000 (numero, telefono) values ('00', '3005550000');
    insert into public.mensajes_grupos_sorteos (grupo_id, texto, cliente_usuario_id) values
        ('g1@g.us', 'hola (bot A)', '${A}'), ('g1@g.us', 'hola (bot B)', '${B}');
`;

// ------------------------------------------------------ base de prueba ---
const abiertas = [];
let contador = 0;
let rolesListos = false;

class BaseReal {
    constructor(cliente, extra) { this.c = cliente; this.extra = extra || []; }
    async exec(sql) { return this.c.query(sql); }
    async query(sql, params) { const r = await this.c.query(sql, params); return { rows: r.rows }; }
    async close() { for (const e of this.extra) await e.end().catch(() => {}); await this.c.end().catch(() => {}); }
}

async function crearDb() {
    if (motor === "pglite") {
        const db = new PGlite();
        abiertas.push(db);
        await db.exec(ROLES + ENTORNO);
        return db;
    }
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    if (!rolesListos) {
        await admin.query(`
            do $$ begin
                if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
                if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
                if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
                if not exists (select 1 from pg_roles where rolname = 'efaat_dueno') then
                    create role efaat_dueno login nosuperuser nobypassrls nocreaterole;
                end if;
            end $$;
            grant anon, authenticated, service_role to efaat_dueno;`);
        rolesListos = true;
    }
    const nombre = `efaat_prueba_${process.pid}_${++contador}`;
    await admin.query(`create database ${nombre} owner efaat_dueno`);
    await admin.end();
    const url = URL_ADMIN.replace(/\/\/[^@]*@/, "//efaat_dueno@").replace(/\/[^/?]+(\?|$)/, `/${nombre}$1`);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    c.on("notice", () => {});
    const db = new BaseReal(c);
    db.url = url;
    db.nombre = nombre;
    abiertas.push(db);
    await db.exec(ENTORNO);
    return db;
}

async function aplicar(db, sql) {
    try { await db.exec(sql); return null; }
    catch (e) { await db.exec("rollback;").catch(() => {}); return e; }
}
async function aplicarOk(db, sql, nombre) {
    const e = await aplicar(db, sql);
    if (e) throw new Error(`${nombre} falló: ${e.message}`);
}
async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}
async function md5Heredada(db) {
    return (await db.query("select md5(prosrc) m from pg_proc where proname = 'actualizar_compradores_semanales'")).rows[0].m;
}
async function parteB(db) {
    // cceca089f72b33a12832eaf6c9f438c5 = md5 de producción; la función de prueba tiene otro cuerpo.
    return ARCH.parteB.replaceAll("cceca089f72b33a12832eaf6c9f438c5", await md5Heredada(db));
}
async function huella(db, tabla, usuario) {
    return (await db.query(`select md5(string_agg(row(numero, estado, comprador, telefono)::text, '|' order by numero)) h,
                                   count(*)::int n from public.${tabla} where usuario_id = '${usuario}'`)).rows[0];
}
// La consulta de validación tal cual, en una transacción de SOLO LECTURA
// (cualquier escritura fallaría).
async function validar(db) {
    const consulta = ARCH.validacion.split(/^set transaction read only;$/m)[1].trim().replace(/;$/, "");
    await db.exec("begin; set transaction read only;");
    try {
        const filas = (await db.query(consulta)).rows;
        return Object.fromEntries(filas.map(f => [f.bloque, f]));
    } finally {
        await db.exec("rollback;");
    }
}

const SECUENCIA = [
    ["limpieza", (db) => ARCH.limpieza.replaceAll("<ID_SESION>", SES_H)],
    ["031", () => ARCH.m031],
    ["Parte A", () => ARCH.parteA],
    ["Parte D", () => ARCH.parteD],
    ["033", () => ARCH.m033],
    ["027", () => ARCH.m027],
    ["Parte B", (db) => parteB(db)],
    ["034", () => ARCH.m034],
    ["Parte G", () => ARCH.parteG],
    ["035", () => ARCH.m035],
    ["Parte C", () => ARCH.parteC],
    ["029", () => ARCH.m029]
];

async function activar(db, hasta) {
    for (const [n, sql] of SECUENCIA) {
        await aplicarOk(db, await sql(db), n);
        if (n === hasta) return;
    }
}

const pruebas = [];
const prueba = (n, fn, soloPostgres = false) => pruebas.push({ n, fn, soloPostgres });

// ===================================================== 1. orden y semáforos
prueba("validación final: ANTES la sesión huérfana solo se informa; DESPUÉS de la secuencia §2f todo en OK", async () => {
    const db = await crearDb();
    const antes = await validar(db);
    assert.strictEqual(antes.precondiciones.semaforo, "OK", JSON.stringify(antes.precondiciones.resultado));
    assert.ok(Number(antes.precondiciones.resultado.filas_sin_dueno_o_huerfanas.sesiones) === 1);
    assert.strictEqual(antes.B_funcion_heredada.semaforo, "PENDIENTE");
    assert.strictEqual(antes.B_funcion_heredada.resultado.funciones[0].md5_cuerpo, await md5Heredada(db));
    assert.strictEqual(antes.exposicion.semaforo, "PENDIENTE");
    assert.strictEqual(antes.funciones.semaforo, "BLOQUEO", "sin la 031 no hay QR público verificable");
    await activar(db);
    const despues = await validar(db);
    for (const b of ["precondiciones", "politicas", "exposicion", "funciones"]) {
        assert.strictEqual(despues[b].semaforo, "OK", `${b}: ${JSON.stringify(despues[b].resultado)}`);
    }
    const pasos = despues.pasos.resultado;
    for (const p of ["031", "parte_a", "033", "027", "b2", "034", "029"]) assert.strictEqual(pasos[p], true, p);
    assert.strictEqual(pasos.efaat_admin_protegido, true);
});

prueba("validación final: una relación desconocida legible por anon es BLOQUEO (no OK)", async () => {
    const db = await crearDb();
    await activar(db);
    await db.exec("create table public.tabla_nueva_sin_revisar (id int); create view public.vista_reservas as select numero, telefono from public.reservas_dos_cifras;");
    const v = await validar(db);
    assert.strictEqual(v.exposicion.semaforo, "BLOQUEO");
    assert.strictEqual(v.precondiciones.semaforo, "BLOQUEO", "vista que salta la RLS");
});

prueba("diagnósticos de solo lectura (V1–V6, R0–R15, único): corren sin error antes y después; V3 = 027_podria_pasar", async () => {
    const bloques = (archivo) => leer(archivo).split(/^set transaction read only;$/m).slice(1)
        .map(b => b.split(/\n-- ={10,}/)[0].trim().replace(/;$/, "")).filter(b => /^(with|select)\b/i.test(b));
    const archivos = ["docs/activacion/validacion_parte_a_solo_lectura.sql", "docs/activacion/diagnostico_reservas_parte_a_solo_lectura.sql",
                      "docs/activacion/diagnostico_unico_parte_a_solo_lectura.sql"];
    const correr = async (db, sql) => {
        const s = sql.replaceAll("<UUID_PRINCIPAL>", A);
        await db.exec("begin; set transaction read only;");
        try {
            const r = await db.exec(s);
            const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
            return ultimo.rows;
        } finally { await db.exec("rollback;"); }
    };
    const db = await crearDb();
    for (const f of archivos) for (const b of bloques(f)) await correr(db, b);
    await activar(db);
    let v3 = null;
    for (const f of archivos) for (const b of bloques(f)) {
        const filas = await correr(db, b);
        if (/027_podria_pasar/.test(b)) v3 = filas;
    }
    assert.ok(v3 && v3.length === 2 && v3.every(f => f.resultado === "027_podria_pasar"), JSON.stringify(v3));
});

prueba("sorteos: activo = true bloquea la ventana; activo NULL no (inerte para el bot); la consulta de pendientes los clasifica sin escribir", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values
        ('${A}', 'n1', null, 'reservas_dos_cifras'), ('${A}', 'n2', null, 'reservas_dos_cifras'), ('${A}', 'n3', null, 'x')`);
    assert.strictEqual((await validar(db)).precondiciones.semaforo, "OK");
    const consulta = leer("docs/activacion/sorteos_pendientes_solo_lectura.sql").split(/^set transaction read only;$/m)[1].trim().replace(/;$/, "");
    await db.exec("begin; set transaction read only;");
    let filas;
    try { filas = (await db.query(consulta)).rows; } finally { await db.exec("rollback;"); }
    assert.deepStrictEqual(filas.map(f => f.resolucion), ["inerte_para_el_bot", "inerte_para_el_bot", "inerte_para_el_bot"]);
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${A}', 'vivo', true, 'reservas_dos_cifras'),
                                                                                       ('${HUERFANO}', 'h', null, 'x')`);
    assert.strictEqual((await validar(db)).precondiciones.semaforo, "BLOQUEO");
    await db.exec("begin; set transaction read only;");
    try { filas = (await db.query(consulta)).rows; } finally { await db.exec("rollback;"); }
    assert.ok(filas.some(f => f.resolucion === "esperar_cierre") && filas.some(f => f.resolucion === "revisar_dueno"), JSON.stringify(filas));
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot where activo is null")).rows[0].n, 4, "ningún estado cambiado");
});

prueba("secuencia SIN la limpieza opcional: la sesión huérfana se conserva intacta y aislada", async () => {
    const db = await crearDb();
    for (const [n, sql] of SECUENCIA) if (n !== "limpieza") await aplicarOk(db, await sql(db), n);
    const fila = (await db.query(`select usuario_id::text u, qr from public.sesiones where id = '${SES_H}'`)).rows[0];
    assert.deepStrictEqual(fila, { u: HUERFANO, qr: "QR-VIEJO" }, "ni borrada ni reasignada");
    for (const u of [A, B]) assert.strictEqual((await como(db, "authenticated", u, `select count(*)::int n from public.sesiones where id = '${SES_H}'`))[0].n, 0);
    await assert.rejects(como(db, "anon", null, "select * from public.sesiones"), /permission denied/i);
    const v = await validar(db);
    for (const b of ["precondiciones", "politicas", "exposicion", "funciones"]) assert.strictEqual(v[b].semaforo, "OK", b);
});

// ===================================================== 2. cuadrículas
prueba("dos clientes con 00-99 en las 2 tablas físicas; A intacta; inicialización idempotente", async () => {
    const db = await crearDb();
    const antes = [await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)];
    await activar(db);
    const r1 = (await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb) r`))[0].r;
    assert.ok(r1.cuadriculas.every(c => c.estado === "creada" && c.filas === 100), JSON.stringify(r1));
    const r2 = (await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb) r`))[0].r;
    assert.ok(r2.cuadriculas.every(c => c.estado === "existente") && r2.configuraciones_creadas === 0, JSON.stringify(r2));
    const rA = (await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${A}', '${BASE}'::jsonb) r`))[0].r;
    assert.ok(rA.cuadriculas.every(c => c.estado === "existente"), JSON.stringify(rA));
    for (const t of [T5K, "reservas_dos_cifras"]) {
        const n = (await db.query(`select count(*)::int n, count(distinct numero)::int d,
                                          count(*) filter (where usuario_id = '${A}')::int a, count(*) filter (where usuario_id = '${B}')::int b
                                   from public.${t}`)).rows[0];
        assert.deepStrictEqual(n, { n: 200, d: 100, a: 100, b: 100 }, t);
    }
    assert.deepStrictEqual([await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)], antes, "A idéntica");
    await assert.rejects(como(db, "service_role", null, `insert into public.${T5K} (numero, estado) values ('13', 'libre')`), /null value|not-null/i, "033: sin dueño no");
});

prueba("B reserva, paga y libera su 13 (backend) sin alterar el 13 ni nada de A", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    const hA = await huella(db, T5K, A);
    const filtro = `numero = '13' and usuario_id = '${B}'`;
    assert.strictEqual((await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', comprador = 'Cliente B', telefono = '3101313131' where ${filtro} and estado = 'libre' returning id`)).length, 1);
    assert.deepStrictEqual(await huella(db, T5K, A), hA);
    assert.strictEqual((await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where ${filtro} and estado = 'reservado' returning id`)).length, 1);
    assert.deepStrictEqual(await huella(db, T5K, A), hA);
    assert.strictEqual((await como(db, "authenticated", B, `select estado from public.${T5K} where numero = '13'`))[0].estado, "pagado", "B lo ve en su panel");
    assert.strictEqual((await como(db, "authenticated", A, `select estado from public.${T5K} where numero = '13'`))[0].estado, "pagado", "el 13 de A sigue como estaba (pagado)");
    assert.strictEqual((await como(db, "service_role", null, `update public.${T5K} set estado = 'libre', comprador = null, telefono = null where ${filtro} returning id`)).length, 1);
    assert.deepStrictEqual(await huella(db, T5K, A), hA);
    assert.strictEqual((await como(db, "authenticated", A, `select count(*)::int n from public.${T5K}`))[0].n, 100, "A solo ve sus 100");
});

prueba("inicialización simultánea del mismo cliente (dos conexiones reales): una sola cuadrícula", async () => {
    const db = await crearDb();
    await activar(db);
    const c1 = new pg.Client({ connectionString: db.url }), c2 = new pg.Client({ connectionString: db.url });
    await c1.connect(); await c2.connect();
    db.extra.push(c1, c2);
    const sql = `set role service_role; select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb) r;`;
    const [r1, r2] = await Promise.all([c1.query(sql), c2.query(sql)]);
    const estados = [r1, r2].map(r => r[1].rows[0].r.cuadriculas.map(c => c.estado).join(","));
    assert.ok(estados.includes("creada,creada") && estados.includes("existente,existente"), estados.join(" | "));
    assert.strictEqual((await db.query(`select count(*)::int n from public.${T5K} where usuario_id = '${B}'`)).rows[0].n, 100);
}, true);

// ===================================================== 3. panel y anon
prueba("panel autenticado: lee y reinicia lo suyo; no inserta reservas, no toca lo ajeno, no TRUNCATE", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    assert.strictEqual((await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre', comprador = null where usuario_id = '${B}' returning id`)).length, 100);
    assert.strictEqual((await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre' where usuario_id = '${A}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", B, `update public.${T5K} set usuario_id = '${A}' where numero = '01' and usuario_id = '${B}'`), /row-level security/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('100', 'libre', '${B}')`), /row-level security/i);
    for (const t of [T5K, "reservas_dos_cifras", "eventos_bot", "sesiones", "plantillas_mensaje"]) {
        await assert.rejects(como(db, "authenticated", B, `truncate public.${t}`), /permission denied/i, t);
    }
    assert.strictEqual((await db.query(`select count(*)::int n from public.${T5K} where usuario_id = '${A}' and estado = 'pagado'`)).rows[0].n, 50, "pagos de A intactos");
});

prueba("sesiones: el panel crea y renombra las suyas; no cambia dueño, estado ni la sesión del otro; no borra", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${B}', 'Nueva sesión', 'desconectado', false)`);
    await assert.rejects(como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${A}', 'intrusa', 'desconectado', false)`), /row-level security/i);
    assert.strictEqual((await como(db, "authenticated", B, `update public.sesiones set nombre = 'B renombrada' where id = '${SES_B}' returning id`)).length, 1);
    await assert.rejects(como(db, "authenticated", B, `update public.sesiones set usuario_id = '${A}' where id = '${SES_B}'`), /permission denied/i, "Parte D");
    await assert.rejects(como(db, "authenticated", B, `update public.sesiones set activa = false where id = '${SES_A}'`), /permission denied/i);
    assert.strictEqual((await como(db, "authenticated", B, `update public.sesiones set nombre = 'x' where id = '${SES_A}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", B, `delete from public.sesiones where id = '${SES_B}'`), /permission denied/i);
    assert.deepStrictEqual((await db.query(`select nombre, activa, estado from public.sesiones where id = '${SES_A}'`)).rows[0], { nombre: "bot A", activa: true, estado: "conectado" });
});

prueba("anon: ninguna tabla privada, ni efaat_admin; solo el QR de UNA sesión por la RPC", async () => {
    const db = await crearDb();
    await activar(db);
    for (const t of [T5K, "reservas_dos_cifras", "eventos_bot", "sesiones", "sesiones_lease", "compradores_semanales", "plantillas_mensaje",
                     "automation_messages", "contactos_tenant", "grupos_autorizados", "usuarios", "grupos", "registro_usuarios",
                     "reservas_2_cifras_1000", "mensajes_grupos_sorteos", "inactividad_miembros", "tablas_cliente"]) {
        await assert.rejects(como(db, "anon", null, `select * from public.${t}`), /permission denied/i, t);
    }
    for (const r of ["anon", "authenticated", "service_role"]) {
        await assert.rejects(como(db, r, A, "select * from efaat_admin.cambios_seguridad"), /permission denied/i, r);
    }
    const qr = (await como(db, "anon", null, `select public.qr_sesion_publica('${SES_B}') r`))[0].r;
    assert.deepStrictEqual(Object.keys(qr).sort(), ["estado", "qr", "qr_expira_en"]);
    assert.strictEqual(qr.qr, "QR-B");
    assert.strictEqual((await como(db, "anon", null, `select public.qr_sesion_publica('no-existe') r`))[0].r, null);
});

prueba("eventos, contactos, grupos autorizados, mensajes y chats: cada panel solo lo suyo (+ mensajes globales)", async () => {
    const db = await crearDb();
    await activar(db);
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${B}', 'gB', false, '5k_15k_reservas_2_cifras')`);
    const ver = async (u, sql) => (await como(db, "authenticated", u, sql)).map(r => Object.values(r)[0]);
    assert.deepStrictEqual(await ver(B, "select grupo_id from public.eventos_bot"), ["gB"]);
    assert.deepStrictEqual(await ver(B, "select nombre from public.contactos_tenant"), ["contacto B"]);
    assert.deepStrictEqual(await ver(B, "select usuario_id::text from public.grupos_autorizados"), [B]);
    assert.deepStrictEqual(await ver(B, "select texto from public.automation_messages order by texto"), ["global", "msg B"]);
    assert.deepStrictEqual(await ver(B, "select texto from public.mensajes_grupos_sorteos"), ["hola (bot B)"]);
    assert.deepStrictEqual(await ver(A, "select texto from public.mensajes_grupos_sorteos"), ["hola (bot A)"]);
    assert.strictEqual((await como(db, "authenticated", B, `update public.grupos_autorizados set grupo_id = 'x' where usuario_id = '${A}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", B, `insert into public.automation_messages (usuario_id, texto) values (null, 'global falso')`), /row-level security/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.mensajes_grupos_sorteos (grupo_id, texto, cliente_usuario_id) values ('g', 'x', '${B}')`), /permission denied/i);
});

// ===================================================== 4. bot y RPC
prueba("bot (service_role): gestiona su lease y todas las tablas; el navegador no puede robar el lease", async () => {
    const db = await crearDb();
    await activar(db);
    await assert.rejects(como(db, "authenticated", B, `select public.lease_sesiones_acquire('${SES_A}', 'robo')`), /permission denied/i);
    await assert.rejects(como(db, "anon", null, `select public.lease_sesiones_acquire('${SES_A}', 'robo')`), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, `select public.lease_sesiones_acquire('${SES_B}', 'VPS-B') ok`))[0].ok, true);
    assert.strictEqual((await como(db, "service_role", null, `select public.lease_sesiones_acquire('${SES_A}', 'otro') ok`))[0].ok, false, "el lease de A sigue siendo de A");
    assert.strictEqual((await db.query(`select owner_id from public.sesiones_lease where session_id = '${SES_A}'`)).rows[0].owner_id, "VPS");
    assert.strictEqual((await como(db, "service_role", null, "select count(*)::int n from public.sesiones"))[0].n, 2);
});

prueba("RPC: toda SECURITY DEFINER de public cerrada al navegador salvo qr_sesion_publica", async () => {
    const db = await crearDb();
    await activar(db);
    const abiertas = (await db.query(`select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows.map(r => r.f);
    assert.deepStrictEqual(abiertas, ["qr_sesion_publica(text)"]);
    const deServicio = (await db.query(`select bool_and(has_function_privilege('service_role', p.oid, 'execute')) ok from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef`)).rows[0].ok;
    assert.strictEqual(deServicio, true);
});

prueba("Parte G aborta (y no cambia nada) si qr_sesion_publica no es la versión de la 031", async () => {
    const db = await crearDb();
    await activar(db, "035");
    await db.exec(`create or replace function public.qr_sesion_publica(p_id text) returns jsonb language sql stable security definer
                   set search_path = public, pg_temp as $$ select to_jsonb(s) from public.sesiones s where s.id::text = p_id $$;`);
    const e = await aplicar(db, ARCH.parteG);
    assert.ok(e && /no es la versión de la 031/.test(e.message), e && e.message);
});

// ===================================================== 5. compradores
prueba("compradores: el mismo teléfono que compra a A y a B queda en dos filas independientes", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    const tel = "3207654321";
    const pagar = async (u, numero) => {
        await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', telefono = '${tel}', comprador = 'Mismo' where numero = '${numero}' and usuario_id = '${u}'`);
        await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where numero = '${numero}' and usuario_id = '${u}'`);
    };
    const filas = async () => (await db.query(`select usuario_id::text u, total_semanal t from public.compradores_semanales where whatsapp = '${tel}' order by 1`)).rows;
    await pagar(A, "95");
    assert.deepStrictEqual(await filas(), [{ u: A, t: 1 }]);
    await pagar(B, "13");
    assert.deepStrictEqual(await filas(), [{ u: A, t: 1 }, { u: B, t: 1 }], "B tiene su propia fila; la de A no cambia");
    await pagar(B, "14");
    await pagar(A, "96");
    assert.deepStrictEqual(await filas(), [{ u: A, t: 2 }, { u: B, t: 2 }]);
    // El histórico sin dueño no se asigna por suposición, y solo lo actualiza
    // el cliente que lo generó (A, único con actividad al aplicar la 034).
    const hist = async () => (await db.query(`select usuario_id::text u, total_semanal t from public.compradores_semanales where whatsapp = '3009999999' order by 1 nulls first`)).rows;
    assert.deepStrictEqual(await hist(), [{ u: null, t: 5 }]);
    const pagarTel = async (u, numero, t) => {
        await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', telefono = '${t}' where numero = '${numero}' and usuario_id = '${u}'`);
        await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where numero = '${numero}' and usuario_id = '${u}'`);
    };
    await pagarTel(B, "20", "3009999999");
    assert.deepStrictEqual(await hist(), [{ u: null, t: 5 }, { u: B, t: 1 }], "B no toca el histórico: fila propia");
    await pagarTel(A, "97", "3009999999");
    assert.deepStrictEqual(await hist(), [{ u: null, t: 6 }, { u: B, t: 1 }], "A sigue sumando en su histórico");
});

prueba("asignación explícita del histórico: solo con evidencia de un único dueño; reversible", async () => {
    const db = await crearDb();
    await activar(db);
    const sql = ARCH.asignacion.replaceAll("<UUID_PRINCIPAL>", A);
    const otro = await aplicar(db, ARCH.asignacion.replaceAll("<UUID_PRINCIPAL>", B));
    assert.ok(otro && /no respalda/.test(otro.message), otro && otro.message);
    await aplicarOk(db, sql, "asignación");
    assert.strictEqual((await db.query(`select usuario_id::text u from public.compradores_semanales where whatsapp = '3009999999'`)).rows[0].u, A);
    const dos = await aplicar(db, sql);
    assert.ok(dos && /ya se aplicó/.test(dos.message));
    const rev = ARCH.asignacion.split("-- REVERSIÓN")[1].split("\n").filter(l => /^--\s{3}\S/.test(l)).map(l => l.replace(/^--\s{3}/, "")).join("\n");
    await aplicarOk(db, rev, "reversión asignación");
    assert.strictEqual((await db.query(`select usuario_id from public.compradores_semanales where whatsapp = '3009999999'`)).rows[0].usuario_id, null);

    // Con actividad de B antes de la 034, la evidencia no basta: aborta.
    const db2 = await crearDb();
    await activar(db2, "Parte B");
    await db2.exec(`insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${B}', 'gB', false, 'x')`);
    await aplicarOk(db2, ARCH.m034, "034");
    const e = await aplicar(db2, sql);
    assert.ok(e && /no respalda/.test(e.message), e && e.message);
});

prueba("034 aborta si compradores_semanales tiene UNIQUE(whatsapp) (la fila por cliente haría fallar el pago)", async () => {
    const db = await crearDb();
    await activar(db, "Parte B");
    await db.exec("alter table public.compradores_semanales add constraint compradores_whatsapp_key unique (whatsapp);");
    const e = await aplicar(db, ARCH.m034);
    assert.ok(e && /unicidades sin usuario_id/.test(e.message), e && e.message);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_trigger where tgname = '000_efaat_cliente'`)).rows[0].n, 0);
});

// ===================================================== 6. abortos seguros
prueba("abortos seguros: cada pieza sin su requisito no cambia nada", async () => {
    const casos = [
        ["027 sin la Parte A", [], ARCH.m027, /027 abortada/],
        ["034 sin la B2", [], ARCH.m034, /Aplica antes la Parte B2/],
        ["Parte G sin la 031", [], ARCH.parteG, /falta qr_sesion_publica/],
        ["Parte D sin la Parte A", [], ARCH.parteD, /Parte D abortada/],
        ["Parte A con reservas de una cuenta inexistente", [`insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('h1', 'libre', '${HUERFANO}')`], ARCH.parteA, /cuentas inexistentes/],
        ["033 con filas sin dueño", ["insert into public.reservas_dos_cifras (numero, estado) values ('x1', 'libre')"], ARCH.m033, /sin usuario_id/]
    ];
    for (const [nombre, prep, sql, esperado] of casos) {
        const db = await crearDb();
        for (const p of prep) await db.exec(p);
        const e = await aplicar(db, sql);
        assert.ok(e && esperado.test(e.message), `${nombre}: ${e && e.message}`);
        assert.strictEqual((await db.query("select count(*)::int n from pg_namespace where nspname = 'efaat_admin'")).rows[0].n, 0, `${nombre}: nada aplicado`);
        assert.strictEqual((await como(db, "anon", null, `select count(*)::int n from public.${T5K}`))[0].n, 100, `${nombre}: anon igual que antes`);
    }
});

prueba("Parte A aborta ante políticas que no puede clasificar (restrictiva, otra condición, propietario para DELETE, vista)", async () => {
    const casos = [
        [`create policy "solo pagadas" on public.${T5K} as restrictive for select to authenticated using (estado = 'pagado')`, /solo pagadas/],
        [`create policy "con dueño" on public.eventos_bot for select to authenticated using (usuario_id is not null)`, /con dueño/],
        [`create policy "borra lo suyo" on public.reservas_dos_cifras for delete to authenticated using (auth.uid() = usuario_id)`, /borra lo suyo/],
        [`create view public.vista_numeros as select numero, telefono from public.${T5K}`, /vistas legibles/]
    ];
    for (const [prep, esperado] of casos) {
        const db = await crearDb();
        await aplicarOk(db, ARCH.limpieza.replaceAll("<ID_SESION>", SES_H), "limpieza");
        await db.exec(prep);
        const e = await aplicar(db, ARCH.parteA);
        assert.ok(e && esperado.test(e.message), e && e.message);
        assert.strictEqual((await db.query(`select relrowsecurity r from pg_class where relname = 'reservas_dos_cifras'`)).rows[0].r, false, "nada aplicado");
    }
    // Una de propietario para una operación que el panel SÍ hace se conserva.
    const db = await crearDb();
    await aplicarOk(db, ARCH.limpieza.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await db.exec(`create policy "Users read own" on public.eventos_bot for select to authenticated using ((select auth.uid()) = usuario_id)`);
    await aplicarOk(db, ARCH.parteA, "Parte A");
    assert.ok((await db.query(`select 1 from pg_policies where policyname = 'Users read own'`)).rows.length === 1);
});

prueba("035 aborta ante una política con condición que no aísla y ante un alta 'global' desde el panel", async () => {
    for (const [prep, esperado] of [
        [`alter table public.contactos_tenant enable row level security;
          create policy "logueados ven" on public.contactos_tenant for select to authenticated using (usuario_id is not null)`, /logueados ven/],
        [`create policy "crean globales" on public.automation_messages for insert to authenticated with check (usuario_id is null or auth.uid() = usuario_id)`, /crean globales/]
    ]) {
        const db = await crearDb();
        await activar(db, "Parte G");
        await db.exec(prep);
        const e = await aplicar(db, ARCH.m035);
        assert.ok(e && esperado.test(e.message), e && e.message);
    }
});

prueba("035 ya no choca con la Parte C: la tabla heredada reservas_2_cifras_1000 (sin usuario_id) la cierra C", async () => {
    const db = await crearDb();
    await activar(db);
    await assert.rejects(como(db, "authenticated", A, "select * from public.reservas_2_cifras_1000"), /permission denied/i);
    await assert.rejects(como(db, "authenticated", A, "select * from public.registro_usuarios"), /permission denied/i, "C cierra también authenticated");
    assert.strictEqual((await como(db, "service_role", null, "select count(*)::int n from public.reservas_2_cifras_1000"))[0].n, 1);
});

prueba("limpieza de la sesión huérfana: aborta si algo la referencia; archiva sesión y lease; reversible", async () => {
    for (const prep of [`insert into public.event_sessions (usuario_id, session_id) values ('${HUERFANO}', '${SES_H}')`,
                        `insert into public.inactividad_miembros (usuario_id, session_id) values ('${HUERFANO}', '${SES_H}')`]) {
        const db = await crearDb();
        await db.exec(prep);
        const e = await aplicar(db, ARCH.limpieza.replaceAll("<ID_SESION>", SES_H));
        assert.ok(e && /sigue referenciada/.test(e.message), e && e.message);
        assert.strictEqual((await db.query(`select count(*)::int n from public.sesiones where id = '${SES_H}'`)).rows[0].n, 1);
    }
    const sinSustituir = await aplicar(await crearDb(), ARCH.limpieza);
    assert.ok(sinSustituir && /no es la sesión huérfana/.test(sinSustituir.message));
    const db = await crearDb();
    await aplicarOk(db, ARCH.limpieza.replaceAll("<ID_SESION>", SES_H), "limpieza");
    const arch = (await db.query("select sesion_id, lease from efaat_admin.sesiones_archivadas")).rows;
    assert.strictEqual(arch[0].sesion_id, SES_H);
    assert.strictEqual(arch[0].lease[0].owner_id, "VPS-viejo");
    const rev = ARCH.limpieza.split("-- REVERSIÓN")[1].split("\n").filter(l => /^--\s{3}\S/.test(l)).map(l => l.replace(/^--\s{3}/, "")).join("\n")
        .replaceAll("<ID_SESION>", SES_H);
    await aplicarOk(db, rev, "reversión limpieza");
    assert.strictEqual((await db.query(`select owner_id from public.sesiones_lease where session_id = '${SES_H}'`)).rows[0].owner_id, "VPS-viejo");
});

// ===================================================== 7. registro y reversión
prueba("efaat_admin: protegido desde su creación e IDÉNTICO en todas las piezas", async () => {
    const bloque = (t) => (t.match(/-- >>> efaat_admin[\s\S]*?-- <<< efaat_admin <<</) || [""])[0];
    const piezas = ["limpieza", "parteA", "m033", "parteB", "m034", "parteG", "m035", "parteC"];
    const ref = bloque(ARCH.parteA);
    assert.ok(ref.length > 500);
    for (const p of piezas) assert.strictEqual(bloque(ARCH[p]), ref, p);
    const funcion = (t) => (t.match(/create or replace function pg_temp\.efaat_norm[\s\S]*?\n\$\$;\n\n-- 'abierta'[\s\S]*?\n\$\$;/) || [""])[0];
    assert.ok(funcion(ARCH.parteA).length > 500 && funcion(ARCH.parteA) === funcion(ARCH.m035), "misma clasificación en A y 035");
    const db = await crearDb();
    await activar(db);
    const r = (await db.query(`select relrowsecurity r,
        has_schema_privilege('anon', 'efaat_admin', 'usage') a, has_schema_privilege('authenticated', 'efaat_admin', 'usage') b,
        has_schema_privilege('service_role', 'efaat_admin', 'usage') c from pg_class where oid = 'efaat_admin.cambios_seguridad'::regclass`)).rows[0];
    assert.deepStrictEqual(r, { r: true, a: false, b: false, c: false });
});

prueba("reversión de la Parte A: con 2 cuentas cierra el panel en vez de exponerlo; con 1 lo conserva", async () => {
    const db = await crearDb();
    await activar(db);
    await aplicarOk(db, ARCH.reversionA, "reversión");
    await assert.rejects(como(db, "authenticated", B, `select * from public.${T5K}`), /permission denied/i);
    await assert.rejects(como(db, "anon", null, `select * from public.sesiones`), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, `select count(*)::int n from public.${T5K}`))[0].n, 100);
    await aplicarOk(db, ARCH.parteA, "Parte A de nuevo");
    await aplicarOk(db, ARCH.parteD, "Parte D de nuevo");
    assert.strictEqual((await como(db, "authenticated", A, `select count(*)::int n from public.${T5K}`))[0].n, 100);
    assert.strictEqual((await como(db, "authenticated", B, `select count(*)::int n from public.${T5K}`))[0].n, 0);

    const una = await crearDb();
    await activar(una);
    await una.exec(`delete from auth.users where id = '${B}'`);
    await aplicarOk(una, ARCH.reversionA, "reversión (1 cuenta)");
    assert.strictEqual((await como(una, "authenticated", A, `select count(*)::int n from public.${T5K}`))[0].n, 100);
    await assert.rejects(como(una, "anon", null, `select * from public.${T5K}`), /permission denied/i);
});

prueba("reejecución: toda la secuencia otra vez sin errores ni cambios en los datos", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    const antes = [await huella(db, T5K, A), await huella(db, T5K, B), await huella(db, "reservas_dos_cifras", B)];
    for (const [n, sql] of SECUENCIA) {
        if (n === "limpieza" || n === "029") continue;   // de un solo uso / exige tráfico reciente
        await aplicarOk(db, await sql(db), `${n} (2.ª vez)`);
    }
    assert.deepStrictEqual([await huella(db, T5K, A), await huella(db, T5K, B), await huella(db, "reservas_dos_cifras", B)], antes);
    const v = await validar(db);
    for (const b of ["precondiciones", "politicas", "exposicion", "funciones"]) assert.strictEqual(v[b].semaforo, "OK", b);
});

// ------------------------------------------------------------- ejecutar ---
(async () => {
    let ok = 0, falla = 0, omitidas = 0;
    console.log(`Motor: ${motor === "postgres" ? "PostgreSQL real (servidor local)" : "PGlite (Postgres en memoria)"}`);
    for (const { n, fn, soloPostgres } of pruebas) {
        if (soloPostgres && motor !== "postgres") { omitidas++; console.log(`⏭️  ${n} (solo con PostgreSQL real)`); continue; }
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}  ⏭️ OMITIDAS: ${omitidas}\n============================`);
    await Promise.allSettled(abiertas.map(db => db.close()));
    if (motor === "postgres") {
        const admin = new pg.Client({ connectionString: URL_ADMIN });
        await admin.connect();
        for (const db of abiertas) await admin.query(`drop database if exists ${db.nombre}`).catch(() => {});
        await admin.end();
    }
    process.exit(falla ? 1 : 0);
})();
