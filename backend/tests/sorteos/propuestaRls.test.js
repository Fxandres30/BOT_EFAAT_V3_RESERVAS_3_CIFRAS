// ==========================================================================
// PRUEBA SQL de la PROPUESTA docs/activacion/propuesta_rls_tablas_antiguas.sql
// (NO aplicada en producción) contra Postgres real en memoria (PGlite).
//
// Reproduce el estado actual (anon lee todo) y comprueba que, tras la
// propuesta: anon no lee nada, cada cliente solo ve/modifica lo suyo, el
// flujo del panel (leer, reiniciar tabla, marcar pagado — con un trigger
// heredado tipo compradores_semanales que corre con el rol de quien paga)
// sigue funcionando, y el bot (service_role) no se ve afectado.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/sorteos/propuestaRls.test.js
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

const PROPUESTA = fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "activacion", "propuesta_rls_tablas_antiguas.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, activo boolean);
    create table public.sesiones (id serial primary key, usuario_id uuid, nombre text);
    create table public.compradores_semanales (id serial primary key, nombre text, whatsapp text, total_semanal int default 0);
    ${["reservas_dos_cifras", "5k_15k_reservas_2_cifras"].map(t => `
    create table public."${t}" (id serial primary key, numero text, estado text, usuario_id uuid, comprador text, contacto text);`).join("")}

    -- Trigger heredado (como el real de compradores_semanales): corre con el
    -- rol de quien hace el UPDATE (security invoker).
    create function public.legado_comprador() returns trigger language plpgsql as $$
    begin
        if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
            insert into public.compradores_semanales (nombre, whatsapp, total_semanal) values (new.comprador, new.contacto, 1);
        end if;
        return new;
    end $$;
    create trigger legado after update on public."5k_15k_reservas_2_cifras" for each row execute function public.legado_comprador();

    insert into public.eventos_bot (usuario_id, grupo_id, activo) values ('${A}', 'gA', true), ('${B}', 'gB', true);
    insert into public.sesiones (usuario_id, nombre) values ('${A}', 'bot A'), ('${B}', 'bot B');
    insert into public."5k_15k_reservas_2_cifras" (numero, estado, usuario_id, comprador, contacto) values
        ('01', 'reservado', '${A}', 'Cliente A', '3000000001'), ('01', 'reservado', '${B}', 'Cliente B', '3000000002');
    insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('05', 'libre', '${A}');
`;

const abiertas = [];

async function crearDb({ conPropuesta = true } = {}) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    if (conPropuesta) await db.exec(PROPUESTA);
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("situación ACTUAL reproducida: sin la propuesta, anon lee los datos de clientes", async () => {
    const db = await crearDb({ conPropuesta: false });
    assert.strictEqual((await como(db, "anon", null, `select * from public."5k_15k_reservas_2_cifras"`)).length, 2);
    assert.strictEqual((await como(db, "anon", null, "select * from public.sesiones")).length, 2);
});

prueba("con la propuesta: anon NO lee reservas, eventos ni sesiones", async () => {
    const db = await crearDb();
    for (const t of ['"5k_15k_reservas_2_cifras"', "reservas_dos_cifras", "eventos_bot", "sesiones"]) {
        await assert.rejects(como(db, "anon", null, `select * from public.${t}`), /permission denied/i, t);
    }
});

prueba("cada cliente ve SOLO lo suyo (reservas, eventos, sesiones)", async () => {
    const db = await crearDb();
    const r = await como(db, "authenticated", A, `select comprador from public."5k_15k_reservas_2_cifras"`);
    assert.deepStrictEqual(r.map(x => x.comprador), ["Cliente A"]);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.eventos_bot")).length, 1);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.sesiones")).length, 1);
    assert.strictEqual((await como(db, "authenticated", null, "select * from public.sesiones")).length, 0, "sin sesión: nada");
});

prueba("flujo del panel intacto: marcar pagado (con el trigger heredado), reiniciar tabla, gestionar sesiones", async () => {
    const db = await crearDb();
    const pagadas = await como(db, "authenticated", A, `update public."5k_15k_reservas_2_cifras" set estado = 'pagado' where numero = '01' and usuario_id = '${A}' and estado = 'reservado' returning id`);
    assert.strictEqual(pagadas.length, 1, "el pago desde el panel funciona");
    assert.strictEqual((await db.query("select count(*)::int n from public.compradores_semanales")).rows[0].n, 1, "el trigger heredado sigue escribiendo");
    await como(db, "authenticated", A, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('06', 'libre', '${A}')`);
    await como(db, "authenticated", A, `update public.reservas_dos_cifras set estado = 'libre' where usuario_id = '${A}'`);
    await como(db, "authenticated", A, `insert into public.sesiones (usuario_id, nombre) values ('${A}', 'bot A2')`);
    await como(db, "authenticated", A, `delete from public.sesiones where nombre = 'bot A2'`);
});

prueba("un cliente NO puede modificar, crear ni borrar datos de otro", async () => {
    const db = await crearDb();
    const r = await como(db, "authenticated", A, `update public."5k_15k_reservas_2_cifras" set estado = 'pagado' where usuario_id = '${B}' returning id`);
    assert.strictEqual(r.length, 0);
    await assert.rejects(como(db, "authenticated", A, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('07', 'libre', '${B}')`), /row-level security/i);
    assert.strictEqual((await como(db, "authenticated", A, `delete from public.sesiones where usuario_id = '${B}' returning id`)).length, 0);
    const ev = await como(db, "authenticated", A, `update public.eventos_bot set activo = false returning id`);
    assert.strictEqual(ev.length, 0, "el panel no puede escribir eventos_bot (solo el bot)");
});

prueba("el bot (service_role) no se ve afectado", async () => {
    const db = await crearDb();
    assert.strictEqual((await como(db, "service_role", null, `select * from public."5k_15k_reservas_2_cifras"`)).length, 2);
    assert.strictEqual((await como(db, "service_role", null, `update public.eventos_bot set activo = false returning id`)).length, 2);
});

prueba("guardia: con una política abierta previa (using true) aborta y NO aplica nada", async () => {
    const db = await crearDb({ conPropuesta: false });
    await db.exec(`alter table public.sesiones enable row level security;
        create policy "todos leen" on public.sesiones for select using (true);`);
    let error = null;
    try { await db.exec(PROPUESTA); } catch (e) { error = e; }
    assert.ok(error && /Parte A abortada.*todos leen/.test(error.message), "debe abortar nombrando la política");
    await db.exec("rollback;");
    assert.strictEqual((await como(db, "anon", null, `select * from public."5k_15k_reservas_2_cifras"`)).length, 2, "nada aplicado");
    const rls = (await db.query(`select relrowsecurity from pg_class where relname = '5k_15k_reservas_2_cifras'`)).rows[0];
    assert.strictEqual(rls.relrowsecurity, false);
});

prueba("idempotente: aplicarla dos veces no falla", async () => {
    const db = await crearDb();
    await db.exec(PROPUESTA);
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    // Cerrar cada PGlite (WASM) antes de process.exit. Una regresión anterior
    // registró salida 127 tras imprimir 7/7 (no reproducible en 14 corridas):
    // las aserciones pasaban y el código salía del apagado del proceso con
    // instancias abiertas. Cerrarlas deja el apagado limpio.
    await Promise.allSettled(abiertas.map(db => db.close()));
    process.exit(falla ? 1 : 0);
})();
