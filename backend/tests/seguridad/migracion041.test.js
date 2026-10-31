// ==========================================================================
// PRUEBA SQL de supabase_migrations/041_pagos_sin_whatsapp.sql (NO aplicada
// en producción) contra Postgres real en memoria (PGlite).
//
// El trigger heredado real (actualizar_compradores_semanales) no está en el
// repositorio: se prueban las dos formas plausibles, INSERT tras UPDATE sin
// filas (como la réplica de aislamientoMulticliente.test.js) y UPSERT por
// whatsapp, ambas security invoker y AFTER UPDATE de fila, como el real.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/migracion041.test.js
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

const M041 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "041_pagos_sin_whatsapp.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T = '"5k_15k_reservas_2_cifras"';

const LEGADO_UPDATE_INSERT = `
    create function public.actualizar_compradores_semanales() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            update public.compradores_semanales set total_semanal = total_semanal + 1 where whatsapp = new.telefono;
            if not found then
                insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values (coalesce(new.comprador, 'x'), new.telefono, 1);
            end if;
        end if;
        return new;
    end $$;`;

const LEGADO_UPSERT = `
    create unique index compradores_semanales_whatsapp on public.compradores_semanales (whatsapp);
    create function public.actualizar_compradores_semanales() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            insert into public.compradores_semanales (nombre, whatsapp, total_semanal)
            values (coalesce(new.comprador, ''), coalesce(nullif(new.contacto, ''), new.telefono), 1)
            on conflict (whatsapp) do update set total_semanal = compradores_semanales.total_semanal + 1;
        end if;
        return new;
    end $$;`;

// Reservas 'reservado' de A con todos los casos de datos de contacto.
const RESERVAS = [
    // numero, comprador, contacto, telefono, lid
    ["01", "Con teléfono", "3000000001", "3000000001", "111@lid"],
    ["02", "Sin teléfono (solo LID)", null, null, "222@lid"],
    ["03", "Sin JID", "3000000003", "3000000003", null],
    ["04", "Sin contacto", null, null, null],
    ["05", null, null, null, null],                         // datos incompletos
    ["06", "LID en el teléfono", "333@lid", "333@lid", "333@lid"],
    ["07", "Teléfono vacío", "", "", null],
    ["11", "María", "3000000011", "3000000011", null],      // 11-13: mismo comprador
    ["12", "María", "3000000011", "3000000011", null],
    ["13", "María", "3000000011", "3000000011", null]
];

const sqlTexto = (v) => (v === null ? "null" : `'${v}'`);

function entorno(legado) {
    return `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

    create table public.compradores_semanales (
        id serial primary key, nombre text not null, whatsapp text not null,
        lunes int default 0, total_semanal int default 0, entregados_3cifras int default 0);
    create table public.${T} (id serial primary key, numero text unique, estado text, usuario_id uuid,
        comprador text, contacto text, nombre text, telefono text, lid text, grupo_id text,
        evento_id text, identidad_evento_real text, fecha_pago text, hora_pago text);

    ${legado}
    create trigger trg_compradores after update on public.${T} for each row execute function public.actualizar_compradores_semanales();

    insert into public.${T} (numero, estado, usuario_id, comprador, contacto, nombre, telefono, lid, grupo_id, evento_id, identidad_evento_real) values
    ${RESERVAS.map(([n, c, ct, t, l]) => `('${n}', 'reservado', '${A}', ${sqlTexto(c)}, ${sqlTexto(ct)}, ${sqlTexto(c)}, ${sqlTexto(t)}, ${sqlTexto(l)}, 'g1@g.us', 'ev-1', 'idA')`).join(",\n    ")};
    insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values ('Histórico', '3000000099', 5);
    `;
}

const abiertas = [];

async function crearDb(legado = LEGADO_UPDATE_INSERT) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(entorno(legado));
    return db;
}

// Mismo UPDATE que el backend (reservaManual.js): condicionado a 'reservado',
// por número (pago individual) o con .in() (lote), como service_role.
async function pagar(db, numeros) {
    const lista = numeros.map(n => `'${n}'`).join(", ");
    await db.exec("set role service_role;");
    try {
        return (await db.query(`update public.${T} set estado = 'pagado', fecha_pago = '2026-10-31', hora_pago = '10:00:00'
            where numero in (${lista}) and estado = 'reservado' and usuario_id = '${A}' returning numero`)).rows.map(r => r.numero).sort();
    } finally {
        await db.exec("reset role;");
    }
}

const filaReserva = async (db, n) => (await db.query(`select * from public.${T} where numero = '${n}'`)).rows[0];
const estados = async (db, ns) => Promise.all(ns.map(async n => (await filaReserva(db, n)).estado));
const compradores = async (db) =>
    (await db.query("select whatsapp, total_semanal from public.compradores_semanales order by whatsapp")).rows;

async function rechaza(promesa, patron) {
    let error = null;
    try { await promesa; } catch (e) { error = e; }
    assert.ok(error, "se esperaba un error");
    if (patron) assert.match(String(error.message), patron);
    return error;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("situación ACTUAL (sin 041): pagar sin teléfono falla con 23502 y el número sigue reservado; el lote entero se revierte", async () => {
    const db = await crearDb();
    const e = await rechaza(pagar(db, ["02"]), /whatsapp/);
    assert.strictEqual(e.code, "23502");
    assert.strictEqual((await filaReserva(db, "02")).estado, "reservado");
    await rechaza(pagar(db, ["01", "02"]), /whatsapp/);
    assert.deepStrictEqual(await estados(db, ["01", "02"]), ["reservado", "reservado"], "ni el que tenía teléfono");
});

prueba("pago individual: con teléfono, sin teléfono, sin JID, sin contacto, datos incompletos, LID o vacío en el teléfono -> todos pagados", async () => {
    const db = await crearDb();
    await db.exec(M041);
    for (const n of ["01", "02", "03", "04", "05", "06", "07"]) {
        assert.deepStrictEqual(await pagar(db, [n]), [n], `pago ${n}`);
    }
    assert.deepStrictEqual(await estados(db, ["01", "02", "03", "04", "05", "06", "07"]), Array(7).fill("pagado"));
    assert.deepStrictEqual(await compradores(db), [
        { whatsapp: "3000000001", total_semanal: 1 },   // con teléfono
        { whatsapp: "3000000003", total_semanal: 1 },   // sin JID: tiene teléfono, cuenta
        { whatsapp: "3000000099", total_semanal: 5 }    // histórico intacto
    ], "solo se copian los que tienen WhatsApp válido; no se inventa ninguno");
});

prueba("registro principal del pago intacto: estado, fecha y hora de pago, comprador, contacto, LID, grupo y sorteo", async () => {
    const db = await crearDb();
    await db.exec(M041);
    const antes = await filaReserva(db, "02");
    await pagar(db, ["02"]);
    const despues = await filaReserva(db, "02");
    assert.deepStrictEqual([despues.estado, despues.fecha_pago, despues.hora_pago], ["pagado", "2026-10-31", "10:00:00"]);
    for (const c of ["comprador", "contacto", "nombre", "telefono", "lid", "grupo_id", "evento_id", "identidad_evento_real", "usuario_id"]) {
        assert.strictEqual(despues[c], antes[c], `${c} no cambia`);
    }
});

prueba("pago por lote (una sentencia) con contactos mezclados: todos pagados, solo los válidos suman", async () => {
    const db = await crearDb();
    await db.exec(M041);
    const todos = ["01", "02", "03", "04", "05", "06", "07"];
    assert.deepStrictEqual(await pagar(db, todos), todos);
    assert.deepStrictEqual(await estados(db, todos), Array(7).fill("pagado"));
    assert.deepStrictEqual((await compradores(db)).map(f => f.whatsapp), ["3000000001", "3000000003", "3000000099"]);
});

prueba("pago parcial y completo de un mismo comprador: por número, y su contador suma cada pago una vez", async () => {
    const db = await crearDb();
    await db.exec(M041);
    await pagar(db, ["11"]);
    assert.deepStrictEqual(await estados(db, ["11", "12", "13"]), ["pagado", "reservado", "reservado"], "parcial");
    assert.deepStrictEqual(await pagar(db, ["11", "12", "13"]), ["12", "13"], "el ya pagado no se repite");
    assert.deepStrictEqual(await estados(db, ["11", "12", "13"]), ["pagado", "pagado", "pagado"], "completo");
    assert.deepStrictEqual((await compradores(db)).find(f => f.whatsapp === "3000000011"), { whatsapp: "3000000011", total_semanal: 3 });
});

prueba("trigger heredado tipo UPSERT (on conflict whatsapp): sin teléfono se paga; con teléfono acumula como antes", async () => {
    const db = await crearDb(LEGADO_UPSERT);
    await rechaza(pagar(db, ["02"]), /whatsapp/);
    await db.exec(M041);
    assert.deepStrictEqual(await pagar(db, ["02", "04", "06", "07"]), ["02", "04", "06", "07"]);
    await db.exec(`update public.${T} set contacto = '3000000099' where numero = '01'`);
    await pagar(db, ["01"]);
    assert.deepStrictEqual(await compradores(db), [{ whatsapp: "3000000099", total_semanal: 6 }]);
});

prueba("comportamiento con WhatsApp válido idéntico con y sin 041 (mismas filas y contadores)", async () => {
    const sin = await crearDb();
    const con = await crearDb();
    await con.exec(M041);
    for (const db of [sin, con]) await pagar(db, ["01", "03", "11", "12"]);
    assert.deepStrictEqual(await compradores(con), await compradores(sin));
});

prueba("UPDATE que dejaría whatsapp NULL: esa fila no cambia y la sentencia no falla", async () => {
    const db = await crearDb();
    await db.exec(M041);
    await db.exec("update public.compradores_semanales set whatsapp = null where whatsapp = '3000000099'");
    assert.deepStrictEqual(await compradores(db), [{ whatsapp: "3000000099", total_semanal: 5 }]);
    await db.exec("update public.compradores_semanales set total_semanal = 6 where whatsapp = '3000000099'");
    assert.deepStrictEqual(await compradores(db), [{ whatsapp: "3000000099", total_semanal: 6 }], "las actualizaciones normales siguen");
});

prueba("idempotente y retira B1 si se aplicó a mano (una sola protección)", async () => {
    const db = await crearDb();
    await db.exec(`
        create function public.compradores_semanales_omitir_sin_whatsapp() returns trigger language plpgsql as $$
        begin if new.whatsapp is null then return null; end if; return new; end $$;
        create trigger omitir_sin_whatsapp before insert on public.compradores_semanales
            for each row execute function public.compradores_semanales_omitir_sin_whatsapp();`);
    await db.exec(M041);
    await db.exec(M041);
    const triggers = (await db.query(`select tgname from pg_trigger where tgrelid = 'public.compradores_semanales'::regclass and not tgisinternal order by 1`)).rows.map(r => r.tgname);
    assert.deepStrictEqual(triggers, ["efaat_omitir_sin_whatsapp"]);
    assert.strictEqual((await db.query("select count(*)::int n from pg_proc where proname = 'compradores_semanales_omitir_sin_whatsapp'")).rows[0].n, 0);
    assert.deepStrictEqual(await pagar(db, ["02"]), ["02"]);
});

prueba("no toca la función heredada (md5), la columna NOT NULL ni los permisos; la función nueva no la ejecuta el navegador", async () => {
    const db = await crearDb();
    const md5 = "select md5(prosrc) m, prosecdef from pg_proc where proname = 'actualizar_compradores_semanales'";
    const antes = (await db.query(md5)).rows[0];
    await db.exec(M041);
    assert.deepStrictEqual((await db.query(md5)).rows[0], antes);
    const col = (await db.query("select is_nullable from information_schema.columns where table_name = 'compradores_semanales' and column_name = 'whatsapp'")).rows[0];
    assert.strictEqual(col.is_nullable, "NO");
    for (const rol of ["anon", "authenticated"]) {
        const r = (await db.query(`select has_function_privilege('${rol}', 'public.efaat_compradores_omitir_sin_whatsapp()', 'EXECUTE') p`)).rows[0];
        assert.strictEqual(r.p, false, rol);
    }
});

prueba("aborta SIN cambiar nada si no existe compradores_semanales", async () => {
    const db = new PGlite();
    abiertas.push(db);
    await rechaza(db.exec(M041), /041 abortada: no existe/);
    await db.exec("rollback;");
    assert.strictEqual((await db.query("select count(*)::int n from pg_proc where proname = 'efaat_compradores_omitir_sin_whatsapp'")).rows[0].n, 0);
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
