// ==========================================================================
// PRUEBAS — Interruptor maestro vigente en cada tick (Centro de
// Automatizaciones, 06/11).
//
// Antes, automation_configs.activo solo se miraba al ABRIR el ciclo: si el
// administrador apagaba la automatización a mitad de un evento, los
// recordatorios, las actualizaciones y el cierre seguían saliendo. Ahora:
//   - recordatorio que vence con la automatización apagada -> no se envía y
//     queda registrado como omitido (motivo automatizacion_desactivada), así
//     no sale tarde ni en ráfaga al volver a encenderla;
//   - actualización -> no se envía ni se registra (se reevalúa en vivo);
//   - cierre -> el ciclo se cierra igual, sin aviso.
// Un grupo nunca afecta a otro.
//
// Supabase y WhatsApp 100 % falsos (entornoFake.js).
//
//     node backend/tests/scheduler/automatizacionDesactivada.test.js
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
const GRUPO_A = "573000000000-1111@g.us";
const GRUPO_B = "573000000000-2222@g.us";
const SESSION_ID = "sesion-scheduler-1";
const AHORA = new Date("2026-01-15T15:00:00.000Z");

function crearEventoBot(fake, grupo, overrides = {}) {
    return fake._agregar("eventos_bot", {
        usuario_id: USUARIO, grupo_id: grupo, grupo_nombre: `Grupo ${grupo}`,
        nombre_evento: "SINUANO", valor: 1500, reservados: 7, libres: 3,
        premios: [{ premio: "$60.000" }], tabla: "reservas_dos_cifras", cifras: 2,
        cantidad_numeros: 100, activo: true, abierto: true, estado: "abierto",
        hora_fin: "14:00", hora_cierre: "18:00", fecha_evento: "2026-01-15",
        ...overrides
    });
}

function crearEventSession(fake, evento, overrides = {}) {
    return fake._agregar("event_sessions", {
        evento_id: evento.id, identidad_ciclo: `ciclo-${evento.id}`, grupo_id: evento.grupo_id,
        session_id: SESSION_ID, usuario_id: USUARIO, automation_config_id: null, estado: "abierto",
        abierto_en: AHORA.toISOString(), cerrado_en: null,
        datos_evento_snapshot: { nombre_evento: evento.nombre_evento },
        actualizaciones_enviadas: 0, ultima_actualizacion_en: null, intentos_recuperacion: 0,
        ...overrides
    });
}

function crearConfig(fake, grupo, overrides = {}) {
    return fake._agregar("automation_configs", {
        usuario_id: USUARIO, grupo_id: grupo, activo: true, dias_permitidos: {},
        mensaje_inicio_dia: {}, mensaje_apertura: {}, mensaje_cierre: {}, stickers: {},
        recordatorios: {}, mensaje_actualizacion: {}, umbral_reservas: 10, cooldown_minutos: 20,
        ...overrides
    });
}

function crearMensaje(fake, overrides = {}) {
    return fake._agregar("automation_messages", {
        usuario_id: null, nombre_interno: "prueba", texto: "Quedan cupos de {nombre_evento}",
        tipo: "REMINDER_MESSAGE", categoria: null, activo: true, orden: 0,
        ...overrides
    });
}

function sembrarCuadriculaLibre(fake) {
    for (let i = 0; i < 100; i++) {
        fake._agregar("reservas_dos_cifras", { numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: USUARIO });
    }
}

async function tick(scheduler, sock, ahora = AHORA) {
    acelerarTimers();
    try {
        await scheduler.tick(sock, { ahora });
    } finally {
        restaurarTimers();
    }
}

function configDe(fake, grupo) {
    return fake._filas("automation_configs").find((c) => c.grupo_id === grupo);
}

async function main() {

    await test("1) con la automatización encendida el recordatorio vencido se envía (control)", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();
        const cierre = sumarMinutos(eventRules.obtenerHoraMinuto(AHORA), 30);

        const evento = crearEventoBot(fakeSupabase, GRUPO_A, { hora_cierre: cierre });
        sembrarCuadriculaLibre(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, GRUPO_A, { recordatorios: { "30": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase);

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock);

        assert.strictEqual(llamadas.sendMessage.length, 1);

    });

    await test("2) apagada a mitad del evento: el recordatorio NO se envía y queda omitido con su motivo", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();
        const cierre = sumarMinutos(eventRules.obtenerHoraMinuto(AHORA), 30);

        const evento = crearEventoBot(fakeSupabase, GRUPO_A, { hora_cierre: cierre });
        sembrarCuadriculaLibre(fakeSupabase);
        const ciclo = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, GRUPO_A, { activo: false, recordatorios: { "30": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase);

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock);

        assert.strictEqual(llamadas.sendMessage.length, 0);

        const acciones = fakeSupabase._filas("automation_actions");
        assert.strictEqual(acciones.length, 1);
        assert.strictEqual(acciones[0].clave_idempotencia, `${ciclo.id}:REMINDER_30M`);
        assert.strictEqual(acciones[0].estado, "ok");
        assert.strictEqual(acciones[0].detalle.resultado.omitido, true);
        assert.strictEqual(acciones[0].detalle.resultado.motivo, "automatizacion_desactivada");

    });

    await test("3) al volver a encenderla no sale en ráfaga el recordatorio omitido; el siguiente sí sale a su hora", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();
        const cierre = sumarMinutos(eventRules.obtenerHoraMinuto(AHORA), 30);

        const evento = crearEventoBot(fakeSupabase, GRUPO_A, { hora_cierre: cierre });
        sembrarCuadriculaLibre(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, GRUPO_A, {
            activo: false,
            recordatorios: { "30": { activo: true, categoria: null }, "10": { activo: true, categoria: null } }
        });
        crearMensaje(fakeSupabase);

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock); // 30 min antes, apagada -> 30 omitido

        configDe(fakeSupabase, GRUPO_A).activo = true;

        await tick(scheduler, sock, new Date(AHORA.getTime() + 60000)); // 29 min antes
        assert.strictEqual(llamadas.sendMessage.length, 0, "el omitido no debe salir tarde");

        await tick(scheduler, sock, new Date(AHORA.getTime() + 20 * 60000)); // 10 min antes
        assert.strictEqual(llamadas.sendMessage.length, 1, "el de 10 min sí sale");

        await tick(scheduler, sock, new Date(AHORA.getTime() + 21 * 60000));
        assert.strictEqual(llamadas.sendMessage.length, 1, "y nunca dos veces");

    });

    await test("4) apagada: la actualización por movimiento no se envía ni se registra; encendida sí", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase, GRUPO_A, { reservados: 8, libres: 2 });
        sembrarCuadriculaLibre(fakeSupabase);
        crearEventSession(fakeSupabase, evento, { abierto_en: new Date(AHORA.getTime() - 40 * 60000).toISOString() });
        crearConfig(fakeSupabase, GRUPO_A, {
            activo: false,
            mensaje_actualizacion: { activo: true, categoria: "movimiento" },
            umbral_reservas: 3,
            cooldown_minutos: 20
        });
        crearMensaje(fakeSupabase, { tipo: "UPDATE_MESSAGE", categoria: "movimiento", texto: "Van {reservados} de {nombre_evento}" });

        for (let i = 0; i < 4; i++) {
            fakeSupabase._agregar("reservas_actividad", {
                usuario_id: USUARIO, tabla: "reservas_dos_cifras", numero: String(i), evento_id: evento.id,
                tipo: "reservado", detalle: {}, realizado_por: "bot",
                creado_en: new Date(AHORA.getTime() - 10 * 60000).toISOString()
            });
        }

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock);

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

        configDe(fakeSupabase, GRUPO_A).activo = true;
        await tick(scheduler, sock, new Date(AHORA.getTime() + 60000));

        assert.strictEqual(llamadas.sendMessage.length, 1);

    });

    await test("5) apagada: al cierre real el ciclo se cierra sin mensaje de cierre", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase, GRUPO_A, { activo: false, abierto: false, estado: "cerrado" });
        const ciclo = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, GRUPO_A, { activo: false, mensaje_cierre: { activo: true, categoria: "urgencia" } });
        crearMensaje(fakeSupabase, { tipo: "CLOSE_MESSAGE", categoria: "urgencia", texto: "Cerramos {nombre_evento}" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock);

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("event_sessions").find((f) => f.id === ciclo.id).estado, "cerrado");
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    await test("6) un grupo apagado no afecta a otro encendido en la misma sesión", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();
        const cierre = sumarMinutos(eventRules.obtenerHoraMinuto(AHORA), 30);

        const eventoA = crearEventoBot(fakeSupabase, GRUPO_A, { hora_cierre: cierre });
        const eventoB = crearEventoBot(fakeSupabase, GRUPO_B, { hora_cierre: cierre });
        sembrarCuadriculaLibre(fakeSupabase);
        const cicloA = crearEventSession(fakeSupabase, eventoA);
        const cicloB = crearEventSession(fakeSupabase, eventoB);
        crearConfig(fakeSupabase, GRUPO_A, { activo: false, recordatorios: { "30": { activo: true, categoria: null } } });
        crearConfig(fakeSupabase, GRUPO_B, { activo: true, recordatorios: { "30": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase);

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });
        await tick(scheduler, sock);

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(llamadas.sendMessage[0].jid, GRUPO_B);

        const porClave = Object.fromEntries(fakeSupabase._filas("automation_actions").map((a) => [a.clave_idempotencia, a]));
        assert.strictEqual(porClave[`${cicloA.id}:REMINDER_30M`].detalle.resultado.omitido, true);
        assert.ok(!porClave[`${cicloB.id}:REMINDER_30M`].detalle?.resultado?.omitido);

    });

    console.log("");
    const total = resultados.length;
    const pasa = resultados.filter((r) => r.ok).length;
    console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
    if (pasa !== total) process.exitCode = 1;

}

main();
