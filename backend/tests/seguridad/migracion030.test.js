// ==========================================================================
// PRUEBAS SQL — migración 030 (reinicio seguro de la tabla) en Postgres en
// memoria (PGlite), con la función REAL reiniciar_tabla_cliente.
//
//   - vista previa (aplicar = false): no escribe nada; resumen por sorteo;
//   - aplicar con otra huella: nada (tabla_cambio);
//   - aplicar con la huella vista: archiva (copia completa, pagos incluidos)
//     y libera SOLO lo liberable del cliente; la tabla de B intacta;
//   - protegidos: sorteo activo, pago en proceso, reservas no atribuibles a
//     un sorteo terminado, estado desconocido -> no se toca nada;
//   - bloqueados a mano: se conservan salvo liberar_bloqueados = true;
//   - conflictos: tabla cambiada entre vista previa y aplicación, doble
//     aplicación con la misma huella y fallo a mitad -> sin cambios parciales;
//   - solo service_role la ejecuta; cada cliente lee solo su archivo.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/migracion030.test.js
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

const M030 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "030_reinicio_tabla_seguro.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T = '"5k_15k_reservas_2_cifras"';

const COLUMNAS = `
    id serial primary key, numero text, estado text, usuario_id uuid,
    comprador text, contacto text, contacto_lower text, nombre text, telefono text, lib text,
    grupo_id text, grupo_nombre text, evento_id text, nombre_evento text,
    fecha_reserva text, hora_reserva text, fecha_pago text, hora_pago text,
    temporal_por text, bloqueado_hasta timestamptz, usuario_global_id uuid,
    telefono_bot text, ip_reserva text, identidad_evento_real text`;

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    insert into auth.users values ('${A}'), ('${B}');
    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, tabla text, activo boolean, identidad_evento_real text, nombre_evento text);
    create table public.reservas_dos_cifras (${COLUMNAS});
    create table public.${T} (${COLUMNAS});
    insert into public.${T} (numero, estado, usuario_id, identidad_evento_real, nombre_evento, comprador, fecha_pago)
    select lpad(g::text, 2, '0'),
           case when g < 3 then 'pagado' when g < 6 then 'reservado' when g = 6 then 'bloqueado' else 'libre' end,
           '${A}',
           case when g < 6 then 'viejo' end,
           case when g < 6 then 'Manizales 14/10' end,
           case when g < 6 then 'Cliente ' || g end,
           case when g < 3 then '2026-10-14' end
    from generate_series(0, 99) g;
    insert into public.${T} (numero, estado, usuario_id, identidad_evento_real, comprador)
    select lpad(g::text, 2, '0'), case when g < 4 then 'pagado' else 'libre' end, '${B}', case when g < 4 then 'de-b' end, case when g < 4 then 'Cliente de B' end
    from generate_series(0, 99) g;
    insert into public.eventos_bot (usuario_id, grupo_id, tabla, activo, identidad_evento_real, nombre_evento) values
        ('${A}', 'g1', '5k_15k_reservas_2_cifras', false, 'viejo', 'Manizales 14/10'),
        ('${B}', 'gb', '5k_15k_reservas_2_cifras', true, 'de-b', 'Sorteo de B');
`;

const abiertas = [];
async function crearDb() {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    await db.exec(M030);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const reiniciar = async (db, usuario, { huella = null, aplicar = false, rol = "service_role", liberarBloqueados = false } = {}) =>
    (await como(db, rol, null, `select public.reiniciar_tabla_cliente('${usuario}', '5k_15k_reservas_2_cifras', ${huella ? `'${huella}'` : "null"}, null, ${aplicar}, ${liberarBloqueados}) as r`))[0].r;

const instantanea = async (db, usuario) => JSON.stringify((await db.query(`select * from public.${T} where usuario_id = '${usuario}' order by numero`)).rows);
const contar = async (db, sql) => Number((await db.query(sql)).rows[0].n);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("vista previa (aplicar=false): resumen por sorteo y NADA cambia", async () => {
    const db = await crearDb();
    const antes = await instantanea(db, A);
    const r = await reiniciar(db, A);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.aplicado, false);
    assert.strictEqual(r.liberables, 6, "3 pagados + 3 reservados del sorteo cerrado");
    assert.strictEqual(r.conservados, 1, "el bloqueado a mano se conserva por defecto");
    assert.strictEqual(r.protegidos, 0);
    const viejo = r.por_sorteo.find(g => g.identidad === "viejo");
    assert.deepStrictEqual([viejo.pagados, viejo.reservados, viejo.nombre_evento], [3, 3, "Manizales 14/10"]);
    assert.strictEqual(await instantanea(db, A), antes);
    assert.strictEqual(await contar(db, "select count(*) as n from public.reservas_archivo"), 0);
});

prueba("aplicar con OTRA huella: no se modifica nada (tabla_cambio)", async () => {
    const db = await crearDb();
    const antes = await instantanea(db, A);
    const r = await reiniciar(db, A, { huella: "no-es", aplicar: true });
    assert.deepStrictEqual([r.ok, r.motivo], [false, "tabla_cambio"]);
    assert.strictEqual(await instantanea(db, A), antes);
});

prueba("aplicar con la huella vista: archiva copia completa (pagos incluidos) y libera SOLO lo de A; B intacto", async () => {
    const db = await crearDb();
    const antesB = await instantanea(db, B);
    const { huella } = await reiniciar(db, A);
    const r = await reiniciar(db, A, { huella, aplicar: true });
    assert.deepStrictEqual([r.ok, r.aplicado, r.archivados], [true, true, 6]);
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T} where usuario_id = '${A}' and estado <> 'libre'`), 1);
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T} where usuario_id = '${A}' and numero = '06' and estado = 'bloqueado'`), 1, "bloqueado conservado");
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T} where usuario_id = '${A}' and comprador is not null`), 0);
    const pagado = (await db.query(`select fila from public.reservas_archivo where numero = '00'`)).rows[0].fila;
    assert.deepStrictEqual([pagado.estado, pagado.comprador, pagado.fecha_pago], ["pagado", "Cliente 0", "2026-10-14"], "el pago queda archivado, no se pierde");
    assert.strictEqual(await instantanea(db, B), antesB, "la tabla de B no cambia");
    assert.strictEqual(await contar(db, `select count(*) as n from public.reservas_archivo where usuario_id <> '${A}'`), 0);
    const otra = await reiniciar(db, A, { huella: (await reiniciar(db, A)).huella, aplicar: true });
    assert.strictEqual(otra.archivados, 0, "repetir no archiva nada más");
});

prueba("PROTEGIDOS: números del sorteo ACTIVO (B) -> nada cambia", async () => {
    const db = await crearDb();
    const antes = await instantanea(db, B);
    const r = await reiniciar(db, B);
    assert.deepStrictEqual([r.ok, r.motivo, r.protegidos], [false, "protegido", 4]);
    assert.strictEqual(r.por_sorteo[0].clase, "protegido_activo");
    const intento = await reiniciar(db, B, { huella: r.huella, aplicar: true });
    assert.strictEqual(intento.ok, false);
    assert.strictEqual(await instantanea(db, B), antes);
});

prueba("PROTEGIDOS: pago en proceso, estado desconocido y reservas que no se pueden atribuir a un sorteo terminado", async () => {
    const db = await crearDb();
    await db.exec(`update public.${T} set estado = 'en_proceso' where usuario_id = '${A}' and numero = '50'`);
    let r = await reiniciar(db, A);
    assert.deepStrictEqual([r.ok, r.protegidos], [false, 1]);
    await db.exec(`update public.${T} set estado = 'raro' where usuario_id = '${A}' and numero = '50'`);
    r = await reiniciar(db, A);
    assert.ok(r.por_sorteo.some(g => g.clase === "protegido_desconocido"));
    // Reserva sin identidad ni evento conocido: no se puede atribuir con
    // seguridad -> protegida aunque no haya ningún sorteo activo.
    await db.exec(`update public.${T} set estado = 'reservado', identidad_evento_real = null, evento_id = null where usuario_id = '${A}' and numero = '50'`);
    r = await reiniciar(db, A);
    assert.ok(!r.ok && r.por_sorteo.some(g => g.clase === "protegido_sin_sorteo"), "no atribuible: protegida");
    // Con el evento CERRADO del cliente (id 1): atribuible -> liberable.
    await db.exec(`update public.${T} set evento_id = '1' where usuario_id = '${A}' and numero = '50'`);
    assert.strictEqual((await reiniciar(db, A)).ok, true, "evento cerrado propio: liberable");
    // Con el evento ACTIVO de OTRO cliente (id 2, de B): no es suyo -> protegida.
    await db.exec(`update public.${T} set evento_id = '2' where usuario_id = '${A}' and numero = '50'`);
    assert.strictEqual((await reiniciar(db, A)).ok, false, "evento ajeno: protegida");
    // Con un evento ACTIVO propio: protegida como sorteo activo.
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, tabla, activo, identidad_evento_real) values ('${A}', 'g2', '5k_15k_reservas_2_cifras', true, 'nuevo')`);
    await db.exec(`update public.${T} set evento_id = '3' where usuario_id = '${A}' and numero = '50'`);
    r = await reiniciar(db, A);
    assert.ok(!r.ok && r.por_sorteo.some(g => g.clase === "protegido_activo"), "evento activo propio: protegida");
});

prueba("solo service_role ejecuta; tabla no permitida rechazada; cada cliente lee solo su archivo; anon nada", async () => {
    const db = await crearDb();
    await assert.rejects(reiniciar(db, A, { rol: "authenticated" }), /permission denied/);
    await assert.rejects(reiniciar(db, A, { rol: "anon" }), /permission denied/);
    await assert.rejects(como(db, "service_role", null, `select public.reiniciar_tabla_cliente('${A}', 'eventos_bot', null, null, false)`), /tabla no permitida/);
    const { huella } = await reiniciar(db, A);
    await reiniciar(db, A, { huella, aplicar: true });
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.reservas_archivo")).length, 6);
    assert.strictEqual((await como(db, "authenticated", B, "select * from public.reservas_archivo")).length, 0);
    await assert.rejects(como(db, "authenticated", A, "delete from public.reservas_archivo"), /permission denied/);
    await assert.rejects(como(db, "anon", null, "select * from public.reservas_archivo"), /permission denied/);
});

prueba("030 idempotente: se aplica dos veces sin error y conserva el archivo", async () => {
    const db = await crearDb();
    const { huella } = await reiniciar(db, A);
    await reiniciar(db, A, { huella, aplicar: true });
    await db.exec(M030);
    assert.strictEqual(await contar(db, "select count(*) as n from public.reservas_archivo"), 6);
});

prueba("CONSERVADOR: sorteo con activo desconocido (null) o activo sin tabla registrada -> sus reservas protegidas", async () => {
    const db = await crearDb();
    await db.exec(`update public.eventos_bot set activo = null where usuario_id = '${A}' and identidad_evento_real = 'viejo'`);
    let r = await reiniciar(db, A);
    assert.ok(!r.ok && r.por_sorteo.some(g => g.clase === "protegido_activo"), "activo null cuenta como activo");
    await db.exec(`update public.eventos_bot set activo = false where usuario_id = '${A}' and identidad_evento_real = 'viejo'`);
    assert.strictEqual((await reiniciar(db, A)).ok, true);
    await db.exec(`insert into public.eventos_bot (usuario_id, grupo_id, tabla, activo, identidad_evento_real) values ('${A}', 'g3', null, true, 'viejo')`);
    r = await reiniciar(db, A);
    assert.ok(!r.ok && r.por_sorteo.some(g => g.clase === "protegido_activo"), "activo sin tabla también protege");
});

prueba("BLOQUEOS: la función toma las filas y eventos_bot (SHARE) y los suelta al terminar", async () => {
    const db = await crearDb();
    const { huella } = await reiniciar(db, A);
    await reiniciar(db, A, { huella, aplicar: true });
    // Tras la transacción no queda ningún bloqueo: se puede escribir en eventos_bot.
    await db.exec(`update public.eventos_bot set activo = true where usuario_id = '${B}'`);
    assert.strictEqual(await contar(db, "select count(*) as n from pg_locks where relation = 'public.eventos_bot'::regclass and mode = 'ShareLock'"), 0);
    assert.ok(/lock table public\.eventos_bot in share mode/.test(M030) && M030.indexOf("for update', p_tabla") < M030.indexOf("lock table public.eventos_bot"), "filas primero, después eventos");
    assert.ok(M030.indexOf("lock table public.eventos_bot") < M030.indexOf("into v_activas"), "los sorteos se leen DESPUÉS de bloquear");
});

prueba("GUARDIA: si a una tabla física le falta una columna que usa la función, la 030 aborta entera", async () => {
    const db = new PGlite();
    abiertas.push(db);
    const sinIdentidad = COLUMNAS.replace(", identidad_evento_real text", "");
    assert.notStrictEqual(sinIdentidad, COLUMNAS);
    await db.exec(ENTORNO.replace(`create table public.reservas_dos_cifras (${COLUMNAS});`, `create table public.reservas_dos_cifras (${sinIdentidad});`));
    await assert.rejects(db.exec(M030), /030 abortada: a reservas_dos_cifras le faltan columnas: identidad_evento_real/);
    await db.exec("rollback;");
    assert.strictEqual((await db.query("select to_regclass('public.reservas_archivo') as t")).rows[0].t, null, "no queda nada creado");
});

prueba("RECUPERACIÓN: la plantilla del final de la 030 devuelve lo archivado y no pisa un número ya reservado de nuevo", async () => {
    const db = await crearDb();
    const antes = await instantanea(db, A);
    const { huella } = await reiniciar(db, A);
    await reiniciar(db, A, { huella, aplicar: true });
    await db.exec(`update public.${T} set estado = 'reservado', comprador = 'Nuevo' where usuario_id = '${A}' and numero = '05'`);
    const instante = (await db.query("select max(archivado_en)::text as t from public.reservas_archivo")).rows[0].t;
    const ini = M030.indexOf("--   update public.\"<TABLA>\" t");
    const fin = M030.indexOf("--   -- comprobar el número");
    assert.ok(ini > 0 && fin > ini, "plantilla presente");
    const sql = M030.slice(ini, fin).split(/\r?\n/).map(l => l.replace(/^--\s{3}/, "")).join("\n")
        .replaceAll("<TABLA>", "5k_15k_reservas_2_cifras").replaceAll("<UUID>", A).replaceAll("<INSTANTE>", instante);
    await db.exec(sql);
    const despues = JSON.parse(await instantanea(db, A));
    const original = JSON.parse(antes);
    for (const n of ["00", "01", "02", "03", "04"]) {
        const [o, d] = [original.find(f => f.numero === n), despues.find(f => f.numero === n)];
        assert.deepStrictEqual([d.estado, d.comprador, d.fecha_pago, d.identidad_evento_real], [o.estado, o.comprador, o.fecha_pago, o.identidad_evento_real], `número ${n} restaurado`);
    }
    const cinco = despues.find(f => f.numero === "05");
    assert.deepStrictEqual([cinco.estado, cinco.comprador], ["reservado", "Nuevo"], "el reservado de nuevo no se pisa");
});

prueba("BLOQUEADOS a mano: solo se liberan eligiéndolo expresamente (y quedan archivados)", async () => {
    const db = await crearDb();
    const r = await reiniciar(db, A, { liberarBloqueados: true });
    assert.deepStrictEqual([r.ok, r.liberables, r.conservados], [true, 7, 0]);
    const ap = await reiniciar(db, A, { huella: r.huella, aplicar: true, liberarBloqueados: true });
    assert.strictEqual(ap.archivados, 7);
    assert.strictEqual(await contar(db, `select count(*) as n from public.reservas_archivo where numero = '06' and estado = 'bloqueado'`), 1);
    assert.strictEqual(await contar(db, `select count(*) as n from public.${T} where usuario_id = '${A}' and estado <> 'libre'`), 0);
});

prueba("CONFLICTOS: reserva entre vista previa y aplicación, y segunda aplicación con la misma huella -> nada", async () => {
    const db = await crearDb();
    const { huella } = await reiniciar(db, A);
    // Alguien reserva entretanto (como el bot), en un sorteo cerrado.
    await db.exec(`update public.${T} set estado = 'reservado', identidad_evento_real = 'viejo' where usuario_id = '${A}' and numero = '80'`);
    const antes = await instantanea(db, A);
    const r = await reiniciar(db, A, { huella, aplicar: true });
    assert.deepStrictEqual([r.ok, r.motivo], [false, "tabla_cambio"]);
    assert.strictEqual(await instantanea(db, A), antes);
    assert.strictEqual(await contar(db, "select count(*) as n from public.reservas_archivo"), 0);
    // Doble clic / dos pestañas: la primera aplica, la segunda ya no.
    const h2 = (await reiniciar(db, A)).huella;
    assert.strictEqual((await reiniciar(db, A, { huella: h2, aplicar: true })).archivados, 7);
    const despues = await instantanea(db, A);
    const otra = await reiniciar(db, A, { huella: h2, aplicar: true });
    assert.deepStrictEqual([otra.ok, otra.motivo], [false, "tabla_cambio"]);
    assert.strictEqual(await instantanea(db, A), despues);
    assert.strictEqual(await contar(db, "select count(*) as n from public.reservas_archivo"), 7);
});

prueba("ABORTO: un fallo a mitad (al liberar) revierte también el archivo -> sin cambios parciales", async () => {
    const db = await crearDb();
    const { huella } = await reiniciar(db, A);
    await db.exec(`create function falla() returns trigger language plpgsql as $f$ begin raise exception 'fallo simulado'; end $f$;
        create trigger t_falla before update on public.${T} for each row execute function falla();`);
    const antes = await instantanea(db, A);
    await assert.rejects(reiniciar(db, A, { huella, aplicar: true }), /fallo simulado/);
    await db.exec("reset role;");
    assert.strictEqual(await instantanea(db, A), antes);
    assert.strictEqual(await contar(db, "select count(*) as n from public.reservas_archivo"), 0);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    for (const db of abiertas) await db.close().catch(() => {});
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
