// ==========================================================================
// PRUEBAS — Recordatorios de la automatización según el estado REAL del
// sorteo (números libres, reservados pendientes de pago, pagados y grupo
// cerrado en WhatsApp).
//
//   1. Decisión pura (eventRules.decidirRecordatoriosSegunEstado), casos A–E.
//   2. Scheduler real (tick) con el sorteo en cada estado:
//      A  hay libres                       -> recordatorio y actualización sí
//      B  sin libres, pagos pendientes     -> no (invitan a participar)
//      C  todo pagado                      -> no
//      D  grupo cerrado antes de tiempo    -> no (con o sin pendientes)
//      E  sorteo finalizado / hora pasada  -> no
//      + un recordatorio omitido queda registrado: nunca se envía tarde ni
//        dos veces; si el estado no se pudo leer, se reintenta.
//
// Ningún envío real: socket simulado y Supabase en memoria.
//
//     node backend/tests/scheduler/recordatoriosSegunEstado.test.js
// ==========================================================================

const assert = require("assert");

const { crearEntorno, acelerarTimers, restaurarTimers } = require("./entornoFake");

const resultados = [];

async function test(nombre, fn) {
    try {
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);
    }
}

function sumarMinutos(hhmm, minutos) {
    const [h, m] = hhmm.split(":").map(Number);
    let total = h * 60 + m + minutos;
    total = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const USUARIO = "usuario-1";
const GRUPO = "573000000000-2222@g.us";
const SESSION_ID = "sesion-recordatorios";
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const TABLA = "reservas_dos_cifras";
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

// Sorteo + event_session + configuración + mensaje, con la tabla real en el
// estado pedido: los primeros `pagados` números pagados, luego `reservados`
// pendientes, luego `bloqueados`; el resto libres.
function escenario({ pagados = 0, reservados = 0, bloqueados = 0, evento: extraEvento = {}, grupoCerrado = null, recordatorios = { "30": { activo: true, categoria: null } }, minutosParaCierre = 30 } = {}) {

    const entorno = crearEntorno();
    const { fakeSupabase, eventRules } = entorno;

    const horaCierre = sumarMinutos(eventRules.obtenerHoraMinuto(AHORA), minutosParaCierre);

    const evento = fakeSupabase._agregar("eventos_bot", {
        usuario_id: USUARIO,
        grupo_id: GRUPO,
        nombre_evento: "SINUANO",
        valor: 1500,
        reservados,
        libres: 100 - pagados - reservados - bloqueados,
        premios: [{ premio: "$60.000" }],
        tabla: TABLA,
        cifras: 2,
        cantidad_numeros: 100,
        identidad_evento_real: null,
        activo: true,
        abierto: true,
        estado: "abierto",
        hora_fin: "14:00",
        hora_cierre: horaCierre,
        fecha_evento: "2026-01-15",
        ...extraEvento
    });

    NUMEROS.forEach((numero, i) => {
        const estado = i < pagados ? "pagado" : i < pagados + reservados ? "reservado" : i < pagados + reservados + bloqueados ? "bloqueado" : "libre";
        fakeSupabase._agregar(TABLA, { numero, estado, usuario_id: USUARIO, evento_id: evento.id });
    });

    if (grupoCerrado !== null) {
        fakeSupabase._agregar("grupos", { jid: GRUPO, announce: grupoCerrado });
    }

    const eventSession = fakeSupabase._agregar("event_sessions", {
        evento_id: evento.id,
        identidad_ciclo: `ciclo-${evento.id}`,
        grupo_id: GRUPO,
        session_id: SESSION_ID,
        usuario_id: USUARIO,
        automation_config_id: null,
        estado: "abierto",
        abierto_en: new Date(AHORA.getTime() - 40 * 60000).toISOString(),
        cerrado_en: null,
        datos_evento_snapshot: { nombre_evento: "SINUANO" },
        actualizaciones_enviadas: 0,
        ultima_actualizacion_en: null,
        intentos_recuperacion: 0
    });

    fakeSupabase._agregar("automation_configs", {
        usuario_id: USUARIO,
        grupo_id: GRUPO,
        activo: true,
        dias_permitidos: {},
        mensaje_inicio_dia: {},
        mensaje_apertura: {},
        mensaje_cierre: {},
        stickers: {},
        recordatorios,
        mensaje_actualizacion: {},
        umbral_reservas: 3,
        cooldown_minutos: 20
    });

    fakeSupabase._agregar("automation_messages", {
        usuario_id: null,
        nombre_interno: "recordatorio",
        texto: "⏰ Quedan pocos números de {nombre_evento}, ¡elige el tuyo!",
        tipo: "REMINDER_MESSAGE",
        categoria: null,
        activo: true,
        orden: 0
    });

    return { ...entorno, evento, eventSession };

}

async function tick(entorno, ahora = AHORA) {
    const { sock, llamadas } = entorno.crearFakeSock({ sessionId: SESSION_ID });
    acelerarTimers();
    await entorno.scheduler.tick(sock, { ahora });
    restaurarTimers();
    return llamadas.sendMessage;
}

function acciones(entorno) {
    return entorno.fakeSupabase._filas("automation_actions");
}

async function main() {

    // ------------------------------------------------ 1. decisión pura ---

    const { eventRules } = crearEntorno();
    const decidir = (e) => eventRules.decidirRecordatoriosSegunEstado({ ok: true, total: 100, grupoCerrado: false, ...e });

    await test("decisión A: hay libres y grupo abierto -> participación", () => {
        const d = decidir({ libres: 10, reservados: 5 });
        assert.deepStrictEqual([d.participacion, d.cobro, d.motivo], [true, true, null]);
    });

    await test("decisión B: sin libres, pagos pendientes -> solo cobro", () => {
        const d = decidir({ libres: 0, reservados: 5 });
        assert.deepStrictEqual([d.participacion, d.cobro, d.motivo], [false, true, "sin_disponibles"]);
    });

    await test("decisión C: todo pagado -> ninguno", () => {
        const d = decidir({ libres: 0, reservados: 0 });
        assert.deepStrictEqual([d.participacion, d.cobro, d.motivo], [false, false, "sin_disponibles_ni_pendientes"]);
    });

    await test("decisión D: grupo cerrado con pendientes -> solo cobro (aunque queden libres)", () => {
        const d = decidir({ libres: 10, reservados: 5, grupoCerrado: true });
        assert.deepStrictEqual([d.participacion, d.cobro, d.motivo], [false, true, "grupo_cerrado"]);
    });

    await test("decisión D: grupo cerrado sin pendientes -> ninguno", () => {
        const d = decidir({ libres: 10, reservados: 0, grupoCerrado: true });
        assert.deepStrictEqual([d.participacion, d.cobro], [false, false]);
    });

    await test("decisión: lo que queda está bloqueado (sin libres ni pendientes) -> ninguno", () => {
        const d = decidir({ libres: 0, reservados: 0 });
        assert.strictEqual(d.participacion || d.cobro, false);
    });

    await test("decisión: estado ilegible -> nada ahora y reintentar", () => {
        const d = eventRules.decidirRecordatoriosSegunEstado({ ok: false, error: "x" });
        assert.deepStrictEqual([d.participacion, d.cobro, d.reintentar], [false, false, true]);
    });

    await test("decisión: sorteo sin cantidad_numeros -> estado desconocido, comportamiento previo", () => {
        const d = eventRules.decidirRecordatoriosSegunEstado({ ok: true, total: 0, libres: 0, reservados: 0 });
        assert.deepStrictEqual([d.participacion, d.cobro, d.motivo], [true, true, "estado_desconocido"]);
    });

    // ------------------------------------------------ 2. scheduler real ---

    await test("A: hay números libres -> el recordatorio se envía (1 vez)", async () => {
        const e = escenario({ pagados: 40, reservados: 20 });
        assert.strictEqual((await tick(e)).length, 1);
        assert.strictEqual((await tick(e)).length, 0, "segundo tick: no duplica");
        assert.strictEqual(acciones(e).length, 1);
    });

    await test("B: todos reservados con pagos pendientes -> NO se envía; queda registrado como omitido", async () => {
        const e = escenario({ pagados: 60, reservados: 40 });
        assert.strictEqual((await tick(e)).length, 0);
        const [accion] = acciones(e);
        assert.strictEqual(accion.tipo_accion, "REMINDER_30M");
        assert.match(JSON.stringify(accion), /"omitido":true/);
        assert.match(JSON.stringify(accion), /sin_disponibles/);
        assert.strictEqual(e.fakeSupabase._filas("automation_message_uses").length, 0, "ningún mensaje usado/enviado");
    });

    await test("B: si después se liberan números, el recordatorio omitido NO se envía tarde", async () => {
        const e = escenario({ pagados: 60, reservados: 40 });
        await tick(e);
        e.fakeSupabase._filas(TABLA).slice(90).forEach(f => { f.estado = "libre"; });
        assert.strictEqual((await tick(e)).length, 0);
        assert.strictEqual(acciones(e).length, 1);
    });

    await test("C: todo pagado (aunque falten 30 min o más) -> NO se envía", async () => {
        const e = escenario({ pagados: 100, recordatorios: { "60": { activo: true, categoria: null }, "30": { activo: true, categoria: null } } });
        assert.strictEqual((await tick(e)).length, 0);
        assert.strictEqual(acciones(e).length, 2, "los dos quedan registrados como omitidos");
    });

    await test("C: lo que no está pagado está bloqueado -> NO se envía", async () => {
        const e = escenario({ pagados: 95, bloqueados: 5 });
        assert.strictEqual((await tick(e)).length, 0);
    });

    await test("D: grupo cerrado antes de tiempo con pagos pendientes -> NO se envía (no es cobro)", async () => {
        const e = escenario({ pagados: 30, reservados: 20, grupoCerrado: true });
        assert.strictEqual((await tick(e)).length, 0);
        assert.match(JSON.stringify(acciones(e)[0]), /grupo_cerrado/);
    });

    await test("D: grupo cerrado con todo pagado -> NO se envía", async () => {
        const e = escenario({ pagados: 100, grupoCerrado: true });
        assert.strictEqual((await tick(e)).length, 0);
    });

    await test("D: grupo abierto en WhatsApp (announce=false) con libres -> sí se envía", async () => {
        const e = escenario({ pagados: 10, grupoCerrado: false });
        assert.strictEqual((await tick(e)).length, 1);
    });

    await test("E: sorteo finalizado (activo=false) -> ningún recordatorio", async () => {
        const e = escenario({ pagados: 10, evento: { activo: false, abierto: false, estado: "cerrado" } });
        assert.strictEqual((await tick(e)).length, 0);
        assert.ok(!acciones(e).some(a => a.tipo_accion.startsWith("REMINDER")));
    });

    await test("E: hora de cierre ya pasada -> ningún recordatorio", async () => {
        const e = escenario({ pagados: 10, minutosParaCierre: -5 });
        assert.strictEqual((await tick(e)).length, 0);
        assert.strictEqual(acciones(e).length, 0);
    });

    await test("estado ilegible: no se envía ni se registra; se reintenta y luego sí se envía", async () => {
        const e = escenario({ pagados: 10, evento: { tabla: null } });
        assert.strictEqual((await tick(e)).length, 0);
        assert.strictEqual(acciones(e).length, 0, "no queda registrado: se puede reintentar");
        e.fakeSupabase._filas("eventos_bot")[0].tabla = TABLA;
        assert.strictEqual((await tick(e)).length, 1);
    });

    // ---------------------------------------------- actualizaciones ---

    function conActualizacion(opciones) {
        const e = escenario({ ...opciones, recordatorios: {} });
        e.fakeSupabase._filas("automation_configs")[0].mensaje_actualizacion = { activo: true, categoria: "movimiento" };
        e.fakeSupabase._agregar("automation_messages", { usuario_id: null, nombre_interno: "act", texto: "Van {reservados} elegidos en {nombre_evento}, ¿y el tuyo?", tipo: "UPDATE_MESSAGE", categoria: "movimiento", activo: true, orden: 0 });
        for (let i = 0; i < 4; i++) {
            e.fakeSupabase._agregar("reservas_actividad", { usuario_id: USUARIO, tabla: TABLA, numero: String(i), evento_id: e.evento.id, tipo: "reservado", detalle: {}, realizado_por: "bot", creado_en: new Date(AHORA.getTime() - 10 * 60000).toISOString() });
        }
        return e;
    }

    await test("actualización A: con libres -> se envía", async () => {
        const e = conActualizacion({ pagados: 10, reservados: 20 });
        assert.strictEqual((await tick(e)).length, 1);
    });

    await test("actualización B: sin libres -> no se envía ni consume el contador", async () => {
        const e = conActualizacion({ pagados: 60, reservados: 40 });
        assert.strictEqual((await tick(e)).length, 0);
        assert.strictEqual(e.fakeSupabase._filas("event_sessions")[0].actualizaciones_enviadas, 0);
    });

    await test("actualización D: grupo cerrado -> no se envía", async () => {
        const e = conActualizacion({ pagados: 10, reservados: 20, grupoCerrado: true });
        assert.strictEqual((await tick(e)).length, 0);
    });

    const total = resultados.length;
    const pasa = resultados.filter(r => r.ok).length;

    console.log("\n============================");
    console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
    console.log("============================");

    if (pasa !== total) process.exitCode = 1;

}

main();
