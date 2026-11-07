// ==========================================================================
// FASE O1 — pruebas del ORQUESTADOR aislado con adaptadores de prueba y
// espías en cada efecto (envío, guardián, rotación/uso, registro).
//
// Modos off/shadow/active, ausencia de efectos en sombra, envío único,
// aislamiento por cliente, respaldos, canales y errores. Ningún motor real.
//
//     node backend/tests/mensajes-o1/o1Orquestador.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const { crearOrquestador, comparar, crearGuardianMemoria, crearRegistroMemoria } = require(path.join(RAIZ, "shared/mensajes"));

const A = "cliente-A";
const B = "cliente-B";
const sockDe = (usuarioId) => ({ context: { usuarioId, sessionId: `ses-${usuarioId}` } });

// Montaje con espías en TODO lo que tiene efectos.
function montar({ adaptador = {}, origen = "respuesta", modo = "active" } = {}) {
    const espia = { envios: [], guardian: 0, antes: 0, despues: 0, lecturas: [] };
    const guardianReal = crearGuardianMemoria();
    const guardian = { ejecutarUnaVez: (args) => { espia.guardian++; return guardianReal.ejecutarUnaVez(args); } };
    const registro = crearRegistroMemoria();
    const envios = {
        sendMessage: async (a) => { espia.envios.push({ canal: "texto", ...a }); return { key: { id: `m${espia.envios.length}` } }; },
        sendImage: async (a) => { espia.envios.push({ canal: "imagen", ...a }); return { key: { id: `i${espia.envios.length}` } }; },
        sendReaction: async (a) => { espia.envios.push({ canal: "reaccion", ...a }); return { key: { id: `r${espia.envios.length}` } }; }
    };
    const base = {
        habilitado: async () => { espia.lecturas.push("habilitado"); return true; },
        candidatas: async () => { espia.lecturas.push("candidatas"); return [{ id: "p1", usuario_id: A, contenido: "Hola {{n}}" }, { id: "p2", usuario_id: A, contenido: "Buenas {{n}}" }]; },
        preferencias: async () => { espia.lecturas.push("preferencias"); return { modo_seleccion: "aleatorio" }; },
        variables: async () => ({ n: "Ana" }),
        renderizar: (c, v) => c.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? ""),
        antesDeEnviar: async () => { espia.antes++; },
        despuesDeEnviar: async () => { espia.despues++; },
        ...adaptador
    };
    const orq = crearOrquestador({ adaptadores: { [origen]: base }, envios, guardian, registro, modo: () => modo, aleatorio: () => 0 });
    return { orq, espia, registro, guardianReal };
}

const solicitud = (extra = {}) => ({ origen: "respuesta", tipo: "reserva_completa", usuarioId: A, sesion: { sock: sockDe(A) }, destino: { jid: "g1@g.us", citar: { key: { id: "C" } } }, textoRespaldo: "RESPALDO", ...extra });
const automatizacion = (extra = {}) => solicitud({ origen: "automatizacion", tipo: "REMINDER_MESSAGE", claveEnvioUnico: "k1", textoRespaldo: undefined, ...extra });

// =============================================================== modos ===

prueba("M1 off → «apagado»: no lee nada, no envía, no registra", async () => {
    const { orq, espia, registro } = montar({ modo: "off" });
    const r = await orq.procesar(solicitud());
    assert.deepStrictEqual(r, { estado: "apagado" });
    assert.deepStrictEqual([espia.lecturas.length, espia.envios.length, espia.guardian, registro.entradas.length], [0, 0, 0, 0]);
});

prueba("M2 shadow → decide (texto, plantilla, candidatas) SIN ningún efecto", async () => {
    const { orq, espia, registro } = montar({ modo: "shadow", origen: "automatizacion" });
    const r = await orq.procesar(automatizacion());
    assert.deepStrictEqual([r.estado, r.texto, r.plantillaId, r.fuente], ["sombra", "Hola Ana", "p1", "plantilla"]);
    assert.deepStrictEqual(r.candidatas, ["p1", "p2"]);
    assert.deepStrictEqual([espia.envios.length, espia.guardian, espia.antes, espia.despues], [0, 0, 0, 0]);
    assert.deepStrictEqual(registro.entradas.map(e => [e.modo, e.estado]), [["shadow", "sombra"]]);
});

prueba("M3 shadow no consume la clave: después, en active, la misma clave SÍ envía", async () => {
    const { orq, espia, guardianReal } = montar({ origen: "automatizacion" });
    await orq.procesar(automatizacion(), { modo: "shadow" });
    assert.strictEqual(guardianReal.acciones.size, 0);
    const r = await orq.procesar(automatizacion(), { modo: "active" });
    assert.strictEqual(r.estado, "enviado");
    assert.strictEqual(espia.envios.length, 1);
});

prueba("M4 shadow no avanza la rotación; active sí (efecto aplicado en antesDeEnviar, como hoy en respuestas)", async () => {
    const config = { modo_seleccion: "rotacion", rotacion_indice: 0 };
    const { orq } = montar({ adaptador: { preferencias: async () => ({ ...config }), antesDeEnviar: async (_s, info) => { config.rotacion_indice = info.efectos.nuevoIndiceRotacion; } } });
    const s1 = await orq.procesar(solicitud(), { modo: "shadow" });
    const s2 = await orq.procesar(solicitud(), { modo: "shadow" });
    assert.deepStrictEqual([s1.plantillaId, s2.plantillaId, config.rotacion_indice], ["p1", "p1", 0]);
    const a1 = await orq.procesar(solicitud(), { modo: "active" });
    const a2 = await orq.procesar(solicitud(), { modo: "active" });
    assert.deepStrictEqual([a1.plantillaId, a2.plantillaId, config.rotacion_indice], ["p1", "p2", 0]);
});

prueba("M5 active: envía por el canal con el socket y la cita; luego despuesDeEnviar", async () => {
    const { orq, espia } = montar();
    const r = await orq.procesar(solicitud());
    assert.deepStrictEqual([r.estado, r.mensajeId], ["enviado", "m1"]);
    const e = espia.envios[0];
    assert.deepStrictEqual([e.canal, e.jid, e.text, e.quoted.key.id, e.sock.context.usuarioId], ["texto", "g1@g.us", "Hola Ana", "C", A]);
    assert.deepStrictEqual([espia.antes, espia.despues], [1, 1]);
});

prueba("M6 misma decisión en shadow y active con el mismo azar (comparar → coincide)", async () => {
    const { orq } = montar();
    const sombra = await orq.procesar(solicitud({ aleatorio: () => 0.99 }), { modo: "shadow" });
    const activo = await orq.procesar(solicitud({ aleatorio: () => 0.99 }), { modo: "active" });
    assert.strictEqual(sombra.plantillaId, "p2");
    assert.deepStrictEqual(comparar(sombra, { enviado: true, texto: activo.texto, plantillaId: activo.plantillaId, fuente: "plantilla" }), { coincide: true, diferencias: [] });
});

// ========================================================= envío único ===

prueba("D1 clave repetida → «duplicado» sin reenviar; en paralelo → un solo envío", async () => {
    const { orq, espia } = montar({ origen: "automatizacion" });
    assert.strictEqual((await orq.procesar(automatizacion())).estado, "enviado");
    const otra = await orq.procesar(automatizacion());
    assert.deepStrictEqual([otra.estado, otra.motivo], ["duplicado", "ya_ok"]);
    const [x, y] = await Promise.all([orq.procesar(automatizacion({ claveEnvioUnico: "k2" })), orq.procesar(automatizacion({ claveEnvioUnico: "k2" }))]);
    assert.deepStrictEqual([x.estado, y.estado].sort(), ["duplicado", "enviado"]);
    assert.strictEqual(espia.envios.length, 2);
});

prueba("D2 tipo con envío único obligatorio y sin clave → error sin_clave, nada enviado", async () => {
    const { orq, espia } = montar({ origen: "automatizacion" });
    const r = await orq.procesar(automatizacion({ claveEnvioUnico: null }));
    assert.deepStrictEqual([r.estado, r.motivo, espia.envios.length], ["error", "sin_clave", 0]);
});

prueba("D3 variable faltante con bloquearSiFaltan → omitido ANTES del guardián (la clave no se consume)", async () => {
    const { orq, espia, guardianReal } = montar({
        origen: "automatizacion",
        adaptador: { bloquearSiFaltan: true, renderizar: (c) => ({ texto: c, faltantes: ["inventada"] }) }
    });
    const r = await orq.procesar(automatizacion());
    assert.deepStrictEqual([r.estado, r.motivo, r.faltantes], ["omitido", "variable_faltante", ["inventada"]]);
    assert.deepStrictEqual([espia.guardian, guardianReal.acciones.size, espia.envios.length], [0, 0, 0]);
});

prueba("D4 fallo de WhatsApp dentro del guardián → error; la clave queda en error y no hay despuesDeEnviar", async () => {
    const { orq, espia, guardianReal } = montar({ origen: "automatizacion" });
    const orqFalla = crearOrquestador({
        adaptadores: { automatizacion: { candidatas: async () => [{ id: "p", contenido: "x" }], renderizar: c => c, despuesDeEnviar: async () => { espia.despues++; } } },
        envios: { sendMessage: async () => { throw new Error("WA caído"); } },
        guardian: guardianReal, modo: () => "active", aleatorio: () => 0
    });
    const r = await orqFalla.procesar(automatizacion({ claveEnvioUnico: "kf" }));
    assert.deepStrictEqual([r.estado, r.motivo, r.error], ["error", "fallo_ejecucion", "WA caído"]);
    assert.strictEqual(guardianReal.acciones.get("kf").estado, "error");
    assert.strictEqual(espia.despues, 0);
    void orq;
});

// ========================================================== interruptor ===

prueba("I1 interruptor apagado → omitido sin leer plantillas", async () => {
    const { orq, espia } = montar({ adaptador: { habilitado: async () => false } });
    const r = await orq.procesar(solicitud());
    assert.deepStrictEqual([r.estado, r.motivo], ["omitido", "interruptor_apagado"]);
    assert.ok(!espia.lecturas.includes("candidatas"));
    assert.strictEqual(espia.envios.length, 0);
});

// ============================================================ respaldos ===

prueba("F1 respuestas sin plantillas → texto de respaldo del motor (fuente «fijo»)", async () => {
    const { orq, espia } = montar({ adaptador: { candidatas: async () => [] } });
    const r = await orq.procesar(solicitud());
    assert.deepStrictEqual([r.estado, r.fuente, espia.envios[0].text], ["enviado", "fijo", "RESPALDO"]);
});

prueba("F2 plantilla elegida que queda vacía → respaldo (reproduce S4)", async () => {
    const { orq } = montar({ adaptador: { candidatas: async () => [{ id: "v", contenido: "" }] } });
    const r = await orq.procesar(solicitud(), { modo: "shadow" });
    assert.deepStrictEqual([r.estado, r.texto, r.fuente, r.plantillaId], ["sombra", "RESPALDO", "fijo", null]);
});

prueba("F3 automatización sin plantillas → omitido «sin_plantillas» (no_enviar; reproduce AU4)", async () => {
    const { orq, espia } = montar({ origen: "automatizacion", adaptador: { candidatas: async () => [] } });
    const r = await orq.procesar(automatizacion());
    assert.deepStrictEqual([r.estado, r.motivo, espia.guardian], ["omitido", "sin_plantillas", 0]);
});

prueba("F4 respaldo con IA: en shadow el adaptador recibe modo=shadow y no la llama; en active sí", async () => {
    let llamadasIa = 0;
    const respaldo = async (_s, { modo }) => (modo === "shadow" ? { fuente: "ia", texto: null } : (llamadasIa++, { fuente: "ia", texto: "REDACTADO" }));
    const { orq } = montar({ adaptador: { candidatas: async () => [], respaldo } });
    const sombra = await orq.procesar(solicitud({ tipo: "info_evento" }), { modo: "shadow" });
    assert.deepStrictEqual([sombra.estado, sombra.motivo, llamadasIa], ["omitido", "ia_no_ejecutada_en_sombra", 0]);
    const activo = await orq.procesar(solicitud({ tipo: "info_evento" }), { modo: "active" });
    assert.deepStrictEqual([activo.estado, activo.fuente, llamadasIa], ["enviado", "ia", 1]);
});

prueba("F5 el anexo se añade solo tras una PLANTILLA (reproduce R3), no tras el respaldo", async () => {
    const { orq } = montar();
    assert.strictEqual((await orq.procesar(solicitud({ anexo: "Ya es tuyo: 12" }), { modo: "shadow" })).texto, "Hola Ana\n\nYa es tuyo: 12");
    const { orq: sinPlantillas } = montar({ adaptador: { candidatas: async () => [] } });
    assert.strictEqual((await sinPlantillas.procesar(solicitud({ anexo: "Ya es tuyo: 12" }), { modo: "shadow" })).texto, "RESPALDO");
});

// ========================================================== aislamiento ===

prueba("X1 plantillas de otro cliente se descartan aunque el adaptador las devuelva", async () => {
    const { orq } = montar({ adaptador: { candidatas: async () => [{ id: "ajena", usuario_id: B, contenido: "DE B" }, { id: "global", usuario_id: null, contenido: "GLOBAL" }] } });
    const r = await orq.procesar(solicitud(), { modo: "shadow" });
    assert.deepStrictEqual([r.candidatas, r.texto], [["global"], "GLOBAL"]);
});

prueba("X2 socket de otro cliente → error, nada enviado (en shadow y en active)", async () => {
    const { orq, espia } = montar();
    for (const modo of ["shadow", "active"]) {
        const r = await orq.procesar(solicitud({ sesion: { sock: sockDe(B) } }), { modo });
        assert.deepStrictEqual([r.estado, r.motivo], ["error", "sesion_de_otro_cliente"]);
    }
    assert.strictEqual(espia.envios.length, 0);
});

prueba("X3 active sin socket → error sin_sesion; shadow sin socket sí decide", async () => {
    const { orq } = montar();
    assert.strictEqual((await orq.procesar(solicitud({ sesion: null }), { modo: "active" })).motivo, "sin_sesion");
    assert.strictEqual((await orq.procesar(solicitud({ sesion: null }), { modo: "shadow" })).estado, "sombra");
});

// ============================================================== canales ===

prueba("K1 imagen: copia con su pie → sendImage; sin imagen en active → omitido; en shadow no hace falta la imagen", async () => {
    const { orq, espia } = montar({ origen: "compartir", adaptador: { renderizar: (c) => c.toUpperCase() } });
    const base = { origen: "compartir", tipo: "compartir_tabla", textoAprobado: "pie", claveEnvioUnico: "c1" };
    const r = await orq.procesar(solicitud({ ...base, imagen: Buffer.from("png") }));
    assert.deepStrictEqual([r.estado, r.fuente, espia.envios[0].canal, espia.envios[0].caption], ["enviado", "copia", "imagen", "PIE"]);
    assert.strictEqual((await orq.procesar(solicitud({ ...base, claveEnvioUnico: "c2" }))).motivo, "imagen_invalida");
    assert.strictEqual((await orq.procesar(solicitud({ ...base, claveEnvioUnico: "c3" }), { modo: "shadow" })).estado, "sombra");
});

prueba("K2 reacción → sendReaction con key y emoji; sin envío único", async () => {
    const { orq, espia } = montar({ origen: "reaccion" });
    const r = await orq.procesar(solicitud({ origen: "reaccion", tipo: "reaccion_reserva", reaccion: { key: { id: "K" }, emoji: "✅" } }));
    assert.deepStrictEqual([r.estado, espia.envios[0].canal, espia.envios[0].emoji, espia.guardian], ["enviado", "reaccion", "✅", 0]);
});

prueba("K3 mensaje fijo del sistema → texto tal cual (fuente «fijo»), sin plantillas", async () => {
    const { orq, espia } = montar({ origen: "sistema" });
    const r = await orq.procesar(solicitud({ origen: "sistema", tipo: "sistema_sin_sorteo_vigente", texto: "No hay un sorteo activo en este grupo en este momento." }));
    assert.deepStrictEqual([r.estado, r.fuente, espia.envios[0].text], ["enviado", "fijo", "No hay un sorteo activo en este grupo en este momento."]);
    assert.ok(!espia.lecturas.includes("candidatas"));
});

// ============================================================== errores ===

prueba("E1 nunca lanza: tipo desconocido, sin adaptador, tipo no soportado, excepción del adaptador", async () => {
    const { orq } = montar();
    assert.strictEqual((await orq.procesar(solicitud({ tipo: "nada" }), { modo: "active" })).motivo, "tipo_desconocido");
    assert.strictEqual((await orq.procesar(automatizacion())).motivo, "sin_adaptador");
    assert.strictEqual((await orq.procesar(solicitud({ tipo: "mensaje_no_entendido" }))).motivo, "tipo_no_soportado");
    const { orq: roto } = montar({ adaptador: { candidatas: async () => { throw new Error("Supabase caído"); } } });
    const r = await roto.procesar(solicitud());
    assert.deepStrictEqual([r.estado, r.motivo, r.error], ["error", "excepcion_decision", "Supabase caído"]);
});

prueba("E2 fallo de envío sin envío único → error fallo_envio (no lanza)", async () => {
    const orq = crearOrquestador({
        adaptadores: { respuesta: { candidatas: async () => [] } },
        envios: { sendMessage: async () => { throw new Error("rechazado"); } },
        modo: () => "active"
    });
    const r = await orq.procesar(solicitud());
    assert.deepStrictEqual([r.estado, r.motivo, r.error], ["error", "fallo_envio", "rechazado"]);
});

prueba("E3 un registro que falla nunca corta el flujo", async () => {
    const orq = crearOrquestador({ adaptadores: { respuesta: { candidatas: async () => [] } }, registro: { registrar: () => { throw new Error("x"); } }, modo: () => "shadow" });
    assert.strictEqual((await orq.procesar(solicitud())).estado, "sombra");
});

prueba("E4 adaptador para un origen desconocido → se rechaza al crear el orquestador", () => {
    assert.throws(() => crearOrquestador({ adaptadores: { inventado: {} } }), /origen desconocido/);
});

prueba("C1 comparar detecta diferencias de envío, texto, plantilla y fuente", () => {
    const sombra = { estado: "sombra", texto: "A", plantillaId: "p1", fuente: "plantilla" };
    assert.deepStrictEqual(comparar(sombra, { enviado: false }).diferencias.map(d => d.campo), ["envio"]);
    assert.deepStrictEqual(comparar(sombra, { enviado: true, texto: "B", plantillaId: "p2", fuente: "fijo" }).diferencias.map(d => d.campo), ["texto", "plantillaId", "fuente"]);
    assert.strictEqual(comparar({ estado: "omitido" }, { enviado: false }).coincide, true);
});

ejecutar("O1 · Orquestador: modos, sombra, envío único, aislamiento, respaldos y canales");
