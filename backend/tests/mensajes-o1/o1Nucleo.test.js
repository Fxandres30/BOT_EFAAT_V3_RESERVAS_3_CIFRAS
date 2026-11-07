// ==========================================================================
// FASE O1 — pruebas del NÚCLEO aislado (shared/mensajes): catálogo, modos,
// selección, validación, envío único y registro.
//
// Incluye una prueba de EQUIVALENCIA: la selección «preferencias» del núcleo
// frente a la función real bot/ai/seleccionarPlantilla.js (pura), con miles
// de combinaciones al azar.
//
//     node backend/tests/mensajes-o1/o1Nucleo.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const REPO = path.resolve(RAIZ, "..");

const { catalogo, modos, seleccionar, validarContenido, validarSolicitud, crearGuardianMemoria, crearRegistroMemoria } = require(path.join(RAIZ, "shared/mensajes"));
const { construirEntrada, huella } = require(path.join(RAIZ, "shared/mensajes/etapas/registro.js"));
const { traducir } = require(path.join(RAIZ, "shared/mensajes/etapas/envioUnico.js"));
const { seleccionarPlantilla } = require(path.join(RAIZ, "bot/ai/seleccionarPlantilla.js"));

// ============================================================ catálogo ===

prueba("N1 catálogo coherente: sin ids repetidos, valores válidos, alias existentes", () => {
    assert.deepStrictEqual(catalogo.validarCatalogo(), []);
});

prueba("N2 catálogo cubre todos los tipos que los motores producen hoy (O0)", () => {
    const esperados = [
        "reserva_completa", "reserva_parcial", "numero_ocupado", "todos_ocupados", "mis_numeros", "mis_reservas",
        "consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo",
        "cantidad_reservas", "numero_especifico", "info_evento", "multiple", "disponibilidad", "disponibilidad_agotada",
        "OPEN_MESSAGE", "REMINDER_MESSAGE", "UPDATE_MESSAGE", "CLOSE_MESSAGE", "inicio_dia",
        "sorteo_publicacion", "sorteo_recordatorio", "sorteo_aviso_cierre", "compartir_tabla", "reaccion_reserva"
    ];
    for (const id of esperados) assert.ok(catalogo.obtenerTipo(id), `falta ${id}`);
});

prueba("N3 cada tipo apunta a un archivo de motor que existe", () => {
    for (const t of catalogo.TIPOS) assert.ok(fs.existsSync(path.join(REPO, t.motorActual)), `${t.id}: ${t.motorActual}`);
});

prueba("N4 reglas de cada motor declaradas como en O0", () => {
    const t = (id) => catalogo.obtenerTipo(id);
    assert.deepStrictEqual([t("reserva_completa").seleccion, t("reserva_completa").respaldo, t("reserva_completa").envioUnico], ["preferencias", "fijo", "ninguno"]);
    assert.strictEqual(t("info_evento").respaldo, "fijo_o_ia");
    assert.deepStrictEqual([t("REMINDER_MESSAGE").seleccion, t("REMINDER_MESSAGE").respaldo, t("REMINDER_MESSAGE").envioUnico], ["aleatorio_sin_repetir", "no_enviar", "obligatorio"]);
    assert.deepStrictEqual([t("inicio_dia").seleccion, t("inicio_dia").envioUnico], ["aleatorio", "obligatorio"]);
    assert.deepStrictEqual([t("sorteo_recordatorio").seleccion, t("compartir_tabla").canal, t("reaccion_reserva").canal], ["copia", "imagen", "reaccion"]);
    assert.strictEqual(catalogo.tipoEfectivo("mis_reservas").id, "mis_numeros");
    assert.strictEqual(t("mensaje_no_entendido").soportado, false);
});

// =============================================================== modos ===

prueba("N5 modos: por defecto off; valores válidos por origen; cualquier otro valor = off", () => {
    assert.strictEqual(modos.resolverModo("inicio_dia", {}), "off");
    assert.strictEqual(modos.resolverModo("inicio_dia", { MENSAJES_ORQUESTADOR_INICIO_DIA: "shadow" }), "shadow");
    assert.strictEqual(modos.resolverModo("respuesta", { MENSAJES_ORQUESTADOR_RESPUESTA: " ACTIVE " }), "active");
    assert.strictEqual(modos.resolverModo("respuesta", { MENSAJES_ORQUESTADOR_RESPUESTA: "si" }), "off");
    assert.strictEqual(modos.resolverModo(null, { MENSAJES_ORQUESTADOR_: "active" }), "off");
    assert.strictEqual(modos.nombreVariable("inicio_dia"), "MENSAJES_ORQUESTADOR_INICIO_DIA");
});

prueba("N6 en este proceso ningún origen está activado (no hay variables MENSAJES_ORQUESTADOR_*)", () => {
    for (const o of catalogo.ORIGENES) assert.strictEqual(modos.resolverModo(o), "off", o);
});

// =========================================================== selección ===

function semilla(n) { let s = n; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

prueba("N7 EQUIVALENCIA «preferencias» = bot/ai/seleccionarPlantilla.js (5000 casos al azar)", () => {
    const azar = semilla(7);
    for (let i = 0; i < 5000; i++) {
        const n = Math.floor(azar() * 5);
        const candidatas = Array.from({ length: n }, (_, k) => ({ id: `p${k}` }));
        const modo = ["aleatorio", "rotacion", "fijo", undefined][Math.floor(azar() * 4)];
        const config = azar() < 0.15 ? null : {
            modo_seleccion: modo,
            plantilla_fija_id: azar() < 0.7 ? `p${Math.floor(azar() * 6)}` : null,
            rotacion_indice: azar() < 0.8 ? Math.floor(azar() * 20) - 5 : "x"
        };
        const r = azar();
        const real = (() => { const m = Math.random; Math.random = () => r; try { return seleccionarPlantilla(config, candidatas); } finally { Math.random = m; } })();
        const nuevo = seleccionar("preferencias", candidatas, config, () => r);
        assert.strictEqual(nuevo.plantilla?.id ?? null, real.plantilla?.id ?? null, JSON.stringify({ config, n, r }));
        assert.strictEqual(nuevo.efectos.nuevoIndiceRotacion ?? null, real.nuevoIndiceRotacion ?? null, JSON.stringify({ config, n }));
    }
});

prueba("N8 aleatorio_sin_repetir (= messageSelector): excluye el último si hay alternativa; con uno solo, lo repite", () => {
    const c = [{ id: "X" }, { id: "Y" }];
    for (const r of [0, 0.5, 0.99]) assert.strictEqual(seleccionar("aleatorio_sin_repetir", c, { ultimoUsadoId: "X" }, () => r).plantilla.id, "Y");
    assert.strictEqual(seleccionar("aleatorio_sin_repetir", [{ id: "X" }], { ultimoUsadoId: "X" }, () => 0).plantilla.id, "X");
    assert.strictEqual(seleccionar("aleatorio_sin_repetir", c, {}, () => 0.99).plantilla.id, "Y");
    assert.strictEqual(seleccionar("aleatorio_sin_repetir", [], {}, () => 0).plantilla, null);
});

prueba("N9 aleatorio simple (= Inicio del día) ignora preferencias (modo fijo, rotación)", () => {
    const c = [{ id: "A" }, { id: "B" }];
    assert.strictEqual(seleccionar("aleatorio", c, { modo_seleccion: "fijo", plantilla_fija_id: "A" }, () => 0.99).plantilla.id, "B");
    assert.throws(() => seleccionar("inventada", c, {}, () => 0), /desconocida/);
});

// ========================================================== validación ===

prueba("N10 validación de contenido", () => {
    assert.deepStrictEqual(validarContenido({ texto: "hola" }), { ok: true });
    assert.strictEqual(validarContenido({ texto: "  " }).motivo, "texto_vacio");
    assert.strictEqual(validarContenido({ texto: null }).motivo, "texto_invalido");
    assert.deepStrictEqual(validarContenido({ texto: "", canal: "imagen" }), { ok: true });
    assert.deepStrictEqual(validarContenido({ texto: "a {x}", faltantes: ["x"] }), { ok: true });
    assert.deepStrictEqual(validarContenido({ texto: "a {x}", faltantes: ["x"], bloquearSiFaltan: true }), { ok: false, motivo: "variable_faltante", detalle: ["x"] });
    assert.strictEqual(validarContenido({ texto: "x".repeat(4001), maxLongitud: 4000 }).motivo, "excede_longitud");
    assert.deepStrictEqual(validarContenido({ canal: "reaccion" }), { ok: true });
});

prueba("N11 validación de la solicitud", () => {
    assert.deepStrictEqual(validarSolicitud({ tipo: "inicio_dia", origen: "inicio_dia", usuarioId: "A", destino: { jid: "g@g.us" } }), []);
    assert.deepStrictEqual(validarSolicitud(null), ["solicitud_invalida"]);
    assert.deepStrictEqual(validarSolicitud({ tipo: "nada", usuarioId: "A", destino: { jid: "g" } }), ["tipo_desconocido"]);
    assert.deepStrictEqual(validarSolicitud({ tipo: "inicio_dia", origen: "respuesta", destino: {} }), ["origen_no_coincide", "sin_usuario", "sin_destino"]);
});

// ========================================================= envío único ===

prueba("N12 guardián en memoria: una vez por clave, también en paralelo; error → ya_error", async () => {
    const g = crearGuardianMemoria();
    let corridas = 0;
    const tarea = () => g.ejecutarUnaVez({ claveIdempotencia: "k", ejecutar: async () => { corridas++; return 1; } });
    const [a, b] = await Promise.all([tarea(), tarea()]);
    assert.strictEqual([a.ejecutada, b.ejecutada].filter(Boolean).length, 1);
    assert.strictEqual(corridas, 1);
    assert.strictEqual((await tarea()).motivo, "ya_ok");
    await g.ejecutarUnaVez({ claveIdempotencia: "e", ejecutar: async () => { throw new Error("x"); } });
    assert.strictEqual((await g.ejecutarUnaVez({ claveIdempotencia: "e", ejecutar: async () => 1 })).motivo, "ya_error");
});

prueba("N13 traducción del resultado de executionGuard", () => {
    assert.deepStrictEqual(traducir({ ejecutada: true, resultado: 5 }), { estado: "enviado", resultado: 5 });
    assert.deepStrictEqual(traducir({ ejecutada: false, motivo: "ya_ok" }), { estado: "duplicado", motivo: "ya_ok" });
    assert.deepStrictEqual(traducir({ ejecutada: false, motivo: "ya_en_progreso" }), { estado: "duplicado", motivo: "ya_en_progreso" });
    assert.strictEqual(traducir({ ejecutada: false, motivo: "fallo_ejecucion", error: new Error("WA") }).error, "WA");
    assert.strictEqual(traducir({ ejecutada: false, motivo: "error_insert" }).estado, "error");
});

// ============================================================ registro ===

prueba("N14 registro: nunca guarda el texto ni el JID; solo huella, longitud y tipo de destino", () => {
    const e = construirEntrada({
        solicitud: { origen: "respuesta", tipo: "mis_numeros", usuarioId: "A", destino: { jid: "573001112233-1@g.us" }, claveEnvioUnico: null },
        modo: "shadow", resultado: { estado: "sombra", texto: "Tus números: 27", fuente: "plantilla", plantillaId: "p1" }, inicio: 1000, ahora: 1250
    });
    assert.strictEqual(e.huellaTexto, huella("Tus números: 27"));
    assert.deepStrictEqual([e.longitud, e.destino, e.duracionMs, e.modo], [15, "grupo", 250, "shadow"]);
    assert.ok(!JSON.stringify(e).includes("573001112233") && !JSON.stringify(e).includes("Tus números"));
    const mem = crearRegistroMemoria();
    mem.registrar(e);
    assert.strictEqual(mem.entradas.length, 1);
});

ejecutar("O1 · Núcleo aislado del orquestador");
