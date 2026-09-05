// Prueba de la capa CENTRAL de gramática singular/plural (bot/ai/gramatica.js)
// y su integración en plantillaMensaje.js, contextBuilder.js y
// resolverConsulta.js. Cubre 0, 1, 2, 3 y 10 números para todos los tipos
// de respuesta aplicables (reserva_completa, reserva_parcial,
// numero_ocupado, todos_ocupados, mis_numeros, mis_reservas,
// numero_especifico, cantidad_reservas, disponibilidad).
//
// NO usa Supabase real: consultarMisNumeros/consultarDisponibilidad se
// reemplazan en cache de require() (mismo patrón que _test_singular_plural.js)
// para poder probar todas las cantidades sin datos reales.
// Ejecutar: node backend/_test_gramatica_central.js
const path = require("path");
const CONSULTAS_DIR = path.join(__dirname, "bot", "funciones", "consultas");
const LIB_DIR = path.join(__dirname, "lib");

let mockNumerosDelUsuario = [];
let mockDisponibles = [];
let mockOcupados = [];
let mockCantidad = 0;

function fakeModule(modId, exportsObj, baseDir) {
    const resolved = require.resolve(modId, { paths: [baseDir] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

fakeModule("./supabase", {}, LIB_DIR);

fakeModule("./consultarMisNumeros", {
    consultarMisNumeros: async () => mockNumerosDelUsuario
}, CONSULTAS_DIR);

fakeModule("./consultarCantidad", {
    consultarCantidad: async () => mockCantidad
}, CONSULTAS_DIR);

fakeModule("./consultarDisponibilidad", {
    consultarDisponibilidad: async () => ({ numerosDisponibles: mockDisponibles, numerosOcupados: mockOcupados })
}, CONSULTAS_DIR);

const { construirVariablesGramaticales, calcularNumerosRelevantes, formatearListaNumeros } = require("./bot/ai/gramatica.js");
const { construirVariables, aplicarPlantilla, calcularTipoPresentacion } = require("./bot/ai/plantillaMensaje.js");
const { construirContextoReserva } = require("./bot/ai/contextBuilder.js");
const { resolverConsulta } = require(path.join(CONSULTAS_DIR, "resolverConsulta.js"));

let pasaron = 0, fallaron = 0;
const fallos = [];

function assertEq(actual, esperado, msg) {
    if (actual === esperado) {
        pasaron++;
        console.log("✅", msg);
    } else {
        fallaron++;
        fallos.push(`${msg} — esperado="${esperado}" obtenido="${actual}"`);
        console.log("❌", msg, `— esperado="${esperado}" obtenido="${actual}"`);
    }
}

// Verifica que un texto NUNCA contenga formas incorrectas para la cantidad
// dada. Usa límites de palabra para no confundir subcadenas.
const FORMAS_SINGULARES = ["tu número", "el número", "ese número", "está", "es", "reservado", "ocupado", "disponible", "número"];
const FORMAS_PLURALES = ["tus números", "los números", "esos números", "están", "son", "reservados", "ocupados", "disponibles", "números"];

function contienePlarelIncorrectoEn1(texto) {
    // En cantidad=1 no deben aparecer las formas plurales (excepto que
    // "número" es substring de "números", así que se compara por palabra
    // completa vía regex con límites).
    return FORMAS_PLURALES.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto));
}

function contieneSingularIncorrectoEn2Mas(texto) {
    // En cantidad>=2 no deben aparecer las formas singulares exclusivas
    // (excluye "número" que es substring válido de "números" — se filtra
    // aparte con límites de palabra estrictos).
    const singularesExclusivos = ["tu número", "el número", "ese número", "reservado", "ocupado", "disponible"];
    return singularesExclusivos.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto))
        || /(^|[^a-záéíóúñ])(está|es)([^a-záéíóúñ]|$)/i.test(texto);
}

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-03", hora_fin: "22:00", valor: 5000 },
        textoOriginal: "",
        ...extra
    };
}

function numerosDeCantidad(n) {
    const base = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "99"];
    return base.slice(0, n);
}

(async () => {

    console.log("\n=== 1) construirVariablesGramaticales(cantidad) — pares completos, 0/1/2/3/10 ===\n");

    for (const n of [0, 1, 2, 3, 10]) {

        const g = construirVariablesGramaticales(n);
        const esperado = n === 1 ? "singular" : "plural";

        const tabla = n === 1 ? {
            tu_numero_tus_numeros: "tu número",
            el_numero_los_numeros: "el número",
            ese_esos: "ese número",
            esta_estan: "está",
            es_son: "es",
            reservado_reservados: "reservado",
            ocupado_ocupados: "ocupado",
            disponible_disponibles: "disponible",
            numero_numeros: "número"
        } : {
            tu_numero_tus_numeros: "tus números",
            el_numero_los_numeros: "los números",
            ese_esos: "esos números",
            esta_estan: "están",
            es_son: "son",
            reservado_reservados: "reservados",
            ocupado_ocupados: "ocupados",
            disponible_disponibles: "disponibles",
            numero_numeros: "números"
        };

        for (const clave of Object.keys(tabla)) {
            assertEq(g[clave], tabla[clave], `cantidad=${n} (${esperado}): ${clave}`);
        }

    }

    console.log("\n=== 2) construirVariables (plantillas) — todos los tipos aplicables, 0/1/2/3/10 ===\n");

    // --- reserva_completa ---
    for (const n of [1, 2, 3, 10]) {
        const reservados = numerosDeCantidad(n);
        const ctx = ctxBase({ reserva: { ok: true, reservados, ocupados: [], mensaje: "" }, textoOriginal: `quiero ${reservados.join(", ")}` });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_completa", `reserva_completa (${n}): tipoPresentacion`);
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} {{el_numero_los_numeros}} {{reservado_reservados}} {{es_son}}: {{numeros_reservados}}. {{esta_estan}} confirmado.", vars);
        if (n === 1) {
            assertEq(contienePlarelIncorrectoEn1(texto), false, `reserva_completa (1): sin plural incorrecto → "${texto}"`);
        } else {
            assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `reserva_completa (${n}): sin singular incorrecto → "${texto}"`);
        }
    }

    // --- reserva_parcial (cuenta manda "reservados") ---
    for (const n of [1, 2, 3, 10]) {
        const reservados = numerosDeCantidad(n);
        const ctx = ctxBase({ reserva: { ok: true, reservados, ocupados: ["77"], mensaje: "" }, textoOriginal: `quiero ${reservados.join(", ")} y 77` });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_parcial", `reserva_parcial (${n} reservados): tipoPresentacion`);
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} ({{reservado_reservados}}).", vars);
        if (n === 1) {
            assertEq(contienePlarelIncorrectoEn1(texto), false, `reserva_parcial (1 reservado): sin plural incorrecto → "${texto}"`);
        } else {
            assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `reserva_parcial (${n} reservados): sin singular incorrecto → "${texto}"`);
        }
    }

    // --- numero_ocupado: SIEMPRE 1 solicitado por definición (calcularTipoPresentacion) ---
    {
        const ctx = ctxBase({ reserva: { ok: false, reservados: [], ocupados: ["45"], mensaje: "" }, textoOriginal: "el 45" });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "numero_ocupado", "numero_ocupado: tipoPresentacion");
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} {{es_son}} {{ocupado_ocupados}}.", vars);
        assertEq(contienePlarelIncorrectoEn1(texto), false, `numero_ocupado (1): sin plural incorrecto → "${texto}"`);
    }

    // --- todos_ocupados: 2, 3, 10 solicitados (1 solo cae en numero_ocupado, no aquí) ---
    for (const n of [2, 3, 10]) {
        const solicitados = numerosDeCantidad(n);
        const ctx = ctxBase({ reserva: { ok: false, reservados: [], ocupados: solicitados, mensaje: "" }, textoOriginal: `quiero ${solicitados.join(", ")}` });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "todos_ocupados", `todos_ocupados (${n}): tipoPresentacion`);
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} {{es_son}} {{ocupado_ocupados}}.", vars);
        assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `todos_ocupados (${n}): sin singular incorrecto → "${texto}"`);
    }

    // --- cantidad_reservas vía plantilla (construirVariables): resultado.cantidad
    // es un ESCALAR, no un arreglo — bug real encontrado al planear la
    // migración de plantillas (sin esta rama en gramatica.js, cualquier
    // plantilla de este tipo con {{numero_numeros}}/{{reservado_reservados}}
    // caía siempre en plural, sin importar la cantidad real). ---
    for (const n of [0, 1, 2, 3, 10]) {
        const resultado = { tipo: "cantidad_reservas", cantidad: n };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("Tienes {{cantidad}} {{numero_numeros}} {{reservado_reservados}}.", vars);
        if (n === 1) {
            assertEq(texto, "Tienes 1 número reservado.", `cantidad_reservas vía plantilla (1): singular correcto`);
            assertEq(contienePlarelIncorrectoEn1(texto), false, `cantidad_reservas vía plantilla (1): sin plural incorrecto → "${texto}"`);
        } else {
            assertEq(texto, `Tienes ${n} números reservados.`, `cantidad_reservas vía plantilla (${n}): plural correcto`);
            assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `cantidad_reservas vía plantilla (${n}): sin singular incorrecto → "${texto}"`);
        }
    }

    // --- mis_numeros / mis_reservas: 0/1/2/3/10 ---
    for (const tipoConsulta of ["mis_numeros", "mis_reservas"]) {
        for (const n of [0, 1, 2, 3, 10]) {
            const numerosDelUsuario = numerosDeCantidad(n);
            const resultado = { tipo: tipoConsulta, numerosDelUsuario };
            const ctx = ctxBase({ consulta: resultado });
            const vars = construirVariables(ctx, resultado);
            const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} {{reservado_reservados}} {{es_son}}: {{numeros_reservados}}", vars);
            if (n === 1) {
                assertEq(contienePlarelIncorrectoEn1(texto), false, `${tipoConsulta} (1): sin plural incorrecto → "${texto}"`);
            } else if (n >= 2) {
                assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `${tipoConsulta} (${n}): sin singular incorrecto → "${texto}"`);
            } else {
                // n === 0: regla explícita → formas neutras/plurales, nunca singular incorrecto.
                assertEq(contieneSingularIncorrectoEn2Mas(texto), false, `${tipoConsulta} (0): sin singular incorrecto → "${texto}"`);
            }
        }
    }

    // --- numero_especifico: siempre 1 (por definición del tipo) ---
    {
        const resultado = { tipo: "numero_especifico", numero: "45", estadoReal: "libre" };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} {{es_son}} {{ese_esos}}.", vars);
        assertEq(contienePlarelIncorrectoEn1(texto), false, `numero_especifico (1): sin plural incorrecto → "${texto}"`);
    }

    console.log("\n=== 3) resolverConsulta — fallbacks fijos, 0/1/2/3/10 ===\n");

    for (const tipo of ["mis_numeros", "mis_reservas"]) {

        for (const n of [0, 1, 2, 3, 10]) {

            mockNumerosDelUsuario = numerosDeCantidad(n);
            const r = await resolverConsulta({ tipo, evento: { tabla: "t" }, usuario: { id: "u1" } });

            if (n === 0) {
                assertEq(r.mensaje, "No tienes números reservados actualmente.", `${tipo} fallback (0): mensaje`);
            } else if (n === 1) {
                assertEq(r.mensaje, `Tu número reservado es: ${formatearListaNumeros(mockNumerosDelUsuario)}`, `${tipo} fallback (1): mensaje singular`);
                assertEq(contienePlarelIncorrectoEn1(r.mensaje), false, `${tipo} fallback (1): sin plural incorrecto → "${r.mensaje}"`);
            } else {
                assertEq(r.mensaje, `Tus números reservados son: ${formatearListaNumeros(mockNumerosDelUsuario)}`, `${tipo} fallback (${n}): mensaje plural`);
                assertEq(contieneSingularIncorrectoEn2Mas(r.mensaje), false, `${tipo} fallback (${n}): sin singular incorrecto → "${r.mensaje}"`);
            }

        }

    }

    for (const n of [0, 1, 2, 3, 10]) {

        mockCantidad = n;
        const r = await resolverConsulta({ tipo: "cantidad_reservas", evento: { tabla: "t" }, usuario: { id: "u1" } });

        if (n === 1) {
            assertEq(r.mensaje, "Tienes 1 número reservado.", "cantidad_reservas (1): mensaje singular");
            assertEq(contienePlarelIncorrectoEn1(r.mensaje), false, `cantidad_reservas (1): sin plural incorrecto → "${r.mensaje}"`);
        } else {
            assertEq(r.mensaje, `Tienes ${n} números reservados.`, `cantidad_reservas (${n}): mensaje plural`);
            assertEq(contieneSingularIncorrectoEn2Mas(r.mensaje), false, `cantidad_reservas (${n}): sin singular incorrecto → "${r.mensaje}"`);
        }

    }

    for (const n of [0, 1, 2, 3, 10]) {

        mockDisponibles = numerosDeCantidad(n);
        mockOcupados = [];
        const r = await resolverConsulta({ tipo: "disponibilidad", evento: { tabla: "t" }, usuario: { id: "u1" } });

        if (n === 0) {
            assertEq(r.mensaje, "No quedan números disponibles.", "disponibilidad (0): mensaje");
        } else if (n === 1) {
            assertEq(r.mensaje, `Número disponible (1): ${formatearListaNumeros(mockDisponibles)}`, "disponibilidad (1): mensaje singular (bug corregido)");
            assertEq(contienePlarelIncorrectoEn1(r.mensaje), false, `disponibilidad (1): sin plural incorrecto → "${r.mensaje}"`);
        } else {
            assertEq(r.mensaje, `Números disponibles (${n}): ${formatearListaNumeros(mockDisponibles)}`, `disponibilidad (${n}): mensaje plural`);
            assertEq(contieneSingularIncorrectoEn2Mas(r.mensaje), false, `disponibilidad (${n}): sin singular incorrecto → "${r.mensaje}"`);
        }

    }

    console.log("\n=== 4) contextBuilder — resultado.gramatica llega correcto a Gemini, 0/1/2/3/10 ===\n");

    for (const n of [1, 2, 3, 10]) {

        const reservados = numerosDeCantidad(n);
        const ctx = ctxBase({ reserva: { ok: true, reservados, ocupados: [], mensaje: "" }, textoOriginal: `quiero ${reservados.join(", ")}` });
        const contexto = construirContextoReserva(ctx);

        assertEq(contexto.resultado.gramatica.cantidadPropiedad, n, `contextBuilder reserva (${n}): cantidadPropiedad`);
        assertEq(contexto.resultado.gramatica.formasPropiedad.tu_numero_tus_numeros, n === 1 ? "tu número" : "tus números", `contextBuilder reserva (${n}): formasPropiedad.tu_numero_tus_numeros`);
        assertEq(contexto.resultado.gramatica.formasGenerales.es_son, n === 1 ? "es" : "son", `contextBuilder reserva (${n}): formasGenerales.es_son`);

    }

    for (const n of [0, 1, 2, 3, 10]) {

        const resultado = { tipo: "mis_numeros", numerosDelUsuario: numerosDeCantidad(n), mensaje: "x" };
        const ctx = ctxBase({ consulta: resultado });
        const contexto = construirContextoReserva(ctx);

        assertEq(contexto.resultado.gramatica.cantidadPropiedad, n, `contextBuilder mis_numeros (${n}): cantidadPropiedad`);
        assertEq(contexto.resultado.gramatica.formasPropiedad.tu_numero_tus_numeros, n === 1 ? "tu número" : "tus números", `contextBuilder mis_numeros (${n}): formasPropiedad.tu_numero_tus_numeros`);
        assertEq(contexto.resultado.mensaje, undefined, `contextBuilder mis_numeros (${n}): "mensaje" fijo NO se reenvía a Gemini`);

    }

    for (const n of [0, 1, 2, 3, 10]) {

        const resultado = { tipo: "disponibilidad", numerosDisponibles: numerosDeCantidad(n), numerosOcupados: [], mensaje: "x" };
        const ctx = ctxBase({ consulta: resultado });
        const contexto = construirContextoReserva(ctx);

        // disponibilidad no tiene dueño: cantidadPropiedad debe ser 0 siempre,
        // pero cantidadNumeros (formasGenerales) sí debe reflejar la cantidad real.
        assertEq(contexto.resultado.gramatica.cantidadPropiedad, 0, `contextBuilder disponibilidad (${n}): cantidadPropiedad siempre 0 (sin dueño)`);
        assertEq(contexto.resultado.gramatica.cantidadNumeros, n, `contextBuilder disponibilidad (${n}): cantidadNumeros`);
        assertEq(contexto.resultado.gramatica.formasGenerales.numero_numeros, n === 1 ? "número" : "números", `contextBuilder disponibilidad (${n}): formasGenerales.numero_numeros`);
        assertEq(contexto.resultado.gramatica.formasGenerales.disponible_disponibles, n === 1 ? "disponible" : "disponibles", `contextBuilder disponibilidad (${n}): formasGenerales.disponible_disponibles`);

    }

    console.log("\n============================");
    console.log(`TOTAL: ${pasaron + fallaron}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================\n");

    if (fallaron > 0) {
        console.log("Fallos:");
        fallos.forEach(f => console.log(" -", f));
        process.exit(1);
    }

})();
