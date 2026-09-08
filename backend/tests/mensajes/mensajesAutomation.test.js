// ==========================================================================
// PRUEBAS — Fase 4A: Message Pool + selector aleatorio + variables +
// integración OPEN_MESSAGE.
//
// Ejercitan el código REAL (messageSelector.js, variableResolver.js,
// repo/messages.js, engine.enviarMensajeApertura -> executionGuard.js ->
// services/baileys/send.js EXISTENTE) contra Supabase 100% fake y un
// socket Baileys 100% fake — nunca WhatsApp real, nunca red real.
//
//     node backend/tests/mensajes/mensajesAutomation.test.js
// ==========================================================================

const assert = require("assert");
const { crearEntorno, acelerarTimers, restaurarTimers } = require("./entornoFake");

const USUARIO_ID = "usuario-mensajes-1";
const GRUPO_ID = "573000000000-1111@g.us";

function sembrarMensaje(fakeSupabase, {
    usuarioId = null,
    tipo = "OPEN_MESSAGE",
    categoria = null,
    texto = "Mensaje de prueba",
    activo = true,
    nombreInterno = "mensaje-prueba"
} = {}) {

    return fakeSupabase._agregar("automation_messages", {
        usuario_id: usuarioId,
        nombre_interno: nombreInterno,
        texto,
        tipo,
        categoria,
        activo
    });

}

function eventoFake(overrides = {}) {
    return {
        id: "evento-bot-1",
        usuario_id: USUARIO_ID,
        grupo_id: GRUPO_ID,
        nombre_evento: "Sinuano Dia",
        hora_fin: "14:30",
        hora_cierre: "14:26",
        fecha_evento: "2026-09-09",
        valor: 1500,
        premios: [{ tipo: "dos_ultimas_cifras", nombre: "Dos últimas cifras", premio: 60000 }],
        reservados: 3,
        libres: 97,
        ...overrides
    };
}

function eventSessionFake(overrides = {}) {
    return {
        id: "event-session-1",
        grupo_id: GRUPO_ID,
        usuario_id: USUARIO_ID,
        ...overrides
    };
}

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

async function main() {

    acelerarTimers(); // send.js real espera 1-7s reales antes de cada envío

    // ---------------------------------------------------------------
    // 1) mensaje activo seleccionado
    // ---------------------------------------------------------------
    await test("1) un único mensaje activo es seleccionado", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const m = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Único mensaje" });

        const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });

        assert.ok(elegido);
        assert.strictEqual(elegido.id, m.id);

    });

    // ---------------------------------------------------------------
    // 2) mensaje inactivo nunca seleccionado
    // ---------------------------------------------------------------
    await test("2) un mensaje inactivo nunca se selecciona", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, activo: false, texto: "Inactivo" });

        const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });

        assert.strictEqual(elegido, null, "sin mensajes activos, no debe elegir ninguno");

    });

    // ---------------------------------------------------------------
    // 3) selección aleatoria entre varios (nunca siempre el primero)
    // ---------------------------------------------------------------
    await test("3) con varios mensajes activos, la selección varía (no siempre el primero, no depende del orden)", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const ids = [
            sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "A" }).id,
            sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "B" }).id,
            sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "C" }).id
        ];

        const vistos = new Set();

        for (let i = 0; i < 60; i++) {

            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });
            assert.ok(ids.includes(elegido.id));
            vistos.add(elegido.id);

        }

        assert.ok(vistos.size > 1, `en 60 intentos con 3 mensajes activos debieron aparecer más de uno distinto (vistos: ${vistos.size})`);

    });

    // ---------------------------------------------------------------
    // 4) evitar repetición inmediata
    // ---------------------------------------------------------------
    await test("4) con 2 mensajes activos, tras usar uno, el siguiente NUNCA repite ese mismo (determinístico)", async () => {

        const { messageSelector, messagesRepo, fakeSupabase } = crearEntorno();

        const a = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "A" });
        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "B" });

        await messagesRepo.registrarUso({ mensajeId: a.id, usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });

        for (let i = 0; i < 10; i++) {

            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });
            assert.notStrictEqual(elegido.id, a.id, "no debe repetir el último mensaje usado mientras haya otra opción");

        }

    });

    await test("4b) 'cuando sea posible': si el ÚNICO mensaje activo ya fue el último usado, se reutiliza igual (no hay alternativa)", async () => {

        const { messageSelector, messagesRepo, fakeSupabase } = crearEntorno();

        const unico = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Único" });

        await messagesRepo.registrarUso({ mensajeId: unico.id, usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });

        const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });

        assert.ok(elegido, "sin alternativa real, debe reutilizar el único mensaje disponible");
        assert.strictEqual(elegido.id, unico.id);

    });

    // ---------------------------------------------------------------
    // 5) categoría funciona
    // ---------------------------------------------------------------
    await test("5) filtrar por categoría solo elige mensajes de esa categoría", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const urgencia = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, categoria: "urgencia", texto: "Urgente" });
        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, categoria: "humor", texto: "Chistoso" });

        for (let i = 0; i < 15; i++) {

            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE", categoria: "urgencia" });
            assert.strictEqual(elegido.id, urgencia.id);

        }

    });

    // ---------------------------------------------------------------
    // 6) tipo funciona
    // ---------------------------------------------------------------
    await test("6) filtrar por tipo solo elige mensajes de ese tipo (OPEN_MESSAGE vs REMINDER_MESSAGE)", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const apertura = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, tipo: "OPEN_MESSAGE", texto: "Apertura" });
        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, tipo: "REMINDER_MESSAGE", texto: "Recordatorio" });

        for (let i = 0; i < 15; i++) {

            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });
            assert.strictEqual(elegido.id, apertura.id);

        }

    });

    await test("6b) mensajes GLOBALES (usuario_id null) también se incluyen en el pool, junto a los propios", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const global1 = sembrarMensaje(fakeSupabase, { usuarioId: null, texto: "Global" });
        const propio = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Propio" });

        const vistos = new Set();

        for (let i = 0; i < 40; i++) {
            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });
            vistos.add(elegido.id);
        }

        assert.ok(vistos.has(global1.id), "el mensaje global debe poder salir elegido");
        assert.ok(vistos.has(propio.id), "el mensaje propio debe poder salir elegido");

    });

    await test("6c) mensajes propios de OTRO usuario nunca se eligen", async () => {

        const { messageSelector, fakeSupabase } = crearEntorno();

        const deOtro = sembrarMensaje(fakeSupabase, { usuarioId: "otro-usuario", texto: "No debería salir" });
        const propio = sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Propio" });

        for (let i = 0; i < 15; i++) {
            const elegido = await messageSelector.seleccionarMensaje({ usuarioId: USUARIO_ID, grupoId: GRUPO_ID, tipo: "OPEN_MESSAGE" });
            assert.notStrictEqual(elegido.id, deOtro.id);
            assert.strictEqual(elegido.id, propio.id);
        }

    });

    // ---------------------------------------------------------------
    // 7) variables se resuelven
    // ---------------------------------------------------------------
    await test("7) las variables del texto se resuelven con datos reales", () => {

        const { variableResolver } = crearEntorno();

        const r = variableResolver.resolverVariables(
            "🔓 ¡Ya abrió {nombre_evento}! Valor ${valor}, cierra {hora_cierre}.",
            { nombre_evento: "Sinuano Dia", valor: 1500, hora_cierre: "14:26" }
        );

        assert.strictEqual(r.completo, true);
        assert.strictEqual(r.texto, "🔓 ¡Ya abrió Sinuano Dia! Valor $1500, cierra 14:26.");
        assert.deepStrictEqual(r.faltantes, []);

    });

    // ---------------------------------------------------------------
    // 8) variable inexistente no produce mensaje corrupto
    // ---------------------------------------------------------------
    await test("8) una variable sin dato disponible se reporta como incompleto, sin inventar el valor", () => {

        const { variableResolver } = crearEntorno();

        const r = variableResolver.resolverVariables("Premio especial: {premio}", {});

        assert.strictEqual(r.completo, false);
        assert.deepStrictEqual(r.faltantes, ["premio"]);
        assert.ok(r.texto.includes("{premio}"), "la variable sin resolver debe quedar visible, nunca reemplazada por un valor inventado");

    });

    await test("8b) integración: OPEN_MESSAGE con variable faltante en el evento real -> NO se envía nada", async () => {

        const { engine, fakeSupabase, crearFakeSock } = crearEntorno();

        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "El premio es {premio}" });

        const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO_ID });

        // evento SIN premios -> {premio} no tiene con qué resolverse.
        const evento = eventoFake({ premios: [] });
        const eventSession = eventSessionFake();

        const resultado = await engine.enviarMensajeApertura(evento, eventSession, sock);

        assert.strictEqual(resultado.enviado, false);
        assert.strictEqual(resultado.motivo, "variable_faltante");
        assert.strictEqual(llamadas.sendMessage.length, 0, "no debe llamarse a send.js si el mensaje quedaría corrupto");

    });

    // ---------------------------------------------------------------
    // 9) no hay doble OPEN_MESSAGE para el mismo event_session
    // ---------------------------------------------------------------
    await test("9) dos llamadas a enviarMensajeApertura() para el MISMO event_session -> un solo envío real", async () => {

        const { engine, fakeSupabase, crearFakeSock } = crearEntorno();

        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Ya estamos activos en {nombre_evento}" });

        const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO_ID });

        const evento = eventoFake();
        const eventSession = eventSessionFake();

        await engine.enviarMensajeApertura(evento, eventSession, sock);
        await engine.enviarMensajeApertura(evento, eventSession, sock); // repetido

        assert.strictEqual(llamadas.sendMessage.length, 1, "la segunda llamada NO debe volver a enviar");

    });

    // ---------------------------------------------------------------
    // 10) concurrencia segura
    // ---------------------------------------------------------------
    await test("10) dos llamadas CONCURRENTES a enviarMensajeApertura() para el mismo event_session -> un solo envío real", async () => {

        const { engine, fakeSupabase, crearFakeSock } = crearEntorno();

        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Ya estamos activos en {nombre_evento}" });

        const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO_ID });

        const evento = eventoFake();
        const eventSession = eventSessionFake();

        await Promise.all([
            engine.enviarMensajeApertura(evento, eventSession, sock),
            engine.enviarMensajeApertura(evento, eventSession, sock)
        ]);

        assert.strictEqual(llamadas.sendMessage.length, 1, "de dos llamadas concurrentes, exactamente una debe enviar de verdad");

    });

    // ---------------------------------------------------------------
    // 11) ExecutionGuard evita duplicación (verificado en automation_actions,
    // no en un sistema de locking nuevo)
    // ---------------------------------------------------------------
    await test("11) la protección es automation_actions/ExecutionGuard EXISTENTE — queda una sola fila 'ok' para OPEN_MESSAGE", async () => {

        const { engine, fakeSupabase, crearFakeSock } = crearEntorno();

        sembrarMensaje(fakeSupabase, { usuarioId: USUARIO_ID, texto: "Ya estamos activos en {nombre_evento}" });

        const { sock } = crearFakeSock({ usuarioId: USUARIO_ID });

        const evento = eventoFake();
        const eventSession = eventSessionFake();

        await Promise.all([
            engine.enviarMensajeApertura(evento, eventSession, sock),
            engine.enviarMensajeApertura(evento, eventSession, sock),
            engine.enviarMensajeApertura(evento, eventSession, sock)
        ]);

        const acciones = fakeSupabase._filas("automation_actions").filter(a => a.tipo_accion === "OPEN_MESSAGE");

        assert.strictEqual(acciones.length, 1, "debe existir exactamente una acción OPEN_MESSAGE registrada");
        assert.strictEqual(acciones[0].estado, "ok");
        assert.strictEqual(acciones[0].clave_idempotencia, `${eventSession.id}:OPEN_MESSAGE`);
        assert.strictEqual(acciones[0].event_session_id, eventSession.id);

        // Y el registro de uso (anti-repetición) también quedó una sola vez.
        const usos = fakeSupabase._filas("automation_message_uses");
        assert.strictEqual(usos.length, 1);

    });

    // ---------------------------------------------------------------
    // 12) integración con send.js existente
    // ---------------------------------------------------------------
    await test("12) el envío pasa por services/baileys/send.js real (sendPresenceUpdate + sendMessage con el texto resuelto)", async () => {

        const { engine, fakeSupabase, crearFakeSock } = crearEntorno();

        sembrarMensaje(fakeSupabase, {
            usuarioId: USUARIO_ID,
            texto: "🔓 ¡Ya abrió {nombre_evento}! Valor ${valor}."
        });

        const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO_ID });

        const evento = eventoFake();
        const eventSession = eventSessionFake();

        const resultado = await engine.enviarMensajeApertura(evento, eventSession, sock);

        assert.strictEqual(resultado.enviado, true);

        // sendPresenceUpdate: SOLO lo llama services/baileys/send.js real
        // (la "simulación de escritura") — confirma que pasó por ahí, no
        // por un envío directo inventado.
        assert.ok(llamadas.sendPresenceUpdate > 0, "debe haber pasado por sendPresenceUpdate de send.js real");

        assert.strictEqual(llamadas.sendMessage.length, 1);
        assert.strictEqual(llamadas.sendMessage[0].jid, GRUPO_ID);
        assert.strictEqual(llamadas.sendMessage[0].contenido.text, "🔓 ¡Ya abrió Sinuano Dia! Valor $1500.");

    });

    await test("12b) sin mensajes OPEN_MESSAGE activos -> no envía nada, no revienta", async () => {

        const { engine, crearFakeSock } = crearEntorno();

        const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO_ID });

        const resultado = await engine.enviarMensajeApertura(eventoFake(), eventSessionFake(), sock);

        assert.strictEqual(resultado.enviado, false);
        assert.strictEqual(resultado.motivo, "sin_mensajes_disponibles");
        assert.strictEqual(llamadas.sendMessage.length, 0);

    });

    restaurarTimers();

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
