// ==========================================================================
// PRUEBAS — Sistema global de variables EFAAT
// (backend/shared/variables/{catalogoVariables,contextoVariables,resolverVariables}.js
//  + integración en backend/bot/ai/plantillaMensaje.js)
//
//     node backend/tests/variables/sistemaVariablesGlobales.test.js
// ==========================================================================

const assert = require("assert");

const catalogo = require("../../shared/variables/catalogoVariables");
const { construirContextoGlobal, contextoTieneRequisitos } = require("../../shared/variables/contextoVariables");
const { resolverVariable, resolverVariablesOrfanas, formatearMoneda } = require("../../shared/variables/resolverVariables");
const { construirVariables, aplicarPlantilla } = require("../../bot/ai/plantillaMensaje");

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

// ---------------------------------------------------------------- CATÁLOGO
test("catálogo: 'cliente' existe con su categoría y ejemplo", () => {
    const v = catalogo.obtenerVariable("cliente");
    assert.ok(v);
    assert.strictEqual(v.categoria, "CLIENTE");
    assert.ok(v.example.length > 0);
});

test("catálogo: cada variable declara key/categoria/description/example/requires/type", () => {
    for (const v of catalogo.listarCatalogo()) {
        assert.ok(v.key, "falta key");
        assert.ok(catalogo.CATEGORIAS[v.categoria], `categoría desconocida: ${v.categoria}`);
        assert.ok(v.description, `${v.key} sin description`);
        assert.ok(v.example !== undefined, `${v.key} sin example`);
        assert.ok(Array.isArray(v.requires), `${v.key}.requires no es arreglo`);
        assert.ok(v.type, `${v.key} sin type`);
    }
});

test("catálogo: no hay claves canónicas duplicadas", () => {
    const claves = catalogo.listarCatalogo().map(v => v.key);
    assert.strictEqual(new Set(claves).size, claves.length);
});

// ----------------------------------------------------------------- ALIASES
test("aliases: 'nombre' resuelve a la definición canónica 'cliente'", () => {
    const info = catalogo.resolverClaveCanonica("nombre");
    assert.ok(info);
    assert.strictEqual(info.definicion.key, "cliente");
});

test("aliases: 'valor' y 'valor_numero' resuelven a 'precio'", () => {
    assert.strictEqual(catalogo.resolverClaveCanonica("valor").definicion.key, "precio");
    assert.strictEqual(catalogo.resolverClaveCanonica("valor_numero").definicion.key, "precio");
});

test("aliases: 'reservados'/'disponibles' (motor de automatización) resuelven a claves del motor {{}}", () => {
    assert.strictEqual(catalogo.resolverClaveCanonica("reservados").definicion.key, "cantidad_reservados");
    assert.strictEqual(catalogo.resolverClaveCanonica("disponibles").definicion.key, "cantidad_disponibles");
});

test("aliases: 'nombre_evento' resuelve a 'evento'", () => {
    assert.strictEqual(catalogo.resolverClaveCanonica("nombre_evento").definicion.key, "evento");
});

test("aliases: 'numero'/'numerito'/'numeritos' resuelven a 'numeros_solicitados'", () => {
    assert.strictEqual(catalogo.resolverClaveCanonica("numero").definicion.key, "numeros_solicitados");
    assert.strictEqual(catalogo.resolverClaveCanonica("numerito").definicion.key, "numeros_solicitados");
    assert.strictEqual(catalogo.resolverClaveCanonica("numeritos").definicion.key, "numeros_solicitados");
});

test("aliases: forma sufijada de gramática 'ocupado_ocupados_ocupados' se reconoce", () => {
    const info = catalogo.resolverClaveCanonica("ocupado_ocupados_ocupados");
    assert.ok(info);
    assert.strictEqual(info.esGramaticaPorConjunto, true);
    assert.strictEqual(info.conjunto, "ocupados");
    assert.strictEqual(info.definicion.key, "ocupado_ocupados");
});

test("aliases: un nombre inventado no resuelve a nada", () => {
    assert.strictEqual(catalogo.resolverClaveCanonica("esto_no_existe"), null);
    assert.strictEqual(catalogo.esVariableConocida("monto_totall"), false);
});

// -------------------------------------------------------------- VALIDACIÓN
test("validación: detecta {{monto_totall}} como desconocida sin tocar las conocidas", () => {
    const desconocidas = catalogo.extraerVariablesDesconocidas("{{cliente}}, tu total es {{monto_totall}} y tu evento {{evento}}");
    assert.deepStrictEqual(desconocidas, ["monto_totall"]);
});

test("validación: plantilla 100% válida no reporta ninguna desconocida", () => {
    assert.deepStrictEqual(catalogo.extraerVariablesDesconocidas("{{cliente}}, {{numeros_reservados}} {{quedo_quedaron}}"), []);
});

// --------------------------------------------------------------- CONTEXTO
test("contexto: banderas de disponibilidad reflejan ctx.usuario/ctx.evento/ctx.reserva/ctx.consulta", () => {
    const ctx = { usuario: { nombre: "A" }, evento: { nombre_evento: "E" }, reserva: { ok: true } };
    const g = construirContextoGlobal(ctx);
    assert.strictEqual(g.disponible.usuario, true);
    assert.strictEqual(g.disponible.evento, true);
    assert.strictEqual(g.disponible.reserva, true);
    assert.strictEqual(g.disponible.consulta, false);
});

test("contexto: contextoTieneRequisitos exige TODOS los requires (AND)", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "A" } });
    assert.strictEqual(contextoTieneRequisitos(g, ["usuario"]), true);
    assert.strictEqual(contextoTieneRequisitos(g, ["usuario", "evento"]), false);
    assert.strictEqual(contextoTieneRequisitos(g, []), true);
});

test("contexto: 'estado_pago' se activa con una faceta modo=monto o modo=lista", () => {
    const gMonto = construirContextoGlobal({ consulta: { tipo: "consulta_pago", modo: "monto" } });
    const gLista = construirContextoGlobal({ consulta: { tipo: "consulta_pago", modo: "lista" } });
    const gNada = construirContextoGlobal({ consulta: { tipo: "mis_reservas" } });
    assert.strictEqual(gMonto.disponible.estado_pago, true);
    assert.strictEqual(gLista.disponible.estado_pago, true);
    // "mis_reservas" no es mis_numeros ni trae modo -> no activa estado_pago
    // por esta bandera (aunque numeros_totales_cliente resuelva por su cuenta
    // solo si además viene numerosDelUsuario, ver más abajo).
    assert.strictEqual(gNada.disponible.estado_pago, false);
});

// -------------------------------------------------------- RESOLVER GLOBAL
test("resolver: variable desconocida -> siempre ''", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {} });
    assert.strictEqual(resolverVariable("no_existe", g), "");
});

test("resolver: nunca devuelve undefined/null/[object Object]", () => {
    const g = construirContextoGlobal({});
    for (const v of catalogo.listarCatalogo()) {
        const valor = resolverVariable(v.key, g);
        assert.strictEqual(typeof valor, "string");
        assert.notStrictEqual(valor, "undefined");
        assert.notStrictEqual(valor, "null");
        assert.notStrictEqual(valor, "[object Object]");
    }
});

test("resolver: 'cliente' con contexto completo resuelve el nombre real", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "Andrés" }, evento: {} });
    assert.strictEqual(resolverVariable("cliente", g), "Andrés");
    assert.strictEqual(resolverVariable("nombre", g), "Andrés"); // alias
});

test("resolver: 'cliente' sin usuario -> '' (nunca inventa un nombre)", () => {
    const g = construirContextoGlobal({ evento: {} });
    assert.strictEqual(resolverVariable("cliente", g), "");
});

test("resolver: 'telefono' (huérfana) conectada a ctx.usuario.telefono", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "A", telefono: "3001234567" } });
    assert.strictEqual(resolverVariable("telefono", g), "3001234567");
});

test("resolver: 'premio' (huérfana) conectada a evento.premios[0].premio", () => {
    const g = construirContextoGlobal({ evento: { premios: [{ premio: "Nevera" }] } });
    assert.strictEqual(resolverVariable("premio", g), "Nevera");
});

test("resolver: monto_total/monto_pagado/monto_pendiente desde una faceta modo=monto", () => {
    const resultado = { tipo: "consulta_pago", modo: "monto", bucket: "pendiente", montoTotal: 50000, montoPagado: 30000, montoPendiente: 20000 };
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: resultado });
    assert.strictEqual(resolverVariable("monto_total", g), "$50.000");
    assert.strictEqual(resolverVariable("monto_pagado", g), "$30.000");
    assert.strictEqual(resolverVariable("monto_pendiente", g), "$20.000");
    assert.strictEqual(resolverVariable("pago_pendiente", g), "$20.000"); // alias
});

test("resolver: monto_* sin faceta de pago -> '' (nunca calcula por su cuenta)", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, reserva: { ok: true, reservados: ["12"] } });
    assert.strictEqual(resolverVariable("monto_total", g), "");
    assert.strictEqual(resolverVariable("monto_pagado", g), "");
    assert.strictEqual(resolverVariable("monto_pendiente", g), "");
});

test("resolver: numeros_pagados/pendientes/totales_cliente desde una faceta modo=lista", () => {
    const resultado = { tipo: "consulta_pago", modo: "lista", bucket: "pagado", total: 5, reservados: ["23", "45"], pagados: ["12", "27", "60"], numerosDelUsuario: ["12", "23", "27", "45", "60"] };
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: resultado });
    assert.strictEqual(resolverVariable("numeros_pagados", g), "( 12 - 27 - 60 )");
    assert.strictEqual(resolverVariable("numeros_pendientes", g), "( 23 - 45 )");
    assert.strictEqual(resolverVariable("numeros_totales_cliente", g), "( 12 - 23 - 27 - 45 - 60 )");
    assert.strictEqual(resolverVariable("numeros", g), "( 12 - 23 - 27 - 45 - 60 )"); // alias
    assert.strictEqual(resolverVariable("cantidad_pagados", g), "3");
    assert.strictEqual(resolverVariable("cantidad_pendientes", g), "2");
});

test("resolver: numeros_totales_cliente también resuelve desde mis_numeros/mis_reservas (mismo campo numerosDelUsuario)", () => {
    const resultado = { tipo: "mis_numeros", numerosDelUsuario: ["10", "20"] };
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: resultado });
    assert.strictEqual(resolverVariable("numeros_totales_cliente", g), "( 10 - 20 )");
});

test("resolver: cantidad_pagados/pendientes también resuelve desde modo=cantidad con el bucket correcto", () => {
    const gPagado = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: { tipo: "consulta_pago", modo: "cantidad", bucket: "pagado", cantidad: 4 } });
    const gPendiente = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: { tipo: "consulta_pago", modo: "cantidad", bucket: "pendiente", cantidad: 2 } });
    assert.strictEqual(resolverVariable("cantidad_pagados", gPagado), "4");
    assert.strictEqual(resolverVariable("cantidad_pendientes", gPendiente), "2");
    // el bucket equivocado no debe "adivinar" el valor
    assert.strictEqual(resolverVariable("cantidad_pendientes", gPagado), "");
});

test("resolver: consulta 'multiple' — busca la faceta correcta dentro de resultados[]", () => {
    const resultado = {
        tipo: "multiple",
        resultados: [
            { tipo: "mis_numeros", numerosDelUsuario: ["12", "45"] },
            { tipo: "consulta_pago", modo: "monto", bucket: "pendiente", montoTotal: 20000, montoPagado: 0, montoPendiente: 20000 }
        ]
    };
    const g = construirContextoGlobal({ usuario: { nombre: "A" }, evento: {}, consulta: resultado });
    assert.strictEqual(resolverVariable("numeros_totales_cliente", g), "( 12 - 45 )");
    assert.strictEqual(resolverVariable("monto_pendiente", g), "$20.000");
});

test("resolver: variables de gramática (concordancia) resuelven vía gramatica.js, sin requires", () => {
    const g = construirContextoGlobal({ reserva: { ok: true, reservados: ["12"] }, textoOriginal: "12" });
    assert.strictEqual(resolverVariable("numero_numeros", g), "número");
    const g2 = construirContextoGlobal({ reserva: { ok: true, reservados: ["12", "45"] }, textoOriginal: "12 y 45" });
    assert.strictEqual(resolverVariable("numero_numeros", g2), "números");
});

test("resolverVariablesOrfanas: solo incluye las variables marcadas NUEVA", () => {
    const g = construirContextoGlobal({ usuario: { nombre: "A", telefono: "300" }, evento: {} });
    const orfanas = resolverVariablesOrfanas(g);
    assert.ok("telefono" in orfanas);
    assert.ok("monto_total" in orfanas);
    assert.ok(!("cliente" in orfanas)); // "cliente" es EXISTENTE, no huérfana
});

test("formatearMoneda: formato es-CO consistente con el que ya usa resolverConsulta.js", () => {
    assert.strictEqual(formatearMoneda(50000), "$50.000");
    assert.strictEqual(formatearMoneda(0), "$0");
    assert.strictEqual(formatearMoneda(undefined), "$0");
});

// --------------------------------------------- COMPATIBILIDAD HACIA ATRÁS
test("compatibilidad: construirVariables() sigue devolviendo exactamente los mismos valores de antes para una reserva", () => {

    const resultado = { ok: true, reservados: ["12", "45"], ocupados: [] };
    const ctx = {
        usuario: { nombre: "Andrés" },
        evento: { nombre_evento: "Sorteo X", valor: 5000, hora_fin: "20:00", fecha_evento: "2026-01-20" },
        textoOriginal: "12 y 45",
        reserva: resultado
    };

    const vars = construirVariables(ctx, resultado);

    assert.strictEqual(vars.cliente, "Andrés");
    assert.strictEqual(vars.evento, "Sorteo X");
    assert.strictEqual(vars.numeros_reservados, "( 12 - 45 )");
    assert.strictEqual(vars.precio, "5000");
    assert.strictEqual(vars.hora, "8:00 PM");
    assert.strictEqual(vars.tu_numero_tus_numeros, "tus números");

    // Variables huérfanas nuevas presentes pero vacías (sin faceta de pago).
    assert.strictEqual(vars.monto_total, "");
    assert.strictEqual(vars.numeros_pagados, "");

});

test("compatibilidad: una plantilla ya guardada con solo variables antiguas renderiza IDÉNTICO", () => {

    const resultado = { ok: true, reservados: ["12"], ocupados: [] };
    const ctx = { usuario: { nombre: "Andrés" }, evento: { nombre_evento: "Sorteo X" }, textoOriginal: "12", reserva: resultado };
    const vars = construirVariables(ctx, resultado);

    const texto = aplicarPlantilla("{{cliente}}, {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}} 👍", vars, {});
    assert.strictEqual(texto, "Andrés, ( 12 ) quedó reservado 👍");

});

test("compatibilidad: una plantilla NUEVA con {{monto_pendiente}} funciona cuando el resultado sí trae pago", () => {

    const resultado = { tipo: "consulta_pago", modo: "monto", bucket: "pendiente", montoTotal: 50000, montoPagado: 30000, montoPendiente: 20000, cantidad: undefined };
    const ctx = { usuario: { nombre: "Andrés" }, evento: { nombre_evento: "Sorteo X" }, consulta: resultado };
    const vars = construirVariables(ctx, resultado);

    const texto = aplicarPlantilla("{{cliente}}, debes {{monto_pendiente}} de {{monto_total}}.", vars, {});
    assert.strictEqual(texto, "Andrés, debes $20.000 de $50.000.");

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
