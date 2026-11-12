// ==========================================================================
// PRUEBAS — el BOT con el motor de rifas (MOTOR_RIFAS=nuevo) sobre el SQL
// REAL (032 + 050), con las funciones reales del bot:
//   reservarNumeros, consultarReservas, consultarDisponibilidad,
//   consultarNumero, consultarMisNumerosPorEstado,
//   marcarReservasPagadasPorAdmin y consultarEvento.
//
//   1. Dos sorteos del MISMO precio en grupos distintos, cada uno con su
//      rifa: reservar el 07 en uno deja el 07 libre en el otro.
//   2. Un sorteo sin tabla_id NO toca ningún número (ni cae al precio).
//   3. «Mis números», «consultar número» y el sticker de pago solo ven la
//      rifa del sorteo del grupo.
//   4. Dos sorteos vigentes en el mismo grupo: el bot no elige (null).
//   5. Con el motor «legado» consultarEvento sigue como siempre.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/botRifas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PERSONA = "11111111-0000-4000-8000-000000000001";
const OTRA = "22222222-0000-4000-8000-000000000002";
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const G3 = "120363000000000003@g.us";

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

(async () => {
    if (!cargarPGlite()) {
        console.log("⏭️  sin PGlite (PGLITE_MODULE): prueba omitida");
        process.exit(0);
    }
    process.env.MOTOR_RIFAS = "nuevo";

    const base = await crearBase({ usuarios: [A] });
    // eventos_bot mínimo para consultarEvento (la real tiene más columnas).
    await base.pg.exec(`
        create table public.eventos_bot (id uuid primary key, usuario_id uuid, grupo_id text, activo boolean,
            estado text, cierre_estado text, cierre_motivo text, fecha_evento date, creado_en timestamptz default now());
        grant select on public.eventos_bot to service_role;`);
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const rifas = require(path.join(RAIZ, "rifas/repositorio.js"));
    const r = (p) => require(path.join(RAIZ, "bot/funciones", p));
    const { reservarNumerosDetallado } = r("reservas/reservarNumeros.js");
    const { consultarReservas } = r("reservas/consultarReservas.js");
    const { consultarDisponibilidad } = r("consultas/consultarDisponibilidad.js");
    const { consultarNumero } = r("consultas/consultarNumero.js");
    const { consultarMisNumerosPorEstado } = r("consultas/consultarMisNumeros.js");
    const { marcarReservasPagadasPorAdmin } = r("pagos/marcarReservasPagadasPorAdmin.js");
    const { consultarEvento } = r("eventos/consultarEvento.js");

    const panel = rifas.actor({ origen: "manual", operadorId: A });
    const M = (await rifas.crearRifa(A, { nombre: "Mañana", precio: 1000 }, panel)).tabla_id;
    const T = (await rifas.crearRifa(A, { nombre: "Tarde", precio: 1000 }, panel)).tabla_id;

    // Sorteos del mismo precio, misma tabla física antigua, rifas distintas.
    const evento = (id, grupo, tablaId) => ({
        id, usuario_id: A, grupo_id: grupo, grupo_nombre: `Grupo ${grupo.slice(-3)}`, tabla: "reservas_dos_cifras",
        tabla_id: tablaId, valor: "1000", cifras: 2, activo: true, identidad_evento_real: `ident-${id.slice(0, 4)}`
    });
    const evM = evento("e1000000-0000-4000-8000-000000000001", G1, M);
    const evT = evento("e1000000-0000-4000-8000-000000000002", G2, T);
    const evSin = evento("e1000000-0000-4000-8000-000000000003", G3, null);
    const ana = { id: PERSONA, nombre: "Ana", telefono: "573001110000", lid: "111@lid" };
    const beto = { id: OTRA, nombre: "Beto", telefono: "573002220000" };

    // ---- 1. reservar en un sorteo no toca el otro del mismo precio
    const res = await reservarNumerosDetallado({ evento: evM, numeros: ["07", "08"], usuario: ana });
    assert.strictEqual(res.error, null);
    assert.deepStrictEqual(res.filas.map(f => f.numero), ["07", "08"]);
    assert.strictEqual(res.filas[0].nombre, "Ana");
    assert.strictEqual(res.filas[0].grupo_id, G1);
    const dispT = await consultarDisponibilidad({ evento: evT });
    assert.ok(dispT.numerosDisponibles.includes("07") && dispT.numerosDisponibles.length === 100);
    const dispM = await consultarDisponibilidad({ evento: evM });
    assert.deepStrictEqual(dispM.numerosOcupados, ["07", "08"]);
    const enT = await consultarReservas(evT, ["07"]);
    assert.strictEqual(enT[0].estado, "libre");
    const resT = await reservarNumerosDetallado({ evento: evT, numeros: ["07"], usuario: beto });
    assert.deepStrictEqual(resT.filas.map(f => `${f.numero}:${f.nombre}`), ["07:Beto"]);
    paso("reservar: el 07 del sorteo del grupo 1 y el 07 del grupo 2 (mismo precio) son de rifas distintas");

    // ---- 2. sin tabla_id: nada
    const antes = base.llamadas.filter(c => c.nombre.startsWith("rifa_")).length;
    const sin = await reservarNumerosDetallado({ evento: evSin, numeros: ["09"], usuario: ana });
    assert.deepStrictEqual(sin.filas, []);
    assert.strictEqual(sin.error?.code, "SIN_RIFA");
    assert.strictEqual(base.llamadas.filter(c => c.nombre.startsWith("rifa_")).length, antes, "no llamó a ninguna función del motor");
    assert.strictEqual((await consultarDisponibilidad({ evento: evSin })).errorLectura, true);
    assert.strictEqual(await consultarReservas(evSin, ["09"]), null);
    const libres = await rifas.leerNumeros(A, M, { estados: ["reservado"] });
    assert.deepStrictEqual(libres.filas.map(f => f.numero), ["07", "08"], "nada nuevo reservado en ninguna rifa");
    paso("sorteo sin tabla_id: no reserva, no lee, no cae al precio (SIN_RIFA)");

    // ---- 3. mis números, consultar número, sticker
    const misM = await consultarMisNumerosPorEstado({ evento: evM, usuario: ana });
    assert.deepStrictEqual(misM.reservados.map(f => f.numero ?? f), ["07", "08"].map(n => misM.reservados.find(x => (x.numero ?? x) === n) ? n : null).filter(Boolean));
    assert.strictEqual(misM.total, 2);
    const misT = await consultarMisNumerosPorEstado({ evento: evT, usuario: ana });
    assert.strictEqual(misT.total, 0, "Ana no tiene números en la rifa del grupo 2");
    assert.strictEqual((await consultarNumero({ evento: evM, usuario: ana, numero: "07" })).estadoReal, "reservado_por_usuario");
    assert.strictEqual((await consultarNumero({ evento: evT, usuario: ana, numero: "07" })).estadoReal, "reservado_por_otro");
    assert.strictEqual((await consultarNumero({ evento: evT, usuario: ana, numero: "08" })).estadoReal, "libre");
    const pagoT = await marcarReservasPagadasPorAdmin({ evento: evT, usuario: ana, realizadoPor: "admin@s.whatsapp.net" });
    assert.strictEqual(pagoT.estado, "sin_reservas", "el sticker en el grupo 2 no paga lo del grupo 1");
    const pago = await marcarReservasPagadasPorAdmin({ evento: evM, usuario: ana, realizadoPor: "admin@s.whatsapp.net" });
    assert.strictEqual(pago.estado, "confirmado");
    assert.deepStrictEqual(pago.actualizadas.map(f => `${f.numero}:${f.estado}`), ["07:pagado", "08:pagado"]);
    assert.ok(pago.actualizadas[0].fecha_pago && pago.actualizadas[0].hora_pago);
    assert.strictEqual((await marcarReservasPagadasPorAdmin({ evento: evM, usuario: ana, realizadoPor: "admin" })).estado, "ya_pagado");
    assert.strictEqual((await rifas.leerNumeros(A, T, { numeros: ["07"] })).filas[0].estado, "reservado", "Beto (rifa Tarde) sigue reservado");
    paso("mis números, consultar número y sticker de pago: solo la rifa del sorteo del grupo; el pago no se duplica");

    // ---- 4/5. dos vigentes en el mismo grupo
    await base.pg.exec(`insert into public.eventos_bot (id, usuario_id, grupo_id, activo, estado, creado_en) values
        ('f1000000-0000-4000-8000-000000000001', '${A}', '${G3}', true, null, now() - interval '1 hour'),
        ('f1000000-0000-4000-8000-000000000002', '${A}', '${G3}', true, null, now());`);
    assert.strictEqual(await consultarEvento(G3, A), null, "nuevo: no elige entre dos vigentes");
    process.env.MOTOR_RIFAS = "legado";
    assert.strictEqual((await consultarEvento(G3, A))?.id, "f1000000-0000-4000-8000-000000000002", "legado: el más reciente, como siempre");
    process.env.MOTOR_RIFAS = "nuevo";
    await base.pg.exec(`update public.eventos_bot set activo = false where id = 'f1000000-0000-4000-8000-000000000001'`);
    assert.strictEqual((await consultarEvento(G3, A))?.id, "f1000000-0000-4000-8000-000000000002", "con uno solo vigente, ese");
    paso("dos sorteos vigentes en un grupo: el motor nuevo no elige; el legado no cambia");

    // ---- sorteo lleno y vencimiento de reservas (motor nuevo)
    const { sorteoSinNumerosLibres } = r("eventos/lifecycle/sorteoSinNumerosLibres.js");
    const { verificarEventoLleno } = r("eventos/lifecycle/verificarEventoLleno.js");
    assert.strictEqual(await sorteoSinNumerosLibres(evT), false, "la rifa Tarde tiene libres");
    assert.strictEqual(await sorteoSinNumerosLibres(evSin), null, "sin rifa: no se afirma nada");
    assert.strictEqual(await verificarEventoLleno({ ...evT, cantidad_numeros: 100 }), false);
    assert.strictEqual(await verificarEventoLleno({ ...evT, cantidad_numeros: 1 }), true, "1 reservado de 1");
    const { liberarVencidasRifa } = require(path.join(RAIZ, "sorteos/publicador.js"));
    const actualizados = [];
    const deps = { supabase: base.client, actualizarEvento: async (e) => actualizados.push(e.id) };
    const reservas = { liberar_no_pagados: true, vencimiento_minutos: 30 };
    const sorteo = { id: "50000000-0000-4000-8000-000000000001", tabla_id: T, tabla: "reservas_dos_cifras", identidad_evento_real: evT.identidad_evento_real, publicar_en: "2026-01-01T00:00:00Z" };
    const pronto = await liberarVencidasRifa({ sorteo, usuarioId: A, activos: [evT], reservas, ahora: new Date(), deps });
    assert.deepStrictEqual(pronto, [], "a los pocos segundos nada ha vencido");
    const tarde = await liberarVencidasRifa({ sorteo, usuarioId: A, activos: [evT], reservas, ahora: new Date(Date.now() + 31 * 60_000), deps });
    assert.deepStrictEqual(tarde.map(x => x.numero), ["07"], "vence el 07 de Beto en la rifa Tarde");
    assert.strictEqual((await rifas.leerNumeros(A, T, { numeros: ["07"] })).filas[0].estado, "libre");
    assert.deepStrictEqual((await rifas.leerNumeros(A, M, { estados: ["pagado"] })).filas.map(f => f.numero), ["07", "08"], "la rifa Mañana (pagados) intacta");
    assert.deepStrictEqual(await liberarVencidasRifa({ sorteo: { ...sorteo, tabla_id: null }, usuarioId: A, activos: [evT], reservas, ahora: new Date(Date.now() + 99 * 60_000), deps }), []);
    assert.deepStrictEqual(actualizados, [evT.id]);
    paso("sorteo lleno y vencimiento: por la rifa del sorteo; sin rifa no se libera nada; los pagados nunca vencen");

    // ---- vencimiento atómico: una reserva NUEVA (posterior al corte) nunca se libera,
    //      aunque el llamador la creyera vencida (carrera lectura → liberación).
    const nueva = await reservarNumerosDetallado({ evento: evT, numeros: ["09"], usuario: beto });
    assert.deepStrictEqual(nueva.filas.map(f => f.numero), ["09"]);
    const carrera = await rifas.liberar(A, T, ["09"], {}, rifas.actor({ origen: "sistema", motivo: "vencimiento" }),
        { reservadoAntesDe: new Date(Date.now() - 60 * 60_000), identidadEventoReal: evT.identidad_evento_real });
    assert.strictEqual(carrera.ok, false, "la reserva es más nueva que el corte: no se libera");
    const otroSorteo = await rifas.liberar(A, T, ["09"], {}, rifas.actor({ origen: "sistema" }),
        { reservadoAntesDe: new Date(Date.now() + 60_000), identidadEventoReal: "otro-sorteo" });
    assert.strictEqual(otroSorteo.ok, false, "de otro sorteo: no se libera");
    assert.strictEqual((await rifas.leerNumeros(A, T, { numeros: ["09"] })).filas[0].estado, "reservado");
    paso("vencimiento atómico: la base no libera una reserva posterior al corte ni de otro sorteo");

    // ---- rifa de un sorteo: el precio solo filtra; nunca se hereda una rifa de otro precio
    const { rifaParaSorteo } = require(path.join(RAIZ, "rifas/bot.js"));
    const D = (await rifas.crearRifa(A, { nombre: "Dos mil", precio: 2000 }, panel)).tabla_id;
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: 1000, heredada: M }), M, "misma rifa y mismo precio: se hereda");
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: 2000, heredada: M }), null,
        "anuncio corregido a $2.000 sobre la rifa de $1.000: NO se hereda");
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: "abc", heredada: null }), null, "precio no válido: no se busca");
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: 2000, heredada: null }), null, "la de $2.000 no está vinculada al grupo");
    await rifas.vincularGrupo(A, G1, D, {}, panel);
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: "$2.000", heredada: null }), D, "vinculada: se resuelve por precio");
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G1, precio: 2000, heredada: "99999999-0000-4000-8000-000000000009" }), null,
        "heredada inexistente o de otro cliente: no se acepta");
    paso("rifa del sorteo: se hereda solo si es del mismo precio; precio inválido o rifa ajena → sin rifa (el bot se detiene)");

    // ---- auditoría del bot
    const { rows } = await base.comoServicio(
        "select accion, origen, numero, tabla_id from public.reservas_auditoria where accion in ('reservar','pagar') and resultado = 'ok' order by creado_en");
    assert.ok(rows.some(x => x.accion === "reservar" && x.origen === "bot" && x.tabla_id === M && x.numero === "07"));
    assert.ok(rows.some(x => x.accion === "pagar" && x.tabla_id === M && x.numero === "08"));
    assert.ok(rows.every(x => x.tabla_id === M || x.tabla_id === T));
    const { rows: venc } = await base.comoServicio("select origen, motivo from public.reservas_auditoria where accion = 'liberar' and tabla_id = $1", [T]);
    assert.ok(venc.some(v => v.origen === 'sistema' && /vencimiento/.test(v.motivo)), 'el vencimiento queda auditado como sistema');
    paso("auditoría: reservas y pagos del bot con su tabla_id");

    console.log(`\n${ok}/${ok} correctos`);
    process.exit(0);
})().catch((e) => {
    console.error("❌", e.stack || e.message);
    process.exit(1);
});
