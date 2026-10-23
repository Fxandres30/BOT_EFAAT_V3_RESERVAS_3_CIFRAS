// ==========================================================================
// PRUEBA SQL de docs/activacion/parte_b_compradores_semanales.sql (B1, B2) y
// parte_c_tablas_legado.sql (NO aplicadas en producción) contra Postgres
// real en memoria (PGlite), junto con la Parte A.
//
// El trigger heredado real no está en el repositorio: se prueban las dos
// formas plausibles (INSERT simple y UPSERT por whatsapp), ambas security
// invoker como el real (ver migración 016).
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/sorteos/parteBCompradores.test.js
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

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "activacion");
const PARTE_A = fs.readFileSync(path.join(DOCS, "propuesta_rls_tablas_antiguas.sql"), "utf8");
const PARTE_B = fs.readFileSync(path.join(DOCS, "parte_b_compradores_semanales.sql"), "utf8");
const PARTE_C = fs.readFileSync(path.join(DOCS, "parte_c_tablas_legado.sql"), "utf8");

// Cada bloque ejecutable va de una línea "begin;" a la siguiente "commit;"
// (los de los comentarios empiezan por "--" y no cuentan).
function bloques(sql) {
    return [...sql.matchAll(/^begin;$[\s\S]*?^commit;$/gm)].map(m => m[0]);
}

const [B1, B2] = bloques(PARTE_B);
const [C1, C2] = bloques(PARTE_C);

// B2 exige el md5 del cuerpo revisado de la función heredada (lo da el
// bloque B_funcion_heredada del diagnóstico): aquí se lee de la base de prueba.
async function conMd5(db, sql) {
    const { rows } = await db.query("select md5(prosrc) m from pg_proc where proname = 'legado_comprador'");
    return sql.replaceAll("cceca089f72b33a12832eaf6c9f438c5", rows[0].m);
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";

const LEGADO_INSERT = `
    create function public.legado_comprador() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            insert into public.compradores_semanales (nombre, whatsapp, total_semanal)
            values (coalesce(new.comprador, ''), coalesce(nullif(new.contacto, ''), new.telefono), 1);
        end if;
        return new;
    end $$;`;

const LEGADO_UPSERT = `
    create unique index compradores_semanales_whatsapp on public.compradores_semanales (whatsapp);
    create function public.legado_comprador() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            insert into public.compradores_semanales (nombre, whatsapp, total_semanal)
            values (coalesce(new.comprador, ''), coalesce(nullif(new.contacto, ''), new.telefono), 1)
            on conflict (whatsapp) do update set total_semanal = compradores_semanales.total_semanal + 1;
        end if;
        return new;
    end $$;`;

function entorno(legado) {
    return `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.eventos_bot (id serial primary key, usuario_id uuid, activo boolean);
    create table public.sesiones (id serial primary key, usuario_id uuid);
    create table public.compradores_semanales (
        id serial primary key, nombre text not null, whatsapp text not null,
        total_semanal int default 0, entregados_3cifras int default 0);
    ${["reservas_dos_cifras", "5k_15k_reservas_2_cifras"].map(t => `
    create table public."${t}" (id serial primary key, numero text, estado text, usuario_id uuid,
        comprador text, contacto text, telefono text, lid text);`).join("")}

    ${legado}
    create trigger legado after update on public."5k_15k_reservas_2_cifras" for each row execute function public.legado_comprador();

    -- Tablas heredadas de la Parte C (una basta) y una RPC heredada.
    create table public.registro_usuarios (id serial primary key, whatsapp text, ip_guardado text);
    insert into public.registro_usuarios (whatsapp, ip_guardado) values ('3000000009', '1.2.3.4');
    create function public.sumar_entregados_tres_cifras(p_whatsapp text, p_cantidad int) returns void
        language sql as $$ update public.compradores_semanales set entregados_3cifras = entregados_3cifras + p_cantidad where whatsapp = p_whatsapp $$;

    insert into public."5k_15k_reservas_2_cifras" (numero, estado, usuario_id, comprador, contacto, telefono, lid) values
        ('01', 'reservado', '${A}', 'Con teléfono', '3000000001', '3000000001', '111@lid'),
        ('02', 'reservado', '${A}', 'Solo LID', null, null, '222@lid'),
        ('03', 'reservado', '${A}', 'Solo LID 2', null, null, '333@lid'),
        ('04', 'reservado', '${A}', 'Con teléfono 2', '3000000004', null, null);
    insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values ('Histórico', '3000000099', 5);
    `;
}

const abiertas = [];

async function crearDb(legado = LEGADO_INSERT) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(entorno(legado));
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const pagar = (db, rol, numero, usuario = A) =>
    como(db, rol, usuario, `update public."5k_15k_reservas_2_cifras" set estado = 'pagado' where numero = '${numero}' returning numero`);

const estado = async (db, numero) =>
    (await db.query(`select estado from public."5k_15k_reservas_2_cifras" where numero = '${numero}'`)).rows[0].estado;

const compradores = async (db) =>
    (await db.query(`select whatsapp, total_semanal from public.compradores_semanales order by whatsapp`)).rows;

async function rechaza(promesa, patron) {
    let error = null;
    try { await promesa; } catch (e) { error = e; }
    assert.ok(error, "se esperaba un error");
    if (patron) assert.match(String(error.message), patron);
    return error;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("situación ACTUAL reproducida: pagar a un cliente solo LID falla (23502) y la reserva sigue 'reservado'", async () => {
    const db = await crearDb();
    const e = await rechaza(pagar(db, "service_role", "02"), /whatsapp/);
    assert.strictEqual(e.code, "23502");
    assert.strictEqual(await estado(db, "02"), "reservado");
});

prueba("B1: el pago solo LID se guarda (bot y panel), no se inventa teléfono ni se crea fila", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await db.exec(B1);
    assert.deepStrictEqual(await pagar(db, "service_role", "02"), [{ numero: "02" }]);
    assert.deepStrictEqual(await pagar(db, "authenticated", "03"), [{ numero: "03" }]);
    assert.strictEqual(await estado(db, "02"), "pagado");
    assert.strictEqual(await estado(db, "03"), "pagado");
    const filas = await compradores(db);
    assert.ok(filas.every(f => f.whatsapp), "ninguna fila sin whatsapp");
    assert.strictEqual(filas.length, 1, "solo la histórica");
});

prueba("B1: los pagos CON teléfono siguen sumando igual que antes", async () => {
    const db = await crearDb();
    await db.exec(B1);
    await pagar(db, "service_role", "01");
    await pagar(db, "service_role", "04");
    assert.deepStrictEqual(await compradores(db), [
        { whatsapp: "3000000001", total_semanal: 1 },
        { whatsapp: "3000000004", total_semanal: 1 },
        { whatsapp: "3000000099", total_semanal: 5 }
    ]);
});

prueba("B1 con trigger heredado tipo UPSERT (on conflict whatsapp): solo LID se guarda, con teléfono acumula", async () => {
    const db = await crearDb(LEGADO_UPSERT);
    await rechaza(pagar(db, "service_role", "02"), /whatsapp/);
    await db.exec(B1);
    await pagar(db, "service_role", "02");
    assert.strictEqual(await estado(db, "02"), "pagado");
    await db.exec(`update public."5k_15k_reservas_2_cifras" set contacto = '3000000099' where numero = '04'`);
    await pagar(db, "service_role", "04");
    assert.deepStrictEqual(await compradores(db), [{ whatsapp: "3000000099", total_semanal: 6 }]);
});

prueba("B1 idempotente", async () => {
    const db = await crearDb();
    await db.exec(B1);
    await db.exec(B1);
    await pagar(db, "service_role", "02");
    assert.strictEqual(await estado(db, "02"), "pagado");
});

prueba("SIN B2: tras quitar permisos al panel, su pago FALLA (por qué B2 hace SECURITY DEFINER)", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await db.exec("revoke all on table public.compradores_semanales from anon, authenticated;");
    await rechaza(pagar(db, "authenticated", "01"), /permission denied/);
    assert.strictEqual(await estado(db, "01"), "reservado");
});

prueba("B2 (tras A y B1): anon y authenticated ya no leen compradores; el panel y el bot siguen pagando", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await db.exec(B1);
    assert.strictEqual((await como(db, "anon", null, "select * from public.compradores_semanales")).length, 1, "hoy anon lee");
    await db.exec(await conMd5(db, B2));
    await rechaza(como(db, "anon", null, "select * from public.compradores_semanales"), /permission denied/);
    await rechaza(como(db, "authenticated", A, "select * from public.compradores_semanales"), /permission denied/);
    assert.deepStrictEqual(await pagar(db, "authenticated", "01"), [{ numero: "01" }], "panel paga");
    assert.deepStrictEqual(await pagar(db, "service_role", "04"), [{ numero: "04" }], "bot paga");
    assert.deepStrictEqual(await pagar(db, "authenticated", "02"), [{ numero: "02" }], "panel paga solo LID");
    assert.strictEqual((await compradores(db)).length, 3);
    const f = (await db.query(`select prosecdef from pg_proc where proname = 'legado_comprador'`)).rows[0];
    assert.strictEqual(f.prosecdef, true);
});

prueba("B2 idempotente", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await db.exec(B1);
    await db.exec(await conMd5(db, B2));
    await db.exec(await conMd5(db, B2));
    await pagar(db, "authenticated", "01");
    assert.strictEqual(await estado(db, "01"), "pagado");
});

prueba("B2 aborta SIN cambiar nada si hay más de una función heredada que escribe en la tabla", async () => {
    const db = await crearDb();
    await db.exec(`
        create function public.legado_dos() returns trigger language plpgsql as $$
        begin insert into public.compradores_semanales (nombre, whatsapp) values ('x', 'y'); return new; end $$;
        create trigger legado_dos after update on public.reservas_dos_cifras for each row execute function public.legado_dos();`);
    await rechaza(db.exec(B2), /B2 abortado/);
    await db.exec("rollback;");
    assert.strictEqual((await como(db, "anon", null, "select * from public.compradores_semanales")).length, 1, "anon conserva sus permisos");
    const f = (await db.query(`select prosecdef from pg_proc where proname = 'legado_comprador'`)).rows[0];
    assert.strictEqual(f.prosecdef, false);
});

prueba("B2 aborta SIN cambiar nada si el cuerpo de la función heredada no es el de producción (md5)", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    // Tal cual (md5 de producción) sobre una función de cuerpo distinto: aborta.
    await rechaza(db.exec(B2), /no es el revisado/);
    await db.exec("rollback;");
    await rechaza(db.exec(B2.replaceAll("cceca089f72b33a12832eaf6c9f438c5", "0".repeat(32))), /no es el revisado/);
    await db.exec("rollback;");
    assert.strictEqual((await db.query(`select prosecdef from pg_proc where proname = 'legado_comprador'`)).rows[0].prosecdef, false);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.compradores_semanales")).length, 1, "nada cambiado");
});

prueba("B2 aborta si el dueño de la función heredada no es el de la tabla ni salta la RLS (la 034 lo dejaría sin filas)", async () => {
    const db = await crearDb();
    await db.exec(`create role legado_dueno nologin; grant all on public.compradores_semanales to legado_dueno;
                   alter function public.legado_comprador() owner to legado_dueno;`);
    await rechaza(db.exec(await conMd5(db, B2)), /no es el de compradores_semanales ni salta la RLS/);
    await db.exec("rollback;");
});

prueba("C1/C2: anon, authenticated y PUBLIC pierden las tablas y RPC heredadas; tablas inexistentes se omiten; el bot no cambia", async () => {
    const db = await crearDb();
    assert.strictEqual((await como(db, "anon", null, "select * from public.registro_usuarios")).length, 1, "hoy anon lee");
    await db.exec(C1);
    await db.exec(C2);
    await rechaza(como(db, "anon", null, "select * from public.registro_usuarios"), /permission denied/);
    await rechaza(como(db, "anon", null, "select public.sumar_entregados_tres_cifras('3000000099', 1)"), /permission denied/);
    assert.strictEqual((await como(db, "service_role", null, "select * from public.registro_usuarios")).length, 1);
    // Antes de la auditoría integral authenticated seguía leyendo: cualquier
    // cliente con cuenta veía los datos personales heredados.
    await rechaza(como(db, "authenticated", A, "select * from public.registro_usuarios"), /permission denied/);
    await rechaza(como(db, "authenticated", A, "select public.sumar_entregados_tres_cifras('3000000099', 1)"), /permission denied/);
    await db.exec(C1);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    // Cerrar PGlite antes de salir (ver nota en propuestaRls.test.js).
    await Promise.allSettled(abiertas.map(db => db.close()));
    process.exit(falla ? 1 : 0);
})();
