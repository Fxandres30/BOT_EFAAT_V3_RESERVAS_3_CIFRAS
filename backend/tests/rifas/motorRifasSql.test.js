// ==========================================================================
// Motor único de rifas (050) — Postgres real en memoria (PGlite).
//
// Aplica los ARCHIVOS REALES 032 (reservas_auditoria) y 050 sobre un entorno
// que imita Supabase (roles anon/authenticated/service_role, permisos por
// defecto que conceden TODO a anon y authenticated, auth.uid()) y demuestra:
//   1-6   dos clientes con su propia rifa de $5.000 y su propio número 25;
//   7     aislamiento por RLS, por permisos y por dueño en las funciones;
//   8     un cliente con dos rifas del mismo precio;
//   9     un grupo de WhatsApp resuelve SU rifa (nunca por precio, nunca al azar);
//   10    doble reserva del mismo número (secuencial aquí; la simultánea real
//         está en concurrenciaRifas.test.js);
//   11    pagos y liberaciones no cruzan clientes;
//   12    el historial conserva la identidad de cada rifa;
//   + creación, edición, archivo y eliminación; integridad; reversión.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/rifas/motorRifasSql.test.js
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

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
const M032 = leer("backend/supabase_migrations/032_auditoria_reservas.sql");
const M050 = leer("backend/supabase_migrations/050_motor_rifas_centralizado.sql");
const R050 = leer("backend/supabase_migrations/050_revertir_motor_rifas.sql");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PERSONA_A = "11111111-0000-4000-8000-000000000001";
const GRUPO = "120363000000000001@g.us";

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
`;

let ok = 0;
function paso(nombre) { ok++; console.log(`✅ ${nombre}`); }

async function esperarError(promesa, patron, nombre) {
    let error = null;
    try { await promesa; } catch (e) { error = e; }
    assert.ok(error, `${nombre}: se esperaba un error`);
    assert.match(error.message, patron, `${nombre}: error inesperado: ${error.message}`);
}

(async () => {
    const db = new PGlite();
    await db.exec(ENTORNO);
    await db.exec(M032);
    await db.exec(M050);

    // Llamadas como el BACKEND (service_role) y como el PANEL (authenticated).
    const comoBackend = async (sql, params = []) => {
        await db.exec("set role service_role");
        try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
    };
    const rpc = async (fn, args) => {
        const marcas = args.map((_, i) => `$${i + 1}`).join(", ");
        return (await comoBackend(`select public.${fn}(${marcas}) as r`, args))[0].r;
    };
    const comoPanel = async (usuario, sql, params = []) => {
        await db.exec("set role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [usuario]);
        try { return (await db.query(sql, params)).rows; }
        finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
    };
    const comoAnon = async (sql) => {
        await db.exec("set role anon");
        try { return (await db.query(sql)).rows; } finally { await db.exec("reset role"); }
    };
    const estado = async (tabla, numero) =>
        (await db.query("select estado, comprador, telefono from public.numeros_rifa where tabla_id = $1 and numero = $2", [tabla, numero])).rows[0];

    const BOT = JSON.stringify({ origen: "bot" });
    const PANEL_A = JSON.stringify({ origen: "manual", operador_id: A, operador_email: "a@ejemplo.com", solicitud_id: "s-1" });

    // ------------------------------------------------------------ 1 y 2 ---
    const rA = await rpc("rifa_crear", [A, "Rifa A 5K", 5000, 2, 100, "{}", "A5", PANEL_A]);
    assert.strictEqual(rA.ok, true); assert.strictEqual(rA.numeros, 100);
    const RIFA_A = rA.tabla_id;
    paso("1. el cliente A crea una rifa de $5.000 con 100 números");

    const rB = await rpc("rifa_crear", [B, "Rifa B 5K", 5000, 2, 100, "{}", "A5", JSON.stringify({ origen: "manual" })]);
    assert.strictEqual(rB.ok, true);
    const RIFA_B = rB.tabla_id;
    assert.notStrictEqual(RIFA_A, RIFA_B);
    paso("2. el cliente B crea otra rifa de $5.000 (mismo precio y hasta el mismo código que A)");

    // ---------------------------------------------------------------- 3 ---
    assert.strictEqual((await estado(RIFA_A, 25)).estado, "libre");
    assert.strictEqual((await estado(RIFA_B, 25)).estado, "libre");
    paso("3. ambos tienen su número 25 disponible");

    // ---------------------------------------------------------------- 4 ---
    const res4 = await rpc("rifa_reservar", [A, RIFA_A, [25], JSON.stringify({ comprador: "Ana", telefono: "573001", lid: "lid-ana", usuario_global_id: PERSONA_A, grupo_id: GRUPO }), BOT, false]);
    assert.deepStrictEqual(res4.reservados, [25]);
    assert.strictEqual((await estado(RIFA_A, 25)).estado, "reservado");
    paso("4. el cliente A reserva su 25");

    // ---------------------------------------------------------------- 5 ---
    assert.strictEqual((await estado(RIFA_B, 25)).estado, "libre");
    paso("5. el 25 del cliente B sigue disponible");

    // ---------------------------------------------------------------- 6 ---
    const res6 = await rpc("rifa_reservar", [B, RIFA_B, [25], JSON.stringify({ comprador: "Beto", telefono: "573002" }), BOT, false]);
    assert.deepStrictEqual(res6.reservados, [25]);
    assert.strictEqual((await estado(RIFA_B, 25)).comprador, "Beto");
    assert.strictEqual((await estado(RIFA_A, 25)).comprador, "Ana");
    paso("6. el cliente B reserva su propio 25 sin tocar el de A");

    // ---------------------------------------------------------------- 7 ---
    const vistosA = await comoPanel(A, "select distinct usuario_id::text u from public.numeros_rifa");
    assert.deepStrictEqual(vistosA.map((f) => f.u), [A]);
    assert.strictEqual((await comoPanel(A, "select count(*)::int n from public.numeros_rifa where tabla_id = $1", [RIFA_B]))[0].n, 0);
    assert.strictEqual((await comoPanel(A, "select count(*)::int n from public.tablas_rifas"))[0].n, 1);
    assert.strictEqual((await comoPanel(A, "select count(*)::int n from public.rifas_resumen"))[0].n, 1);
    paso("7a. RLS: el panel de A solo ve sus rifas y números (ni filas ni resumen de B)");

    await esperarError(comoPanel(A, "update public.numeros_rifa set estado = 'libre' where tabla_id = $1", [RIFA_B]), /permission denied/, "update panel");
    await esperarError(comoPanel(A, "update public.numeros_rifa set estado = 'pagado' where tabla_id = $1", [RIFA_A]), /permission denied/, "update propio panel");
    await esperarError(comoPanel(A, "delete from public.numeros_rifa"), /permission denied/, "delete panel");
    await esperarError(comoPanel(A, "insert into public.tablas_rifas (usuario_id, nombre, precio, cifras, cantidad) values ($1, 'x', 1, 1, 1)", [A]), /permission denied/, "insert panel");
    await esperarError(comoPanel(A, `select public.rifa_reservar('${A}', '${RIFA_A}', array[1])`), /permission denied/, "rpc desde panel");
    paso("7b. el panel no puede escribir directamente ni llamar a las funciones (ni siquiera sobre lo suyo)");

    await esperarError(comoAnon("select * from public.numeros_rifa"), /permission denied/, "anon numeros");
    await esperarError(comoAnon("select * from public.tablas_rifas"), /permission denied/, "anon tablas");
    await esperarError(comoAnon(`select public.rifa_resolver('${A}', 'g')`), /permission denied/, "anon rpc");
    paso("7c. anon no lee nada ni ejecuta nada");

    await esperarError(comoBackend("update public.numeros_rifa set estado = 'libre'"), /permission denied/, "update backend directo");
    paso("7d. ni el backend (service_role) escribe directamente: solo a través de rifa_*");

    for (const [fn, args] of [
        ["rifa_reservar", [A, RIFA_B, [30], "{}", BOT, false]],
        ["rifa_pagar", [A, RIFA_B, [25], "{}", PANEL_A]],
        ["rifa_liberar", [A, RIFA_B, [25], "{}", PANEL_A, "{}"]],
        ["rifa_bloquear", [A, RIFA_B, [40], PANEL_A, null]],
        ["rifa_reiniciar", [A, RIFA_B, "REINICIAR", PANEL_A]],
        ["rifa_actualizar", [A, RIFA_B, JSON.stringify({ nombre: "robada" }), PANEL_A]],
        ["rifa_archivar", [A, RIFA_B, PANEL_A]],
        ["rifa_eliminar", [A, RIFA_B, PANEL_A]],
        ["rifa_vincular_grupo", [A, GRUPO, RIFA_B, false, PANEL_A]]
    ]) {
        const r = await rpc(fn, args);
        assert.strictEqual(r.ok, false, fn); assert.strictEqual(r.motivo, "rifa_no_encontrada", fn);
    }
    const b25 = await estado(RIFA_B, 25);
    assert.strictEqual(b25.estado, "reservado"); assert.strictEqual(b25.comprador, "Beto");
    assert.strictEqual((await db.query("select nombre from public.tablas_rifas where id = $1", [RIFA_B])).rows[0].nombre, "Rifa B 5K");
    assert.strictEqual((await estado(RIFA_B, 30)).estado, "libre");
    paso("7e. A, con la rifa de B, recibe «rifa_no_encontrada» en las 9 operaciones y B no cambia");

    // ---------------------------------------------------------------- 8 ---
    const rA2 = await rpc("rifa_crear", [A, "Rifa A 5K tarde", 5000, 2, 100, "{}", "T5", PANEL_A]);
    assert.strictEqual(rA2.ok, true);
    const RIFA_A2 = rA2.tabla_id;
    assert.deepStrictEqual((await rpc("rifa_reservar", [A, RIFA_A2, [25], JSON.stringify({ comprador: "Carla" }), BOT, false])).reservados, [25]);
    assert.strictEqual((await estado(RIFA_A, 25)).comprador, "Ana");
    assert.strictEqual((await estado(RIFA_A2, 25)).comprador, "Carla");
    const dup = await rpc("rifa_crear", [A, "Otra", 5000, 2, 100, "{}", "a5", PANEL_A]);
    assert.strictEqual(dup.motivo, "codigo_en_uso");
    paso("8. A tiene dos rifas de $5.000 independientes (el código sí es único por cliente)");

    // ---------------------------------------------------------------- 9 ---
    assert.strictEqual((await rpc("rifa_resolver", [A, GRUPO, null])).motivo, "sin_rifa");
    await rpc("rifa_vincular_grupo", [A, GRUPO, RIFA_A, false, PANEL_A]);
    let res = await rpc("rifa_resolver", [A, GRUPO, null]);
    assert.strictEqual(res.tabla_id, RIFA_A); assert.strictEqual(res.por, "unica");

    await rpc("rifa_vincular_grupo", [A, GRUPO, RIFA_A2, false, PANEL_A]);
    res = await rpc("rifa_resolver", [A, GRUPO, null]);
    assert.strictEqual(res.ok, false); assert.strictEqual(res.motivo, "ambigua"); assert.strictEqual(res.candidatas.length, 2);
    assert.strictEqual((await rpc("rifa_resolver", [A, GRUPO, "t5"])).tabla_id, RIFA_A2);
    assert.strictEqual((await rpc("rifa_resolver", [A, GRUPO, "ZZ"])).motivo, "codigo_desconocido");
    await rpc("rifa_vincular_grupo", [A, GRUPO, RIFA_A2, true, PANEL_A]);
    res = await rpc("rifa_resolver", [A, GRUPO, null]);
    assert.strictEqual(res.tabla_id, RIFA_A2); assert.strictEqual(res.por, "predeterminada");

    // El MISMO grupo de WhatsApp visto por el bot de B: nunca resuelve rifas de A.
    assert.strictEqual((await rpc("rifa_resolver", [B, GRUPO, null])).motivo, "sin_rifa");
    await rpc("rifa_vincular_grupo", [B, GRUPO, RIFA_B, false, JSON.stringify({ origen: "manual" })]);
    assert.strictEqual((await rpc("rifa_resolver", [B, GRUPO, "A5"])).tabla_id, RIFA_B);
    assert.strictEqual((await rpc("rifa_resolver", [A, GRUPO, "A5"])).tabla_id, RIFA_A);
    paso("9. el grupo resuelve la rifa correcta: única, por código o predeterminada; si es ambigua NO elige; el mismo grupo para B solo ve las de B");

    // --------------------------------------------------------------- 10 ---
    const otraVez = await rpc("rifa_reservar", [A, RIFA_A, [25], JSON.stringify({ comprador: "Intruso" }), BOT, false]);
    assert.strictEqual(otraVez.ok, false); assert.deepStrictEqual(otraVez.no_disponibles, [25]);
    assert.strictEqual((await estado(RIFA_A, 25)).comprador, "Ana");
    const mezcla = await rpc("rifa_reservar", [A, RIFA_A, [25, 26, 26, 200], "{}", BOT, false]);
    assert.deepStrictEqual(mezcla.reservados, [26]); assert.deepStrictEqual(mezcla.fuera_de_rango, [200]);
    const todo = await rpc("rifa_reservar", [A, RIFA_A, [25, 27], "{}", BOT, true]);
    assert.strictEqual(todo.ok, false); assert.strictEqual((await estado(RIFA_A, 27)).estado, "libre");
    assert.strictEqual((await db.query("select count(*)::int n from public.numeros_rifa where tabla_id = $1 and numero = 25", [RIFA_A])).rows[0].n, 1);
    paso("10. un número ocupado no se vuelve a reservar; repetidos y fuera de rango se filtran; «todo o nada» no reserva a medias");

    // --------------------------------------------------------------- 11 ---
    const pago = await rpc("rifa_pagar", [A, RIFA_A, [25], JSON.stringify({ titular: { telefono: "573001" }, metodo_pago: "nequi" }), PANEL_A]);
    assert.deepStrictEqual(pago.pagados, [25]);
    assert.strictEqual((await estado(RIFA_A, 25)).estado, "pagado");
    assert.strictEqual((await estado(RIFA_B, 25)).estado, "reservado");
    assert.deepStrictEqual((await rpc("rifa_pagar", [A, RIFA_A, [25], "{}", PANEL_A])).ya_pagados, [25]);
    const ajeno = await rpc("rifa_pagar", [A, RIFA_A, [26], JSON.stringify({ titular: { telefono: "000" } }), BOT]);
    assert.strictEqual(ajeno.ok, false); assert.strictEqual((await estado(RIFA_A, 26)).estado, "reservado");
    const lib = await rpc("rifa_liberar", [A, RIFA_A, [25, 26], "{}", PANEL_A, "{}"]);
    assert.deepStrictEqual(lib.liberados, [26]);
    assert.strictEqual((await estado(RIFA_A, 25)).estado, "pagado");
    assert.deepStrictEqual((await rpc("rifa_liberar", [A, RIFA_A, [25], "{}", PANEL_A, JSON.stringify({ incluir_pagados: true })])).liberados, [25]);
    const a25 = await estado(RIFA_A, 25);
    assert.strictEqual(a25.estado, "libre"); assert.strictEqual(a25.comprador, null); assert.strictEqual(a25.telefono, null);
    assert.strictEqual((await estado(RIFA_B, 25)).estado, "reservado");
    assert.strictEqual((await estado(RIFA_A2, 25)).estado, "reservado");
    paso("11. pagar y liberar en A no toca B ni la otra rifa de A; pago doble no duplica; titular ajeno no paga; un pagado solo se libera a propósito");

    // --------------------------------------------------------------- 12 ---
    const audit = (await db.query(
        `select usuario_id::text u, tabla_id::text t, numero, accion, estado_anterior, estado_nuevo, resultado, codigo, origen, operador_email, contacto_nombre, ciclo
           from public.reservas_auditoria where tabla_id is not null order by creado_en, id`)).rows;
    const deA = audit.filter((f) => f.t === RIFA_A && f.numero === "25" && f.resultado === "ok").map((f) => `${f.accion}:${f.estado_anterior}->${f.estado_nuevo}`);
    assert.deepStrictEqual(deA, ["reservar:libre->reservado", "pagar:reservado->pagado", "liberar:pagado->libre"]);
    assert.ok(audit.every((f) => (f.t === RIFA_B) === (f.u === B)), "cada fila de auditoría lleva el dueño de su rifa");
    assert.ok(audit.some((f) => f.t === RIFA_A && f.codigo === "no_disponible" && f.contacto_nombre === "Intruso"));
    assert.ok(audit.some((f) => f.accion === "pagar" && f.operador_email === "a@ejemplo.com" && f.origen === "manual"));
    assert.strictEqual(audit.filter((f) => f.t === RIFA_B && f.numero === "25" && f.resultado === "ok").length, 1);
    const auditPanelA = await comoPanel(A, "select distinct usuario_id::text u from public.reservas_auditoria");
    assert.deepStrictEqual(auditPanelA.map((f) => f.u), [A]);
    await esperarError(comoBackend("update public.reservas_auditoria set accion = 'pagar'"), /permission denied|solo inserción/, "auditoría inmutable");
    paso("12a. la auditoría guarda dueño, rifa, número, comprador, actor, acción y estado anterior→nuevo; A solo ve la suya; es inmutable");

    await rpc("rifa_reservar", [A, RIFA_A, [7, 8], JSON.stringify({ comprador: "Dani" }), BOT, false]);
    await rpc("rifa_pagar", [A, RIFA_A, [8], "{}", PANEL_A]);
    assert.strictEqual((await rpc("rifa_reiniciar", [A, RIFA_A, "si", PANEL_A])).motivo, "confirmacion_requerida");
    const rein = await rpc("rifa_reiniciar", [A, RIFA_A, "REINICIAR", JSON.stringify({ origen: "manual", motivo: "nuevo sorteo" })]);
    assert.strictEqual(rein.archivados, 2); assert.strictEqual(rein.ciclo, 2);
    const arch = (await db.query("select usuario_id::text u, numero, estado, ciclo, fila->>'comprador' c from public.numeros_rifa_archivo where tabla_id = $1 order by numero", [RIFA_A])).rows;
    assert.deepStrictEqual(arch.map((f) => `${f.numero}:${f.estado}:${f.ciclo}:${f.c}:${f.u === A}`), ["7:reservado:1:Dani:true", "8:pagado:1:Dani:true"]);
    assert.strictEqual((await db.query("select count(*)::int n from public.numeros_rifa where tabla_id = $1 and estado <> 'libre'", [RIFA_A])).rows[0].n, 0);
    assert.strictEqual((await estado(RIFA_B, 25)).estado, "reservado");
    await esperarError(db.query("delete from public.numeros_rifa_archivo"), /solo inserción/, "archivo inmutable");
    paso("12b. reiniciar exige confirmación, archiva con dueño, rifa y ciclo, sube el ciclo y no toca a B; el archivo es inmutable");

    // ------------------------------------------- creación / edición / borrado ---
    await esperarError(rpc("rifa_crear", [A, "Mal", 5000, 2, 101, "{}", null, PANEL_A]), /tablas_rifas_cantidad_cabe/, "cantidad > 10^cifras");
    await esperarError(rpc("rifa_crear", [A, "Mal", 0, 2, 100, "{}", null, PANEL_A]), /check/, "precio 0");
    await esperarError(rpc("rifa_crear", [A, "Mal", 1000, 2, 100, "{}", null, JSON.stringify({ origen: "hacker" })]), /origen invalido/, "origen inválido");
    assert.strictEqual((await rpc("rifa_crear", [A, "Mal", 1000, 2, 100, JSON.stringify({ cualquiera: {} }), null, PANEL_A])).motivo, "config_invalida");
    assert.strictEqual((await rpc("rifa_crear", ["cccccccc-0000-4000-8000-00000000000c", "X", 1000, 2, 100, "{}", null, PANEL_A])).motivo, "cliente_no_encontrado");
    const tres = await rpc("rifa_crear", [A, "Tres cifras", 20000, 3, 1000, JSON.stringify({ reservas: { expiracion_minutos: 30, max_por_persona: 10 } }), null, PANEL_A]);
    assert.strictEqual(tres.numeros, 1000);
    assert.strictEqual((await rpc("rifa_crear", [A, "Mal", 1000, 2, 100, JSON.stringify({ reservas: { expiracion_minutos: -1 } }), null, PANEL_A])).motivo, "config_invalida");
    paso("13. crear valida cantidad/cifras, precio, origen, configuración y dueño; 3 cifras = 1000 números");

    const ed = await rpc("rifa_actualizar", [A, tres.tabla_id, JSON.stringify({ cantidad: 500, precio: 25000, nombre: "Tres cifras 500" }), PANEL_A]);
    assert.strictEqual(ed.ok, true);
    assert.strictEqual((await db.query("select count(*)::int n, max(numero) m from public.numeros_rifa where tabla_id = $1", [tres.tabla_id])).rows[0].m, 499);
    await rpc("rifa_reservar", [A, tres.tabla_id, [1], "{}", BOT, false]);
    assert.strictEqual((await rpc("rifa_actualizar", [A, tres.tabla_id, JSON.stringify({ precio: 1 }), PANEL_A])).motivo, "rifa_con_numeros_ocupados");
    assert.strictEqual((await rpc("rifa_actualizar", [A, tres.tabla_id, JSON.stringify({ usuario_id: B }), PANEL_A])).motivo, "campo_no_permitido");
    paso("14. editar ajusta números y precio solo sin ventas; el dueño no se puede cambiar");

    const vacia = await rpc("rifa_crear", [A, "Sin uso", 3000, 2, 100, "{}", null, PANEL_A]);
    assert.strictEqual((await rpc("rifa_eliminar", [A, vacia.tabla_id, PANEL_A])).eliminada, true);
    assert.strictEqual((await db.query("select count(*)::int n from public.numeros_rifa where tabla_id = $1", [vacia.tabla_id])).rows[0].n, 0);
    assert.ok((await db.query("select 1 from public.reservas_auditoria where tabla_id = $1 and accion = 'eliminar_rifa'", [vacia.tabla_id])).rows.length);
    const usada = await rpc("rifa_eliminar", [A, RIFA_A, PANEL_A]);
    assert.strictEqual(usada.motivo, "tiene_historial"); assert.strictEqual(usada.sugerencia, "archivar");
    assert.strictEqual((await rpc("rifa_archivar", [A, RIFA_A2, PANEL_A])).ok, true);
    assert.strictEqual((await rpc("rifa_reservar", [A, RIFA_A2, [1], "{}", BOT, false])).motivo, "rifa_inactiva");
    assert.strictEqual((await estado(RIFA_A2, 25)).comprador, "Carla");
    assert.strictEqual((await rpc("rifa_resolver", [A, GRUPO, null])).tabla_id, RIFA_A);
    assert.strictEqual((await rpc("rifa_restaurar", [A, RIFA_A2, PANEL_A])).ok, true);
    assert.strictEqual((await db.query("select activa from public.tablas_rifas where id = $1", [RIFA_A2])).rows[0].activa, false);
    paso("15. eliminar borra solo una rifa sin uso (y lo audita); con historial pide archivar; archivar conserva números y la saca del grupo; restaurar la deja inactiva");

    // ------------------------------------------------------------ integridad ---
    await esperarError(db.query("insert into public.numeros_rifa (tabla_id, usuario_id, numero) values ($1, $2, 99)", [RIFA_A, B]), /no pertenece a ese dueño/, "dueño cruzado");
    await esperarError(db.query("update public.numeros_rifa set usuario_id = $2 where tabla_id = $1 and numero = 1", [RIFA_A, B]), /no se puede mover/, "mover de dueño");
    await esperarError(db.query("update public.numeros_rifa set tabla_id = $2 where tabla_id = $1 and numero = 1", [RIFA_A, RIFA_A2]), /no se puede mover/, "mover de rifa");
    await esperarError(db.query("update public.tablas_rifas set usuario_id = $2 where id = $1", [RIFA_A, B]), /dueño/, "cambiar dueño rifa");
    await esperarError(db.query("insert into public.numeros_rifa (tabla_id, usuario_id, numero) values ($1, $2, 100)", [RIFA_A, A]), /fuera de la rifa/, "número fuera de rango");
    await esperarError(db.query("insert into public.numeros_rifa (tabla_id, usuario_id, numero) values ($1, $2, 5)", [RIFA_A, A]), /numeros_rifa_numero_unico/, "número duplicado");
    await esperarError(db.query("update public.numeros_rifa set comprador = 'x' where tabla_id = $1 and numero = 2", [RIFA_A]), /numeros_rifa_libre_sin_datos/, "libre con datos");
    paso("16. integridad en la base (incluso para el superusuario): sin dueño cruzado, sin mover números, sin duplicados ni fuera de rango, libre sin datos");

    const pub = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1")).rows.map((f) => f.tablename);
    assert.deepStrictEqual(pub, ["numeros_rifa", "tablas_rifas"]);
    const exec = (await db.query(`select distinct a.grantee::regrole::text g from pg_proc p, aclexplode(p.proacl) a
                                   where p.proname like 'rifa\\_%' and a.privilege_type = 'EXECUTE' order by 1`)).rows.map((f) => f.g);
    assert.ok(!exec.includes("anon") && !exec.includes("authenticated") && !exec.includes("-") && exec.includes("service_role"), `EXECUTE: ${exec}`);
    paso("17. Realtime publica numeros_rifa y tablas_rifas; EXECUTE de rifa_* solo para service_role");

    // ------------------------------------------------------------- reversión ---
    await esperarError(db.exec(R050), /tiene datos/, "revertir con datos");
    await db.exec("rollback");
    assert.ok((await db.query("select to_regclass('public.numeros_rifa') t")).rows[0].t);
    const limpia = new PGlite();
    await limpia.exec(ENTORNO); await limpia.exec(M032); await limpia.exec(M050);
    await esperarError(limpia.exec(M050), /ya existen objetos/, "re-aplicar 050");
    await limpia.exec("rollback");
    await limpia.exec(R050);
    const quedan = (await limpia.query(`select to_regclass('public.numeros_rifa') a, to_regnamespace('rifas_privado') b,
        (select count(*)::int from information_schema.columns where table_name = 'reservas_auditoria' and column_name in ('tabla_id', 'ciclo')) c`)).rows[0];
    assert.deepStrictEqual([quedan.a, quedan.b, quedan.c], [null, null, 0]);
    await limpia.query("insert into public.reservas_auditoria (usuario_id, origen, accion, tabla, numero, resultado) values ($1, 'bot', 'reservar', 'x', '01', 'ok')", [A]);
    await esperarError(limpia.query("insert into public.reservas_auditoria (usuario_id, origen, accion, tabla, numero, resultado) values ($1, 'bot', 'reiniciar', 'x', '01', 'ok')", [A]), /check/, "check 032 restaurado");
    paso("18. la 050 no se re-aplica a medias; la reversión se niega con datos y, vacía, deja la 032 exactamente como estaba");

    console.log(`\n${ok} comprobaciones superadas.`);
})().catch((e) => { console.error("❌", e.message); if (e.position) console.error("posición", e.position); process.exit(1); });
