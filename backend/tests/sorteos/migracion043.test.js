// ==========================================================================
// PRUEBAS SQL — migración 043 (una tabla = un sorteo ACTIVO por cliente)
// contra Postgres REAL en memoria (PGlite + btree_gist): qué permite, qué
// rechaza (23P01), que los sorteos terminados no cuentan, que se detiene
// sin cambiar nada si ya hay conflictos, idempotencia y escrituras a la vez.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/sorteos/migracion043.test.js
// Sin PGlite la prueba se omite (exit 0). NUNCA se conecta a Supabase.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
let btree_gist;

try {
    const base = process.env.PGLITE_MODULE || "@electric-sql/pglite";
    ({ PGlite } = require(base));
    ({ btree_gist } = require(process.env.PGLITE_MODULE ? path.join(base, "dist/contrib/btree_gist.cjs") : "@electric-sql/pglite/contrib/btree_gist"));
} catch {
    console.log("⏭️  PGlite (con btree_gist) no disponible — prueba SQL omitida (ver cabecera del archivo).");
    process.exit(0);
}

const M043 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "043_un_sorteo_activo_por_tabla.sql"), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T1K = "reservas_dos_cifras";

const ENTORNO = `
    create schema extensions;
    create table public.eventos_bot (
        id uuid primary key default gen_random_uuid(),
        usuario_id uuid, grupo_id text, grupo_nombre text, tabla text, identidad_evento_real text,
        nombre_evento text, fecha_evento date, hora_fin text, hora_cierre text,
        activo boolean default true, estado text default 'abierto',
        cierre_estado text, cierre_motivo text, creado_en timestamptz default now()
    );
`;

async function crearDb({ aplicar = true } = {}) {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(ENTORNO);
    if (aplicar) await db.exec(M043);
    return db;
}

const insertar = (db, f) => db.query(
    `insert into public.eventos_bot (usuario_id, grupo_id, tabla, identidad_evento_real, nombre_evento, activo, estado, cierre_estado, cierre_motivo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [f.usuario ?? A, f.grupo ?? "g1@g.us", f.tabla ?? T5K, f.identidad ?? null, f.nombre ?? f.identidad, f.activo ?? true, f.estado ?? "abierto", f.cierre_estado ?? null, f.cierre_motivo ?? null]
).then(r => r.rows[0].id);

const rechazada = (promesa) => assert.rejects(promesa, (e) => e.code === "23P01" && /eventos_bot_un_sorteo_activo_por_tabla/.test(e.message));

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("043: crea la restricción de exclusión con btree_gist", async () => {
    const db = await crearDb();
    const r = (await db.query(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla'`)).rows;
    assert.strictEqual(r.length, 1);
    assert.match(r[0].def, /EXCLUDE USING gist \(usuario_id WITH =, tabla WITH =, identidad_evento_real WITH <>\)/);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_extension where extname = 'btree_gist'`)).rows[0].n, 1);
});

prueba("el MISMO sorteo en varios grupos se permite (misma identidad)", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", grupo: "g1@g.us" });
    await insertar(db, { identidad: "s1", grupo: "g2@g.us" });
    await insertar(db, { identidad: "s1", grupo: "g3@g.us" });
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot")).rows[0].n, 3);
});

prueba("OTRO sorteo activo en la misma tabla del mismo cliente: rechazado (23P01), en el mismo grupo o en otro", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", grupo: "g1@g.us" });
    await rechazada(insertar(db, { identidad: "s2", grupo: "g1@g.us" }));
    await rechazada(insertar(db, { identidad: "s2", grupo: "g2@g.us" }));
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot")).rows[0].n, 1, "nada escrito");
});

prueba("otra tabla del mismo cliente, u otro cliente con la misma tabla: se permite", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", tabla: T5K });
    await insertar(db, { identidad: "s2", tabla: T1K });
    await insertar(db, { identidad: "b1", tabla: T5K, usuario: B });
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot")).rows[0].n, 3);
});

prueba("sorteos terminados no ocupan la tabla (cerrado, desactivado, cancelado, eliminado, cierre_estado, panel:, sustituido, activo=false)", async () => {
    const db = await crearDb();
    const terminados = [
        { estado: "cerrado" }, { estado: "desactivado" }, { estado: "cancelado" }, { estado: "eliminado" },
        { cierre_estado: "cerrado" }, { cierre_motivo: "panel:desactivado en g1" }, { cierre_motivo: "sustituido por el anuncio de X" }, { activo: false }
    ];
    for (const [i, t] of terminados.entries()) await insertar(db, { identidad: `viejo-${i}`, ...t });
    await insertar(db, { identidad: "nuevo" });
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot")).rows[0].n, terminados.length + 1);
});

prueba("cerrar ANTES de activar el nuevo funciona; reactivar el viejo con el nuevo activo, no", async () => {
    const db = await crearDb();
    const viejo = await insertar(db, { identidad: "s1" });
    await db.query(`update public.eventos_bot set activo = false, estado = 'cerrado', cierre_motivo = 'sustituido por s2' where id = $1`, [viejo]);
    await insertar(db, { identidad: "s2" });
    await rechazada(db.query(`update public.eventos_bot set activo = true, estado = 'abierto', cierre_motivo = null where id = $1`, [viejo]));
});

prueba("UPDATE que movería un sorteo activo a una tabla ocupada (o a otra identidad): rechazado", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", tabla: T5K });
    const otro = await insertar(db, { identidad: "s2", tabla: T1K });
    await rechazada(db.query(`update public.eventos_bot set tabla = $1 where id = $2`, [T5K, otro]));
    const hermano = await insertar(db, { identidad: "s1", tabla: T5K, grupo: "g2@g.us" });
    await rechazada(db.query(`update public.eventos_bot set identidad_evento_real = 's3' where id = $1`, [hermano]));
});

prueba("corregir la identidad de TODO el sorteo en una sola sentencia se permite (deferrable initially immediate)", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", grupo: "g1@g.us" });
    await insertar(db, { identidad: "s1", grupo: "g2@g.us" });
    await db.query(`update public.eventos_bot set identidad_evento_real = 's1-corregida' where identidad_evento_real = 's1'`);
    assert.strictEqual((await db.query(`select count(*)::int n from public.eventos_bot where identidad_evento_real = 's1-corregida'`)).rows[0].n, 2);
    const def = (await db.query(`select condeferrable, condeferred from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla'`)).rows[0];
    assert.deepStrictEqual(def, { condeferrable: true, condeferred: false });
});

prueba("LÍMITE documentado: cambiar la identidad fila a fila (varias sentencias) choca a mitad", async () => {
    // Es lo que hace la reversión de corregirIdentidad si falla el traslado
    // de reservas (respaldo por fila). Con la 043 esa reversión se detendría.
    const db = await crearDb();
    const g1 = await insertar(db, { identidad: "s1", grupo: "g1@g.us" });
    await insertar(db, { identidad: "s1", grupo: "g2@g.us" });
    await rechazada(db.query(`update public.eventos_bot set identidad_evento_real = 's2' where id = $1`, [g1]));
});

prueba("filas históricas sin identidad o sin tabla quedan fuera de la regla", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: null });
    await insertar(db, { identidad: null });
    await insertar(db, { identidad: "s1", tabla: null });
    await insertar(db, { identidad: "s1" });
    assert.strictEqual((await db.query("select count(*)::int n from public.eventos_bot")).rows[0].n, 4);
});

prueba("datos con dos sorteos activos en una tabla: la 043 se detiene SIN cambiar nada", async () => {
    const db = await crearDb({ aplicar: false });
    await insertar(db, { identidad: "s1", grupo: "g1@g.us" });
    await insertar(db, { identidad: "s2", grupo: "g2@g.us" });
    const antes = JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows);
    await assert.rejects(db.exec(M043), /043: 1 tabla\(s\) ya tienen más de un sorteo activo/);
    await db.exec("rollback");
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla'`)).rows[0].n, 0);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_extension where extname = 'btree_gist'`)).rows[0].n, 0, "ni la extensión");
    assert.strictEqual(JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows), antes, "filas intactas");
});

prueba("sin las columnas de cierre (023): se detiene sin cambiar nada", async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(`create schema extensions; create table public.eventos_bot (id uuid primary key, usuario_id uuid, tabla text, identidad_evento_real text, activo boolean, estado text);`);
    await assert.rejects(db.exec(M043), /043: a eventos_bot le faltan columnas \(cierre_estado, cierre_motivo\)/);
    await db.exec("rollback");
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla'`)).rows[0].n, 0);
});

prueba("idempotente: aplicarla dos veces no falla ni duplica nada", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1" });
    await db.exec(M043);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = 'eventos_bot_un_sorteo_activo_por_tabla'`)).rows[0].n, 1);
    await rechazada(insertar(db, { identidad: "s2" }));
});

prueba("dos escrituras a la vez (publicador y detector): una entra, la otra recibe 23P01", async () => {
    const db = await crearDb();
    const r = await Promise.allSettled([insertar(db, { identidad: "programado", grupo: "g1@g.us" }), insertar(db, { identidad: "detectado", grupo: "g2@g.us" })]);
    assert.strictEqual(r.filter(x => x.status === "fulfilled").length, 1);
    assert.strictEqual(r.filter(x => x.status === "rejected" && x.reason.code === "23P01").length, 1);
    assert.strictEqual((await db.query("select count(distinct identidad_evento_real)::int n from public.eventos_bot")).rows[0].n, 1);
});

(async () => {
    let ok = 0;
    let fallos = 0;
    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            fallos++;
            console.log(`❌ ${nombre}\n   ${err.message}`);
        }
    }
    console.log(`\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${fallos}`);
    process.exit(fallos ? 1 : 0);
})();
