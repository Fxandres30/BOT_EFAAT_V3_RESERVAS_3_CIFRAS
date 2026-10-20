// ==========================================================================
// PRUEBAS — sorteo publicado de noche para el día siguiente.
//
// Un anuncio publicado a las 8:00 p. m. para las 10:00 a. m. queda con la
// fecha de mañana y el worker no cierra el grupo hoy. Los sorteos normales,
// las filas sin fecha y los cierres que cruzan la medianoche conservan el
// comportamiento de siempre.
//
//     node backend/tests/eventos/sorteoDiaSiguiente.test.js
// ==========================================================================

// La comparación por hora de siempre usa la zona del proceso: se fija la de
// Colombia para que las horas de estas pruebas sean deterministas.
process.env.TZ = "America/Bogota";

const assert = require("assert");
const path = require("path");

const R = (p) => path.join(__dirname, "..", "..", p);
const { fechaSorteoAnunciado, fechaEventoHoy } = require(R("bot/funciones/eventos/identidadEventoReal"));
const { verificarHoraCierre } = require(R("bot/funciones/eventos/lifecycle/verificarHoraCierre"));

// Hora de Colombia (UTC-5, sin horario de verano).
const co = (fechaHora) => new Date(`${fechaHora}:00-05:00`);

let pasadas = 0;
async function prueba(nombre, fn) {
    await fn();
    pasadas++;
    console.log(`  ✔ ${nombre}`);
}

(async () => {

    console.log("Fecha del sorteo al detectar el anuncio");

    await prueba("8:00 p. m. → sorteo de las 10:00 a. m. es de mañana", () => {
        assert.strictEqual(fechaSorteoAnunciado("10:00", "09:56", co("2026-10-20T20:00")), "2026-10-21");
    });

    await prueba("usa la hora de Colombia, no la UTC (21:30 CO = 02:30 UTC del día siguiente)", () => {
        assert.strictEqual(fechaSorteoAnunciado("10:00", "09:56", new Date("2026-10-21T02:30:00Z")), "2026-10-21");
        assert.strictEqual(fechaSorteoAnunciado("22:30", "22:26", new Date("2026-10-21T02:30:00Z")), "2026-10-20", "22:30 aún no pasa: hoy en Colombia (20/10), aunque en UTC ya sea 21/10");
    });

    await prueba("regla desde las 6:00 p. m.: 5:59 p. m. queda hoy, 6:00 p. m. pasa a mañana", () => {
        assert.strictEqual(fechaSorteoAnunciado("10:00", "09:56", co("2026-10-20T17:59")), "2026-10-20");
        assert.strictEqual(fechaSorteoAnunciado("10:00", "09:56", co("2026-10-20T18:00")), "2026-10-21");
    });

    await prueba("sorteo normal de las 10:30 p. m. publicado a las 8:00 p. m.: hoy", () => {
        assert.strictEqual(fechaSorteoAnunciado("22:30", "22:26", co("2026-10-20T20:00")), "2026-10-20");
    });

    await prueba("sorteos consecutivos 10:30 p. m. y 11:00 p. m. publicados a las 10:00 p. m.: ambos hoy", () => {
        assert.strictEqual(fechaSorteoAnunciado("22:30", "22:26", co("2026-10-20T22:00")), "2026-10-20");
        assert.strictEqual(fechaSorteoAnunciado("23:00", "22:56", co("2026-10-20T22:00")), "2026-10-20");
    });

    await prueba("12:30 a. m. publicado a las 11:00 p. m.: mañana", () => {
        assert.strictEqual(fechaSorteoAnunciado("00:30", "00:26", co("2026-10-20T23:00")), "2026-10-21");
    });

    await prueba("cierre antes de medianoche (00:02 → 23:58): se conserva hoy", () => {
        assert.strictEqual(fechaSorteoAnunciado("00:02", "23:58", co("2026-10-20T23:59")), "2026-10-20");
    });

    await prueba("fin de mes y datos sin hora: mañana correcto / hoy", () => {
        assert.strictEqual(fechaSorteoAnunciado("10:00", "09:56", co("2026-10-31T20:00")), "2026-11-01");
        assert.strictEqual(fechaSorteoAnunciado(null, null, co("2026-10-20T20:00")), "2026-10-20");
    });

    console.log("Cierre por hora");

    const deManana = { fecha_evento: "2026-10-21", hora_cierre: "09:56" };

    await prueba("sorteo de mañana: no cierra hoy (20:00:30, 23:59) ni mañana antes de las 09:56", () => {
        assert.strictEqual(verificarHoraCierre(deManana, co("2026-10-20T20:00")), false);
        assert.strictEqual(verificarHoraCierre(deManana, co("2026-10-20T23:59")), false);
        assert.strictEqual(verificarHoraCierre(deManana, co("2026-10-21T09:55")), false);
    });

    await prueba("sorteo de mañana: cierra a las 09:56 de mañana", () => {
        assert.strictEqual(verificarHoraCierre(deManana, co("2026-10-21T09:56")), true);
    });

    await prueba("sorteo normal de hoy: igual que antes (22:25 abierto, 22:26 cierra)", () => {
        const hoy = { fecha_evento: "2026-10-20", hora_cierre: "22:26" };
        assert.strictEqual(verificarHoraCierre(hoy, co("2026-10-20T22:25")), false);
        assert.strictEqual(verificarHoraCierre(hoy, co("2026-10-20T22:26")), true);
    });

    await prueba("sin fecha_evento y filas de días anteriores: comparación por hora de siempre", () => {
        assert.strictEqual(verificarHoraCierre({ hora_cierre: "09:56" }, co("2026-10-20T20:00")), true);
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-10-19", hora_cierre: "22:26" }, co("2026-10-20T08:00")), false);
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-10-19", hora_cierre: "22:26" }, co("2026-10-20T22:30")), true);
    });

    await prueba("fecha con formato de marca de tiempo también se reconoce", () => {
        assert.strictEqual(verificarHoraCierre({ fecha_evento: "2026-10-21T00:00:00", hora_cierre: "09:56" }, co("2026-10-20T20:00")), false);
    });

    console.log("Worker (procesarSorteo con el reloj real)");

    // Dobles mínimos: lectura de la tabla, contadores y cierre del grupo.
    const cierres = [];
    const stub = (rel, exportsObj) => {
        const ruta = require.resolve(R(rel));
        require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
    };
    stub("lib/supabase.js", {});
    stub("bot/funciones/eventos/sorteoReal.js", { estadoDelSorteo: async () => ({ ok: true, completo: false }), claveSorteo: (e) => e.id });
    stub("bot/funciones/reservas/actualizarEvento.js", { sincronizarContadores: async () => {} });
    stub("bot/funciones/eventos/lifecycle/cerrarEvento.js", {
        cerrarFilaDeEvento: async ({ fila, motivo }) => { cierres.push({ id: fila.id, motivo }); return true; },
        esperaAntesDeReintentar: () => 0
    });
    const { procesarSorteo } = require(R("bot/funciones/eventos/lifecycle/procesarSorteo"));

    const hoyReal = fechaEventoHoy();
    const [a, m, d] = hoyReal.split("-").map(Number);
    const mananaReal = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);

    await prueba("fila de mañana con cierre ya «pasado» en hora del día: el worker no cierra el grupo", async () => {
        const r = await procesarSorteo({ sock: {}, filas: [{ id: "MAN", activo: true, grupo_id: "g@g.us", fecha_evento: mananaReal, hora_cierre: "00:00" }] });
        assert.strictEqual(r.accion, "continuar");
        assert.deepStrictEqual(cierres, []);
    });

    await prueba("la misma fila con fecha de hoy: el worker cierra por hora (como siempre)", async () => {
        const r = await procesarSorteo({ sock: {}, filas: [{ id: "HOY", activo: true, grupo_id: "g@g.us", fecha_evento: hoyReal, hora_cierre: "00:00" }] });
        assert.strictEqual(r.accion, "cerrar");
        assert.strictEqual(r.motivo, "hora");
        assert.deepStrictEqual(cierres.map(c => c.id), ["HOY"]);
    });

    console.log(`\n${pasadas} pruebas OK`);

})().catch((e) => {
    console.error(`❌ ${e.stack || e}`);
    process.exit(1);
});
