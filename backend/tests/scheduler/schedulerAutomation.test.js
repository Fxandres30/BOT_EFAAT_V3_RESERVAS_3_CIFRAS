// ==========================================================================
// PRUEBAS — scheduler.js (backend/automation/scheduler.js), Fase 4B.
//
// Supabase 100% fake (fakeSupabaseAutomation.js vía entornoFake.js) y
// socket Baileys 100% fake — ningún WhatsApp real, ningún grupo real,
// ninguna red real. `ahora` siempre se inyecta explícitamente a tick()
// (mismo patrón que engine.onEventoDetectado(evento, { ahora })) para que
// ningún cálculo de recordatorio dependa de la hora real del reloj.
//
//     node backend/tests/scheduler/schedulerAutomation.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Suma minutos a un "HH:mm", con wrap-around a 24h — permite construir una
// hora_cierre relativa a un `ahora` fijo, sin depender del reloj real.
function sumarMinutos(hhmm, minutos) {

    const [h, m] = hhmm.split(":").map(Number);

    let total = h * 60 + m + minutos;
    total = ((total % 1440) + 1440) % 1440;

    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");

    return `${hh}:${mm}`;

}

const USUARIO = "usuario-1";
const GRUPO = "573000000000-1111@g.us";
const SESSION_ID = "sesion-scheduler-1";

const AHORA = new Date("2026-01-15T15:00:00.000Z"); // fija, arbitraria

function crearEventoBot(fakeSupabase, overrides = {}) {

    return fakeSupabase._agregar("eventos_bot", {

        usuario_id: USUARIO,
        grupo_id: GRUPO,
        grupo_nombre: "Grupo de prueba",
        nombre_evento: "SINUANO",
        valor: 1500,
        reservados: 7,
        libres: 3,
        premios: [{ premio: "$60.000" }],
        tabla: "reservas_dos_cifras",
        cifras: 2,
        cantidad_numeros: 100,
        activo: true,
        abierto: true,
        estado: "abierto",
        hora_fin: "14:00",
        hora_cierre: "18:00",
        fecha_evento: "2026-01-15",

        ...overrides

    });

}

function crearEventSession(fakeSupabase, eventoBot, overrides = {}) {

    return fakeSupabase._agregar("event_sessions", {

        evento_id: eventoBot.id,
        identidad_ciclo: `ciclo-${eventoBot.id}`,
        grupo_id: GRUPO,
        session_id: SESSION_ID,
        usuario_id: USUARIO,
        automation_config_id: null,
        estado: "abierto",
        abierto_en: AHORA.toISOString(),
        cerrado_en: null,
        datos_evento_snapshot: { nombre_evento: eventoBot.nombre_evento },
        actualizaciones_enviadas: 0,
        ultima_actualizacion_en: null,
        intentos_recuperacion: 0,

        ...overrides

    });

}

function crearConfig(fakeSupabase, overrides = {}) {

    return fakeSupabase._agregar("automation_configs", {

        usuario_id: USUARIO,
        grupo_id: GRUPO,
        activo: true,
        dias_permitidos: {},
        mensaje_inicio_dia: {},
        mensaje_apertura: {},
        mensaje_cierre: {},
        stickers: {},
        recordatorios: {},
        mensaje_actualizacion: {},
        umbral_reservas: 10,
        cooldown_minutos: 20,

        ...overrides

    });

}

function crearMensaje(fakeSupabase, overrides = {}) {

    return fakeSupabase._agregar("automation_messages", {

        usuario_id: null, // global — no depende de a quién detectó el evento
        nombre_interno: "mensaje de prueba",
        texto: "texto de prueba",
        tipo: "REMINDER_MESSAGE",
        categoria: null,
        activo: true,
        orden: 0,

        ...overrides

    });

}

// Fase 5 (INITIAL_TABLE) — grupos_autorizados nunca se sembraba antes en
// este archivo porque REMINDER/UPDATE/CLOSE no lo revisan por tick (solo
// evaluarApertura lo hace, una vez, al detectar el evento). INITIAL_TABLE
// SÍ lo revisa en cada tick (pedido explícito), así que las pruebas que
// esperan que SÍ publique deben autorizar el grupo explícitamente.
function autorizarGrupo(fakeSupabase, overrides = {}) {

    return fakeSupabase._agregar("grupos_autorizados", {
        usuario_id: USUARIO,
        grupo_id: GRUPO,
        activo: true,
        ...overrides
    });

}

// Fila cruda de la tabla de reservas REAL del evento (evento.tabla) — el
// mismo fake soporta "reservas_dos_cifras" (ver fakeSupabaseAutomation.js).
function crearNumero(fakeSupabase, { tabla = "reservas_dos_cifras", numero, estado = "libre" }) {

    return fakeSupabase._agregar(tabla, { numero, estado });

}

async function main() {

    // ---------------------------------------------------------------
    // 1) Scheduler encuentra un Event Session activo
    // ---------------------------------------------------------------
    await test("1) obtenerAbiertasPorSesion encuentra el event_session abierto de ESTA sesión, no el de otra", async () => {

        const { fakeSupabase, eventSessionsRepo } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase);
        const propio = crearEventSession(fakeSupabase, evento, { session_id: SESSION_ID });
        crearEventSession(fakeSupabase, evento, { session_id: "otra-sesion", identidad_ciclo: "otro-ciclo" });

        const abiertas = await eventSessionsRepo.obtenerAbiertasPorSesion(SESSION_ID);

        assert.strictEqual(abiertas.length, 1);
        assert.strictEqual(abiertas[0].id, propio.id);

    });

    // ---------------------------------------------------------------
    // 2) Scheduler no procesa un Event Session inexistente
    // ---------------------------------------------------------------
    await test("2) tick() sobre una sesión sin event_sessions no hace nada y no lanza", async () => {

        const { scheduler, fakeSupabase, crearFakeSock } = crearEntorno();

        const { sock, llamadas } = crearFakeSock({ sessionId: "sesion-vacia" });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 3) recordatorio pendiente se ejecuta
    // ---------------------------------------------------------------
    await test("3) un recordatorio cuyo offset ya se alcanzó se envía", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 30); // exactamente 30 min desde "ahora"

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "30": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", texto: "Quedan pocos cupos de {nombre_evento}" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);

        const acciones = fakeSupabase._filas("automation_actions");
        assert.strictEqual(acciones.length, 1);
        assert.strictEqual(acciones[0].tipo_accion, "REMINDER_30M");
        assert.strictEqual(acciones[0].estado, "ok");

    });

    // ---------------------------------------------------------------
    // 4) recordatorio futuro NO se ejecuta
    // ---------------------------------------------------------------
    await test("4) un recordatorio cuyo offset todavía no se alcanzó NO se envía", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 130); // faltan 130 min, offset configurado es 30

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "30": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 5) CLOSE_MESSAGE se ejecuta cuando llega la hora real de cierre
    // ---------------------------------------------------------------
    await test("5) CLOSE_MESSAGE se envía y el event_session pasa a 'cerrado' cuando eventos_bot.activo=false", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase, { activo: false, abierto: false, estado: "cerrado" });
        const eventSession = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { mensaje_cierre: { activo: true, categoria: "urgencia" } });
        crearMensaje(fakeSupabase, { tipo: "CLOSE_MESSAGE", categoria: "urgencia", texto: "Cerramos {nombre_evento}, gracias por participar" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);

        const filaFinal = fakeSupabase._filas("event_sessions").find(f => f.id === eventSession.id);
        assert.strictEqual(filaFinal.estado, "cerrado");
        assert.ok(filaFinal.cerrado_en);

        const acciones = fakeSupabase._filas("automation_actions");
        assert.strictEqual(acciones.length, 1);
        assert.strictEqual(acciones[0].tipo_accion, "CLOSE_MESSAGE");

    });

    // ---------------------------------------------------------------
    // 5b) sin evento_bot.activo=false, CLOSE_MESSAGE nunca se dispara solo por la hora
    // ---------------------------------------------------------------
    await test("5b) el Scheduler NUNCA decide el cierre por su cuenta: con activo=true no hay CLOSE_MESSAGE aunque ya pasó hora_cierre", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, -60); // hora_cierre "ya pasó"

        const evento = crearEventoBot(fakeSupabase, { activo: true, hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { mensaje_cierre: { activo: true, categoria: "urgencia" } });
        crearMensaje(fakeSupabase, { tipo: "CLOSE_MESSAGE", categoria: "urgencia" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);

    });

    // ---------------------------------------------------------------
    // 6) UPDATE_MESSAGE puede ejecutarse
    // ---------------------------------------------------------------
    await test("6) UPDATE_MESSAGE se envía cuando el movimiento de reservas cruza el umbral y el cooldown ya pasó", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase, { reservados: 8, libres: 2 });

        const abiertoEn = new Date(AHORA.getTime() - 40 * 60000).toISOString(); // 40 min antes

        const eventSession = crearEventSession(fakeSupabase, evento, {
            abierto_en: abiertoEn,
            ultima_actualizacion_en: null
        });

        crearConfig(fakeSupabase, {
            mensaje_actualizacion: { activo: true, categoria: "movimiento" },
            umbral_reservas: 3,
            cooldown_minutos: 20
        });

        crearMensaje(fakeSupabase, {
            tipo: "UPDATE_MESSAGE",
            categoria: "movimiento",
            texto: "Van {reservados} reservados, quedan {disponibles} de {nombre_evento}"
        });

        // 4 reservas nuevas después de abierto_en -> cruza el umbral de 3
        for (let i = 0; i < 4; i++) {
            fakeSupabase._agregar("reservas_actividad", {
                usuario_id: USUARIO,
                tabla: "reservas_dos_cifras",
                numero: String(i),
                evento_id: evento.id,
                tipo: "reservado",
                detalle: {},
                realizado_por: "bot",
                creado_en: new Date(AHORA.getTime() - 10 * 60000).toISOString()
            });
        }

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.ok(llamadas.sendMessage[0].contenido.text.includes("8"));

        const filaFinal = fakeSupabase._filas("event_sessions").find(f => f.id === eventSession.id);
        assert.strictEqual(filaFinal.actualizaciones_enviadas, 1);
        assert.ok(filaFinal.ultima_actualizacion_en);

    });

    // ---------------------------------------------------------------
    // 7) una acción duplicada no vuelve a enviar
    // ---------------------------------------------------------------
    await test("7) llamar tick() dos veces para el mismo recordatorio pendiente solo envía una vez", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 10);

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "10": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 1);

    });

    // ---------------------------------------------------------------
    // 8) dos Schedulers concurrentes -> un solo envío
    // ---------------------------------------------------------------
    await test("8) dos tick() concurrentes sobre el mismo recordatorio pendiente solo envían una vez", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 10);

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "10": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();

        await Promise.all([
            scheduler.tick(sock, { ahora: AHORA }),
            scheduler.tick(sock, { ahora: AHORA })
        ]);

        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 1);

    });

    // ---------------------------------------------------------------
    // 9) variables reales se resuelven
    // ---------------------------------------------------------------
    await test("9) el texto enviado resuelve variables reales del evento en vivo (no del snapshot)", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 5);

        const evento = crearEventoBot(fakeSupabase, {
            hora_cierre: horaCierre,
            nombre_evento: "SINUANO NOCHE",
            valor: 2500,
            reservados: 9,
            libres: 1
        });

        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "5": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, {
            tipo: "REMINDER_MESSAGE",
            texto: "¡Últimos {disponibles} cupos de {nombre_evento}! Valor: {valor}"
        });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);

        const texto = llamadas.sendMessage[0].contenido.text;
        assert.ok(texto.includes("1"), texto);
        assert.ok(texto.includes("SINUANO NOCHE"), texto);
        assert.ok(texto.includes("2500"), texto);

    });

    // ---------------------------------------------------------------
    // 10) datos faltantes -> no se envía
    // ---------------------------------------------------------------
    await test("10) si la plantilla usa una variable que el evento real no tiene, no se envía nada", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 5);

        // Sin premios -> {premio} nunca se resuelve.
        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre, premios: [] });

        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "5": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", texto: "¡Ganate {premio} en {nombre_evento}!" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        // enviarMensajeProgramado devuelve antes de tocar ExecutionGuard
        // cuando faltan variables -> no debe quedar ninguna fila.
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 11) mensaje inactivo -> no se selecciona
    // ---------------------------------------------------------------
    await test("11) un mensaje inactivo del pool nunca se selecciona ni se envía", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 5);

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "5": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", activo: false });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);

    });

    // ---------------------------------------------------------------
    // 12) selección aleatoria funciona
    // ---------------------------------------------------------------
    await test("12) messageSelector (el mismo que usa el Scheduler) elige entre varios candidatos activos, no siempre el mismo", async () => {

        const { fakeSupabase } = crearEntorno();

        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", categoria: "escasez", nombre_interno: "a" });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", categoria: "escasez", nombre_interno: "b" });

        // messageSelector se recarga en el mismo entorno fake, vía el
        // require.cache compartido de scheduler.js/engine.js.
        const messageSelector = require(path.join(__dirname, "..", "..", "automation", "messageSelector"));

        const vistos = new Set();

        for (let i = 0; i < 40; i++) {
            const m = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO, grupoId: GRUPO, tipo: "REMINDER_MESSAGE", categoria: "escasez" });
            vistos.add(m.nombre_interno);
        }

        assert.ok(vistos.size >= 2, `se esperaban al menos 2 mensajes distintos, se vieron: ${[...vistos]}`);

    });

    // ---------------------------------------------------------------
    // 13) anti-repetición funciona (dentro del flujo del Scheduler)
    // ---------------------------------------------------------------
    await test("13) dos CLOSE_MESSAGE consecutivos (event_sessions distintos) no repiten el mismo mensaje cuando hay alternativa", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        crearMensaje(fakeSupabase, { tipo: "CLOSE_MESSAGE", categoria: "urgencia", nombre_interno: "cierre-a", texto: "Cierre texto A" });
        crearMensaje(fakeSupabase, { tipo: "CLOSE_MESSAGE", categoria: "urgencia", nombre_interno: "cierre-b", texto: "Cierre texto B" });

        crearConfig(fakeSupabase, { mensaje_cierre: { activo: true, categoria: "urgencia" } });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();

        const eventoA = crearEventoBot(fakeSupabase, { activo: false });
        crearEventSession(fakeSupabase, eventoA, { identidad_ciclo: "ciclo-a" });
        await scheduler.tick(sock, { ahora: AHORA });

        const eventoB = crearEventoBot(fakeSupabase, { activo: false });
        crearEventSession(fakeSupabase, eventoB, { identidad_ciclo: "ciclo-b" });
        await scheduler.tick(sock, { ahora: AHORA });

        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 2);
        assert.notStrictEqual(llamadas.sendMessage[0].contenido.text, llamadas.sendMessage[1].contenido.text);

    });

    // ---------------------------------------------------------------
    // 14) ExecutionGuard protege (no se duplica el registro)
    // ---------------------------------------------------------------
    await test("14) automation_actions nunca tiene dos filas para la misma clave de idempotencia", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 10);

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        const eventSession = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "10": { activo: true, categoria: null } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE" });

        const { sock } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await Promise.all([scheduler.tick(sock, { ahora: AHORA }), scheduler.tick(sock, { ahora: AHORA }), scheduler.tick(sock, { ahora: AHORA })]);
        restaurarTimers();

        const claves = fakeSupabase._filas("automation_actions")
            .filter(f => f.event_session_id === eventSession.id)
            .map(f => f.clave_idempotencia);

        assert.strictEqual(claves.length, new Set(claves).size);
        assert.strictEqual(claves.length, 1);

    });

    // ---------------------------------------------------------------
    // 15) automation_actions registra el resultado con datos correctos
    // ---------------------------------------------------------------
    await test("15) la fila de automation_actions queda con estado='ok' y los datos correctos", async () => {

        const { fakeSupabase, scheduler, eventRules, crearFakeSock } = crearEntorno();

        const ahoraHHmm = eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 15);

        const evento = crearEventoBot(fakeSupabase, { hora_cierre: horaCierre });
        const eventSession = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, { recordatorios: { "15": { activo: true, categoria: "escasez" } } });
        crearMensaje(fakeSupabase, { tipo: "REMINDER_MESSAGE", categoria: "escasez" });

        const { sock } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        const accion = fakeSupabase._filas("automation_actions").find(f => f.event_session_id === eventSession.id);

        assert.ok(accion);
        assert.strictEqual(accion.estado, "ok");
        assert.strictEqual(accion.tipo_accion, "REMINDER_15M");
        assert.strictEqual(accion.clave_idempotencia, `${eventSession.id}:REMINDER_15M`);
        assert.strictEqual(accion.grupo_id, GRUPO);
        assert.strictEqual(accion.usuario_id, USUARIO);
        assert.ok(accion.finalizado_en);

    });

    // ---------------------------------------------------------------
    // 16) reinicio del Scheduler no duplica acciones
    // ---------------------------------------------------------------
    await test("16) tras un 'reinicio' (recarga de módulos, misma base fake) no se reenvía un recordatorio ya enviado", async () => {

        const primero = crearEntorno();

        const ahoraHHmm = primero.eventRules.obtenerHoraMinuto(AHORA);
        const horaCierre = sumarMinutos(ahoraHHmm, 10);

        const evento = crearEventoBot(primero.fakeSupabase, { hora_cierre: horaCierre });
        crearEventSession(primero.fakeSupabase, evento);
        crearConfig(primero.fakeSupabase, { recordatorios: { "10": { activo: true, categoria: null } } });
        crearMensaje(primero.fakeSupabase, { tipo: "REMINDER_MESSAGE" });

        const sock1 = primero.crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await primero.scheduler.tick(sock1.sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(sock1.llamadas.sendMessage.length, 1);

        // "Reinicio": módulos recargados desde cero, MISMA base de datos
        // fake (igual que un restart real de proceso contra el mismo
        // Supabase).
        const segundo = crearEntorno({ fakeSupabaseExistente: primero.fakeSupabase });
        const sock2 = segundo.crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await segundo.scheduler.tick(sock2.sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(sock2.llamadas.sendMessage.length, 0);
        assert.strictEqual(primero.fakeSupabase._filas("automation_actions").length, 1);

    });

    // ---------------------------------------------------------------
    // 17) Scheduler.stop() detiene la ejecución
    // ---------------------------------------------------------------
    await test("17) stop() detiene los ticks periódicos: no hay más llamadas después de detenerlo", async () => {

        const { scheduler, eventSessionsRepo, crearFakeSock } = crearEntorno();

        let llamadasRepo = 0;
        const original = eventSessionsRepo.obtenerAbiertasPorSesion;
        eventSessionsRepo.obtenerAbiertasPorSesion = async (...args) => {
            llamadasRepo++;
            return original(...args);
        };

        try {

            const { sock } = crearFakeSock({ sessionId: "sesion-stop" });

            const iniciado = scheduler.start(sock, { intervaloMs: 40 });
            assert.strictEqual(iniciado, true);

            await esperar(140); // varios ticks reales

            scheduler.stop("sesion-stop");

            const llamadasAlDetener = llamadasRepo;
            assert.ok(llamadasAlDetener >= 1, "el scheduler debería haber corrido al menos un tick antes de detenerse");

            await esperar(140); // si el interval no se limpió, aquí crecería

            assert.strictEqual(llamadasRepo, llamadasAlDetener);

        } finally {

            eventSessionsRepo.obtenerAbiertasPorSesion = original;

        }

    });

    // ---------------------------------------------------------------
    // 18) Scheduler.start() no crea múltiples loops
    // ---------------------------------------------------------------
    await test("18) llamar start() dos veces para la misma sesión no deja dos intervalos corriendo en paralelo", async () => {

        const { scheduler, eventSessionsRepo, crearFakeSock } = crearEntorno();

        let llamadasRepo = 0;
        const original = eventSessionsRepo.obtenerAbiertasPorSesion;
        eventSessionsRepo.obtenerAbiertasPorSesion = async (...args) => {
            llamadasRepo++;
            return original(...args);
        };

        try {

            const { sock } = crearFakeSock({ sessionId: "sesion-doble-start" });

            scheduler.start(sock, { intervaloMs: 80 });
            scheduler.start(sock, { intervaloMs: 80 }); // debe reemplazar, no sumar

            await esperar(150); // una sola ventana de intervalo + margen

            scheduler.stop("sesion-doble-start");

            // Si hubiera DOS intervalos activos, en esta ventana ya habría
            // 2 (uno de cada intervalo). Con el reemplazo correcto, solo 1.
            assert.strictEqual(llamadasRepo, 1);

        } finally {

            eventSessionsRepo.obtenerAbiertasPorSesion = original;

        }

    });

    // ---------------------------------------------------------------
    // 19) el Scheduler nunca llama abrirGrupo()
    // ---------------------------------------------------------------
    await test("19) scheduler.js nunca LLAMA a abrirGrupo/groupSettingUpdate ni requiere bot/ (fuera de comentarios)", async () => {

        const codigoFuente = fs.readFileSync(path.join(__dirname, "..", "..", "automation", "scheduler.js"), "utf-8");
        // Mismo criterio que tests/automation/eventSessions.test.js (extra2):
        // se ignoran las líneas de comentario // — este archivo SÍ menciona
        // "abrirGrupo()" en prosa explicando qué NO hace, eso no cuenta
        // como una llamada real.
        const lineasReales = codigoFuente.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

        assert.ok(!lineasReales.includes("abrirGrupo("));
        assert.ok(!lineasReales.includes("groupSettingUpdate"));
        assert.ok(!/require\(["']\.\.\/bot\//.test(lineasReales));

    });

    // ---------------------------------------------------------------
    // 20) el Scheduler nunca crea Event Sessions
    // ---------------------------------------------------------------
    await test("20) scheduler.js nunca llama eventSessionsRepo.crear() y tick() nunca agrega filas a event_sessions", async () => {

        const codigoFuente = fs.readFileSync(path.join(__dirname, "..", "..", "automation", "scheduler.js"), "utf-8");
        const lineasReales = codigoFuente.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
        assert.ok(!lineasReales.includes("eventSessionsRepo.crear("));

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase);

        const antes = fakeSupabase._filas("event_sessions").length;

        const { sock } = crearFakeSock({ sessionId: SESSION_ID });
        await scheduler.tick(sock, { ahora: AHORA });

        const despues = fakeSupabase._filas("event_sessions").length;

        assert.strictEqual(antes, despues);

    });

    // =================================================================
    // INITIAL_TABLE (Fase 5) — publicación inicial de la tabla real.
    // =================================================================

    // ---------------------------------------------------------------
    // 21) publicación programada a la hora correcta
    // ---------------------------------------------------------------
    await test("21) INITIAL_TABLE: a la hora configurada, publica con los números REALES de evento.tabla", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase); // tabla: "reservas_dos_cifras"
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });

        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });
        crearNumero(fakeSupabase, { numero: 2, estado: "libre" });
        crearNumero(fakeSupabase, { numero: 3, estado: "reservado" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA }); // AHORA = jueves 10:00 COT, ya pasó las 07:00
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);

        const texto = llamadas.sendMessage[0].contenido.text;
        assert.ok(texto.includes("( 1 - 2 )"), texto);
        assert.ok(!texto.includes("3"), texto);

        const acciones = fakeSupabase._filas("automation_actions");
        assert.strictEqual(acciones.length, 1);
        assert.strictEqual(acciones[0].tipo_accion, "INITIAL_TABLE");
        assert.strictEqual(acciones[0].estado, "ok");

    });

    // ---------------------------------------------------------------
    // 22) día no permitido -> no publica
    // ---------------------------------------------------------------
    await test("22) INITIAL_TABLE: día no permitido para esta acción -> no publica", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: false } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 23) automatización apagada -> no publica
    // ---------------------------------------------------------------
    await test("23) INITIAL_TABLE: automatización apagada (interruptor maestro) -> no publica", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            activo: false,
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);

    });

    // ---------------------------------------------------------------
    // 24) grupo no autorizado -> no publica
    // ---------------------------------------------------------------
    await test("24) INITIAL_TABLE: grupo no autorizado -> no publica", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        // Deliberadamente SIN autorizarGrupo(fakeSupabase).
        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);

    });

    // ---------------------------------------------------------------
    // 25) sin evento real (sin event_session abierto) -> no publica nada
    // ---------------------------------------------------------------
    await test("25) INITIAL_TABLE: sin ningún event_session abierto (evento real no detectado) -> no publica nada", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 26) evento sin tabla válida -> no publica (nunca inventa una)
    // ---------------------------------------------------------------
    await test("26) INITIAL_TABLE: evento real sin tabla válida -> no publica nada (no inventa una tabla)", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase, { tabla: null });
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        await scheduler.tick(sock, { ahora: AHORA });

        assert.strictEqual(llamadas.sendMessage.length, 0);
        assert.strictEqual(fakeSupabase._filas("automation_actions").length, 0);

    });

    // ---------------------------------------------------------------
    // 27) evento detectado después de la hora programada -> publica igual
    // ---------------------------------------------------------------
    await test("27) INITIAL_TABLE: la hora programada ya pasó hace rato (detección tardía del evento) -> publica de inmediato", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        // hora configurada 07:00, AHORA son las 10:00 -> el evento recién
        // se detectó y su event_session recién se abrió a las 10:00,
        // mucho después de la hora programada.
        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 5, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);

    });

    // ---------------------------------------------------------------
    // 28) mismo ciclo ejecutado dos veces -> una sola publicación
    // ---------------------------------------------------------------
    await test("28) INITIAL_TABLE: llamar tick() dos veces para el mismo event_session solo publica una vez", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(fakeSupabase._filas("automation_actions").filter(a => a.tipo_accion === "INITIAL_TABLE").length, 1);

    });

    // ---------------------------------------------------------------
    // 29) reinicio del proceso -> no vuelve a publicar
    // ---------------------------------------------------------------
    await test("29) INITIAL_TABLE: tras un 'reinicio' (recarga de módulos, misma base fake) no se vuelve a publicar", async () => {

        const primero = crearEntorno();

        autorizarGrupo(primero.fakeSupabase);

        const evento = crearEventoBot(primero.fakeSupabase);
        crearEventSession(primero.fakeSupabase, evento);
        crearConfig(primero.fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(primero.fakeSupabase, { numero: 1, estado: "libre" });

        const sock1 = primero.crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await primero.scheduler.tick(sock1.sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(sock1.llamadas.sendMessage.length, 1);

        const segundo = crearEntorno({ fakeSupabaseExistente: primero.fakeSupabase });
        const sock2 = segundo.crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await segundo.scheduler.tick(sock2.sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(sock2.llamadas.sendMessage.length, 0);
        assert.strictEqual(
            primero.fakeSupabase._filas("automation_actions").filter(a => a.tipo_accion === "INITIAL_TABLE").length,
            1
        );

    });

    // ---------------------------------------------------------------
    // 30) dos ejecuciones concurrentes -> una sola publicación
    // ---------------------------------------------------------------
    await test("30) INITIAL_TABLE: dos tick() concurrentes sobre el mismo event_session solo publican una vez", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });
        crearNumero(fakeSupabase, { numero: 1, estado: "libre" });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();

        await Promise.all([
            scheduler.tick(sock, { ahora: AHORA }),
            scheduler.tick(sock, { ahora: AHORA })
        ]);

        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(fakeSupabase._filas("automation_actions").filter(a => a.tipo_accion === "INITIAL_TABLE").length, 1);

    });

    // ---------------------------------------------------------------
    // 31) un nuevo ciclo (event_session distinto) puede publicar su
    //     propia tabla, independiente del ciclo anterior
    // ---------------------------------------------------------------
    await test("31) INITIAL_TABLE: un event_session nuevo (nuevo ciclo) publica su propia tabla, sin bloquearse por el ciclo anterior", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();

        const eventoA = crearEventoBot(fakeSupabase, { nombre_evento: "SORTEO A" });
        crearEventSession(fakeSupabase, eventoA, { identidad_ciclo: "ciclo-tabla-a" });
        crearNumero(fakeSupabase, { numero: 10, estado: "libre" });
        await scheduler.tick(sock, { ahora: AHORA });

        const eventoB = crearEventoBot(fakeSupabase, { nombre_evento: "SORTEO B" });
        crearEventSession(fakeSupabase, eventoB, { identidad_ciclo: "ciclo-tabla-b" });
        crearNumero(fakeSupabase, { numero: 20, estado: "libre" });
        await scheduler.tick(sock, { ahora: AHORA });

        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 2);
        assert.ok(llamadas.sendMessage[0].contenido.text.includes("( 10 )"), llamadas.sendMessage[0].contenido.text);
        assert.ok(llamadas.sendMessage[1].contenido.text.includes("( 10 - 20 )"), llamadas.sendMessage[1].contenido.text);

    });

    // ---------------------------------------------------------------
    // 32) nunca inventa datos del sorteo
    // ---------------------------------------------------------------
    await test("32) INITIAL_TABLE: sin ningún número sembrado en la tabla real, nunca inventa disponibilidad", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
        });

        // Deliberadamente SIN crearNumero() — la tabla real está vacía.

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(llamadas.sendMessage[0].contenido.text, "No quedan números disponibles.");

    });

    // ---------------------------------------------------------------
    // 33) INITIAL_TABLE es independiente del Message Pool (OPEN_MESSAGE)
    // ---------------------------------------------------------------
    await test("33) INITIAL_TABLE nunca depende del Message Pool: publica aunque no exista ningún automation_messages", async () => {

        const { fakeSupabase, scheduler, crearFakeSock } = crearEntorno();

        autorizarGrupo(fakeSupabase);

        const evento = crearEventoBot(fakeSupabase);
        const eventSession = crearEventSession(fakeSupabase, evento);
        crearConfig(fakeSupabase, {
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: { jueves: true } }
            // mensaje_apertura/recordatorios/mensaje_actualizacion/mensaje_cierre
            // quedan en su default {} — ningún OPEN_MESSAGE/REMINDER/etc. se
            // envía en este tick, y no hace falta ningún automation_messages
            // sembrado para que INITIAL_TABLE funcione.
        });
        crearNumero(fakeSupabase, { numero: 7, estado: "libre" });

        assert.strictEqual(fakeSupabase._filas("automation_messages").length, 0);

        const { sock, llamadas } = crearFakeSock({ sessionId: SESSION_ID });

        acelerarTimers();
        await scheduler.tick(sock, { ahora: AHORA });
        restaurarTimers();

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.ok(llamadas.sendMessage[0].contenido.text.includes("( 7 )"));

        const acciones = fakeSupabase._filas("automation_actions");
        assert.strictEqual(acciones.length, 1);
        assert.strictEqual(acciones[0].tipo_accion, "INITIAL_TABLE");
        assert.strictEqual(acciones[0].clave_idempotencia, `${eventSession.id}:INITIAL_TABLE`);

    });

    console.log("");
    console.log("============================");

    const total = resultados.length;
    const pasa = resultados.filter(r => r.ok).length;

    console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
    console.log("============================");

    if (pasa !== total) {
        process.exitCode = 1;
    }

}

main();
