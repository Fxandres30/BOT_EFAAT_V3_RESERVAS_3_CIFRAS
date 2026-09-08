// ==========================================================================
// PRUEBAS — evaluarApertura() (backend/automation/eventRules.js).
//
// Función pura: sin Supabase. Todos los datos que en producción vendrían
// de repo/automationConfig.js y repo/eventSessions.js se pasan aquí ya
// resueltos, tal como los recibiría la función real desde engine.js.
//
//     node backend/tests/automation/eventRules.test.js
// ==========================================================================

const assert = require("assert");
const { evaluarApertura, evaluarPublicacionInicialTabla } = require("../../automation/eventRules");

// Miércoles 2026-09-09, 10:00 America/Bogota (usado como "ahora" fijo en
// la mayoría de los casos, salvo los que prueban específicamente día/hora).
const AHORA_MIERCOLES_10AM = new Date("2026-09-09T15:00:00.000Z"); // 10:00 COT (UTC-5)

function eventoValido(overrides = {}) {
    return {
        nombre_evento: "SORTEO DE LA TARDE",
        hora_fin: "20:00",
        valor: 5000,
        grupo_id: "573000000000-1111@g.us",
        fecha_evento: "2026-09-09",
        ...overrides
    };
}

function configuracionActiva(overrides = {}) {
    return {
        id: "config-uuid",
        activo: true,
        dias_permitidos: {
            miercoles: { activo: true, desde: "08:00", hasta: "20:00" }
        },
        ...overrides
    };
}

const resultados = [];

function test(nombre, fn) {

    try {

        fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

}

// ---------------------------------------------------------------
// 11) grupo no autorizado
// ---------------------------------------------------------------
test("11) grupo no autorizado -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva(),
        grupoAutorizado: false,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "grupo_no_autorizado");

});

// ---------------------------------------------------------------
// 12) configuración inactiva
// ---------------------------------------------------------------
test("12) configuración inactiva (interruptor apagado) -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva({ activo: false }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "configuracion_inactiva");

});

test("12b) sin ninguna fila de configuración (null) -> mismo motivo que inactiva", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: null,
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "configuracion_inactiva");

});

// ---------------------------------------------------------------
// 13) día no permitido
// ---------------------------------------------------------------
test("13) día no permitido (miércoles desactivado en la config) -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva({
            dias_permitidos: { miercoles: { activo: false } }
        }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "dia_no_permitido");

});

test("13b) día sin ninguna entrada en dias_permitidos -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva({ dias_permitidos: {} }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "dia_no_permitido");

});

// ---------------------------------------------------------------
// 14) horario no permitido
// ---------------------------------------------------------------
test("14) fuera del horario permitido ese día -> rechazado", () => {

    const AHORA_MIERCOLES_6AM = new Date("2026-09-09T11:00:00.000Z"); // 06:00 COT

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva({
            dias_permitidos: { miercoles: { activo: true, desde: "08:00", hasta: "20:00" } }
        }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_6AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "horario_no_permitido");

});

// ---------------------------------------------------------------
// 15) evento inválido
// ---------------------------------------------------------------
test("15) evento sin nombre_evento -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido({ nombre_evento: null }),
        configuracion: configuracionActiva(),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "evento_invalido");

});

test("15b) evento sin valor -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido({ valor: null }),
        configuracion: configuracionActiva(),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "evento_invalido");

});

// ---------------------------------------------------------------
// 16) ciclo duplicado
// ---------------------------------------------------------------
test("16) ya existe un event_session para esta identidad de ciclo -> rechazado", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva(),
        grupoAutorizado: true,
        eventSessionExistente: { id: "ya-existe", estado: "abierto" },
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "ciclo_duplicado");

});

test("16b) ya existe (aunque esté cerrado) -> igual rechazado, misma identidad no se reabre", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva(),
        grupoAutorizado: true,
        eventSessionExistente: { id: "ya-existe", estado: "cerrado" },
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "ciclo_duplicado");

});

// ---------------------------------------------------------------
// 17) todos correctos -> permitido
// ---------------------------------------------------------------
test("17) grupo autorizado + config activa + día y horario permitidos + evento válido + ciclo nuevo -> permitido", () => {

    const r = evaluarApertura({
        evento: eventoValido(),
        configuracion: configuracionActiva(),
        grupoAutorizado: true,
        eventSessionExistente: null,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, true);
    assert.strictEqual(r.motivo, null);

});

// ==================================================================
// evaluarPublicacionInicialTabla() — Fase 5 (INITIAL_TABLE)
// ==================================================================

function configuracionPublicacion(pubOverrides = {}, extra = {}) {
    return {
        activo: true,
        publicacion_inicial_tabla: {
            activo: true,
            hora: "07:00",
            dias_permitidos: { miercoles: true },
            ...pubOverrides
        },
        ...extra
    };
}

test("18) evaluarPublicacionInicialTabla: grupo no autorizado -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion(),
        grupoAutorizado: false,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "grupo_no_autorizado");

});

test("19) evaluarPublicacionInicialTabla: automatización inactiva (interruptor maestro) -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({}, { activo: false }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "configuracion_inactiva");

});

test("19b) evaluarPublicacionInicialTabla: sin configuración (null) -> mismo motivo que inactiva", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: null,
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "configuracion_inactiva");

});

test("20) evaluarPublicacionInicialTabla: la acción está desactivada aunque el interruptor maestro esté activo -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ activo: false }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "publicacion_inactiva");

});

test("20b) evaluarPublicacionInicialTabla: sin publicacion_inicial_tabla en la config -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: { activo: true },
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "publicacion_inactiva");

});

test("21) evaluarPublicacionInicialTabla: día no permitido para esta acción -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ dias_permitidos: { miercoles: false } }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "dia_no_permitido");

});

test("21b) evaluarPublicacionInicialTabla: dias_permitidos de Apertura (columna histórica) nunca se reutiliza aquí", () => {

    // La config trae dias_permitidos de Apertura con miércoles activo,
    // pero publicacion_inicial_tabla.dias_permitidos no trae ninguna
    // entrada -> debe rechazar igual, sin mirar la otra columna.
    const r = evaluarPublicacionInicialTabla({
        configuracion: {
            activo: true,
            dias_permitidos: { miercoles: { activo: true, desde: "00:00", hasta: "23:59" } },
            publicacion_inicial_tabla: { activo: true, hora: "07:00", dias_permitidos: {} }
        },
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "dia_no_permitido");

});

test("22) evaluarPublicacionInicialTabla: todavía no es la hora configurada -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ hora: "12:00" }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM // 10:00 < 12:00

    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "todavia_no_es_la_hora");

});

test("22b) evaluarPublicacionInicialTabla: hora sin configurar -> rechazado", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ hora: null }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM
    });

    assert.strictEqual(r.permitido, false);
    assert.strictEqual(r.motivo, "hora_no_configurada");

});

test("23) evaluarPublicacionInicialTabla: la hora ya se cumplió exactamente -> permitido", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ hora: "10:00" }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM // 10:00
    });

    assert.strictEqual(r.permitido, true);
    assert.strictEqual(r.motivo, null);

});

test("24) evaluarPublicacionInicialTabla: la hora ya pasó hace rato (detección tardía del evento) -> sigue permitido", () => {

    const r = evaluarPublicacionInicialTabla({
        configuracion: configuracionPublicacion({ hora: "07:00" }),
        grupoAutorizado: true,
        ahora: AHORA_MIERCOLES_10AM // 10:00, muy después de las 07:00
    });

    assert.strictEqual(r.permitido, true);
    assert.strictEqual(r.motivo, null);

});

const total = resultados.length;
const pasa = resultados.filter(r => r.ok).length;

console.log("");
console.log("============================");
console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
console.log("============================");

if (pasa !== total) {
    process.exitCode = 1;
}
