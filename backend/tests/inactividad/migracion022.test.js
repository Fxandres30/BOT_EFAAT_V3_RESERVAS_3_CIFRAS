// ==========================================================================
// PRUEBAS SQL — migración 022_control_inactividad_miembros.sql contra un
// Postgres REAL en memoria (PGlite). Ejecuta el archivo tal cual: tablas,
// candado único, privilegios, trigger de compras confirmadas, backfill e
// idempotencia (aplicarla dos veces).
//
// Mismo criterio que tests/analitica/sqlAnalitica.test.js: PGlite NO es
// dependencia del proyecto. Para ejecutarla:
//
//     npm install --no-save @electric-sql/pglite --prefix <carpeta>
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/inactividad/migracion022.test.js
//
// Sin PGlite disponible la prueba se omite (exit 0) avisándolo.
// NUNCA se conecta a Supabase.
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

const MIGRACION = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "022_control_inactividad_miembros.sql"), "utf8");

const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT2 = "99999999-9999-4999-8999-999999999999";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U_HUERFANO = "33333333-3333-4333-8333-333333333333"; // no existe en usuarios

// Roles y esquema mínimos de Supabase + las dos tablas de reservas con las
// columnas reales (verificadas vía OpenAPI de PostgREST).
const ENTORNO = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${TENANT}'), ('${TENANT2}');
    create table public.usuarios (id uuid primary key, lid text, telefono text, nombre text);
    insert into public.usuarios (id) values ('${U1}'), ('${U2}');
    ${["reservas_dos_cifras", "5k_15k_reservas_2_cifras"].map(t => `
    create table public."${t}" (
        id bigserial primary key, numero text not null, estado text not null,
        comprador text, contacto text, grupo_id text, grupo_nombre text, evento_id uuid,
        fecha_reserva date, hora_reserva time, fecha_pago date, hora_pago time,
        usuario_id uuid, telefono text, lid text, nombre text,
        usuario_global_id uuid, identidad_evento_real text
    );`).join("\n")}
`;

async function crearDb({ semillas = "" } = {}) {
    const db = new PGlite();
    await db.exec(ENTORNO);
    if (semillas) await db.exec(semillas);
    await db.exec(MIGRACION);
    return db;
}

async function filas(db, sql, params) {
    return (await db.query(sql, params)).rows;
}

async function miembro(db, ug, grupo = "A@g.us", tenant = TENANT) {
    return (await filas(db, "select * from public.inactividad_miembros where usuario_id = $1 and grupo_id = $2 and usuario_global_id = $3", [tenant, grupo, ug]))[0] || null;
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. aplica limpio: 3 tablas, RLS activo, índice único parcial y trigger en las 2 tablas de reservas", async () => {
    const db = await crearDb();
    const tablas = await filas(db, "select tablename, rowsecurity from pg_tables where tablename like 'inactividad_%' order by 1");
    assert.deepStrictEqual(tablas.map(t => t.tablename), ["inactividad_ejecuciones", "inactividad_evaluaciones", "inactividad_miembros"]);
    assert.ok(tablas.every(t => t.rowsecurity), "RLS habilitado en las tres");
    const triggers = await filas(db, "select event_object_table as t from information_schema.triggers where trigger_name = 'inactividad_compra_confirmada' group by 1 order by 1");
    assert.deepStrictEqual(triggers.map(x => x.t), ["5k_15k_reservas_2_cifras", "reservas_dos_cifras"]);
    const idx = await filas(db, "select indexdef from pg_indexes where indexname = 'inactividad_ejecuciones_una_en_curso'");
    assert.ok(/UNIQUE/.test(idx[0].indexdef) && /en_curso/.test(idx[0].indexdef), idx[0]?.indexdef);
});

prueba("2. backfill: importa solo compras 'pagado' con fecha, hora de Bogotá, la más reciente por (tenant, grupo, miembro)", async () => {
    const db = await crearDb({ semillas: `
        insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago) values
          ('01', 'pagado',    'A@g.us', '${TENANT}', '${U1}', '2026-10-01', '19:30:00'),
          ('02', 'pagado',    'A@g.us', '${TENANT}', '${U1}', '2026-09-20', '08:00:00'),
          ('03', 'reservado', 'A@g.us', '${TENANT}', '${U2}', null, null),
          ('04', 'pagado',    'A@g.us', '${TENANT}', '${U2}', null, null),
          ('05', 'pagado',    'A@g.us', '${TENANT}', '${U_HUERFANO}', '2026-10-01', '10:00:00'),
          ('06', 'pagado',    null,     '${TENANT}', '${U2}', '2026-10-01', '10:00:00');
        insert into public."5k_15k_reservas_2_cifras" (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago) values
          ('10', 'pagado', 'B@g.us', '${TENANT}', '${U2}', '2026-10-05', null);
    ` });
    const m1 = await miembro(db, U1);
    assert.strictEqual(new Date(m1.ultima_compra_en).toISOString(), "2026-10-02T00:30:00.000Z");
    assert.strictEqual(m1.ultima_compra_origen, "migracion_022");
    assert.strictEqual(await miembro(db, U2), null, "reservado / sin fecha / sin grupo no cuentan como compra");
    assert.strictEqual(new Date((await miembro(db, U2, "B@g.us")).ultima_compra_en).toISOString(), "2026-10-05T05:00:00.000Z");
    const total = await filas(db, "select count(*)::int as n from public.inactividad_miembros");
    assert.strictEqual(total[0].n, 2, "la fila huérfana no rompe la migración ni se importa");
});

prueba("3. trigger: el PANEL (rol authenticated) marca pagado -> compra registrada en la misma transacción", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('07', 'reservado', 'A@g.us', '${TENANT}', '${U1}');` });
    await db.exec("set role authenticated");
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado', fecha_pago = current_date, hora_pago = localtime where numero = '07'");
    await db.exec("reset role");
    const m = await miembro(db, U1);
    assert.ok(m, "se registró aunque authenticated no tiene acceso a inactividad_miembros");
    assert.strictEqual(m.ultima_compra_origen, "trigger_pago");
    assert.ok(Date.now() - new Date(m.ultima_compra_en).getTime() < 60000);
});

prueba("4. el registro SOBREVIVE al reinicio de la tabla y a la cancelación del número", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('08', 'reservado', 'A@g.us', '${TENANT}', '${U1}');` });
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado' where numero = '08'");
    const antes = await miembro(db, U1);
    // reiniciarTabla.ts: todo a 'libre' y borra grupo/usuario/fechas.
    await db.exec(`update public.reservas_dos_cifras set estado = 'libre', grupo_id = null, usuario_global_id = null, fecha_pago = null, hora_pago = null where usuario_id = '${TENANT}'`);
    const despues = await miembro(db, U1);
    assert.strictEqual(new Date(despues.ultima_compra_en).toISOString(), new Date(antes.ultima_compra_en).toISOString());
});

prueba("5. NO cuentan como compra: reservar, liberar, re-guardar una fila ya pagada", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('09', 'libre', 'A@g.us', '${TENANT}', '${U2}');` });
    await db.exec("update public.reservas_dos_cifras set estado = 'reservado' where numero = '09'");
    assert.strictEqual(await miembro(db, U2), null);
    await db.exec("update public.reservas_dos_cifras set estado = 'libre' where numero = '09'");
    assert.strictEqual(await miembro(db, U2), null);
    // pagado -> pagado (p. ej. completar identidad): no re-registra.
    await db.exec(`insert into public.inactividad_miembros (usuario_id, grupo_id, usuario_global_id, ultima_compra_en, ultima_compra_origen) values ('${TENANT}', 'A@g.us', '${U2}', '2026-01-01T00:00:00Z', 'x')`);
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado' where numero = '09'");
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado', nombre = 'otro' where numero = '09'");
    const m = await miembro(db, U2);
    assert.strictEqual(m.ultima_compra_origen, "trigger_pago", "solo la transición a pagado registró");
});

prueba("6. el trigger NUNCA bloquea un pago: usuario inexistente (FK) -> pago guardado, compra no registrada", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('11', 'reservado', 'A@g.us', '${TENANT}', '${U_HUERFANO}');` });
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado' where numero = '11'");
    const fila = await filas(db, "select estado from public.reservas_dos_cifras where numero = '11'");
    assert.strictEqual(fila[0].estado, "pagado");
    assert.strictEqual(await miembro(db, U_HUERFANO), null);
});

prueba("7. por grupo: compra en A no crea ni toca el registro de B; nunca retrocede la fecha", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('12', 'reservado', 'A@g.us', '${TENANT}', '${U1}');` });
    await db.exec(`insert into public.inactividad_miembros (usuario_id, grupo_id, usuario_global_id, ultima_compra_en) values ('${TENANT}', 'B@g.us', '${U1}', '2026-09-01T00:00:00Z')`);
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado' where numero = '12'");
    assert.ok(await miembro(db, U1, "A@g.us"));
    assert.strictEqual(new Date((await miembro(db, U1, "B@g.us")).ultima_compra_en).toISOString(), "2026-09-01T00:00:00.000Z");
    // GREATEST: una compra futura ya registrada no se pisa con now().
    await db.exec(`update public.inactividad_miembros set ultima_compra_en = '2099-01-01T00:00:00Z' where grupo_id = 'A@g.us'`);
    await db.exec("update public.reservas_dos_cifras set estado = 'reservado' where numero = '12'");
    await db.exec("update public.reservas_dos_cifras set estado = 'pagado' where numero = '12'");
    assert.strictEqual(new Date((await miembro(db, U1, "A@g.us")).ultima_compra_en).toISOString(), "2099-01-01T00:00:00.000Z");
});

prueba("8. candado: una sola ejecución 'en_curso' por tenant (23505); otro tenant y tras cerrar, sí", async () => {
    const db = await crearDb();
    await db.exec(`insert into public.inactividad_ejecuciones (usuario_id, modo) values ('${TENANT}', 'simulacion')`);
    await assert.rejects(db.exec(`insert into public.inactividad_ejecuciones (usuario_id, modo) values ('${TENANT}', 'real')`), e => e.code === "23505");
    await db.exec(`insert into public.inactividad_ejecuciones (usuario_id, modo) values ('${TENANT2}', 'simulacion')`);
    await db.exec(`update public.inactividad_ejecuciones set estado = 'completada' where usuario_id = '${TENANT}'`);
    await db.exec(`insert into public.inactividad_ejecuciones (usuario_id, modo) values ('${TENANT}', 'simulacion')`);
    await assert.rejects(db.exec(`insert into public.inactividad_ejecuciones (usuario_id, modo) values ('${TENANT}', 'otro')`), /check/i);
});

prueba("9. privilegios: anon y authenticated NO leen ni escriben; service_role sí", async () => {
    const db = await crearDb();
    for (const rol of ["anon", "authenticated"]) {
        for (const t of ["inactividad_miembros", "inactividad_ejecuciones", "inactividad_evaluaciones"]) {
            await db.exec(`set role ${rol}`);
            await assert.rejects(db.query(`select * from public.${t}`), /permission denied/i, `${rol} leyó ${t}`);
            await db.exec("reset role");
        }
    }
    await db.exec("set role service_role");
    await db.query("select * from public.inactividad_miembros");
    await db.exec(`insert into public.inactividad_evaluaciones (usuario_id, modo, grupo_id, decision, motivo) values ('${TENANT}', 'simulacion', 'A@g.us', 'conservar', 'x')`);
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.inactividad_registrar_compra()"), /permission denied|trigger functions can only be called/i);
    await db.exec("reset role");
});

prueba("10. idempotente: aplicarla 2 veces no falla, no duplica triggers ni pierde datos", async () => {
    const db = await crearDb({ semillas: `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago) values ('13', 'pagado', 'A@g.us', '${TENANT}', '${U1}', '2026-10-01', '10:00:00');` });
    await db.exec(`update public.inactividad_miembros set seguimiento_desde = '2026-01-01T00:00:00Z', presente = false`);
    await db.exec(MIGRACION);
    const triggers = await filas(db, "select count(*)::int as n from pg_trigger where tgname = 'inactividad_compra_confirmada'");
    assert.strictEqual(triggers[0].n, 2);
    const m = await miembro(db, U1);
    assert.strictEqual(new Date(m.seguimiento_desde).toISOString(), "2026-01-01T00:00:00.000Z", "no pisa el seguimiento");
    assert.strictEqual(m.presente, false, "no pisa la presencia");
    assert.strictEqual(new Date(m.ultima_compra_en).toISOString(), "2026-10-01T15:00:00.000Z");
});

prueba("11. no destructiva: columnas y filas de las tablas de reservas intactas", async () => {
    const semilla = `insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago, comprador) values ('14', 'pagado', 'A@g.us', '${TENANT}', '${U1}', '2026-10-01', '10:00:00', 'Ana');`;
    const db = new PGlite();
    await db.exec(ENTORNO);
    await db.exec(semilla);
    const columnasAntes = await filas(db, "select column_name, data_type from information_schema.columns where table_name = 'reservas_dos_cifras' order by ordinal_position");
    const filasAntes = await filas(db, "select * from public.reservas_dos_cifras order by id");
    await db.exec(MIGRACION);
    assert.deepStrictEqual(await filas(db, "select column_name, data_type from information_schema.columns where table_name = 'reservas_dos_cifras' order by ordinal_position"), columnasAntes);
    assert.deepStrictEqual(await filas(db, "select * from public.reservas_dos_cifras order by id"), filasAntes);
});

// Réplica de los UPDATE reales que generan PostgREST/supabase-js:
//   PANEL  (frontend/services/tablas/marcarPagado.ts, rol authenticated):
//     update ... set estado, fecha_pago, hora_pago
//     where numero = $n and usuario_id = $tenant and estado = 'reservado'
//   STICKER (bot/funciones/pagos/marcarReservasPagadasPorAdmin.js, service_role):
//     update ... set estado, fecha_pago, hora_pago, [identidad]
//     where usuario_global_id = $u and usuario_id = $tenant and estado = 'reservado'
//       and identidad_evento_real = $id     (varias filas a la vez)
prueba("12. PANEL: UPDATE real de marcarPagado.ts (authenticated) -> compra persistente en el grupo de la reserva", async () => {
    const db = await crearDb({ semillas: `insert into public."5k_15k_reservas_2_cifras" (numero, estado, grupo_id, usuario_id, usuario_global_id) values ('21', 'reservado', 'G-panel@g.us', '${TENANT}', '${U1}');` });
    await db.exec("set role authenticated");
    await db.query(`update public."5k_15k_reservas_2_cifras" set estado = 'pagado', fecha_pago = $1, hora_pago = $2
                    where numero = $3 and usuario_id = $4 and estado = 'reservado'`, ["2026-10-10", "14:05:09", "21", TENANT]);
    await db.exec("reset role");
    const m = await miembro(db, U1, "G-panel@g.us");
    assert.ok(m, "registrada");
    assert.strictEqual(m.ultima_compra_origen, "trigger_pago");
    await db.exec(`update public."5k_15k_reservas_2_cifras" set estado = 'libre', grupo_id = null, usuario_global_id = null where usuario_id = '${TENANT}'`);
    assert.ok(await miembro(db, U1, "G-panel@g.us"), "sobrevive al reinicio");
});

prueba("13. STICKER: UPDATE real de marcarReservasPagadasPorAdmin (service_role, varias filas) -> una compra por grupo", async () => {
    const db = await crearDb({ semillas: `
        insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id, identidad_evento_real) values
          ('31', 'reservado', 'G-A@g.us', '${TENANT}', '${U2}', 'sorteo-1'),
          ('32', 'reservado', 'G-A@g.us', '${TENANT}', '${U2}', 'sorteo-1'),
          ('33', 'reservado', 'G-B@g.us', '${TENANT}', '${U2}', 'sorteo-1'),
          ('34', 'reservado', 'G-A@g.us', '${TENANT}', '${U1}', 'sorteo-1');` });
    await db.exec("set role service_role");
    await db.query(`update public.reservas_dos_cifras set estado = 'pagado', fecha_pago = $1, hora_pago = $2, telefono = $3
                    where usuario_global_id = $4 and usuario_id = $5 and estado = 'reservado' and identidad_evento_real = $6`,
        ["2026-10-10", "09:00:00", "3000000000", U2, TENANT, "sorteo-1"]);
    await db.exec("reset role");
    assert.ok(await miembro(db, U2, "G-A@g.us"), "grupo A (dos números, un registro)");
    assert.ok(await miembro(db, U2, "G-B@g.us"), "grupo B (reserva hecha en B, pagada con el mismo sticker)");
    assert.strictEqual(await miembro(db, U1, "G-A@g.us"), null, "otro cliente no se toca");
    const n = await filas(db, `select count(*)::int as n from public.inactividad_miembros where usuario_global_id = '${U2}'`);
    assert.strictEqual(n[0].n, 2);
});

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "inactividad");

prueba("14. verificación: docs/inactividad/022_verificacion.sql corre y da los resultados ESPERADOS", async () => {
    const db = await crearDb({ semillas: `
        insert into public.reservas_dos_cifras (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago) values
          ('01', 'pagado', 'A@g.us', '${TENANT}', '${U1}', '2026-10-01', '10:00:00'),
          ('02', 'pagado', 'A@g.us', '${TENANT}', '${U_HUERFANO}', '2026-10-01', '10:00:00');
        insert into public."5k_15k_reservas_2_cifras" (numero, estado, grupo_id, usuario_id, usuario_global_id, fecha_pago, hora_pago) values
          ('03', 'pagado', 'B@g.us', '${TENANT}', '${U2}', '2026-10-02', '11:00:00');` });
    const r = await db.exec(fs.readFileSync(path.join(DOCS, "022_verificacion.sql"), "utf8"));
    const res = r.filter(x => x.fields && x.fields.length).map(x => x.rows); // solo los SELECT
    const [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11] = res;
    assert.deepStrictEqual(v1.map(f => [f.tabla, f.rls]), [["inactividad_ejecuciones", true], ["inactividad_evaluaciones", true], ["inactividad_miembros", true]]);
    assert.strictEqual(v2.length, 0, "sin políticas");
    assert.ok(v3.length === 3 && v3.every(f => f.grantee === "service_role" && ["DELETE", "INSERT", "SELECT", "UPDATE"].every(p => f.privilegios.includes(p))), JSON.stringify(v3));
    assert.ok(v4.some(f => f.indexname === "inactividad_ejecuciones_una_en_curso" && /UNIQUE/.test(f.indexdef)));
    assert.strictEqual(v5.length, 4);
    assert.strictEqual(v6[0].security_definer, true);
    assert.ok(String(v6[0].config).includes("search_path=public, pg_temp"), JSON.stringify(v6[0].config));
    assert.deepStrictEqual(v7[0], { anon: false, authenticated: false });
    assert.ok(v8.length >= 4);
    assert.deepStrictEqual(v9.map(f => [f.ultima_compra_origen, Number(f.miembros)]), [["migracion_022", 2]]);
    assert.deepStrictEqual([Number(v10[0].importables), Number(v10[0].importados), Number(v10[0].huerfanas_no_importables)], [2, 2, 1]);
    assert.strictEqual(v11.length, 0);
});

prueba("15. docs/inactividad/revision_simulacion.sql corre (placeholders sustituidos) y NO puede escribir", async () => {
    const db = await crearDb();
    const sql = fs.readFileSync(path.join(DOCS, "revision_simulacion.sql"), "utf8")
        .replaceAll("<USUARIO_GLOBAL_ID>", U1).replaceAll("<TELEFONO_SIN_57>", "3000000000").replaceAll("<NUMERO>", "01");
    const r = await db.exec(sql);
    assert.ok(r.length > 10);
    const seguridad = r.find(x => x.fields?.some(f => f.name === "miembros_expulsados")).rows[0];
    assert.deepStrictEqual([seguridad.ejecuciones_reales, seguridad.evaluaciones_con_expulsion, seguridad.miembros_expulsados].map(Number), [0, 0, 0]);
    // La transacción READ ONLY rechaza cualquier escritura añadida por error.
    await assert.rejects(db.exec("begin transaction read only; delete from public.inactividad_miembros; rollback;"), /read-only/i);
    await db.exec("rollback").catch(() => {});
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
