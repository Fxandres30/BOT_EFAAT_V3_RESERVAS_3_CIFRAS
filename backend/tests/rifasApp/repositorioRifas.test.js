// ==========================================================================
// PRUEBAS — backend/rifas/repositorio.js contra el SQL REAL (032 + 050).
//
// Aislamiento entre rifas, que es el objetivo del motor:
//   1. Dos rifas del MISMO cliente y MISMO precio no comparten números.
//   2. Reiniciar una rifa no toca otra (ni la de otro precio ni la del mismo).
//   3. Un cliente no puede leer ni operar la rifa de otro (rifa_no_encontrada).
//   4. Pagar/liberar con titular solo toca los números de ese titular.
//   5. El grupo resuelve SU rifa: única, por código, por precio entre las
//      vinculadas; ambigua o sin vínculo → no procesa.
//   6. Formato: "07" ↔ 7; textos inválidos no llegan al motor.
//   7. Auditoría: cada operación deja filas con tabla_id y ciclo.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/repositorioRifas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PERSONA = "11111111-0000-4000-8000-000000000001";
const GRUPO = "120363000000000001@g.us";
const GRUPO_2 = "120363000000000002@g.us";

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

(async () => {
    if (!cargarPGlite()) {
        console.log("⏭️  sin PGlite (PGLITE_MODULE): prueba omitida");
        process.exit(0);
    }

    const base = await crearBase({ usuarios: [A, B] });
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const rifas = require(path.join(RAIZ, "rifas/repositorio.js"));
    const { aTexto, aEntero, aEnteros } = require(path.join(RAIZ, "rifas/formato.js"));
    const panel = rifas.actor({ origen: "manual", operadorId: A, operadorEmail: "a@prueba.test" });
    const bot = rifas.actor({ origen: "bot" });

    // ---- formato
    assert.strictEqual(aTexto(7, 2), "07");
    assert.strictEqual(aTexto(7, 3), "007");
    assert.strictEqual(aEntero("07", { cifras: 2 }), 7);
    assert.strictEqual(aEntero("123", { cifras: 2 }), null);
    assert.strictEqual(aEntero("7a"), null);
    assert.strictEqual(aEntero("99", { cantidad: 50 }), null);
    assert.deepStrictEqual(aEnteros(["07", "7", "x", "03"]), { numeros: [3, 7], invalidos: ["x"] });
    paso("formato: texto ↔ entero, inválidos separados");

    // ---- crear: dos rifas de $1.000 del mismo cliente + una de $2.000 + una de B
    const r1 = await rifas.crearRifa(A, { nombre: "Mañana", precio: 1000, cifras: 2, codigo: "M" }, panel);
    const r2 = await rifas.crearRifa(A, { nombre: "Tarde", precio: 1000, cifras: 2, codigo: "T" }, panel);
    const r3 = await rifas.crearRifa(A, { nombre: "Dos mil", precio: 2000, cifras: 2 }, panel);
    const rb = await rifas.crearRifa(B, { nombre: "De B", precio: 1000, cifras: 2 }, rifas.actor({ origen: "manual", operadorId: B }));
    for (const r of [r1, r2, r3, rb]) assert.ok(r.ok && r.tabla_id, JSON.stringify(r));
    const [T1, T2, T3, TB] = [r1.tabla_id, r2.tabla_id, r3.tabla_id, rb.tabla_id];
    assert.strictEqual(new Set([T1, T2, T3, TB]).size, 4);
    const lista = await rifas.listarRifas(A);
    assert.deepStrictEqual(lista.map(x => x.nombre).sort(), ["Dos mil", "Mañana", "Tarde"]);
    assert.ok(lista.every(x => Number(x.total) === 100 && Number(x.libres) === 100));
    paso("crear: 2 rifas del mismo precio + 1 de otro precio, cada una con sus 100 números; B no aparece en la lista de A");

    // ---- 1. mismo número en dos rifas del mismo precio: independientes
    const d1 = { comprador: "Ana", telefono: "573001110000", usuario_global_id: PERSONA, grupo_id: GRUPO };
    const res1 = await rifas.reservar(A, T1, ["07", "15"], d1, bot);
    assert.ok(res1.ok);
    assert.deepStrictEqual(res1.reservados, [7, 15]);
    const res2 = await rifas.reservar(A, T2, ["07"], { comprador: "Beto", telefono: "573002220000" }, bot);
    assert.ok(res2.ok, "el 07 de la rifa Tarde está libre aunque el 07 de Mañana esté reservado");
    const l1 = await rifas.leerNumeros(A, T1, { numeros: ["07"] });
    const l2 = await rifas.leerNumeros(A, T2, { numeros: ["07"] });
    assert.strictEqual(l1.filas[0].nombre, "Ana");
    assert.strictEqual(l2.filas[0].nombre, "Beto");
    assert.strictEqual(l1.filas[0].numero, "07");
    assert.ok(l1.filas[0].fecha_reserva && l1.filas[0].hora_reserva, "fecha y hora de Colombia");
    const otraRifa = await rifas.leerNumeros(A, T3, { estados: ["reservado", "pagado"] });
    assert.strictEqual(otraRifa.filas.length, 0, "la rifa de $2.000 no ve nada");
    paso("aislamiento: el 07 de dos rifas de $1.000 del mismo cliente son números distintos");

    // ---- ocupado en la MISMA rifa
    const repetido = await rifas.reservar(A, T1, ["07"], { comprador: "Otro" }, bot);
    assert.strictEqual(repetido.ok, false);
    assert.deepStrictEqual(repetido.no_disponibles, [7]);
    paso("en la misma rifa, un número ocupado no se vuelve a reservar");

    // ---- 3. otro cliente
    const ajeno = await rifas.reservar(B, T1, ["20"], { comprador: "X" }, bot);
    assert.strictEqual(ajeno.motivo, "rifa_no_encontrada");
    assert.strictEqual(await rifas.obtenerRifa(B, T1), null);
    assert.deepStrictEqual((await rifas.leerNumeros(B, T1)).filas, []);
    const reiniciarAjeno = await rifas.reiniciar(B, T1, "REINICIAR", rifas.actor({ origen: "manual", operadorId: B }));
    assert.strictEqual(reiniciarAjeno.motivo, "rifa_no_encontrada");
    const bLibre = await rifas.reservar(B, TB, ["07"], { comprador: "Cliente de B" }, bot);
    assert.ok(bLibre.ok, "el 07 de la rifa de B es suyo");
    paso("otro cliente: no lee, no reserva, no reinicia la rifa ajena (rifa_no_encontrada)");

    // ---- 4. titular
    const pagoAjeno = await rifas.pagar(A, T1, ["07"], { titular: { telefono: "573009999999" } }, bot);
    assert.strictEqual(pagoAjeno.ok, false);
    const pago = await rifas.pagar(A, T1, ["07", "15"], { titular: { usuario_global_id: PERSONA }, metodo_pago: "nequi" }, bot);
    assert.deepStrictEqual(pago.pagados, [7, 15]);
    const pagoDoble = await rifas.pagar(A, T1, ["07"], {}, panel);
    assert.deepStrictEqual(pagoDoble.ya_pagados, [7]);
    const mios = await rifas.numerosDelTitular(A, T1, { telefono: "573001110000" });
    assert.deepStrictEqual(mios.filas.map(f => `${f.numero}:${f.estado}`), ["07:pagado", "15:pagado"]);
    const miosOtra = await rifas.numerosDelTitular(A, T2, { telefono: "573001110000" });
    assert.strictEqual(miosOtra.filas.length, 0);
    paso("titular: paga solo lo suyo, el pago repetido no duplica, «mis números» por rifa");

    // ---- liberar protege pagados
    const lib = await rifas.liberar(A, T1, ["07"], {}, panel);
    assert.strictEqual(lib.ok, false, "un pagado no se libera sin opción explícita");
    const lib2 = await rifas.liberar(A, T2, ["07"], {}, panel);
    assert.deepStrictEqual(lib2.liberados, [7]);
    paso("liberar: pagados protegidos; liberar en una rifa no toca la otra");

    // ---- 2. reiniciar SOLO una rifa
    await rifas.reservar(A, T3, ["40"], { comprador: "Cliente 2000" }, bot);
    await rifas.reservar(A, T2, ["50"], { comprador: "Cliente Tarde" }, bot);
    const sinConfirmar = await rifas.reiniciar(A, T1, "si", panel);
    assert.strictEqual(sinConfirmar.motivo, "confirmacion_requerida");
    const rein = await rifas.reiniciar(A, T1, "REINICIAR", panel);
    assert.ok(rein.ok);
    assert.strictEqual(rein.archivados, 2);
    assert.strictEqual(rein.ciclo, 2);
    assert.strictEqual((await rifas.leerNumeros(A, T1, { estados: ["reservado", "pagado"] })).filas.length, 0);
    assert.strictEqual((await rifas.leerNumeros(A, T2, { numeros: ["50"] })).filas[0].estado, "reservado", "Tarde intacta");
    assert.strictEqual((await rifas.leerNumeros(A, T3, { numeros: ["40"] })).filas[0].estado, "reservado", "$2.000 intacta");
    assert.strictEqual((await rifas.leerNumeros(B, TB, { numeros: ["07"] })).filas[0].estado, "reservado", "B intacta");
    const archivo = await rifas.leerArchivo(A, T1);
    assert.deepStrictEqual(archivo.map(a => a.numero).sort((a, b) => a - b), [7, 15]);
    assert.ok(archivo.every(a => a.ciclo === 1 && a.estado === "pagado"));
    assert.deepStrictEqual(await rifas.leerArchivo(A, T2), []);
    paso("reiniciar: solo la rifa elegida (archiva sus 2 pagados, ciclo 2); la otra de $1.000, la de $2.000 y la de B intactas");

    // ---- 5. resolución por grupo
    assert.strictEqual((await rifas.resolver(A, GRUPO)).motivo, "sin_rifa");
    assert.ok((await rifas.vincularGrupo(A, GRUPO, T1, {}, panel)).ok);
    let r = await rifas.resolver(A, GRUPO);
    assert.ok(r.ok && r.tabla_id === T1 && r.por === "unica");
    assert.ok((await rifas.vincularGrupo(A, GRUPO, T2, {}, panel)).ok);
    r = await rifas.resolver(A, GRUPO);
    assert.strictEqual(r.motivo, "ambigua", "dos rifas sin predeterminada: no elige");
    assert.strictEqual(r.candidatas.length, 2);
    r = await rifas.resolver(A, GRUPO, { codigo: "t" });
    assert.ok(r.ok && r.tabla_id === T2 && r.por === "codigo");
    r = await rifas.resolver(A, GRUPO, { precio: 1000 });
    assert.strictEqual(r.motivo, "ambigua", "el precio no desempata dos rifas del mismo precio");
    r = await rifas.resolver(A, GRUPO, { precio: 2000 });
    assert.strictEqual(r.motivo, "sin_rifa_de_ese_precio", "el precio solo filtra entre las VINCULADAS");
    assert.ok((await rifas.vincularGrupo(A, GRUPO_2, T3, {}, panel)).ok);
    r = await rifas.resolver(A, GRUPO_2, { precio: 2000 });
    assert.ok(r.ok && r.tabla_id === T3);
    r = await rifas.resolver(B, GRUPO);
    assert.strictEqual(r.motivo, "sin_rifa", "los vínculos de A no existen para B en el mismo grupo");
    const vinculoAjeno = await rifas.vincularGrupo(B, GRUPO, T1, {}, rifas.actor({ origen: "manual", operadorId: B }));
    assert.strictEqual(vinculoAjeno.ok, false);
    paso("resolver: única, ambigua (no elige), código, precio solo entre vinculadas; B no ve ni vincula rifas de A");

    // ---- 6. entradas inválidas nunca llegan al motor
    const antes = base.llamadas.length;
    assert.strictEqual((await rifas.reservar(A, "no-es-uuid", ["01"], {}, bot)).motivo, "rifa_no_encontrada");
    assert.strictEqual((await rifas.reservar("x", T1, ["01"], {}, bot)).motivo, "sin_cliente");
    const inval = await rifas.reservar(A, T1, ["abc"], {}, bot, { rifa: { cifras: 2 } });
    assert.strictEqual(inval.motivo, "sin_numeros");
    assert.deepStrictEqual(inval.invalidos, ["abc"]);
    assert.strictEqual(base.llamadas.length, antes, "ninguna llamada a rifa_* con datos inválidos");
    paso("entradas inválidas (uuid, cliente, número) se rechazan sin llamar al motor");

    // ---- 7. auditoría con tabla_id y ciclo
    const { rows: aud } = await base.comoServicio(
        "select accion, numero, resultado, ciclo, origen from public.reservas_auditoria where tabla_id = $1 order by creado_en, numero", [T1]);
    assert.ok(aud.some(a => a.accion === "reservar" && a.numero === "07" && a.ciclo === 1 && a.origen === "bot"));
    assert.ok(aud.some(a => a.accion === "pagar" && a.numero === "15" && a.resultado === "ok"));
    assert.ok(aud.some(a => a.accion === "reiniciar" && a.numero === "*"));
    const { rows: audB } = await base.comoServicio("select count(*)::int as n from public.reservas_auditoria where tabla_id = $1 and usuario_id = $2", [T1, B]);
    assert.strictEqual(audB[0].n, 0);
    paso("auditoría: cada operación con tabla_id, ciclo y origen; nada a nombre de otro cliente");

    console.log(`\n${ok}/${ok} correctos`);
    process.exit(0);
})().catch((e) => {
    console.error("❌", e.stack || e.message);
    process.exit(1);
});
