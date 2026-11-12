// ==========================================================================
// PRUEBAS — crear tablas y editar su valor desde Reservas (rifas/panel.js),
// con el SQL REAL (032 + 050) en PGlite.
//
//   1. crear una tabla con un precio que no existía (su propio tabla_id y sus
//      100 números libres), vinculada a los grupos autorizados activos;
//   2. dos tablas del MISMO precio = dos tabla_id distintos; la segunda no se
//      vincula a los grupos que ya usan la primera (el bot no dudaría);
//   3. editar el precio conserva el MISMO tabla_id;
//   4. y conserva números, reservas, pagos, historial, grupos y configuración;
//   5. editar no toca la otra tabla del mismo precio (aislamiento);
//   6. con un sorteo en curso o un programado pendiente, no se edita;
//   7. aviso si el nuevo precio deja dos tablas de ese valor en un grupo.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/tablasEditables.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PERSONA = "11111111-0000-4000-8000-000000000001";
const OPERADOR = { id: A, email: "admin@ejemplo.com" };

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

(async () => {
    if (!cargarPGlite()) {
        console.log("⏭️  sin PGlite (PGLITE_MODULE): prueba omitida");
        process.exit(0);
    }
    process.env.MOTOR_RIFAS = "nuevo";

    const base = await crearBase({ usuarios: [A] });
    await base.pg.exec(`
        create table public.eventos_bot (id uuid primary key, usuario_id uuid, grupo_id text, activo boolean, estado text,
            cierre_estado text, cierre_motivo text, tabla_id uuid, valor text, creado_en timestamptz default now());
        create table public.sorteos_programados (id uuid primary key, usuario_id uuid, estado text, tabla_id uuid, archivado_en timestamptz);
        create table public.grupos_autorizados (usuario_id uuid, grupo_id text, activo boolean);
        create table public.usuarios (id uuid primary key, nombre text, telefono text, lid text);
        create table public.contactos_tenant (usuario_id uuid, usuario_global_id uuid);
        insert into public.grupos_autorizados values ('${A}', 'g1@g.us', true), ('${A}', 'g2@g.us', true), ('${A}', 'g3@g.us', false);
        insert into public.usuarios values ('${PERSONA}', 'Ana', '573001110000', null);
        insert into public.contactos_tenant values ('${A}', '${PERSONA}');
        grant select on public.eventos_bot, public.sorteos_programados, public.grupos_autorizados, public.usuarios, public.contactos_tenant to service_role;`);
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const rifas = require(path.join(RAIZ, "rifas/repositorio.js"));
    const panel = require(path.join(RAIZ, "rifas/panel.js"));
    const filas = async (id) => (await rifas.leerNumeros(A, id)).filas;
    const grupos = async (id) => (await rifas.gruposDeRifa(A, id)).map(g => g.grupo_id).sort();

    // ---- 1. precio nuevo
    const t2500 = await panel.crearTabla(A, OPERADOR, { precio: "2.500" });
    assert.strictEqual(t2500.ok, true, JSON.stringify(t2500));
    assert.deepStrictEqual([t2500.precio, t2500.nombre, t2500.vinculados], [2500, "Tabla $2.500", 2]);
    const f2500 = await filas(t2500.tabla_id);
    assert.strictEqual(f2500.length, 100);
    assert.ok(f2500.every(f => f.estado === "libre"));
    assert.deepStrictEqual(await grupos(t2500.tabla_id), ["g1@g.us", "g2@g.us"], "solo grupos autorizados ACTIVOS");
    assert.strictEqual((await panel.crearTabla(A, OPERADOR, { precio: "abc" })).motivo, "precio_invalido");
    assert.strictEqual((await panel.crearTabla(A, OPERADOR, { precio: 0 })).motivo, "precio_invalido");
    paso("1. crear una tabla con un precio nuevo: su tabla_id, 100 números libres, lista en los grupos autorizados activos");

    // ---- 2. mismo precio dos veces
    const p1 = await panel.crearTabla(A, OPERADOR, { precio: 1500 });
    const p2 = await panel.crearTabla(A, OPERADOR, { precio: 1500 });
    assert.ok(p1.ok && p2.ok);
    assert.notStrictEqual(p1.tabla_id, p2.tabla_id, "dos tablas de $1.500 = dos tabla_id distintos");
    assert.deepStrictEqual([p1.vinculados, p2.vinculados, p2.sin_vincular], [2, 0, 2],
        "la segunda no se vincula donde ya está la primera (el bot no tendría que elegir)");
    assert.strictEqual((await filas(p2.tabla_id)).length, 100);
    paso("2. dos tablas del mismo precio: tabla_id distintos y sus propios números; la segunda no crea ambigüedad en los grupos");

    // Ventas e historial en la primera de $1.500.
    await panel.operarNumero(A, OPERADOR, await rifas.obtenerRifa(A, p1.tabla_id), { accion: "reservar", numero: "07", contactoId: PERSONA, solicitudId: "s1" });
    await panel.operarNumero(A, OPERADOR, await rifas.obtenerRifa(A, p1.tabla_id), { accion: "reservar", numero: "08", contactoId: PERSONA, solicitudId: "s2" });
    await panel.operarNumero(A, OPERADOR, await rifas.obtenerRifa(A, p1.tabla_id), { accion: "pagar", numero: "08", metodoPago: "nequi", solicitudId: "s3" });
    await rifas.actualizar(A, p1.tabla_id, { config: { reservas: { expiracion_minutos: 30 } } }, rifas.actor({ origen: "manual" }));
    const antes = await filas(p1.tabla_id);
    const otraAntes = await filas(p2.tabla_id);
    const audAntes = (await base.comoServicio("select id from public.reservas_auditoria where tabla_id = $1 order by id", [p1.tabla_id])).rows.map(r => r.id);
    const gruposAntes = await grupos(p1.tabla_id);

    // ---- 3 y 4. editar el precio
    const e = await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, p1.tabla_id), { precio: "4.000" });
    assert.deepStrictEqual([e.ok, e.tabla_id, e.precio], [true, p1.tabla_id, 4000], JSON.stringify(e));
    const editada = await rifas.obtenerRifa(A, p1.tabla_id);
    assert.deepStrictEqual([editada.id, editada.precio, editada.nombre], [p1.tabla_id, 4000, "Tabla $4.000"], "mismo tabla_id; el nombre automático sigue al precio");
    paso("3. editar el precio NO crea otra tabla: el mismo tabla_id, ahora de $4.000");

    const despues = await filas(p1.tabla_id);
    const sinFecha = (l) => l.map(({ creado_en, rifa_nombre, version, ...x }) => x);
    assert.deepStrictEqual(sinFecha(despues), sinFecha(antes), "los 100 números, con sus reservas y pagos, idénticos");
    assert.deepStrictEqual(despues.filter(f => f.estado !== "libre").map(f => `${f.numero}:${f.estado}:${f.comprador}`), ["07:reservado:Ana", "08:pagado:Ana"]);
    const audDespues = (await base.comoServicio("select id, accion from public.reservas_auditoria where tabla_id = $1 order by id", [p1.tabla_id])).rows;
    assert.ok(audAntes.every(id => audDespues.some(r => r.id === id)), "todo el historial anterior sigue");
    assert.ok(audDespues.some(r => r.accion === "actualizar_rifa"), "y el cambio de valor queda auditado");
    assert.deepStrictEqual(await grupos(p1.tabla_id), gruposAntes, "los mismos grupos");
    const conf = (await base.comoServicio("select config from public.configuracion_tabla where tabla_id = $1", [p1.tabla_id])).rows[0].config;
    assert.deepStrictEqual(conf, { reservas: { expiracion_minutos: 30 } }, "la misma configuración");
    paso("4. tras editar se conservan números, reservas, pagos, historial (con el cambio auditado), grupos y configuración");

    // ---- 5. aislamiento
    assert.deepStrictEqual(sinFecha(await filas(p2.tabla_id)), sinFecha(otraAntes), "la otra tabla de $1.500 no cambió");
    assert.strictEqual((await rifas.obtenerRifa(A, p2.tabla_id)).precio, 1500);
    await panel.operarNumero(A, OPERADOR, editada, { accion: "reservar", numero: "09", contactoId: PERSONA, solicitudId: "s4" });
    assert.ok((await filas(p2.tabla_id)).every(f => f.estado === "libre"), "reservar en la editada no toca la otra");
    assert.ok((await filas(t2500.tabla_id)).every(f => f.estado === "libre"), "ni la de $2.500");
    paso("5. aislamiento: la otra tabla del mismo precio y las demás siguen intactas tras crear y editar");

    // ---- 6. sorteo en curso / programado pendiente
    await base.pg.query("insert into public.eventos_bot (id, usuario_id, grupo_id, activo, estado, tabla_id, valor) values ('e0000000-0000-4000-8000-000000000001', $1, 'g1@g.us', true, 'activo', $2, '2500')", [A, t2500.tabla_id]);
    let r = await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, t2500.tabla_id), { precio: 3000 });
    assert.strictEqual(r.motivo, "sorteo_en_curso");
    await base.pg.query("update public.eventos_bot set activo = false, estado = 'cerrado', cierre_estado = 'cerrado'");
    await base.pg.query("insert into public.sorteos_programados values ('50000000-0000-4000-8000-000000000001', $1, 'programado', $2, null)", [A, t2500.tabla_id]);
    r = await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, t2500.tabla_id), { precio: 3000 });
    assert.strictEqual(r.motivo, "programado_pendiente");
    await base.pg.query("update public.sorteos_programados set estado = 'cancelado'");
    r = await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, t2500.tabla_id), { precio: 3000 });
    assert.strictEqual(r.ok, true, "sin sorteo pendiente, sí");
    assert.strictEqual((await rifas.obtenerRifa(A, t2500.tabla_id)).precio, 3000);
    paso("6. con un sorteo en curso o un programado pendiente no se cambia el valor; sin ellos, sí");

    // ---- 7. aviso de ambigüedad
    const amb = await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, t2500.tabla_id), { precio: 4000 });
    assert.deepStrictEqual([amb.ok, amb.grupos_ambiguos], [true, 2], "g1 y g2 ya tienen la tabla de $4.000: se avisa");
    await rifas.actualizar(A, t2500.tabla_id, { nombre: "Rifa especial" }, rifas.actor({ origen: "manual" }));
    await panel.editarPrecio(A, OPERADOR, await rifas.obtenerRifa(A, t2500.tabla_id), { precio: 5000 });
    assert.strictEqual((await rifas.obtenerRifa(A, t2500.tabla_id)).nombre, "Rifa especial", "un nombre propio no se cambia");
    paso("7. aviso cuando el nuevo valor deja dos tablas iguales en un grupo; un nombre propio se respeta");

    console.log(`\n${ok}/${ok} correctos`);
    process.exit(0);
})().catch((e) => {
    console.error("❌", e.stack || e.message);
    process.exit(1);
});
