// ==========================================================================
// CARACTERIZACIÓN C3: cómo se interpreta HOY el estado de una fila de
// eventos_bot (shared/eventos/estadosGestion.js).
//
// El estado del evento está repartido en activo, abierto, estado,
// cierre_estado y cierre_motivo, este último con prefijos de texto ("panel:",
// "sustituido", "recuperado:"). F2 del plan creará un lector único: esta
// tabla es el contrato que ese lector debe respetar fila por fila.
//
// Pura: sin Supabase, sin red, sin WhatsApp.
//     node backend/tests/caracterizacion/estadoEvento.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, riesgo, ejecutar } = require("./_prueba");

const g = require(path.resolve(__dirname, "../../shared/eventos/estadosGestion.js"));

// [caso, fila, motivoGestion, cierreSilencioso, sinDeuda, finDelEvento]
const TABLA = [
    ["vigente", { activo: true, estado: "abierto" }, null, false, false, null],
    ["cerrado por hora (aviso de cierre normal)", { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora_cierre" }, null, false, false, "cerrado"],
    ["cierre recuperado (sin aviso tardío)", { activo: false, estado: "cerrado", cierre_motivo: "recuperado: hora pasó" }, null, true, false, "cerrado"],
    ["desactivado en `estado`", { activo: false, estado: "desactivado" }, "desactivado", true, false, "desactivado"],
    ["cancelado en `estado`", { activo: false, estado: "cancelado" }, "cancelado", true, true, "cancelado"],
    ["eliminado en `estado`", { activo: false, estado: "eliminado" }, "eliminado", true, true, "eliminado"],
    ["cancelado solo por motivo 'panel:'", { activo: false, estado: "cerrado", cierre_motivo: "panel:cancelado por el administrador" }, "cancelado", true, true, "cancelado"],
    ["desactivado solo por motivo 'panel:'", { activo: false, estado: "cerrado", cierre_motivo: "panel:desactivado" }, "desactivado", true, false, "desactivado"],
    ["sustituido por otro sorteo", { activo: false, estado: "cerrado", cierre_motivo: "sustituido por el sorteo X" }, "sustituido", true, false, "sustituido"],
    ["motivo 'panel:' desconocido = cierre normal", { activo: false, estado: "cerrado", cierre_motivo: "panel:otra" }, null, false, false, "cerrado"],
    ["activo=true con cierre_estado='cerrado' (reactivado por un reintento)", { activo: true, estado: "abierto", cierre_estado: "cerrado" }, null, false, false, "cerrado"],
    ["activo=true con estado='cerrado'", { activo: true, estado: "cerrado" }, null, false, false, "cerrado"],
    ["cierre fallido, sigue activo", { activo: true, estado: "abierto", cierre_estado: "fallido" }, null, false, false, null]
];

for (const [caso, fila, motivo, silencioso, sinDeuda, fin] of TABLA) {
    prueba(`estado «${caso}» → motivo=${motivo} · silencioso=${silencioso} · sinDeuda=${sinDeuda} · fin=${fin}`, () => {
        assert.strictEqual(g.motivoGestion(fila), motivo, "motivoGestion");
        assert.strictEqual(g.cierreSilencioso(fila), silencioso, "cierreSilencioso");
        assert.strictEqual(g.sinDeuda(fila), sinDeuda, "sinDeuda");
        assert.strictEqual(g.finDelEvento(fila), fin, "finDelEvento");
        assert.strictEqual(g.eliminado(fila), motivo === "eliminado", "eliminado");
    });
}

prueba("fila nula: sin motivo y sin fin", () => {
    assert.strictEqual(g.motivoGestion(null), null);
    assert.strictEqual(g.finDelEvento(null), null);
});

prueba("los estados de gestión son exactamente desactivado, cancelado y eliminado", () => {
    assert.deepStrictEqual([...g.ESTADOS_GESTION], ["desactivado", "cancelado", "eliminado"]);
});

prueba("contradicción documentada: una fila con activo=true puede estar «terminada»", () => {
    // Quien filtra solo por activo=true (consultas .eq("activo", true) en
    // publicador, sorteosActivos, gestionEventos…) la trata como vigente;
    // finDelEvento la trata como cerrada. Hoy no existe CHECK que lo impida.
    const fila = { activo: true, estado: "cerrado" };
    assert.strictEqual(fila.activo, true);
    assert.strictEqual(g.finDelEvento(fila), "cerrado");
    riesgo("eventos_bot admite activo=true con estado/cierre_estado 'cerrado': los lectores que filtran solo por `activo` y finDelEvento discrepan (C3).");
});

ejecutar("CARACTERIZACIÓN C3 · estado del evento (estadosGestion.js)");
