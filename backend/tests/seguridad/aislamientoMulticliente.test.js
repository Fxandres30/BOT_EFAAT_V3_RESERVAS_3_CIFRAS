// ==========================================================================
// Aislamiento multicliente completo (2026-10-22) — Postgres real en memoria.
//
// Reproduce el estado de PRODUCCIÓN que mostró el diagnóstico del 22/10:
//   - reservas_dos_cifras y 5k_15k_reservas_2_cifras con UNIQUE(numero),
//     sin RLS y con políticas públicas antiguas "using (true)";
//   - trigger heredado actualizar_compradores_semanales() (security
//     invoker) que escribe compradores_semanales al pagar;
//   - funciones SECURITY DEFINER heredadas ejecutables por anon;
//   - una sesión de una cuenta que ya no existe en auth.users;
//   - permisos por defecto de Supabase (anon/authenticated con todo).
// y aplica los ARCHIVOS REALES en el orden de ACTIVACION.md §2e:
//   limpieza sesión huérfana -> 031 -> Parte A -> 033 -> 027 -> Parte B ->
//   034 -> Parte G -> 035
// con dos clientes (A = cuenta principal con datos, B = cliente nuevo).
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/seguridad/aislamientoMulticliente.test.js
// No se conecta a ninguna base remota.
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
const { configuracionesBase } = require(path.join(RAIZ, "backend/bot/funciones/eventos/configEvento.js"));

const M031 = leer("backend/supabase_migrations/031_qr_sesion_publica.sql");
const PARTE_A = leer("docs/activacion/propuesta_rls_tablas_antiguas.sql");
const M033 = leer("backend/supabase_migrations/033_cuadricula_por_cliente.sql");
const M027 = leer("backend/supabase_migrations/027_tablas_cliente.sql");
const PARTE_B = leer("docs/activacion/parte_b_compradores_semanales.sql");
const M041 = leer("backend/supabase_migrations/041_pagos_sin_whatsapp.sql");
const M034 = leer("backend/supabase_migrations/034_compradores_por_cliente.sql");
const PARTE_G = leer("docs/activacion/parte_g_funciones_definer.sql");
const M035 = leer("backend/supabase_migrations/035_rls_tablas_cliente.sql");
const LIMPIEZA = leer("docs/activacion/limpieza_sesion_huerfana.sql");
const REVERSION_A = leer("docs/activacion/reversion_parte_a.sql");

// La B2 lleva el md5 de la función de PRODUCCIÓN (cceca089f72b33a12832eaf6c9f438c5); la de
// prueba tiene otro cuerpo, así que se sustituye por el suyo.
async function conMd5(db, sql) {
    const { rows } = await db.query("select md5(prosrc) m from pg_proc where proname = 'actualizar_compradores_semanales'");
    return sql.replaceAll("cceca089f72b33a12832eaf6c9f438c5", rows[0].m);
}

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

    create table public.sesiones (id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text, telefono text,
        estado text, principal boolean default false, activa boolean default false, qr text, qr_expira_en timestamptz);
    create table public.sesiones_lease (session_id uuid primary key references public.sesiones(id) on delete cascade, owner_id text not null);
    create table public.event_sessions (id serial primary key, usuario_id uuid, session_id uuid references public.sesiones(id) on delete set null);
    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, activo boolean, tabla text);

    create table public.reservas_dos_cifras (${COLUMNAS_RESERVA}, constraint reservas_dos_cifras_numero_key unique (numero));
    create table public.${T5K} (${COLUMNAS_RESERVA}, constraint "5k_15k_reservas_2_cifras_numero_key" unique (numero));

    -- Políticas públicas antiguas (inactivas mientras RLS esté apagada, pero
    -- se activarían con ella y dejarían pasar a todos).
    create policy "Enable read access for all users" on public.reservas_dos_cifras for select using (true);
    create policy "Permitir todo" on public.${T5K} for all to public using (true) with check (true);
    create policy "servicio interno" on public.${T5K} for all to service_role using (true);

    create table public.compradores_semanales (id serial primary key, nombre text not null, whatsapp text,
        lunes int default 0, martes int default 0, miercoles int default 0, jueves int default 0,
        viernes int default 0, sabado int default 0, domingo int default 0,
        total_semanal int default 0, entregados_3cifras int default 0);

    -- Trigger heredado de pago (security invoker, como en producción).
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

    -- Funciones SECURITY DEFINER heredadas, ejecutables por PUBLIC (por defecto).
    create function public.asignar_numeros_gratis() returns bigint language sql security definer as $$ select count(*) from public.reservas_dos_cifras $$;
    create function public.asignar_boletos_seguro() returns int language sql security definer as $$ select 1 $$;
    create function public.incrementar_veces_preguntada() returns int language sql security definer as $$ select 1 $$;
    create function public.sumar_entregados_tres_cifras(p text) returns void language sql security definer as $$
        update public.compradores_semanales set entregados_3cifras = entregados_3cifras + 1 where whatsapp = p $$;
    create function public.lease_sesiones_acquire(p_session uuid, p_owner text) returns boolean language plpgsql security definer as $$
    begin insert into public.sesiones_lease values (p_session, p_owner) on conflict (session_id) do nothing; return found; end $$;

    -- Tablas de cliente para la 035
    create table public.plantillas_mensaje (id serial primary key, usuario_id uuid, texto text);
    create policy "acceso total" on public.plantillas_mensaje for all using (true);
    create table public.automation_messages (id serial primary key, usuario_id uuid, texto text, activo boolean default true);
    alter table public.automation_messages enable row level security;
    create policy "usuarios ven mensajes globales y propios" on public.automation_messages for select using (usuario_id is null or auth.uid() = usuario_id);
    create policy "usuarios crean sus propios mensajes" on public.automation_messages for insert with check (auth.uid() = usuario_id);
    create policy "usuarios eliminan sus propios mensajes" on public.automation_messages for delete using (auth.uid() = usuario_id);
    create table public.variables_globales (id serial primary key, usuario_id uuid, nombre text);
    create table public.usuarios (id serial primary key, telefono text);
    create table public.grupos (jid text primary key, nombre text);

    -- Datos: A con todo; B sin cuadrícula; una sesión huérfana.
    insert into public.sesiones (id, usuario_id, nombre, estado, principal, activa, qr) values
        ('${SES_A}', '${A}', 'bot A', 'conectado', true, true, null),
        ('${SES_B}', '${B}', 'bot B', 'conectado', true, true, 'QR-B'),
        ('${SES_H}', '${HUERFANO}', 'vieja', 'desconectado', false, false, 'QR-VIEJO');
    insert into public.sesiones_lease values ('${SES_H}', 'VPS-viejo');
    insert into public.event_sessions (usuario_id, session_id) values ('${A}', '${SES_A}');
    insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${A}', 'gA', false, '5k_15k_reservas_2_cifras');
    insert into public.reservas_dos_cifras (numero, estado, usuario_id)
        select lpad(g::text, 2, '0'), 'libre', '${A}' from generate_series(0, 99) g;
    insert into public.${T5K} (numero, estado, usuario_id, comprador, telefono, identidad_evento_real)
        select lpad(g::text, 2, '0'),
               case when g < 76 then 'pagado' when g < 97 then 'reservado' else 'libre' end,
               '${A}',
               case when g < 97 then 'Comprador ' || g end,
               case when g < 97 then '300' || lpad(g::text, 7, '0') end,
               case when g < 97 then 'sorteo-a' end
        from generate_series(0, 99) g;
    insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values ('Histórico', '3009999999', 5);
    insert into public.plantillas_mensaje (usuario_id, texto) values ('${A}', 'plantilla A'), ('${B}', 'plantilla B');
    insert into public.automation_messages (usuario_id, texto) values (null, 'global'), ('${A}', 'msg A'), ('${B}', 'msg B');
    insert into public.variables_globales (usuario_id, nombre) values ('${A}', 'var A'), ('${B}', 'var B');
    insert into public.usuarios (telefono) values ('3001112222');
    insert into public.grupos values ('g1@g.us', 'Grupo 1');
`;

const abiertas = [];

async function crearDb() {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    return db;
}

// Aplica un archivo; devuelve el error (y deshace la transacción abierta) o null.
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

async function huella(db, tabla, usuario) {
    return (await db.query(`select md5(string_agg(row(numero, estado, comprador, telefono, identidad_evento_real)::text, '|' order by numero)) h,
                                   count(*)::int n from public.${tabla} where usuario_id = '${usuario}'`)).rows[0];
}

// Secuencia completa de §2e sobre una base nueva.
async function activar(db) {
    await aplicarOk(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await aplicarOk(db, M031, "031");
    await aplicarOk(db, PARTE_A, "Parte A");
    await aplicarOk(db, M033, "033");
    await aplicarOk(db, M027, "027");
    await aplicarOk(db, await conMd5(db, PARTE_B), "Parte B");
    await aplicarOk(db, M041, "041");
    await aplicarOk(db, M034, "034");
    await aplicarOk(db, PARTE_G, "Parte G");
    await aplicarOk(db, M035, "035");
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------ estado actual
prueba("ESTADO ACTUAL reproducido: anon lee reservas, B lee las de A y B no puede tener su 00-99", async () => {
    const db = await crearDb();
    assert.strictEqual((await como(db, "anon", null, `select * from public.${T5K}`)).length, 100);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.${T5K} where usuario_id = '${A}'`)).length, 100);
    await assert.rejects(
        como(db, "service_role", null, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('00', 'libre', '${B}')`),
        /duplicate key|unique/i);
    assert.strictEqual((await como(db, "anon", null, "select public.asignar_numeros_gratis() n"))[0].n, 100, "definer heredada abierta a anon");
});

// ------------------------------------------------------------ Parte A
prueba("Parte A con la sesión huérfana: se aplica, la CONSERVA (no borra) y la registra; nadie la ve en el panel, el bot sí", async () => {
    const db = await crearDb();
    await aplicarOk(db, M031, "031");
    await aplicarOk(db, PARTE_A, "Parte A");
    for (const u of [A, B]) assert.strictEqual((await como(db, "authenticated", u, `select * from public.sesiones where id = '${SES_H}'`)).length, 0);
    assert.strictEqual((await como(db, "service_role", null, `select * from public.sesiones where id = '${SES_H}'`)).length, 1);
    const reg = (await db.query(`select detalle from efaat_admin.cambios_seguridad where accion = 'sesiones_sin_dueno_conservadas'`)).rows;
    assert.strictEqual(reg.length, 1);
    assert.deepStrictEqual(reg[0].detalle.ids, [SES_H]);
    // Reservas de una cuenta inexistente SÍ bloquean (no se asignan por suposición).
    const db2 = await crearDb();
    await db2.exec(`insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('h1', 'libre', '${HUERFANO}')`);
    const e = await aplicar(db2, PARTE_A);
    assert.ok(e && /reservas_dos_cifras: 1 de cuentas inexistentes/.test(e.message), e && e.message);
});

prueba("limpieza de la sesión huérfana: archiva la fila, borra el lease en cascada y no toca a A ni a B", async () => {
    const db = await crearDb();
    await aplicarOk(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    assert.deepStrictEqual((await db.query("select id::text from public.sesiones order by 1")).rows.map(r => r.id), [SES_A, SES_B]);
    assert.strictEqual((await db.query("select count(*)::int n from public.sesiones_lease")).rows[0].n, 0);
    const arch = (await db.query("select fila from efaat_admin.sesiones_archivadas")).rows;
    assert.strictEqual(arch.length, 1);
    assert.strictEqual(arch[0].fila.id, SES_H);
    // Con otro id: aborta.
    const e = await aplicar(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_A));
    assert.ok(e && /Limpieza abortada/.test(e.message));
});

prueba("Parte A elimina las políticas públicas abiertas (registradas), conserva la de service_role y aborta ante una desconocida", async () => {
    const db = await crearDb();
    await aplicarOk(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await aplicarOk(db, PARTE_A, "Parte A");
    const pol = (await db.query(`select tablename, policyname from pg_policies where tablename in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras') order by 1, 2`)).rows
        .map(r => `${r.tablename}:${r.policyname}`);
    assert.ok(!pol.some(p => /Enable read access|Permitir todo/.test(p)), pol.join(", "));
    assert.ok(pol.includes("5k_15k_reservas_2_cifras:servicio interno"));
    const log = (await db.query(`select objeto, detalle->>'politica' p from efaat_admin.cambios_seguridad where accion = 'politica_abierta_eliminada' order by 2`)).rows;
    assert.deepStrictEqual(log.map(r => r.p), ["Enable read access for all users", "Permitir todo"]);

    const db2 = await crearDb();
    await aplicarOk(db2, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await db2.exec(`create policy "solo libres" on public.eventos_bot for select to authenticated using (activo)`);
    const e = await aplicar(db2, PARTE_A);
    assert.ok(e && /políticas no previstas.*solo libres/.test(e.message), e && e.message);
});

prueba("Parte A con permisos heredados de PUBLIC: anon sin acceso, panel y bot conservan los suyos", async () => {
    const db = await crearDb();
    await aplicarOk(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await db.exec(`revoke all on public.eventos_bot from anon, authenticated; grant select on public.eventos_bot to public;`);
    await aplicarOk(db, PARTE_A, "Parte A");
    await assert.rejects(como(db, "anon", null, "select * from public.eventos_bot"), /permission denied/i);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.eventos_bot")).length, 1, "el panel sigue leyendo");
    const conc = (await db.query(`select detalle from efaat_admin.cambios_seguridad where accion = 'permiso_explicito' and objeto = 'eventos_bot'`)).rows;
    assert.ok(conc.some(r => r.detalle.rol === "authenticated" && r.detalle.privilegio === "SELECT"));
});

// ------------------------------------------------------------ 033 y 027
prueba("027 se niega a aplicarse con UNIQUE(numero) aunque la Parte A esté aplicada", async () => {
    const db = await crearDb();
    await aplicarOk(db, LIMPIEZA.replaceAll("<ID_SESION>", SES_H), "limpieza");
    await aplicarOk(db, PARTE_A, "Parte A");
    const e = await aplicar(db, M027);
    assert.ok(e && /027 abortada.*Aplica antes la 033/.test(e.message), e && e.message);
});

prueba("033: no toca ninguna fila de A, es idempotente y aborta ante duplicados por cliente o claves foráneas", async () => {
    const db = await crearDb();
    const antes = [await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)];
    await aplicarOk(db, M033, "033");
    await aplicarOk(db, M033, "033 (2.ª vez)");
    assert.deepStrictEqual([await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)], antes);
    const defs = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.reservas_dos_cifras'::regclass and contype = 'u'`)).rows.map(r => r.d);
    assert.deepStrictEqual(defs, ["UNIQUE (usuario_id, numero)"]);

    const dup = await crearDb();
    await dup.exec(`alter table public.reservas_dos_cifras drop constraint reservas_dos_cifras_numero_key;
                    insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('00', 'libre', '${A}');`);
    const e1 = await aplicar(dup, M033);
    assert.ok(e1 && /repetidos dentro de un mismo cliente/.test(e1.message), e1 && e1.message);

    const fk = await crearDb();
    await fk.exec(`create table public.ref_numero (numero text references public.reservas_dos_cifras(numero));`);
    const e2 = await aplicar(fk, M033);
    assert.ok(e2 && /claves foráneas dependen/.test(e2.message), e2 && e2.message);
    assert.strictEqual((await fk.query(`select count(*)::int n from pg_constraint where conname = 'reservas_dos_cifras_numero_key'`)).rows[0].n, 1, "nada cambiado");
});

// ------------------------------------------------------------ secuencia completa
prueba("secuencia completa §2e: se aplica entera y la cuenta principal queda idéntica", async () => {
    const db = await crearDb();
    const antes = [await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)];
    await activar(db);
    assert.deepStrictEqual([await huella(db, T5K, A), await huella(db, "reservas_dos_cifras", A)], antes);
});

prueba("cuadrículas: B recibe su 00-99 en las 2 tablas con los MISMOS números que A; A queda 'existente'", async () => {
    const db = await crearDb();
    await activar(db);
    const rB = (await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb) r`))[0].r;
    assert.strictEqual(rB.ok, true, JSON.stringify(rB));
    assert.ok(rB.cuadriculas.every(c => c.estado === "creada" && c.filas === 100), JSON.stringify(rB));
    const rA = (await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${A}', '${BASE}'::jsonb) r`))[0].r;
    assert.ok(rA.cuadriculas.every(c => c.estado === "existente"), JSON.stringify(rA));
    const n = (await db.query(`select count(*)::int n from public.${T5K} where numero = '05'`)).rows[0].n;
    assert.strictEqual(n, 2, "el 05 existe una vez por cliente");
    // Dentro de un mismo cliente sigue siendo único (incluso para el bot), y
    // el navegador ya no inserta filas.
    await assert.rejects(como(db, "service_role", null, `insert into public.${T5K} (numero, estado, usuario_id) values ('05', 'libre', '${B}')`), /duplicate key|unique/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.${T5K} (numero, estado, usuario_id) values ('105', 'libre', '${B}')`), /row-level security/i);
});

prueba("reservas: cada cliente ve solo las suyas; B no lee, modifica, paga, libera ni se apropia de las de A", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    assert.strictEqual((await como(db, "authenticated", A, `select * from public.${T5K}`)).length, 100);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.${T5K}`)).length, 100);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.${T5K} where usuario_id = '${A}'`)).length, 0);
    // Consultas reales del panel apuntando a A
    assert.strictEqual((await como(db, "authenticated", B, `update public.${T5K} set estado = 'pagado' where numero = '80' and usuario_id = '${A}' and estado = 'reservado' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre', comprador = null where usuario_id = '${A}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", B, `update public.${T5K} set usuario_id = '${A}' where numero = '01' and usuario_id = '${B}'`), /row-level security/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('77', 'libre', '${A}')`), /row-level security|duplicate/i);
    assert.strictEqual((await db.query(`select count(*)::int n from public.${T5K} where usuario_id = '${A}' and estado = 'pagado'`)).rows[0].n, 76, "pagos de A intactos");
    for (const t of [T5K, "reservas_dos_cifras", "eventos_bot", "sesiones", "compradores_semanales", "usuarios", "grupos", "plantillas_mensaje"]) {
        await assert.rejects(como(db, "anon", null, `select * from public.${t}`), /permission denied/i, t);
    }
});

prueba("pagos: el panel de A paga (trigger heredado intacto) y la compra queda a nombre de A; la de B a nombre de B", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    // A paga desde el panel (authenticated) su número 80 (reservado, teléfono 3000000080)
    const pA = await como(db, "authenticated", A, `update public.${T5K} set estado = 'pagado' where numero = '80' and usuario_id = '${A}' and estado = 'reservado' returning id`);
    assert.strictEqual(pA.length, 1);
    // B reserva y paga desde el bot (service_role) su número 05 con otro teléfono
    await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', comprador = 'Cliente de B', telefono = '3105550000' where numero = '05' and usuario_id = '${B}'`);
    await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where numero = '05' and usuario_id = '${B}'`);
    // B paga desde su panel otro número
    await como(db, "service_role", null, `update public.reservas_dos_cifras set estado = 'reservado', telefono = '3107770000' where numero = '10' and usuario_id = '${B}'`);
    await como(db, "authenticated", B, `update public.reservas_dos_cifras set estado = 'pagado' where numero = '10' and usuario_id = '${B}' and estado = 'reservado'`);
    const filas = (await db.query(`select whatsapp, usuario_id::text u, total_semanal from public.compradores_semanales order by whatsapp`)).rows;
    const por = Object.fromEntries(filas.map(f => [f.whatsapp, f]));
    assert.strictEqual(por["3000000080"].u, A);
    assert.strictEqual(por["3105550000"].u, B);
    assert.strictEqual(por["3107770000"].u, B);
    assert.strictEqual(por["3009999999"].u, null, "el histórico no se asigna por suposición");
    // Nadie lee compradores desde el navegador
    await assert.rejects(como(db, "authenticated", A, "select * from public.compradores_semanales"), /permission denied/i);
});

prueba("pagos: una sentencia del bot que toca a dos clientes no atribuye la compra a ninguno ('mixto')", async () => {
    const db = await crearDb();
    await activar(db);
    await como(db, "service_role", null, `select public.inicializar_tablas_cliente('${B}', '${BASE}'::jsonb)`);
    await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', telefono = '3200000000' where numero = '98' and usuario_id = '${B}'`);
    await como(db, "service_role", null, `update public.${T5K} set telefono = '3200000001' where numero = '97' and usuario_id = '${A}'`);
    await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado' where numero = '97' and usuario_id = '${A}'`);
    await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where numero in ('97', '98') and estado = 'reservado'`);
    const f = (await db.query(`select whatsapp, usuario_id from public.compradores_semanales where whatsapp in ('3200000000', '3200000001')`)).rows;
    assert.strictEqual(f.length, 2);
    assert.ok(f.every(x => x.usuario_id === null), JSON.stringify(f));
    // La variable no se arrastra a la siguiente sentencia
    await como(db, "service_role", null, `update public.${T5K} set estado = 'reservado', telefono = '3200000002' where numero = '99' and usuario_id = '${B}'`);
    await como(db, "service_role", null, `update public.${T5K} set estado = 'pagado' where numero = '99' and usuario_id = '${B}'`);
    assert.strictEqual((await db.query(`select usuario_id::text u from public.compradores_semanales where whatsapp = '3200000002'`)).rows[0].u, B);
});

prueba("sesiones y sorteos: cada cliente ve y cambia solo lo suyo; el cambio de A no toca la sesión de B", async () => {
    const db = await crearDb();
    await activar(db);
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, activo, tabla) values ('${B}', 'gB', true, '5k_15k_reservas_2_cifras')`);
    assert.deepStrictEqual((await como(db, "authenticated", A, "select grupo_id from public.eventos_bot")).map(r => r.grupo_id), ["gA"]);
    assert.deepStrictEqual((await como(db, "authenticated", B, "select grupo_id from public.eventos_bot")).map(r => r.grupo_id), ["gB"]);
    assert.strictEqual((await como(db, "authenticated", A, `update public.eventos_bot set activo = false where grupo_id = 'gB' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", A, `update public.sesiones set nombre = 'A renombrada' returning id::text`))[0].id, SES_A);
    const b = (await db.query(`select nombre, activa, estado from public.sesiones where id = '${SES_B}'`)).rows[0];
    assert.deepStrictEqual(b, { nombre: "bot B", activa: true, estado: "conectado" });
    assert.strictEqual((await como(db, "authenticated", A, `delete from public.sesiones where id = '${SES_B}' returning id`)).length, 0);
    // El bot (service_role) sigue gestionando las dos
    assert.strictEqual((await como(db, "service_role", null, `update public.sesiones set estado = estado returning id`)).length, 2);
});

prueba("QR público: /conectar sin sesión obtiene el QR de B por la RPC, pero no la tabla", async () => {
    const db = await crearDb();
    await activar(db);
    const r = (await como(db, "anon", null, `select public.qr_sesion_publica('${SES_B}') r`))[0].r;
    assert.strictEqual(r.qr, "QR-B");
    assert.ok(!("usuario_id" in r) && !("telefono" in r));
    await assert.rejects(como(db, "anon", null, "select qr from public.sesiones"), /permission denied/i);
});

prueba("Parte G: las definer heredadas y el lease ya no se ejecutan desde el navegador; el bot sí; el trigger de pago sigue disparando", async () => {
    const db = await crearDb();
    await activar(db);
    for (const f of ["asignar_numeros_gratis()", "asignar_boletos_seguro()", "incrementar_veces_preguntada()", "sumar_entregados_tres_cifras('x')"]) {
        await assert.rejects(como(db, "anon", null, `select public.${f}`), /permission denied/i, f);
        await assert.rejects(como(db, "authenticated", A, `select public.${f}`), /permission denied/i, f);
    }
    await assert.rejects(como(db, "authenticated", B, `select public.lease_sesiones_acquire('${SES_A}', 'robo')`), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, `select public.lease_sesiones_acquire('${SES_A}', 'VPS') ok`))[0].ok, true);
    const ex = (await db.query(`select has_function_privilege('authenticated', 'public.actualizar_compradores_semanales()', 'execute') e`)).rows[0].e;
    assert.strictEqual(ex, false, "la función del trigger ya no es ejecutable por el panel");
    const pago = await como(db, "authenticated", A, `update public.${T5K} set estado = 'pagado' where numero = '81' and usuario_id = '${A}' and estado = 'reservado' returning id`);
    assert.strictEqual(pago.length, 1, "pagar desde el panel sigue funcionando");
});

prueba("Parte G aborta si una función invoker ejecutable por el panel llama a una definer que se cierra", async () => {
    const db = await crearDb();
    await aplicarOk(db, M031, "031");
    await db.exec(`create function public.puente() returns bigint language sql as $$ select public.asignar_numeros_gratis() $$;`);
    const e = await aplicar(db, PARTE_G);
    assert.ok(e && /Parte G abortada.*puente/.test(e.message), e && e.message);
    assert.strictEqual((await como(db, "anon", null, "select public.asignar_numeros_gratis() n"))[0].n, 100, "nada cambiado");
});

prueba("034 exige la Parte B2 (función del trigger SECURITY DEFINER) y no cambia nada sin ella", async () => {
    const db = await crearDb();
    const e = await aplicar(db, M034);
    assert.ok(e && /Aplica antes la Parte B2/.test(e.message), e && e.message);
    assert.strictEqual((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'compradores_semanales' and column_name = 'usuario_id'`)).rows[0].n, 0);
});

prueba("035: plantillas, mensajes y variables aislados; los globales siguen visibles; usuarios/grupos solo backend", async () => {
    const db = await crearDb();
    await activar(db);
    assert.deepStrictEqual((await como(db, "authenticated", A, "select texto from public.plantillas_mensaje")).map(r => r.texto), ["plantilla A"]);
    assert.deepStrictEqual((await como(db, "authenticated", B, "select texto from public.automation_messages order by texto")).map(r => r.texto), ["global", "msg B"]);
    assert.strictEqual((await como(db, "authenticated", B, `update public.plantillas_mensaje set texto = 'x' where usuario_id = '${A}' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", B, `delete from public.variables_globales where usuario_id = '${A}' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", B, `delete from public.variables_globales where usuario_id = '${B}' returning id`)).length, 1, "lo propio sí");
    await assert.rejects(como(db, "authenticated", A, "select * from public.usuarios"), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, "select * from public.usuarios")).length, 1);
    const pol = (await db.query(`select policyname from pg_policies where tablename = 'plantillas_mensaje' order by 1`)).rows.map(r => r.policyname);
    assert.ok(!pol.includes("acceso total"), pol.join(","));
});

prueba("035 aborta si una tabla del panel sin RLS tiene filas sin dueño", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.variables_globales (usuario_id, nombre) values (null, 'huérfana')`);
    const e = await aplicar(db, M035);
    assert.ok(e && /035 abortada.*variables_globales: 1 filas sin dueño/.test(e.message), e && e.message);
});

prueba("reversión segura de la Parte A: con dos cuentas NI anon NI el otro cliente leen lo ajeno; el bot sigue", async () => {
    const db = await crearDb();
    await activar(db);
    // Lo que hacía la reversión anterior (solo "disable row level security")
    // dejaba a B leer las 100 reservas de A: se comprueba primero ese hueco.
    await db.exec(`begin; alter table public.${T5K} disable row level security; commit;`);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.${T5K} where usuario_id = '${A}'`)).length, 100, "hueco reproducido");
    await db.exec(`begin; alter table public.${T5K} enable row level security; commit;`);
    await aplicarOk(db, REVERSION_A, "reversión A");
    await assert.rejects(como(db, "authenticated", B, `select * from public.${T5K} where usuario_id = '${A}'`), /permission denied/i);
    await assert.rejects(como(db, "anon", null, `select * from public.${T5K}`), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, `select * from public.${T5K} where usuario_id = '${A}'`)).length, 100);
    // Volver a aplicar la Parte A restaura el panel aislado.
    await aplicarOk(db, PARTE_A, "Parte A otra vez");
    assert.strictEqual((await como(db, "authenticated", A, `select * from public.${T5K}`)).length, 100);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.${T5K} where usuario_id = '${A}'`)).length, 0);
});

prueba("idempotencia: toda la secuencia se puede volver a aplicar sin errores ni cambios en los datos", async () => {
    const db = await crearDb();
    await activar(db);
    const antes = await huella(db, T5K, A);
    for (const [n, sql] of [["031", M031], ["A", PARTE_A], ["033", M033], ["027", M027], ["B", await conMd5(db, PARTE_B)], ["041", M041], ["034", M034], ["G", PARTE_G], ["035", M035]]) {
        await aplicarOk(db, sql, `${n} (2.ª vez)`);
    }
    assert.deepStrictEqual(await huella(db, T5K, A), antes);
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
