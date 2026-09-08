// ==========================================================================
// PRUEBAS DE INTEGRACIÓN — Fase 3: detectarEvento.js <-> Automation Engine.
//
// Ejercitan el código REAL (detectarEvento, extraerEvento, guardarEvento,
// consultarEvento, abrirGrupo, groupQueue, automation/*) — ninguno
// duplicado ni mockeado en su lógica interna. Solo se sustituyen sus
// bordes externos: Supabase (fake, ver tests/automation/fakeSupabaseAutomation.js)
// y el socket de Baileys (fake, ver ./entornoFake.js) — nunca WhatsApp
// real, nunca red real, nunca Supabase real.
//
//     node backend/tests/deteccion/deteccionAutomation.test.js
// ==========================================================================

const assert = require("assert");
const { crearEntorno } = require("./entornoFake");
const eventRules = require("../../automation/eventRules");

const GRUPO_ID = "573000000000-1111@g.us";

// Mensaje realista: mismo formato que ya reconoce buscarLineaEvento()/
// extraerNombreEvento()/extraerHoraEvento()/extraerValorNumero()/
// extraerPremios() SIN NINGÚN CAMBIO — "Sinuano Dia" está en LOTERIAS
// (extractor/loterias.js), "2:30 PM" -> hora_fin "14:30", "$1.500" ->
// valor 1500 (mapea a config "reservas_dos_cifras" en configEvento.js).
const MENSAJE_VALIDO = [
    "🎰 SINUANO DIA 2:30 PM 🎰",
    "🍀 Dos últimas cifras → $60.000",
    "🍀 Dos primeras cifras → $20.000",
    "Valor número $1.500"
].join("\n");

function ctx({ sock, textoOriginal = MENSAJE_VALIDO, grupoId = GRUPO_ID }) {

    return {
        sock,
        grupo: { remoteJid: grupoId },
        chat: { remoteJid: grupoId, esGrupo: true },
        textoOriginal
    };

}

// Día/hora REALES del sistema en el momento de correr las pruebas — así
// las pruebas de día/horario son correctas sin importar cuándo se
// ejecuten (detectarEvento.js no acepta un reloj inyectado; ver
// docs/EFAAT_AUTOMATION_PHASE_3_IMPLEMENTATION.md).
const HOY = eventRules.obtenerClaveDia(new Date());
const OTRO_DIA = HOY === "lunes" ? "martes" : "lunes";

function configPermisivaHoy(extra = {}) {
    return {
        activo: true,
        dias_permitidos: { [HOY]: { activo: true, desde: "00:00", hasta: "23:59" } },
        ...extra
    };
}

function configDiaNoPermitido() {
    // Activa, pero el único día configurado NO es hoy.
    return { activo: true, dias_permitidos: { [OTRO_DIA]: { activo: true, desde: "00:00", hasta: "23:59" } } };
}

function configFueraDeHorario() {
    // Ventana imposible ("desde" > "hasta" lexicográficamente): nunca
    // satisfecha salvo exactamente a las 23:59:00, sin importar la hora
    // real de ejecución — determinístico, sin flakiness.
    return { activo: true, dias_permitidos: { [HOY]: { activo: true, desde: "23:59", hasta: "00:00" } } };
}

function autorizar(fakeSupabase, { usuarioId, grupoId = GRUPO_ID, config = configPermisivaHoy() }) {

    fakeSupabase._agregar("grupos_autorizados", { usuario_id: usuarioId, grupo_id: grupoId, activo: true });
    fakeSupabase._agregar("automation_configs", { usuario_id: usuarioId, grupo_id: grupoId, ...config });

}

// Corrección fail-closed: simula que las tablas de la migración 006
// (automation_configs/grupos_autorizados/event_sessions) todavía no
// existen en Supabase (el caso real más probable, ya que 006 no se ha
// ejecutado) — cualquier consulta a `nombreTabla` rechaza con un error
// realista (mismo shape {data, error} que PostgREST), en vez de que el
// fake responda normalmente. `eventos_bot` (y cualquier otra tabla no
// listada) sigue funcionando sin cambios, para poder comprobar que
// guardarEvento()/consultarEvento() (reales) no se ven afectados.
function romperTablaAutomation(fakeSupabase, nombreTabla) {

    const original = fakeSupabase.client.from.bind(fakeSupabase.client);

    const respuestaRota = () => Promise.resolve({
        data: null,
        error: { code: "42P01", message: `relation "public.${nombreTabla}" does not exist (simulado)` }
    });

    const queryRota = new Proxy({}, {
        get(_target, prop) {

            if (prop === "then") {
                const p = respuestaRota();
                return p.then.bind(p);
            }

            if (prop === "single" || prop === "maybeSingle") {
                return respuestaRota;
            }

            // Cualquier otro método encadenable (select/eq/in/insert/
            // update/order/limit/lt) devuelve la misma query rota.
            return () => queryRota;

        }
    });

    fakeSupabase.client.from = (tabla) => (tabla === nombreTabla ? queryRota : original(tabla));

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

    // ---------------------------------------------------------------
    // 1) evento válido + grupo autorizado + horario permitido -> abre
    // ---------------------------------------------------------------
    await test("1) evento válido + autorizado + horario permitido -> llama a abrirGrupo() (mecanismo existente)", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-1";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });

        const resultado = await detectarEvento(ctx({ sock }));

        assert.ok(resultado, "detectarEvento debe seguir devolviendo el evento guardado");
        assert.strictEqual(llamadas.groupSettingUpdate.length, 1, "abrirGrupo() (groupSettingUpdate real) debe haberse llamado exactamente una vez");
        assert.strictEqual(llamadas.groupSettingUpdate[0].ajuste, "not_announcement", "debe ser el ajuste real que usa abrirGrupo.js — confirma que es el mecanismo existente, no uno nuevo (caso 12)");
        assert.strictEqual(llamadas.groupSettingUpdate[0].jid, GRUPO_ID);

    });

    // ---------------------------------------------------------------
    // 2) grupo no autorizado -> NO abre
    // ---------------------------------------------------------------
    await test("2) grupo no autorizado -> NO llama a abrirGrupo(), evento igual queda guardado", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const { sock, llamadas } = crearFakeSock({ usuarioId: "usuario-2" });
        // Sin sembrar grupos_autorizados ni automation_configs.

        const resultado = await detectarEvento(ctx({ sock }));

        assert.ok(resultado, "el evento se sigue devolviendo/guardando aunque Automation rechace");
        assert.strictEqual(llamadas.groupSettingUpdate.length, 0, "no debe llamarse a abrirGrupo()");
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 0);
        assert.strictEqual(fakeSupabase._filas("eventos_bot").length, 1, "el evento (10) sigue guardado en eventos_bot");

    });

    // ---------------------------------------------------------------
    // 3) configuración inactiva -> NO abre
    // ---------------------------------------------------------------
    await test("3) configuración inactiva (interruptor apagado) -> NO llama a abrirGrupo()", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-3";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId, config: configPermisivaHoy({ activo: false }) });

        await detectarEvento(ctx({ sock }));

        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 0);

    });

    // ---------------------------------------------------------------
    // 4) día no permitido -> NO abre
    // ---------------------------------------------------------------
    await test("4) día no permitido (hoy no está en la configuración) -> NO llama a abrirGrupo()", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-4";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId, config: configDiaNoPermitido() });

        await detectarEvento(ctx({ sock }));

        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);

    });

    // ---------------------------------------------------------------
    // 5) fuera de horario -> NO abre
    // ---------------------------------------------------------------
    await test("5) fuera del horario permitido hoy -> NO llama a abrirGrupo()", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-5";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId, config: configFueraDeHorario() });

        await detectarEvento(ctx({ sock }));

        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);

    });

    // ---------------------------------------------------------------
    // 6) evento inválido -> NO abre
    // ---------------------------------------------------------------
    // No es posible provocar esto a través del pipeline completo de
    // detectarEvento(): extraerEvento()/guardarEvento() (sin cambios)
    // garantizan que eventoGuardado siempre tiene nombre_evento/hora_fin/
    // valor antes de que Automation lo reciba — por diseño (ver Fase 2A/
    // Master Spec §13). Este caso ya está cubierto a nivel de reglas en
    // tests/automation/eventRules.test.js (#15/#15b) y se repite aquí solo
    // para confirmar que el mismo punto de integración que usa
    // detectarEvento.js (automationEngine.onEventoDetectado) se comporta
    // igual ante un evento inválido, con grupo/configuración ya en regla.
    await test("6) evento inválido (llegado directo al engine, mismo punto que usa detectarEvento.js) -> rechazado", async () => {

        const { engine, fakeSupabase } = crearEntorno();

        const usuarioId = "usuario-6";
        autorizar(fakeSupabase, { usuarioId });

        const decision = await engine.onEventoDetectado({
            usuario_id: usuarioId,
            grupo_id: GRUPO_ID,
            nombre_evento: null, // inválido a propósito
            hora_fin: "20:00",
            valor: 1500,
            fecha_evento: "2026-01-01"
        });

        assert.strictEqual(decision.creoEventSession, false);
        assert.strictEqual(decision.motivo, "evento_invalido");

    });

    // ---------------------------------------------------------------
    // 7) ciclo duplicado -> NO abre nuevamente
    // ---------------------------------------------------------------
    await test("7) el mismo mensaje detectado dos veces -> abrirGrupo() se llama solo la primera vez", async () => {

        const { detectarEvento, crearFakeSock, fakeSupabase } = crearEntorno();

        const usuarioId = "usuario-7";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });

        await detectarEvento(ctx({ sock }));
        await detectarEvento(ctx({ sock })); // mismo texto, mismo grupo, mismo sock

        assert.strictEqual(llamadas.groupSettingUpdate.length, 1, "la segunda detección del mismo ciclo NO debe volver a abrir");
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1);

    });

    // ---------------------------------------------------------------
    // 8) dos detecciones concurrentes -> solo una apertura
    // ---------------------------------------------------------------
    await test("8) dos detectarEvento() CONCURRENTES del mismo mensaje -> solo una apertura real", async () => {

        const { detectarEvento, crearFakeSock, fakeSupabase } = crearEntorno();

        const usuarioId = "usuario-8";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });

        await Promise.all([
            detectarEvento(ctx({ sock })),
            detectarEvento(ctx({ sock }))
        ]);

        assert.strictEqual(llamadas.groupSettingUpdate.length, 1, "de dos detecciones concurrentes del mismo ciclo, exactamente una debe abrir");
        assert.strictEqual(fakeSupabase._filas("event_sessions").length, 1, "debe existir un solo event_session para ese ciclo");

    });

    // ---------------------------------------------------------------
    // 9) restart/repetición del mismo evento -> no segunda apertura
    // ---------------------------------------------------------------
    await test("9) reinicio del proceso (módulos recargados, misma base persistida) -> no vuelve a abrir el mismo ciclo", async () => {

        const usuarioId = "usuario-9";

        const primero = crearEntorno();
        const { sock: sockAntes, llamadas: llamadasAntes } = primero.crearFakeSock({ usuarioId });

        autorizar(primero.fakeSupabase, { usuarioId });

        await primero.detectarEvento(ctx({ sock: sockAntes }));

        assert.strictEqual(llamadasAntes.groupSettingUpdate.length, 1, "precondición: la primera vez sí abrió");

        // "Reinicio": módulos recargados desde cero (equivalente a un
        // proceso Node nuevo, pierde CUALQUIER estado en memoria), pero la
        // misma base de datos fake (equivalente a lo ya persistido en
        // Supabase real) se conserva.
        const despues = crearEntorno({ fakeSupabaseExistente: primero.fakeSupabase });
        const { sock: sockDespues, llamadas: llamadasDespues } = despues.crearFakeSock({ usuarioId });

        await despues.detectarEvento(ctx({ sock: sockDespues }));

        assert.strictEqual(llamadasDespues.groupSettingUpdate.length, 0, "tras el 'reinicio', el mismo ciclo ya persistido NO debe volver a abrirse");
        assert.strictEqual(despues.fakeSupabase._filas("event_sessions").length, 1, "sigue existiendo un único event_session para ese ciclo");

    });

    // ---------------------------------------------------------------
    // 10) Automation rechaza -> evento sigue guardado en eventos_bot
    // ---------------------------------------------------------------
    await test("10) cuando Automation rechaza, el evento permanece intacto en eventos_bot (activo/abierto como lo dejó guardarEvento)", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const { sock } = crearFakeSock({ usuarioId: "usuario-10" });
        // Sin autorizar -> Automation rechaza (grupo_no_autorizado).

        await detectarEvento(ctx({ sock }));

        const filas = fakeSupabase._filas("eventos_bot");

        assert.strictEqual(filas.length, 1);
        assert.strictEqual(filas[0].nombre_evento, "Sinuano Dia");
        assert.strictEqual(filas[0].activo, true, "guardarEvento() sin cambios sigue dejando activo=true — Automation no lo toca");
        assert.strictEqual(filas[0].estado, "abierto", "el campo estado (texto de guardarEvento) tampoco se toca");

    });

    // ---------------------------------------------------------------
    // 11) Automation permite -> event_session queda creado
    // ---------------------------------------------------------------
    await test("11) cuando Automation permite, el event_session queda creado con los datos del ciclo", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-11";
        const { sock } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });

        await detectarEvento(ctx({ sock }));

        const sesiones = fakeSupabase._filas("event_sessions");

        assert.strictEqual(sesiones.length, 1);
        assert.strictEqual(sesiones[0].grupo_id, GRUPO_ID);
        assert.strictEqual(sesiones[0].usuario_id, usuarioId);
        assert.strictEqual(sesiones[0].estado, "pendiente");
        assert.ok(sesiones[0].identidad_ciclo);
        assert.strictEqual(sesiones[0].datos_evento_snapshot.nombre_evento, "Sinuano Dia");
        assert.strictEqual(sesiones[0].datos_evento_snapshot.valor, 1500);

    });

    // ---------------------------------------------------------------
    // 12) abrirGrupo() existente sigue siendo el mecanismo utilizado
    // ---------------------------------------------------------------
    await test("12) la apertura pasa por el guardarEvento()/groupQueue reales (groupMetadata + groupSettingUpdate reales, no un mecanismo nuevo)", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-12";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });

        await detectarEvento(ctx({ sock }));

        // groupMetadata: llamado por guardarEvento.js (sin cambios) para
        // completar grupo_nombre/participantes — confirma que ese código
        // existente siguió corriendo tal cual.
        assert.ok(llamadas.groupMetadata > 0, "guardarEvento() real debe haber consultado groupMetadata (sin cambios)");

        // groupSettingUpdate: llamado por abrirGrupo.js (sin cambios) — el
        // ÚNICO ajuste real que usa ese archivo es "not_announcement".
        assert.strictEqual(llamadas.groupSettingUpdate.length, 1);
        assert.strictEqual(llamadas.groupSettingUpdate[0].ajuste, "not_announcement");

    });

    // =================================================================
    // CORRECCIÓN FAIL-CLOSED — una excepción del Automation Engine NUNCA
    // autoriza la apertura (antes: fallback que sí abría; ahora: no).
    // =================================================================

    // ---------------------------------------------------------------
    // 13) excepción del Automation Engine -> NO abre
    // ---------------------------------------------------------------
    await test("13) el Automation Engine lanza una excepción (p. ej. tabla de 006 inexistente) -> NO se llama a abrirGrupo()", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-13";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        // Ni siquiera autorizado de más: aunque grupo/config estuvieran en
        // regla, la excepción debe bloquear la apertura de todas formas.
        autorizar(fakeSupabase, { usuarioId });

        romperTablaAutomation(fakeSupabase, "grupos_autorizados");

        const resultado = await detectarEvento(ctx({ sock }));

        assert.ok(resultado, "detectarEvento no debe lanzar ni devolver null solo porque Automation falló");
        assert.strictEqual(llamadas.groupSettingUpdate.length, 0, "fail-closed: una excepción de Automation NUNCA debe terminar en abrirGrupo()");

    });

    // ---------------------------------------------------------------
    // 14) el evento queda guardado en eventos_bot aunque Automation falle
    // ---------------------------------------------------------------
    await test("14) aunque el Automation Engine falle con excepción, el evento queda guardado igual en eventos_bot", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-14";
        const { sock } = crearFakeSock({ usuarioId });

        autorizar(fakeSupabase, { usuarioId });
        romperTablaAutomation(fakeSupabase, "grupos_autorizados");

        const resultado = await detectarEvento(ctx({ sock }));

        const filas = fakeSupabase._filas("eventos_bot");

        assert.strictEqual(filas.length, 1, "guardarEvento() real no se ve afectado por el fallo de Automation");
        assert.strictEqual(filas[0].nombre_evento, "Sinuano Dia");
        assert.strictEqual(resultado.id, filas[0].id, "detectarEvento() sigue devolviendo el evento guardado, no null");

    });

    // ---------------------------------------------------------------
    // 15) ningún camino de error termina llamando abrirGrupo() — se repite
    // la excepción con OTRA tabla rota (automation_configs en vez de
    // grupos_autorizados) para confirmar que no es una casualidad de un
    // solo punto de fallo específico.
    // ---------------------------------------------------------------
    await test("15) excepción en un punto distinto del Automation Engine (automation_configs) -> tampoco abre", async () => {

        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();

        const usuarioId = "usuario-15";
        const { sock, llamadas } = crearFakeSock({ usuarioId });

        fakeSupabase._agregar("grupos_autorizados", { usuario_id: usuarioId, grupo_id: GRUPO_ID, activo: true });
        // automation_configs se rompe en vez de grupos_autorizados.
        romperTablaAutomation(fakeSupabase, "automation_configs");

        await detectarEvento(ctx({ sock }));

        assert.strictEqual(llamadas.groupSettingUpdate.length, 0, "ningún camino de error del Automation Engine debe terminar en abrirGrupo()");

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
