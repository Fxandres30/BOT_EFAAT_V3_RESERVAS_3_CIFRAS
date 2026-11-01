// ==========================================================================
// PRUEBAS SQL — migración 043 (un sorteo ACTIVO por PRECIO y cliente) contra
// Postgres REAL en memoria (PGlite + btree_gist): precios distintos conviven
// aunque compartan tabla física, el mismo precio se rechaza (23P01), los
// sorteos terminados no cuentan, se detiene sin cambiar nada si ya hay
// conflictos, idempotencia y escrituras a la vez.
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

const M043 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "043_un_sorteo_activo_por_precio.sql"), "utf8");
const RESTRICCION = "eventos_bot_un_sorteo_activo_por_precio";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";

// `tipoValor`: la columna valor puede ser texto o numérica según la base.
const entorno = (tipoValor) => `
    create schema extensions;
    create table public.eventos_bot (
        id uuid primary key default gen_random_uuid(),
        usuario_id uuid, grupo_id text, grupo_nombre text, tabla text, valor ${tipoValor}, identidad_evento_real text,
        nombre_evento text, fecha_evento date, hora_fin text, hora_cierre text,
        activo boolean default true, estado text default 'abierto',
        cierre_estado text, cierre_motivo text, creado_en timestamptz default now()
    );
`;

async function crearDb({ aplicar = true, tipoValor = "text" } = {}) {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(entorno(tipoValor));
    if (aplicar) await db.exec(M043);
    return db;
}

const insertar = (db, f) => db.query(
    `insert into public.eventos_bot (usuario_id, grupo_id, tabla, valor, identidad_evento_real, nombre_evento, activo, estado, cierre_estado, cierre_motivo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [f.usuario ?? A, f.grupo ?? "g1@g.us", f.tabla ?? T5K, f.valor ?? 3000, f.identidad ?? null, f.nombre ?? f.identidad, f.activo ?? true, f.estado ?? "abierto", f.cierre_estado ?? null, f.cierre_motivo ?? null]
).then(r => r.rows[0].id);

const rechazada = (promesa) => assert.rejects(promesa, (e) => e.code === "23P01" && e.message.includes(RESTRICCION));
const contar = async (db, where = "true") => (await db.query(`select count(*)::int n from public.eventos_bot where ${where}`)).rows[0].n;

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("043: crea la restricción de exclusión por cliente + precio, diferible", async () => {
    const db = await crearDb();
    const r = (await db.query(`select pg_get_constraintdef(oid) def, condeferrable, condeferred from pg_constraint where conname = '${RESTRICCION}'`)).rows;
    assert.strictEqual(r.length, 1);
    assert.match(r[0].def, /EXCLUDE USING gist \(usuario_id WITH =, \(\(NULLIF\(regexp_replace\(valor, '\[\^0-9\]'::text, ''::text, 'g'::text\), ''::text\)\)::numeric\) WITH =, identidad_evento_real WITH <>\)/);
    assert.deepStrictEqual([r[0].condeferrable, r[0].condeferred], [true, false]);
});

prueba("$3.000 y $10.000 activos a la vez (MISMA tabla física): permitido", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "tres-mil", valor: 3000, grupo: "g1@g.us" });
    await insertar(db, { identidad: "diez-mil", valor: 10000, grupo: "g2@g.us" });
    assert.strictEqual(await contar(db, "activo"), 2);
});

prueba("$5.000 y $15.000 activos a la vez, incluso en el mismo grupo: permitido por la base", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "cinco-mil", valor: 5000, grupo: "g1@g.us" });
    await insertar(db, { identidad: "quince-mil", valor: 15000, grupo: "g1@g.us" });
    assert.strictEqual(await contar(db, "activo"), 2);
});

prueba("dos sorteos de $10.000 del mismo cliente: el segundo se rechaza (23P01), en el mismo grupo o en otro", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "diez-a", valor: 10000 });
    await rechazada(insertar(db, { identidad: "diez-b", valor: 10000, grupo: "g1@g.us" }));
    await rechazada(insertar(db, { identidad: "diez-b", valor: 10000, grupo: "g2@g.us" }));
    assert.strictEqual(await contar(db), 1);
});

prueba("el mismo precio escrito distinto («10000», «$10.000», 10000) es el mismo precio", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "diez-a", valor: "10000" });
    await rechazada(insertar(db, { identidad: "diez-b", valor: "$10.000" }));
});

prueba("el MISMO sorteo en varios grupos se permite (misma identidad y precio)", async () => {
    const db = await crearDb();
    for (const g of ["g1@g.us", "g2@g.us", "g3@g.us"]) await insertar(db, { identidad: "s1", valor: 10000, grupo: g });
    assert.strictEqual(await contar(db), 3);
});

prueba("otro cliente con el mismo precio: se permite (aislamiento entre clientes)", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "a-diez", valor: 10000 });
    await insertar(db, { identidad: "b-diez", valor: 10000, usuario: B });
    assert.strictEqual(await contar(db), 2);
});

prueba("sorteos terminados no ocupan el precio (cerrado, desactivado, cancelado, eliminado, cierre_estado, panel:, sustituido, activo=false)", async () => {
    const db = await crearDb();
    const terminados = [
        { estado: "cerrado" }, { estado: "desactivado" }, { estado: "cancelado" }, { estado: "eliminado" },
        { cierre_estado: "cerrado" }, { cierre_motivo: "panel:desactivado en g1" }, { cierre_motivo: "sustituido por el sorteo X" }, { activo: false }
    ];
    for (const [i, t] of terminados.entries()) await insertar(db, { identidad: `viejo-${i}`, valor: 10000, ...t });
    await insertar(db, { identidad: "nuevo", valor: 10000 });
    assert.strictEqual(await contar(db), terminados.length + 1);
});

prueba("reemplazo del mismo precio: cerrar el anterior ANTES funciona; reactivarlo con el nuevo activo, no", async () => {
    const db = await crearDb();
    const viejo = await insertar(db, { identidad: "diez-a", valor: 10000 });
    await db.query(`update public.eventos_bot set activo = false, estado = 'cerrado', cierre_motivo = 'sustituido por diez-b' where id = $1`, [viejo]);
    await insertar(db, { identidad: "diez-b", valor: 10000 });
    await rechazada(db.query(`update public.eventos_bot set activo = true, estado = 'abierto', cierre_motivo = null where id = $1`, [viejo]));
});

prueba("corregir el precio hacia uno ocupado se rechaza; hacia uno libre (misma tabla física) se permite", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "diez", valor: 10000 });
    const tres = await insertar(db, { identidad: "tres", valor: 3000 });
    await rechazada(db.query(`update public.eventos_bot set valor = '10000' where id = $1`, [tres]));
    await db.query(`update public.eventos_bot set valor = '5000' where id = $1`, [tres]);
    assert.strictEqual(await contar(db, "activo"), 2);
});

prueba("corregir la identidad de TODO el sorteo en una sola sentencia se permite; fila a fila choca (límite documentado)", async () => {
    const db = await crearDb();
    const g1 = await insertar(db, { identidad: "s1", valor: 10000, grupo: "g1@g.us" });
    await insertar(db, { identidad: "s1", valor: 10000, grupo: "g2@g.us" });
    await rechazada(db.query(`update public.eventos_bot set identidad_evento_real = 's2' where id = $1`, [g1]));
    await db.query(`update public.eventos_bot set identidad_evento_real = 's1-corregida' where identidad_evento_real = 's1'`);
    assert.strictEqual(await contar(db, "identidad_evento_real = 's1-corregida'"), 2);
});

prueba("filas históricas sin identidad o sin precio quedan fuera de la regla", async () => {
    const db = await crearDb();
    await db.query(`insert into public.eventos_bot (usuario_id, tabla, valor, identidad_evento_real) values ($1, $2, '10000', null), ($1, $2, '10000', null), ($1, $2, null, 'x'), ($1, $2, null, 'y')`, [A, T5K]);
    assert.strictEqual(await contar(db), 4);
});

prueba("columna valor NUMÉRICA: la misma regla funciona", async () => {
    const db = await crearDb({ tipoValor: "integer" });
    await insertar(db, { identidad: "tres", valor: 3000 });
    await insertar(db, { identidad: "diez", valor: 10000 });
    await rechazada(insertar(db, { identidad: "diez-b", valor: 10000 }));
});

prueba("datos con dos sorteos activos del mismo precio: la 043 se detiene SIN cambiar nada", async () => {
    const db = await crearDb({ aplicar: false });
    await insertar(db, { identidad: "diez-a", valor: 10000, grupo: "g1@g.us" });
    await insertar(db, { identidad: "diez-b", valor: 10000, grupo: "g2@g.us" });
    await insertar(db, { identidad: "tres", valor: 3000, grupo: "g3@g.us" });
    const antes = JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows);
    await assert.rejects(db.exec(M043), /043: 1 precio\(s\) ya tienen más de un sorteo activo/);
    await db.exec("rollback");
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = '${RESTRICCION}'`)).rows[0].n, 0);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_extension where extname = 'btree_gist'`)).rows[0].n, 0, "ni la extensión");
    assert.strictEqual(JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows), antes, "filas intactas");
});

prueba("$3.000 y $10.000 activos en la misma tabla NO impiden aplicarla", async () => {
    const db = await crearDb({ aplicar: false });
    await insertar(db, { identidad: "tres", valor: 3000 });
    await insertar(db, { identidad: "diez", valor: 10000 });
    await db.exec(M043);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = '${RESTRICCION}'`)).rows[0].n, 1);
});

prueba("sin las columnas de cierre (023): se detiene sin cambiar nada", async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(`create schema extensions; create table public.eventos_bot (id uuid primary key, usuario_id uuid, valor text, identidad_evento_real text, activo boolean, estado text);`);
    await assert.rejects(db.exec(M043), /043: a eventos_bot le faltan columnas \(cierre_estado, cierre_motivo\)/);
    await db.exec("rollback");
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = '${RESTRICCION}'`)).rows[0].n, 0);
});

prueba("idempotente: aplicarla dos veces no falla ni duplica nada", async () => {
    const db = await crearDb();
    await insertar(db, { identidad: "s1", valor: 10000 });
    await db.exec(M043);
    assert.strictEqual((await db.query(`select count(*)::int n from pg_constraint where conname = '${RESTRICCION}'`)).rows[0].n, 1);
    await rechazada(insertar(db, { identidad: "s2", valor: 10000 }));
});

prueba("carrera: dos escrituras a la vez del MISMO precio → una entra y la otra recibe 23P01; de precios DISTINTOS → entran las dos", async () => {
    const db = await crearDb();
    const mismo = await Promise.allSettled([insertar(db, { identidad: "programado", valor: 10000, grupo: "g1@g.us" }), insertar(db, { identidad: "detectado", valor: 10000, grupo: "g2@g.us" })]);
    assert.strictEqual(mismo.filter(x => x.status === "fulfilled").length, 1);
    assert.strictEqual(mismo.filter(x => x.status === "rejected" && x.reason.code === "23P01").length, 1);
    const distintos = await Promise.allSettled([insertar(db, { identidad: "tres", valor: 3000, grupo: "g3@g.us" }), insertar(db, { identidad: "cinco", valor: 5000, grupo: "g4@g.us" })]);
    assert.ok(distintos.every(x => x.status === "fulfilled"));
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
