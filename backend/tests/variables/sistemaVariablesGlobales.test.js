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
const { formatearGrillaNumeros, determinarColumnasGrilla } = require("../../bot/ai/gramatica");

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

// ----------------------------------- MENSAJE "DISPONIBLES" — GRILLA CON 🍀
// (corrección 2026-09-13: las filas CRECEN según la cantidad total — ya no
// hay un límite de 3 filas, el ancho de fila lo decide
// determinarColumnasGrilla(). Sin tocar la lógica de disponibilidad real:
// consultarDisponibilidad.js sigue devolviendo exactamente los mismos
// números — esto solo cambia cómo se presentan).

// Helpers de verificación reutilizados por todos los casos de cantidad.
function filasDe(texto) {
    return texto.split("\n").filter(f => f.length > 0);
}

function numerosDeFila(fila) {
    return fila.split("🍀").map(s => s.trim()).filter(Boolean);
}

function verificarGrillaCompleta(numerosOriginales, columnasEsperadas) {

    const grilla = formatearGrillaNumeros(numerosOriginales);
    const filas = filasDe(grilla);

    const unicosEsperados = [...new Set(numerosOriginales.filter(n => n !== null && n !== undefined && n !== ""))]
        .sort((a, b) => Number(a) - Number(b));

    const reconstruido = filas.flatMap(numerosDeFila);

    // 1) Ningún número inventado ni perdido, sin duplicados, orden correcto.
    assert.deepStrictEqual(reconstruido, unicosEsperados, "deben aparecer TODOS los números reales, sin repetir y en orden ascendente");

    // 2) Todas las filas (salvo quizás la última) tienen exactamente el
    //    ancho esperado; ninguna fila supera ese ancho.
    filas.forEach((fila, i) => {
        const cantidad = numerosDeFila(fila).length;
        assert.ok(cantidad <= columnasEsperadas, `fila ${i} tiene ${cantidad} números, más que el máximo esperado (${columnasEsperadas})`);
        if (i < filas.length - 1) {
            assert.strictEqual(cantidad, columnasEsperadas, `fila ${i} (no es la última) debe tener exactamente ${columnasEsperadas} números`);
        }
    });

    // 3) Cada número lleva su 🍀 delante.
    assert.ok(filas.every(f => numerosDeFila(f).length > 0), "cada fila debe tener al menos un número");
    assert.ok(grilla.includes("🍀"), "debe llevar el emoji 🍀 delante de los números");

    return { grilla, filas };

}

function generarNumeros(cantidad) {
    return Array.from({ length: cantidad }, (_, i) => String(i + 1).padStart(2, "0"));
}

const CASOS_CANTIDAD = [
    { cantidad: 1, columnas: 1 },
    { cantidad: 2, columnas: 2 },
    { cantidad: 7, columnas: 3 },
    { cantidad: 9, columnas: 3 },
    { cantidad: 12, columnas: 3 },
    { cantidad: 39, columnas: 3 },
    { cantidad: 40, columnas: 3 },
    { cantidad: 60, columnas: 3 },
    { cantidad: 61, columnas: 4 },
    { cantidad: 80, columnas: 4 },
    { cantidad: 99, columnas: 4 }
];

for (const { cantidad, columnas } of CASOS_CANTIDAD) {

    test(`formatearGrillaNumeros: ${cantidad} números -> ${columnas} por fila, se muestran TODOS sin duplicar`, () => {

        assert.strictEqual(determinarColumnasGrilla(cantidad), columnas, `determinarColumnasGrilla(${cantidad}) debe devolver ${columnas}`);

        const numeros = generarNumeros(cantidad);
        const { filas } = verificarGrillaCompleta(numeros, columnas);

        const filasEsperadas = Math.ceil(cantidad / columnas);
        assert.strictEqual(filas.length, filasEsperadas, `${cantidad} números a ${columnas} por fila deben producir ${filasEsperadas} filas (nunca un límite fijo de filas)`);

    });

}

test("formatearGrillaNumeros: datos DUPLICADOS en la entrada -> cada número aparece una sola vez en la salida", () => {

    const conDuplicados = ["05", "12", "05", "23", "12", "05", "45"];
    const grilla = formatearGrillaNumeros(conDuplicados);
    const reconstruido = filasDe(grilla).flatMap(numerosDeFila);

    assert.deepStrictEqual(reconstruido, ["05", "12", "23", "45"], "debe deduplicar antes de construir el texto, no filtrar visualmente después");
    assert.strictEqual(new Set(reconstruido).size, reconstruido.length, "no debe quedar ningún número repetido");

});

test("formatearGrillaNumeros: datos DESORDENADOS en la entrada -> salida siempre ordenada de menor a mayor", () => {

    const desordenados = ["45", "05", "99", "12", "23", "01"];
    const grilla = formatearGrillaNumeros(desordenados);
    const reconstruido = filasDe(grilla).flatMap(numerosDeFila);

    assert.deepStrictEqual(reconstruido, ["01", "05", "12", "23", "45", "99"]);

});

test("formatearGrillaNumeros: 0 números -> cadena vacía (nunca inventa datos)", () => {

    assert.strictEqual(formatearGrillaNumeros([]), "");
    assert.strictEqual(formatearGrillaNumeros(null), "");
    assert.strictEqual(formatearGrillaNumeros(undefined), "");

});

test("construirVariables(): numeros_disponibles usa la nueva grilla (con 🍀, todas las filas necesarias) para resultado.tipo='disponibilidad'", () => {

    const numerosDisponibles = generarNumeros(61); // > 60 -> 4 por fila
    const resultado = { tipo: "disponibilidad", numerosDisponibles, numerosOcupados: [] };
    const ctx = { usuario: {}, evento: { nombre_evento: "Sinuano Noche" }, consulta: resultado };

    const vars = construirVariables(ctx, resultado);
    const filas = filasDe(vars.numeros_disponibles);

    assert.strictEqual(filas.length, Math.ceil(61 / 4));
    assert.strictEqual(numerosDeFila(filas[0]).length, 4);
    assert.deepStrictEqual(filasDe(vars.numeros_disponibles).flatMap(numerosDeFila), numerosDisponibles);

});

test("construirVariables(): numeros_reservados/ocupados/solicitados NO cambian de formato (compatibilidad)", () => {

    const resultado = { ok: true, reservados: ["12", "45"], ocupados: ["07"] };
    const ctx = { usuario: { nombre: "Andrés" }, evento: { nombre_evento: "Sorteo X" }, textoOriginal: "12, 45 y 07", reserva: resultado };
    const vars = construirVariables(ctx, resultado);

    assert.strictEqual(vars.numeros_reservados, "( 12 - 45 )");
    assert.strictEqual(vars.numeros_ocupados, "( 07 )");

});

// Los 5 estilos pedidos para el mensaje "Disponibles" — se prueban con el
// código REAL (construirVariables + aplicarPlantilla), no una reimplementación.
const ESTILOS_DISPONIBLES = {

    clasico:
        "🎲 *NÚMEROS DISPONIBLES* 🎲\n\n📋 Estos son los números que puedes elegir:\n\n{{numeros_disponibles}}\n\n⚡ ¡Elige rápido antes de que alguien se adelante!\n🍀 *¡Mucha suerte, familia!*",

    dinamico:
        "🔥 *¡TABLA ACTUALIZADA, FAMILIA!* 🔥\n\n🟢 *Disponibles en este momento:*\n\n{{numeros_disponibles}}\n\n👀 Revisa bien y escoge tu favorito.\n🎲 *¡El que decide rápido, juega tranquilo!* 🍀",

    comercial:
        "🎯 *¡Todavía hay números disponibles!*\n\n🎲 Dinámica: *{{nombre_evento}}*\n\n{{numeros_disponibles}}\n\n📲 Escríbeme el número que deseas jugar y te ayudo con tu reserva.\n\n🍀 *¡Éxitos familia!*",

    corto:
        "⚡ *DISPONIBLES AHORA* ⚡\n\n{{numeros_disponibles}}\n\n🟢 Disponibilidad actualizada.\n🎲 *¡A jugar, familia!* 🍀",

    familia:
        "👑 *FAMILIA, AQUÍ ESTÁ LO QUE QUEDA* 👑\n\n🎲 *{{nombre_evento}}*\n\n{{numeros_disponibles}}\n\n⏳ La disponibilidad puede cambiar en cualquier momento.\n\n🔥 *¡Si tienes uno en mente, no lo dejes pasar!* 🍀"

};

for (const [nombreEstilo, contenido] of Object.entries(ESTILOS_DISPONIBLES)) {

    test(`estilo "${nombreEstilo}": renderiza sin undefined/null/[object Object], con 🍀 y TODOS los números`, () => {

        const numerosDisponibles = generarNumeros(22); // <40 y >=7 -> 3 por fila
        const resultado = { tipo: "disponibilidad", numerosDisponibles, numerosOcupados: [] };
        const ctx = { usuario: {}, evento: { nombre_evento: "Sinuano Noche" }, consulta: resultado };

        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla(contenido, vars, {});

        assert.ok(texto, "debe producir texto");
        assert.ok(!texto.includes("undefined"), "no debe contener 'undefined'");
        assert.ok(!texto.includes("null"), "no debe contener 'null'");
        assert.ok(!texto.includes("[object Object]"), "no debe contener '[object Object]'");
        assert.ok(!/\{\{.*\}\}/.test(texto), "no debe quedar ninguna variable sin resolver");

        // Los 22 números deben aparecer todos, con 🍀, sin duplicar.
        const numerosEnTexto = [...texto.matchAll(/🍀\s*(\d+)/g)].map(m => m[1]);
        assert.deepStrictEqual(numerosEnTexto, numerosDisponibles);

    });

}

test("estilo \"comercial\": {{nombre_evento}} (alias) resuelve al mismo valor real que {{evento}}", () => {

    const resultado = { tipo: "disponibilidad", numerosDisponibles: ["05"], numerosOcupados: [] };
    const ctx = { usuario: {}, evento: { nombre_evento: "Loteria de Boyacá" }, consulta: resultado };

    const vars = construirVariables(ctx, resultado);
    const texto = aplicarPlantilla(ESTILOS_DISPONIBLES.comercial, vars, {});

    assert.ok(texto.includes("Dinámica: *Loteria de Boyacá*"), "el alias nombre_evento debe resolver al mismo dato real que 'evento'");

});

test("estilo \"corto\": sigue funcionando con 0 números disponibles (sin inventar datos)", () => {

    const resultado = { tipo: "disponibilidad", numerosDisponibles: [], numerosOcupados: [] };
    const ctx = { usuario: {}, evento: { nombre_evento: "Sinuano Noche" }, consulta: resultado };

    const vars = construirVariables(ctx, resultado);
    const texto = aplicarPlantilla(ESTILOS_DISPONIBLES.corto, vars, {});

    assert.ok(!texto.includes("undefined") && !texto.includes("null"));
    assert.ok(!/\{\{.*\}\}/.test(texto));

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
