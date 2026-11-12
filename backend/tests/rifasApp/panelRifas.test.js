// ==========================================================================
// PRUEBAS — la pantalla ORIGINAL de Tablas sobre el motor de rifas
// (rifas/panel.js), con el SQL REAL (032 + 050) en PGlite.
//
// Mismo contrato que la pantalla ya usaba (ContextoNumero, Exito/Fallo,
// RespuestaLote) pero sobre UNA rifa. Dos rifas del MISMO precio y cliente:
//   1. la ventana del número lee SU rifa (estado, acciones, historial);
//   2. reservar con un contacto del directorio; el 07 de la otra rifa sigue
//      libre; repetir da «no_disponible»; contacto ajeno, rechazado;
//   3. pagar (repetir = idempotente) y liberar según el estado real;
//   4. lote: reservar, pagar y liberar varios en UNA solicitud;
//   5. un sorteo de otra tabla no se acepta;
//   6. la auditoría lleva el tabla_id y el operador del panel.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/panelRifas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PERSONA = "11111111-0000-4000-8000-000000000001";
const PERSONA2 = "22222222-0000-4000-8000-000000000002";
const AJENA = "33333333-0000-4000-8000-000000000003";
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
        create table public.eventos_bot (id uuid primary key, usuario_id uuid, grupo_id text, grupo_nombre text, activo boolean,
            estado text, cierre_estado text, cierre_motivo text, tabla text, tabla_id uuid, valor text, nombre_evento text,
            cifras integer, identidad_evento_real text, fecha_evento date, hora_cierre text, hora_fin text, creado_en timestamptz default now());
        create table public.usuarios (id uuid primary key, nombre text, telefono text, lid text);
        create table public.contactos_tenant (usuario_id uuid, usuario_global_id uuid);
        insert into public.usuarios values ('${PERSONA}', 'Ana', '573001110000', '111@lid'), ('${PERSONA2}', 'Beto', '573002220000', null),
            ('${AJENA}', 'Otra', '573009990000', null);
        insert into public.contactos_tenant values ('${A}', '${PERSONA}'), ('${A}', '${PERSONA2}');
        grant select on public.eventos_bot, public.usuarios, public.contactos_tenant to service_role;`);
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const rifas = require(path.join(RAIZ, "rifas/repositorio.js"));
    const panel = require(path.join(RAIZ, "rifas/panel.js"));
    const actor = rifas.actor({ origen: "manual", operadorId: A });
    const R1 = (await rifas.crearRifa(A, { nombre: "Tabla $1.500", precio: 1500 }, actor)).tabla_id;
    const R2 = (await rifas.crearRifa(A, { nombre: "Tabla $1.500 tarde", precio: 1500 }, actor)).tabla_id;
    const r1 = await rifas.obtenerRifa(A, R1);
    const r2 = await rifas.obtenerRifa(A, R2);
    const estado = async (rifa, n) => (await rifas.leerNumeros(A, rifa.id, { numeros: [n] })).filas[0].estado;

    // ---- 1. ventana del número
    let c = await panel.contextoNumero(A, r1, "07");
    assert.strictEqual(c.ok, true);
    assert.deepStrictEqual([c.numero, c.estado, c.acciones, c.precio, c.tabla], ["07", "libre", ["reservar"], 1500, "numeros_rifa"]);
    assert.strictEqual((await panel.contextoNumero(A, r1, "100")).motivo, "numero_invalido");
    paso("ventana del número: estado y acciones de SU rifa; fuera de rango, rechazado");

    // ---- 2. reservar
    const sol = (n) => `sol-${n}-${Math.random()}`;
    let r = await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "07", contactoId: PERSONA, solicitudId: sol(1) });
    assert.deepStrictEqual([r.ok, r.estado], [true, "reservado"], JSON.stringify(r));
    assert.strictEqual(await estado(r2, "07"), "libre", "el 07 de la otra rifa de $1.500 sigue libre");
    const fila = (await rifas.leerNumeros(A, R1, { numeros: ["07"] })).filas[0];
    assert.deepStrictEqual([fila.comprador, fila.telefono, fila.usuario_global_id], ["Ana", "573001110000", PERSONA]);
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "07", contactoId: PERSONA, solicitudId: sol(2) });
    assert.deepStrictEqual([r.ok, r.idempotente], [true, true], "repetir con el MISMO contacto no hace nada");
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "07", contactoId: PERSONA2, solicitudId: sol(2) });
    assert.deepStrictEqual([r.ok, r.motivo, r.estadoActual], [false, "no_disponible", "reservado"], "otra persona: no disponible");
    assert.strictEqual((await rifas.leerNumeros(A, R1, { numeros: ["07"] })).filas[0].comprador, "Ana", "la reserva de Ana sigue intacta");
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "09", contactoId: AJENA, solicitudId: sol(3) });
    assert.strictEqual(r.motivo, "contacto_no_existe", "un contacto que no está en el directorio del cliente no se usa");
    assert.strictEqual((await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "09", solicitudId: sol(4) })).motivo, "falta_contacto");
    paso("reservar: contacto del directorio; la otra rifa del mismo precio intacta; repetir y contacto ajeno rechazados");

    // ---- 3. pagar y liberar
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "pagar", numero: "07", metodoPago: "nequi", solicitudId: sol(5) });
    assert.deepStrictEqual([r.ok, r.estado], [true, "pagado"]);
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "pagar", numero: "07", solicitudId: sol(6) });
    assert.deepStrictEqual([r.ok, r.idempotente], [true, true], "pagar dos veces no duplica");
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "liberar", numero: "07", solicitudId: sol(7) });
    assert.deepStrictEqual([r.ok, r.estado], [true, "libre"], "liberar según el estado real (anula el pago)");
    assert.strictEqual((await rifas.leerNumeros(A, R1, { numeros: ["07"] })).filas[0].comprador, null);
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "pagar", numero: "07", solicitudId: sol(8) });
    assert.deepStrictEqual([r.ok, r.motivo], [false, "estado_invalido"], "un libre no se paga");
    paso("pagar (repetir = idempotente) y liberar según el estado real; un libre no se paga");

    // ---- 4. lote
    let l = await panel.operarLote(A, OPERADOR, r1, { accion: "reservar", numeros: ["10", "11", "12"], contactoId: PERSONA, solicitudId: sol(9) });
    assert.deepStrictEqual([l.ok, l.hechos, l.omitidos], [true, 3, 0], JSON.stringify(l));
    l = await panel.operarLote(A, OPERADOR, r1, { accion: "reservar", numeros: ["12", "13"], contactoId: PERSONA, solicitudId: sol(10) });
    assert.deepStrictEqual(l.resultados.map(x => `${x.numero}:${x.estado}`), ["12:sin_cambio", "13:hecho"], "el 12 ya era de Ana");
    l = await panel.operarLote(A, OPERADOR, r1, { accion: "reservar", numeros: ["12", "14"], contactoId: PERSONA2, solicitudId: sol(10) });
    assert.deepStrictEqual(l.resultados.map(x => `${x.numero}:${x.estado}`), ["12:omitido", "14:hecho"], "Beto no se queda con el 12 de Ana");
    l = await panel.operarLote(A, OPERADOR, r1, { accion: "pagar", numeros: ["10", "11"], metodoPago: "efectivo", solicitudId: sol(11) });
    assert.strictEqual(l.hechos, 2);
    l = await panel.operarLote(A, OPERADOR, r1, { accion: "liberar", numeros: [{ numero: "10", estado: "pagado" }, { numero: "12", estado: "reservado" }], solicitudId: sol(12) });
    assert.strictEqual(l.hechos, 2);
    assert.deepStrictEqual(await Promise.all(["10", "11", "12", "13", "14"].map(n => estado(r1, n))), ["libre", "pagado", "libre", "reservado", "reservado"]);
    assert.strictEqual((await rifas.leerNumeros(A, R2, { estados: ["reservado", "pagado"] })).filas.length, 0, "la otra rifa no cambió en ningún momento");
    paso("lote: reservar, pagar y liberar varios en una solicitud; resultados por número; la otra rifa intacta");

    // ---- 5. sorteo de otra tabla
    await base.pg.query(`insert into public.eventos_bot (id, usuario_id, grupo_id, activo, estado, tabla_id, valor) values
        ('e2000000-0000-4000-8000-000000000002', $1, 'g2', true, 'activo', $2, '1500')`, [A, R2]);
    r = await panel.operarNumero(A, OPERADOR, r1, { accion: "reservar", numero: "20", contactoId: PERSONA, eventoId: "e2000000-0000-4000-8000-000000000002", solicitudId: sol(13) });
    assert.strictEqual(r.motivo, "sorteo_de_otra_tabla");
    c = await panel.contextoNumero(A, r2, "20");
    assert.deepStrictEqual(c.contextos.map(x => x.eventoId), ["e2000000-0000-4000-8000-000000000002"], "la ventana muestra el sorteo de SU rifa");
    assert.deepStrictEqual((await panel.contextoNumero(A, r1, "20")).contextos, [], "y no el de la otra");
    paso("un sorteo de otra tabla no se acepta; cada ventana muestra el sorteo de su propia rifa");

    // ---- 6. auditoría
    const { rows } = await base.comoServicio(
        "select accion, numero, tabla_id, operador_email, resultado from public.reservas_auditoria where accion in ('reservar','pagar','liberar') and resultado = 'ok' order by creado_en");
    assert.ok(rows.length >= 6);
    assert.ok(rows.every(x => x.tabla_id === R1), "todas las operaciones del panel quedaron en R1");
    assert.ok(rows.filter(x => x.accion !== "reservar").every(x => x.operador_email === "admin@ejemplo.com"), "con el operador del panel");
    c = await panel.contextoNumero(A, r1, "07");
    assert.deepStrictEqual(c.historial.filter(h => h.resultado === "ok").map(h => h.accion), ["liberar", "pagar", "reservar"],
        "el historial de la ventana sale de la auditoría de la rifa");
    assert.ok(c.historial.some(h => h.resultado === "rechazado" && h.codigo === "no_disponible"), "los intentos rechazados también quedan");
    paso("auditoría: cada operación con su tabla_id y el operador; la ventana muestra su historial");

    console.log(`\n${ok}/${ok} correctos`);
    process.exit(0);
})().catch((e) => {
    console.error("❌", e.stack || e.message);
    process.exit(1);
});
