// ==========================================================================
// PRUEBAS — repo/eventSessions.js + engine.js (orquestación completa, sin
// ninguna acción de WhatsApp).
//
// Supabase 100% fake — ningún socket real, ninguna llamada de red, ningún
// WhatsApp. engine.onEventoDetectado() en esta fase SOLO decide y persiste
// event_sessions — nunca abre/cierra grupos ni envía mensajes (verificado
// también en el punto "extra" al final de este archivo).
//
//     node backend/tests/automation/eventSessions.test.js
// ==========================================================================

const assert = require("assert");
const { crearEntorno } = require("./entornoFake");

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

// Réplica de la forma real de ctx.evento (= fila de eventos_bot devuelta
// por detectarEvento(), ver PHASE_2A_FINDINGS §3) — NO se reimplementa
// detectarEvento() aquí, solo se construye el objeto que ya produciría.
function eventoDetectado(overrides = {}) {
    return {
        id: "evento-bot-fijo-1",
        usuario_id: "usuario-1",
        session_id: "sesion-whatsapp-1",
        telefono_bot: "573000000000",
        grupo_id: "573000000000-1111@g.us",
        grupo_nombre: "Grupo de prueba",
        nombre_evento: "SORTEO DE LA TARDE",
        hora_fin: "20:00",
        hora_cierre: "19:30",
        fecha_evento: "2026-09-09",
        valor: 5000,
        premios: ["1er lugar", "2do lugar"],
        tabla: "5k_15k_reservas_2_cifras",
        cifras: 2,
        cantidad_numeros: 100,
        activo: true,
        abierto: true,
        ...overrides
    };
}

const AHORA_MIERCOLES_10AM = new Date("2026-09-09T15:00:00.000Z"); // 10:00 COT, miércoles

function prepararGrupoAutorizadoYConfig(fakeSupabase, { usuarioId = "usuario-1", grupoId = "573000000000-1111@g.us" } = {}) {

    fakeSupabase._agregar("grupos_autorizados", {
        usuario_id: usuarioId,
        grupo_id: grupoId,
        activo: true
    });

    return fakeSupabase._agregar("automation_configs", {
        usuario_id: usuarioId,
        grupo_id: grupoId,
        activo: true,
        dias_permitidos: {
            miercoles: { activo: true, desde: "08:00", hasta: "20:00" }
        }
    });

}

async function main() {

    // ---------------------------------------------------------------
    // 18) crear ciclo
    // ---------------------------------------------------------------
    await test("18) engine.onEventoDetectado() crea un event_session cuando todas las reglas pasan", async () => {

        const { engine, eventRules, fakeSupabase } = crearEntorno();

        prepararGrupoAutorizadoYConfig(fakeSupabase);

        const evento = eventoDetectado();

        const r = await engine.onEventoDetectado(evento, { ahora: AHORA_MIERCOLES_10AM });

        assert.strictEqual(r.creoEventSession, true);
        assert.ok(r.eventSession);
        assert.strictEqual(r.eventSession.estado, "pendiente");
        assert.strictEqual(r.eventSession.grupo_id, evento.grupo_id);
        assert.strictEqual(r.identidadCiclo, eventRules.crearIdentidadCiclo(evento));

        // El snapshot debe conservar los datos reales de ESTE ciclo.
        assert.strictEqual(r.eventSession.datos_evento_snapshot.nombre_evento, evento.nombre_evento);
        assert.strictEqual(r.eventSession.datos_evento_snapshot.valor, evento.valor);

        const filas = fakeSupabase._filas("event_sessions");
        assert.strictEqual(filas.length, 1);

    });

    // ---------------------------------------------------------------
    // 19) recuperar ciclo existente
    // ---------------------------------------------------------------
    await test("19) buscarPorIdentidadCiclo() recupera un ciclo ya creado", async () => {

        const { eventSessionsRepo, eventRules, fakeSupabase } = crearEntorno();

        const evento = eventoDetectado();
        const identidad = eventRules.crearIdentidadCiclo(evento);

        const creado = await eventSessionsRepo.crear({
            identidadCiclo: identidad,
            grupoId: evento.grupo_id,
            usuarioId: evento.usuario_id,
            eventoId: evento.id,
            sessionId: evento.session_id,
            datosEventoSnapshot: { nombre_evento: evento.nombre_evento }
        });

        const recuperado = await eventSessionsRepo.buscarPorIdentidadCiclo(evento.grupo_id, identidad);

        assert.ok(recuperado);
        assert.strictEqual(recuperado.id, creado.id);
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1, "no debe haber creado una fila extra al buscar");

    });

    // ---------------------------------------------------------------
    // 20) no crear duplicado
    // ---------------------------------------------------------------
    await test("20) un segundo onEventoDetectado() con el MISMO evento no crea un segundo event_session", async () => {

        const { engine, fakeSupabase } = crearEntorno();

        prepararGrupoAutorizadoYConfig(fakeSupabase);

        const evento = eventoDetectado();

        const primero = await engine.onEventoDetectado(evento, { ahora: AHORA_MIERCOLES_10AM });
        const segundo = await engine.onEventoDetectado(evento, { ahora: AHORA_MIERCOLES_10AM });

        assert.strictEqual(primero.creoEventSession, true);
        assert.strictEqual(segundo.creoEventSession, false);
        assert.strictEqual(segundo.motivo, "ciclo_duplicado");

        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1, "debe seguir existiendo una sola fila");

    });

    // ---------------------------------------------------------------
    // 21) permitir nuevo ciclo con el mismo evento_bot.id pero nueva
    //     identidad (el caso central de Fase 2A: eventos_bot.id se
    //     reutiliza entre sorteos distintos del mismo grupo).
    // ---------------------------------------------------------------
    await test("21) mismo eventos_bot.id, sorteo del día siguiente (nueva fecha_evento) -> se crea un SEGUNDO event_session", async () => {

        const { engine, fakeSupabase } = crearEntorno();

        prepararGrupoAutorizadoYConfig(fakeSupabase);

        const sorteoDeHoy = eventoDetectado({ id: "misma-fila-eventos-bot", fecha_evento: "2026-09-09" });

        const resultadoHoy = await engine.onEventoDetectado(sorteoDeHoy, { ahora: AHORA_MIERCOLES_10AM });

        assert.strictEqual(resultadoHoy.creoEventSession, true);

        // Mismo grupo, mismo evento.id (fila reutilizada por guardarEvento()
        // tal como confirma PHASE_2A_FINDINGS §4.11), pero es el sorteo del
        // día SIGUIENTE -> fecha_evento distinta -> identidad distinta.
        // Se evalúa "un día después" en horario válido (jueves, misma
        // config no cubre jueves -> se agrega jueves a la config para que
        // la única variable que cambie sea la identidad, no las reglas).
        fakeSupabase._filas("automation_configs")[0].dias_permitidos.jueves =
            { activo: true, desde: "08:00", hasta: "20:00" };

        const AHORA_JUEVES_10AM = new Date("2026-09-10T15:00:00.000Z"); // jueves 10:00 COT

        const sorteoDeManana = eventoDetectado({ id: "misma-fila-eventos-bot", fecha_evento: "2026-09-10" });

        const resultadoManana = await engine.onEventoDetectado(sorteoDeManana, { ahora: AHORA_JUEVES_10AM });

        assert.strictEqual(resultadoManana.creoEventSession, true, "el ciclo nuevo debe poder crearse aunque comparta evento.id con el de ayer");
        assert.notStrictEqual(resultadoManana.identidadCiclo, resultadoHoy.identidadCiclo);
        assert.strictEqual(resultadoManana.eventSession.evento_id, "misma-fila-eventos-bot");

        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 2, "deben existir DOS event_sessions distintos");

    });

    // =================================================================
    // CORRECCIÓN QUIRÚRGICA — eventSessionsRepo.crear() ante 23505
    // (auditoría Fase 2B, hallazgo E). Cubre exactamente los 5 puntos
    // pedidos en la consigna de esta corrección.
    // =================================================================

    // ---------------------------------------------------------------
    // 1-4) primera creación crea la fila; la carrera real entre dos
    // ejecuciones concurrentes para el MISMO ciclo dispara el 23505 real
    // de Postgres (vía el fake) en la segunda -> se traduce en
    // "ciclo_duplicado" (mismo contrato que ya usa evaluarApertura, ver
    // engine.js), NUNCA una excepción no controlada, y sigue existiendo
    // una sola fila.
    // ---------------------------------------------------------------
    await test("22) dos onEventoDetectado() CONCURRENTES para el mismo evento: una crea, la otra recibe 'ciclo_duplicado' sin excepción", async () => {

        const { engine, fakeSupabase } = crearEntorno();

        prepararGrupoAutorizadoYConfig(fakeSupabase);

        const evento = eventoDetectado();

        // Promise.all invoca ambas llamadas antes de que ninguna termine
        // (mismo patrón ya validado en executionGuard.test.js #6) — el
        // pre-chequeo de "ciclo existente" de AMBAS ve "no existe" antes de
        // que ninguna haya insertado; la protección real es la UNIQUE de
        // Postgres en el INSERT, no el pre-chequeo (ver engine.js).
        const [r1, r2] = await Promise.all([
            engine.onEventoDetectado(evento, { ahora: AHORA_MIERCOLES_10AM }),
            engine.onEventoDetectado(evento, { ahora: AHORA_MIERCOLES_10AM })
        ]);

        // Punto 3: ninguna de las dos promesas debe haber rechazado —
        // Promise.all ya lo garantiza (si una hubiera lanzado, este await
        // habría lanzado también y el test fallaría aquí mismo).

        const resultados2 = [r1, r2];

        const exitosas = resultados2.filter(r => r.creoEventSession === true);
        const duplicadas = resultados2.filter(r => r.creoEventSession === false);

        // Punto 1: una de las dos SÍ creó el event_session.
        assert.strictEqual(exitosas.length, 1, "exactamente una de las dos debe haber creado el event_session");
        assert.ok(exitosas[0].eventSession);

        // Punto 4: la otra debe reportar el mismo contrato que ya usa
        // evaluarApertura() para un ciclo duplicado — sin inventar una API
        // nueva.
        assert.strictEqual(duplicadas.length, 1, "la otra debe reportar ciclo_duplicado, no lanzar");
        assert.strictEqual(duplicadas[0].motivo, "ciclo_duplicado");
        assert.strictEqual(duplicadas[0].identidadCiclo, exitosas[0].identidadCiclo);

        // Punto 2: no se generó una segunda fila.
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1, "debe existir una sola fila, no dos");

    });

    await test("23) eventSessionsRepo.crear() lanza CicloDuplicadoError (no un Error genérico) ante la UNIQUE real", async () => {

        const { eventSessionsRepo, eventRules, fakeSupabase } = crearEntorno();

        const evento = eventoDetectado();
        const identidad = eventRules.crearIdentidadCiclo(evento);

        const datos = {
            identidadCiclo: identidad,
            grupoId: evento.grupo_id,
            usuarioId: evento.usuario_id,
            datosEventoSnapshot: { nombre_evento: evento.nombre_evento }
        };

        await eventSessionsRepo.crear(datos); // primera vez: OK

        let errorCapturado = null;

        try {

            await eventSessionsRepo.crear(datos); // segunda vez: misma (grupo_id, identidad_ciclo)

        } catch (err) {

            errorCapturado = err;

        }

        assert.ok(errorCapturado, "la segunda llamada debe lanzar");
        assert.ok(errorCapturado instanceof eventSessionsRepo.CicloDuplicadoError, "debe ser el error tipado, no un Error genérico");
        assert.strictEqual(errorCapturado.esCicloDuplicado, true);

        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1);

    });

    // ---------------------------------------------------------------
    // 5) otro error de Supabase (no 23505) sigue siendo un error real —
    // NUNCA se enmascara como ciclo_duplicado.
    // ---------------------------------------------------------------
    await test("24) un error de Supabase que NO es 23505 se relanza tal cual (no se confunde con ciclo_duplicado)", async () => {

        const { eventSessionsRepo, eventRules, fakeSupabase } = crearEntorno();

        const evento = eventoDetectado();
        const identidad = eventRules.crearIdentidadCiclo(evento);

        fakeSupabase._forzarErrorInsert("event_sessions", {
            code: "23503", // foreign key violation — código real distinto de 23505
            message: "insert or update on table \"event_sessions\" violates foreign key constraint"
        });

        let errorCapturado = null;

        try {

            await eventSessionsRepo.crear({
                identidadCiclo: identidad,
                grupoId: evento.grupo_id,
                usuarioId: evento.usuario_id,
                datosEventoSnapshot: { nombre_evento: evento.nombre_evento }
            });

        } catch (err) {

            errorCapturado = err;

        }

        assert.ok(errorCapturado, "debe lanzar");
        assert.strictEqual(errorCapturado instanceof eventSessionsRepo.CicloDuplicadoError, false, "NO debe ser tratado como ciclo_duplicado");
        assert.strictEqual(errorCapturado.code, "23503");

    });

    await test("25) un 23505 con texto NO reconocible como esta UNIQUE específica se relanza tal cual (no se asume ciclo_duplicado a ciegas)", async () => {

        const { eventSessionsRepo, eventRules, fakeSupabase } = crearEntorno();

        const evento = eventoDetectado();
        const identidad = eventRules.crearIdentidadCiclo(evento);

        // Mismo código 23505, pero un mensaje que NO corresponde a la
        // UNIQUE(grupo_id, identidad_ciclo) (p. ej. una futura constraint
        // distinta sobre la misma tabla) — la solución más segura es no
        // enmascararlo como "ciclo_duplicado".
        fakeSupabase._forzarErrorInsert("event_sessions", {
            code: "23505",
            message: 'duplicate key value violates unique constraint "event_sessions_pkey"',
            details: "Key (id)=(11111111-1111-1111-1111-111111111111) already exists."
        });

        let errorCapturado = null;

        try {

            await eventSessionsRepo.crear({
                identidadCiclo: identidad,
                grupoId: evento.grupo_id,
                usuarioId: evento.usuario_id,
                datosEventoSnapshot: { nombre_evento: evento.nombre_evento }
            });

        } catch (err) {

            errorCapturado = err;

        }

        assert.ok(errorCapturado, "debe lanzar");
        assert.strictEqual(errorCapturado instanceof eventSessionsRepo.CicloDuplicadoError, false, "un 23505 de OTRA constraint no debe tratarse como ciclo_duplicado");
        assert.strictEqual(errorCapturado.code, "23505");

    });

    // ---------------------------------------------------------------
    // Extra (criterio §17 de la consigna — "el bot debe funcionar
    // exactamente igual... ningún grupo debe abrirse/cerrarse por
    // Automation Engine"): confirmar que engine.onEventoDetectado() no
    // importa/usa nada de Baileys ni de bot/, en ningún punto de su cadena
    // de dependencias real.
    // ---------------------------------------------------------------
    await test("extra) las reglas/persistencia puras no requieren Baileys ni ningún módulo de bot/", () => {

        const fs = require("fs");
        const path = require("path");

        // engine.js queda FUERA de esta lista desde Fase 4A a propósito:
        // ahora exporta enviarMensajeApertura(), que reutiliza (no
        // duplica) services/baileys/send.js — ver
        // docs/EFAAT_AUTOMATION_PHASE_4A_IMPLEMENTATION.md. Las piezas de
        // decisión/persistencia pura siguen —y deben seguir— sin ninguna
        // referencia a Baileys/bot/envío de mensajes.
        const archivos = [
            "../../automation/eventRules.js",
            "../../automation/executionGuard.js",
            "../../automation/variableResolver.js",
            "../../automation/messageSelector.js",
            "../../automation/repo/eventSessions.js",
            "../../automation/repo/automationConfig.js",
            "../../automation/repo/messages.js"
        ];

        for (const rel of archivos) {

            const contenido = fs.readFileSync(path.join(__dirname, rel), "utf8");

            assert.ok(!contenido.includes("baileys"), `${rel} no debe mencionar baileys`);
            assert.ok(!contenido.includes("require(\"../bot/"), `${rel} no debe requerir nada de bot/`);
            assert.ok(!contenido.includes("require(\"../../bot/"), `${rel} no debe requerir nada de bot/`);
            assert.ok(!contenido.includes("sendMessage"), `${rel} no debe enviar mensajes de WhatsApp`);
            assert.ok(!contenido.includes("groupSettingUpdate"), `${rel} no debe abrir/cerrar grupos`);

        }

    });

    await test("extra2) engine.js SÍ reutiliza send.js (Fase 4A), pero NUNCA abre/cierra grupos ni requiere bot/", () => {

        const fs = require("fs");
        const path = require("path");

        const contenido = fs.readFileSync(path.join(__dirname, "../../automation/engine.js"), "utf8");

        // La apertura/cierre reales siguen siendo EXCLUSIVOS de
        // abrirGrupo()/cerrarGrupo() (bot/), nunca de Automation.
        assert.ok(!contenido.includes("groupSettingUpdate"), "engine.js no debe abrir/cerrar grupos directamente");
        assert.ok(!contenido.includes("require(\"../bot/"), "engine.js no debe requerir nada de bot/");
        assert.ok(!contenido.includes("require(\"../../bot/"), "engine.js no debe requerir nada de bot/");

        // Sí debe reutilizar (no duplicar) el envío real.
        assert.ok(contenido.includes("services/baileys/send"), "engine.js debe reutilizar services/baileys/send.js, no un sistema de envío nuevo");

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
