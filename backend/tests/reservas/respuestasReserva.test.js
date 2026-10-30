// ==========================================================================
// PRUEBAS — la respuesta de una reserva corresponde a lo que pasó de verdad,
// desde el texto del cliente hasta el mensaje y la reacción de WhatsApp.
//
//   - Todos reservados: reserva_completa.
//   - Algunos reservados y otros ocupados: reserva_parcial con ambas listas.
//   - Ninguno reservado: numero_ocupado / todos_ocupados con los ocupados.
//   - Error técnico: mensaje fijo; nunca dice que están ocupados.
//   - Orden pedido y ceros iniciales.
//   - Caso real (30/10, Katy): pidió 87 27 09 17 01; 17 y 27 estaban ocupados
//     por OTRO sorteo de la misma tabla y la respuesta fue la de reserva
//     completa, sin mencionarlos.
//
// detectarReserva, calcularTipoPresentacion, construirVariables,
// aplicarPlantilla y responderResultado REALES sobre Supabase en memoria;
// plantillas reales de producción. Sin WhatsApp ni Gemini.
//
//     node backend/tests/reservas/respuestasReserva.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(ruta, exportsObj) {
    require.cache[r(ruta)] = { id: r(ruta), filename: r(ruta), loaded: true, exports: exportsObj };
}

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

const enviados = [];
let llamadasIA = 0;
inyectar("services/baileys/send.js", {
    sendMessage: async ({ text }) => { enviados.push(text); },
    sendReaction: async () => {}
});
inyectar("bot/ai/aiService.js", { suggestReply: async () => { llamadasIA++; return { respuesta: "Tus números están ocupados (IA)" }; } });

const { detectarReserva } = require(r("bot/funciones/reservas/detectarReserva.js"));
const { calcularTipoPresentacion, construirVariables, aplicarPlantilla } = require(r("bot/ai/plantillaMensaje.js"));
const { responderResultado } = require(r("bot/ai/responderResultado.js"));

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const T = "5k_15k_reservas_2_cifras";
const ESTE = "sorteo-de-hoy";
const OTRO = "sorteo-anterior";
const KATY = { id: "c-katy", nombre: "Katy", telefono: "3001112233", lid: null };

const evento = {
    id: "ev-1", usuario_id: U, tabla: T, identidad_evento_real: ESTE, activo: true, estado: "abierto", cifras: 2, cantidad_numeros: 100,
    valor: "5000", nombre_evento: "Chontico", grupo_id: "g1@g.us", grupo_nombre: "Rifa", fecha_evento: "2999-01-01", hora_fin: "23:59", hora_cierre: "23:58"
};

// estados: { "23": { estado, identidad_evento_real, usuario_global_id } }
function sembrar(estados = {}) {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.antesDeEscribir = null;
    fake.control.despuesDeLeer = null;
    fake.tablas[T] = Array.from({ length: 100 }, (_, i) => {
        const numero = String(i).padStart(2, "0");
        return { numero, usuario_id: U, estado: "libre", ...(estados[numero] || {}) };
    });
    fake.tablas.eventos_bot = [{ ...evento }];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];
    fake.tablas.plantillas_mensaje = [];
    fake.tablas.configuracion_seleccion_mensajes = [];
    enviados.length = 0;
    llamadasIA = 0;
}

const deOtraPersona = { estado: "reservado", usuario_global_id: "c-otra", identidad_evento_real: ESTE };
const pagadoOtra = { estado: "pagado", usuario_global_id: "c-otra", identidad_evento_real: ESTE };
const deOtroSorteo = { estado: "reservado", usuario_global_id: "c-otra", identidad_evento_real: OTRO };
const pagadoOtroSorteo = { estado: "pagado", usuario_global_id: "c-otra", identidad_evento_real: OTRO };

const pedir = (texto) => detectarReserva({ evento, texto, usuario: KATY, lib: null });
const ctxDe = (texto, reserva) => ({ reserva, evento, usuario: KATY, textoOriginal: texto });
const tipoDe = (texto, reserva) => calcularTipoPresentacion(ctxDe(texto, reserva), reserva);
const redactar = (plantilla, texto, reserva) => aplicarPlantilla(plantilla, construirVariables(ctxDe(texto, reserva), reserva, []), {}, []);

// Plantillas reales de producción (texto tal cual, sin emojis ni formato).
const P_COMPLETA = "perfecto tus numeros {{numeros_reservados}} ya quedaron reservados";
const P_PARCIAL = "{{numeros_reservados}} {{reservado_reservados}} para ti. {{el_numero_los_numeros_ocupados}} {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}.";
const P_OCUPADO = "{{numeros_solicitados}} ya está ocupado.";
const P_TODOS = "{{cliente}}, {{el_numero_los_numeros}} {{numeros_solicitados}} ya {{esta_estan}} {{ocupado_ocupados}}.";

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("caso de Katy: 17 y 27 ocupados por OTRO sorteo → parcial con ambas listas, sin tocarlos", async () => {
    sembrar({ "17": pagadoOtroSorteo, "27": deOtroSorteo });
    const antes = JSON.stringify(fake.tablas[T].filter(f => ["17", "27"].includes(f.numero)));
    const texto = "87 27 09 17 01";
    const res = await pedir(texto);
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.reservados, ["87", "09", "01"], "en el orden pedido");
    assert.deepStrictEqual(res.ocupados, ["27", "17"]);
    assert.strictEqual(tipoDe(texto, res), "reserva_parcial", "antes salía reserva_completa");
    const mensaje = redactar(P_PARCIAL, texto, res);
    for (const n of ["87", "09", "01", "27", "17"]) assert.ok(mensaje.includes(n), `${n} en: ${mensaje}`);
    assert.strictEqual(res.reaccion, null, "reserva parcial: sin ✅ ni ❌");
    assert.strictEqual(JSON.stringify(fake.tablas[T].filter(f => ["17", "27"].includes(f.numero))), antes, "los del otro sorteo intactos");
    assert.ok(["87", "09", "01"].every(n => fake.tablas[T].find(f => f.numero === n).identidad_evento_real === ESTE));
});

prueba("ejemplo pedido: 12 23 45 67 → reservados 12 y 45; ocupados 23 y 67; invita a elegir otros", async () => {
    sembrar({ "23": deOtraPersona, "67": pagadoOtra });
    const texto = "12 23 45 67";
    const res = await pedir(texto);
    assert.deepStrictEqual([res.reservados, res.ocupados], [["12", "45"], ["23", "67"]]);
    assert.strictEqual(tipoDe(texto, res), "reserva_parcial");
    assert.ok(res.mensaje.startsWith("⚠️ Reserva parcial."), res.mensaje);
    assert.ok(/Reservados: \( 12 - 45 \)/.test(res.mensaje) && /ya están ocupados: \( 23 - 67 \)/.test(res.mensaje) && /Elige otros números/.test(res.mensaje), res.mensaje);
    assert.ok(!/Reserva realizada correctamente/.test(res.mensaje), "no se presenta como completa");
});

prueba("todos reservados: confirmación completa, orden pedido, ceros iniciales y ✅", async () => {
    sembrar();
    const texto = "45 07 00";
    const res = await pedir(texto);
    assert.deepStrictEqual([res.reservados, res.ocupados], [["45", "07", "00"], []]);
    assert.strictEqual(tipoDe(texto, res), "reserva_completa");
    assert.strictEqual(redactar(P_COMPLETA, texto, res), "perfecto tus numeros ( 45 - 07 - 00 ) ya quedaron reservados");
    assert.strictEqual(res.reaccion, "✅");
});

prueba("ninguno disponible, varios: todos_ocupados los enumera y reacciona ❌", async () => {
    sembrar({ "23": deOtraPersona, "07": pagadoOtroSorteo });
    const texto = "23 07";
    const res = await pedir(texto);
    assert.strictEqual(res.ok, false);
    assert.deepStrictEqual(res.ocupados, ["23", "07"]);
    assert.strictEqual(tipoDe(texto, res), "todos_ocupados");
    assert.strictEqual(redactar(P_TODOS, texto, res), "Katy, los números ( 23 - 07 ) ya están ocupados.");
    assert.ok(/🔒 Ocupados: \( 23 - 07 \)/.test(res.mensaje) && /Elige otros números/.test(res.mensaje), res.mensaje);
    assert.strictEqual(res.reaccion, "❌");
});

prueba("un solo número ocupado por otro sorteo: numero_ocupado (antes, error genérico)", async () => {
    sembrar({ "23": deOtroSorteo });
    const res = await pedir("23");
    assert.deepStrictEqual([res.ok, res.ocupados, res.errorTecnico], [false, ["23"], undefined]);
    assert.strictEqual(tipoDe("23", res), "numero_ocupado");
    assert.strictEqual(redactar(P_OCUPADO, "23", res), "( 23 ) ya está ocupado.");
    assert.strictEqual(res.reaccion, "❌");
});

prueba("uno ya era del cliente y otro está ocupado: no se dice que el suyo esté ocupado", async () => {
    sembrar({ "12": { estado: "reservado", usuario_global_id: KATY.id, identidad_evento_real: ESTE }, "23": deOtraPersona });
    const texto = "12 23";
    const res = await pedir(texto);
    assert.deepStrictEqual([res.ok, res.ocupados], [false, ["23"]]);
    assert.strictEqual(tipoDe(texto, res), "numero_ocupado");
    assert.strictEqual(redactar(P_OCUPADO, texto, res), "( 23 ) ya está ocupado.");
});

prueba("el mismo cliente tiene el número en OTRO sorteo: no es suyo en este, no se calla", async () => {
    sembrar({ "12": { estado: "reservado", usuario_global_id: KATY.id, identidad_evento_real: OTRO } });
    const res = await pedir("12");
    assert.deepStrictEqual([res.ok, res.ocupados], [false, ["12"]], "antes: silencio («ya es tuyo»)");
    assert.strictEqual(tipoDe("12", res), "numero_ocupado");
});

// Recomendación 1 de la auditoría de veracidad (autorizada 30/10): antes
// silencio; ahora se le dice que ya son suyos, con el mensaje fijo.
prueba("todos ya son del cliente en ESTE sorteo: «ya es tuyo», sin plantillas ni reacción", async () => {
    sembrar({ "12": { estado: "reservado", usuario_global_id: KATY.id, identidad_evento_real: ESTE } });
    const res = await pedir("12");
    assert.deepStrictEqual([res.ok, res.yaTuyos, res.ocupados, res.reaccion, res.soloMensajeFijo], [false, ["12"], [], null, true]);
    assert.strictEqual(res.mensaje, "✅ Ya es tuyo: ( 12 )");
    assert.strictEqual(tipoDe("12", res), null, "no es una plantilla de ocupado");
});

prueba("bloqueados o en proceso se informan como tales (no como ocupados), sin ❌", async () => {
    sembrar({ "23": { estado: "bloqueado" }, "45": { estado: "en_proceso" } });
    const texto = "12 23 45";
    const parcial = await pedir(texto);
    assert.deepStrictEqual([parcial.reservados, parcial.ocupados, parcial.bloqueados, parcial.enProceso], [["12"], [], ["23"], ["45"]]);
    assert.strictEqual(tipoDe(texto, parcial), "reserva_parcial");
    assert.strictEqual(parcial.soloMensajeFijo, true, "ninguna plantilla sabe decir «bloqueado»");
    assert.ok(/Está bloqueado y no se puede reservar por ahora: \( 23 \)/.test(parcial.mensaje) && /Está en proceso y no se puede reservar por ahora: \( 45 \)/.test(parcial.mensaje), parcial.mensaje);
    assert.strictEqual(parcial.reaccion, null);
    sembrar({ "23": { estado: "bloqueado" } });
    const solo = await pedir("23");
    assert.deepStrictEqual([solo.ok, solo.bloqueados, solo.ocupados, solo.reaccion], [false, ["23"], [], null]);
    assert.ok(!/ocupad/i.test(solo.mensaje), solo.mensaje);
});

prueba("carrera: otro toma un número entre la lectura y el UPDATE → no se confirma; va a ocupados", async () => {
    sembrar({ "23": deOtraPersona });
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T) return;
        fake.control.antesDeEscribir = null;
        Object.assign(fake.tablas[T].find(f => f.numero === "45"), deOtraPersona);
    };
    const texto = "12 23 45";
    const res = await pedir(texto);
    assert.deepStrictEqual([res.reservados, res.ocupados], [["12"], ["23", "45"]], "antes confirmaba el 45");
    assert.strictEqual(tipoDe(texto, res), "reserva_parcial");
    assert.strictEqual(fake.tablas[T].find(f => f.numero === "45").usuario_global_id, "c-otra", "sigue siendo de quien lo tomó");
    assert.strictEqual(res.reaccion, null);
});

prueba("carrera total: todos tomados antes del UPDATE → ocupados, no error técnico", async () => {
    sembrar();
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T) return;
        fake.control.antesDeEscribir = null;
        for (const n of ["12", "45"]) Object.assign(fake.tablas[T].find(f => f.numero === n), deOtraPersona);
    };
    const res = await pedir("12 45");
    assert.deepStrictEqual([res.ok, res.ocupados, res.errorTecnico], [false, ["12", "45"], undefined]);
    assert.strictEqual(res.reaccion, "❌");
});

const ctxCompleto = (texto, reserva) => ({
    ...ctxDe(texto, reserva),
    session: { usuarioId: U, sessionId: "s1" },
    sock: {},
    chat: { remoteJid: "g1@g.us", esGrupo: true },
    message: { key: { id: "m1", fromMe: false, remoteJid: "g1@g.us" } }
});

prueba("error técnico al leer: mensaje fijo, sin plantillas de ocupado ni Gemini, sin reacción", async () => {
    sembrar();
    fake.tablas.plantillas_mensaje = [{ id: "p1", usuario_id: U, tipo_respuesta: "todos_ocupados", contenido: "esos ya están ocupados", habilitada: true }];
    fake.control.fallarTabla = T;
    const error = console.error;
    console.error = () => {};
    const res = await pedir("12 23");
    fake.control.fallarTabla = null;
    assert.deepStrictEqual([res.ok, res.errorTecnico, res.reaccion], [false, true, undefined]);
    assert.ok(!/ocupad/i.test(res.mensaje), res.mensaje);
    assert.strictEqual(tipoDe("12 23", res), null);
    const log = console.log;
    console.log = () => {};
    const respondido = await responderResultado(ctxCompleto("12 23", res));
    console.log = log;
    console.error = error;
    assert.strictEqual(respondido, true);
    assert.deepStrictEqual(enviados, [res.mensaje]);
    assert.strictEqual(llamadasIA, 0, "Gemini podría decir que están ocupados");
});

prueba("error técnico al guardar: no se afirma que estén ocupados", async () => {
    sembrar();
    fake.control.despuesDeLeer = (tabla) => {
        if (tabla !== T) return;
        fake.control.despuesDeLeer = null;
        fake.control.fallarTabla = T;
    };
    const error = console.error, log = console.log;
    console.error = console.log = () => {};
    const res = await pedir("12 23");
    console.error = error; console.log = log;
    assert.deepStrictEqual([res.ok, res.errorTecnico], [false, true]);
    assert.strictEqual(res.ocupados, undefined);
    fake.control.fallarTabla = null;
    assert.ok(fake.tablas[T].every(f => f.estado === "libre"), "nada a medias");
});

prueba("de punta a punta: el motor de plantillas del panel envía la parcial, no la completa", async () => {
    sembrar({ "17": pagadoOtroSorteo, "27": deOtroSorteo });
    fake.tablas.plantillas_mensaje = [
        { id: "p-c", usuario_id: U, tipo_respuesta: "reserva_completa", contenido: P_COMPLETA, habilitada: true },
        { id: "p-p", usuario_id: U, tipo_respuesta: "reserva_parcial", contenido: P_PARCIAL, habilitada: true }
    ];
    const texto = "87 27 09 17 01";
    const res = await pedir(texto);
    const log = console.log;
    console.log = () => {};
    await responderResultado(ctxCompleto(texto, res));
    console.log = log;
    assert.strictEqual(enviados.length, 1);
    assert.ok(/\( 87 - 09 - 01 \)/.test(enviados[0]) && /\( 27 - 17 \)/.test(enviados[0]) && !enviados[0].startsWith("perfecto"), enviados[0]);
    assert.strictEqual(llamadasIA, 0);
});

(async () => {
    let ok = 0, falla = 0;
    const { log } = console;
    for (const { n, fn } of pruebas) {
        console.log = () => {};
        try { await fn(); ok++; console.log = log; log(`✅ ${n}`); }
        catch (e) { falla++; console.log = log; log(`❌ ${n}`); log("   ", e && e.stack); }
    }
    log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
