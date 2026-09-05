// Corrección de PRESENTACIÓN — formato único y obligatorio para listas de
// números: "( 27 )" para uno solo, "( 27 - 45 - 60 )" para varios. Fuente
// única: bot/ai/gramatica.js#formatearListaNumeros(), consumida por
// plantillaMensaje.js (construirVariables) y resolverConsulta.js
// (fallbacks fijos). Ningún otro archivo formatea listas de números por
// su cuenta.
//
// NO usa Supabase real (mismo patrón que los tests anteriores). Cubre los
// 8 escenarios del criterio de aceptación + verificación explícita de que
// nunca aparezcan los formatos prohibidos (coma, "/", corchetes, guion
// pegado, paréntesis sin espacio interno).
// Ejecutar: node backend/_test_formato_numeros.js
const path = require("path");
const CONSULTAS_DIR = path.join(__dirname, "bot", "funciones", "consultas");
const RESERVAS_DIR = path.join(__dirname, "bot", "funciones", "reservas");
const LIB_DIR = path.join(__dirname, "lib");

let mockNumerosDelUsuario = [];
let mockDisponibles = [];
let mockOcupados = [];

function fakeModule(modId, exportsObj, baseDir) {
    const resolved = require.resolve(modId, { paths: [baseDir] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

fakeModule("./supabase", {}, LIB_DIR);
fakeModule("./consultarMisNumeros", { consultarMisNumeros: async () => mockNumerosDelUsuario }, CONSULTAS_DIR);
fakeModule("./consultarDisponibilidad", {
    consultarDisponibilidad: async () => ({ numerosDisponibles: mockDisponibles, numerosOcupados: mockOcupados })
}, CONSULTAS_DIR);
fakeModule("./consultarNumero", {
    consultarNumero: async ({ numero }) => ({ numero, estadoReal: "libre" })
}, CONSULTAS_DIR);

// ---- detectarReserva.js: mismo patrón de módulos falsos, aislado del resto ----
// OJO: "./extraerNumeros" NO se reemplaza — es una función pura (sin
// Supabase) que TAMBIÉN usa gramatica.js/plantillaMensaje.js más arriba en
// este mismo archivo; el caché de módulos de Node es compartido por todo
// el proceso, así que sustituirla aquí rompería los escenarios 1-8.
fakeModule("./validarTextoReserva", { validarTextoReserva: () => true }, RESERVAS_DIR);
fakeModule("./consultarReservas", { consultarReservas: async () => [] }, RESERVAS_DIR);
fakeModule("./reservarNumeros", { reservarNumeros: async (a) => a.numeros }, RESERVAS_DIR);
fakeModule("./actualizarEvento", { actualizarEvento: async () => {} }, RESERVAS_DIR);

const DETECTAR_RESERVA_PATH = path.join(RESERVAS_DIR, "detectarReserva.js");

function cargarDetectarReservaCon(validarReservasImpl) {
    fakeModule("./validarReservas", { validarReservas: validarReservasImpl }, RESERVAS_DIR);
    delete require.cache[require.resolve(DETECTAR_RESERVA_PATH)];
    return require(DETECTAR_RESERVA_PATH).detectarReserva;
}

const { formatearListaNumeros } = require("./bot/ai/gramatica.js");
const { construirVariables, aplicarPlantilla, calcularTipoPresentacion } = require("./bot/ai/plantillaMensaje.js");
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

function assert(cond, msg) {
    if (cond) { pasaron++; console.log("✅", msg); }
    else { fallaron++; fallos.push(msg); console.log("❌", msg); }
}

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-05", hora_fin: "22:00", valor: 5000 },
        textoOriginal: "",
        ...extra
    };
}

// ---- verificación de formatos PROHIBIDOS, sobre cualquier texto final ----
const PATRONES_PROHIBIDOS = [
    { nombre: "coma entre números (27, 45)", re: /\d\s*,\s*\d/ },
    { nombre: "slash entre números (27 / 45)", re: /\d\s*\/\s*\d/ },
    { nombre: "corchetes ([27, 45])", re: /\[\s*\d|\d\s*\]/ },
    { nombre: "guion pegado sin espacios (27-45)", re: /\d-\d/ },
    { nombre: "paréntesis sin espacio interno ((27 - 45) o (27))", re: /\(\d|\d\)/ },
    { nombre: "paréntesis dobles (( 27 - 45 ))", re: /\(\(|\)\)/ }
];

function formatosProhibidosEncontrados(texto) {
    return PATRONES_PROHIBIDOS.filter(p => p.re.test(texto)).map(p => p.nombre);
}

function assertFormatoValido(texto, contexto) {
    const encontrados = formatosProhibidosEncontrados(texto);
    assert(encontrados.length === 0, `${contexto}: sin formatos prohibidos → "${texto}"` + (encontrados.length ? ` [ENCONTRADO: ${encontrados.join(", ")}]` : ""));
}

console.log("\n=== formatearListaNumeros() — la función central, 0/1/2/3 ===\n");

assertEq(formatearListaNumeros([]), "", "0 números: cadena vacía");
assertEq(formatearListaNumeros(["27"]), "( 27 )", "1 número: ( 27 )");
assertEq(formatearListaNumeros(["27", "45"]), "( 27 - 45 )", "2 números: ( 27 - 45 )");
assertEq(formatearListaNumeros(["27", "45", "60"]), "( 27 - 45 - 60 )", "3 números: ( 27 - 45 - 60 )");

console.log("\n=== Escenario 1: reserva de 1 número (27) ===\n");
{
    const ctx = ctxBase({ reserva: { ok: true, reservados: ["27"], ocupados: [], mensaje: "" }, textoOriginal: "quiero el 27" });
    const resultado = ctx.reserva;
    assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_completa", "E1: tipoPresentacion = reserva_completa");
    const vars = construirVariables(ctx, resultado);
    assertEq(vars.numeros_reservados, "( 27 )", "E1: numeros_reservados = ( 27 )");
    assertEq(vars.tu_numero_tus_numeros, "tu número", "E1: concordancia singular (tu número)");
    assertEq(vars.es_son, "es", "E1: concordancia singular (es)");
    assertEq(vars.reservado_reservados, "reservado", "E1: concordancia singular (reservado)");
    const texto = aplicarPlantilla("Quedó {{el_numero_los_numeros}} {{numeros_reservados}} a tu nombre. ✅", vars);
    assertEq(texto, "Quedó el número ( 27 ) a tu nombre. ✅", "E1: texto final exacto");
    assertFormatoValido(texto, "E1");
}

console.log("\n=== Escenario 2: reserva de varios números (27, 45) ===\n");
{
    const ctx = ctxBase({ reserva: { ok: true, reservados: ["27", "45"], ocupados: [], mensaje: "" }, textoOriginal: "quiero el 27 y el 45" });
    const resultado = ctx.reserva;
    assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_completa", "E2: tipoPresentacion = reserva_completa");
    const vars = construirVariables(ctx, resultado);
    assertEq(vars.numeros_reservados, "( 27 - 45 )", "E2: numeros_reservados = ( 27 - 45 )");
    assertEq(vars.tu_numero_tus_numeros, "tus números", "E2: concordancia plural (tus números)");
    assertEq(vars.es_son, "son", "E2: concordancia plural (son)");
    assertEq(vars.reservado_reservados, "reservados", "E2: concordancia plural (reservados)");
    const texto = aplicarPlantilla("Quedaron {{el_numero_los_numeros}} {{numeros_reservados}} a tu nombre. ✅", vars);
    assertEq(texto, "Quedaron los números ( 27 - 45 ) a tu nombre. ✅", "E2: texto final exacto");
    assertFormatoValido(texto, "E2");
}

console.log("\n=== Escenario 3: reserva parcial — solicitados 27,45,60 / reservados 27,45 / ocupados 60 ===\n");
{
    const ctx = ctxBase({ reserva: { ok: true, reservados: ["27", "45"], ocupados: ["60"], mensaje: "" }, textoOriginal: "quiero el 27, 45 y 60" });
    const resultado = ctx.reserva;
    assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_parcial", "E3: tipoPresentacion = reserva_parcial");
    const vars = construirVariables(ctx, resultado);
    assertEq(vars.numeros_solicitados, "( 27 - 45 - 60 )", "E3: numeros_solicitados = ( 27 - 45 - 60 )");
    assertEq(vars.numeros_reservados, "( 27 - 45 )", "E3: numeros_reservados = ( 27 - 45 ) — SOLO los realmente reservados");
    assertEq(vars.numeros_ocupados, "( 60 )", "E3: numeros_ocupados = ( 60 ) — SOLO el que no se pudo reservar");
    // Concordancia de reservados (2) y ocupados (1) — INDEPENDIENTES, cada
    // una con su propia cantidad, nunca con el total solicitado (3).
    assertEq(vars.reservado_reservados, "reservados", "E3: reservados=2 -> 'reservados' (plural)");
    assertEq(vars.el_numero_los_numeros, "los números", "E3: reservados=2 -> 'los números' (plural, forma principal)");
    assertEq(vars.ocupado_ocupados_ocupados, "ocupado", "E3: ocupados=1 -> 'ocupado' (singular, conjunto independiente)");
    assertEq(vars.el_numero_los_numeros_ocupados, "el número", "E3: ocupados=1 -> 'el número' (singular, conjunto independiente)");
    assertEq(vars.estaba_estaban_ocupados, "estaba", "E3: ocupados=1 -> 'estaba' (singular, conjunto independiente)");
    // Nota: {{el_numero_los_numeros_ocupados}} produce texto en minúscula
    // (la sustitución de variables es literal, sin capitalizar — mismo
    // límite ya documentado en fases anteriores). Igual que en las
    // plantillas reales ya migradas, se evita depender de mayúscula
    // automática a media plantilla uniendo la cláusula con ";" en vez de
    // empezar una oración nueva — el contenido informativo es idéntico al
    // ejemplo del pedido.
    const texto = aplicarPlantilla(
        "Quedaron {{el_numero_los_numeros}} {{numeros_reservados}} a tu nombre; {{el_numero_los_numeros_ocupados}} {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}. ✅",
        vars
    );
    assertEq(texto, "Quedaron los números ( 27 - 45 ) a tu nombre; el número ( 60 ) ya estaba ocupado. ✅", "E3: texto final EXACTO — mismo contenido que el ejemplo del pedido");
    assertFormatoValido(texto, "E3");
    // La cantidad total solicitada (3) NUNCA debe determinar la concordancia
    // de reservados ni de ocupados — se verifica que NO aparezca "( 27 - 45 - 60 )"
    // en ninguna cláusula de reservados/ocupados (solo en numeros_solicitados,
    // que aquí ni siquiera se usó en la plantilla).
    assert(!texto.includes("( 27 - 45 - 60 )"), "E3: el texto NO junta los 3 solicitados como si todos se hubieran reservado");
}

(async () => {

    console.log("\n=== Escenario 4: 'mis números' con 1 número ===\n");
    {
        mockNumerosDelUsuario = ["45"];
        const resultado = { tipo: "mis_numeros", numerosDelUsuario: mockNumerosDelUsuario };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.numeros_reservados, "( 45 )", "E4: numeros_reservados = ( 45 )");
        assertEq(vars.tu_numero_tus_numeros, "tu número", "E4: concordancia singular");

        const r = await resolverConsulta({ tipo: "mis_numeros", evento: { tabla: "t" }, usuario: { id: "u1" } });
        assertEq(r.mensaje, "Tu número reservado es: ( 45 )", "E4: fallback fijo exacto");
        assertFormatoValido(r.mensaje, "E4 fallback");
    }

    console.log("\n=== Escenario 5: 'mis números' con varios ===\n");
    {
        mockNumerosDelUsuario = ["01", "27", "48"];
        const resultado = { tipo: "mis_numeros", numerosDelUsuario: mockNumerosDelUsuario };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.numeros_reservados, "( 01 - 27 - 48 )", "E5: numeros_reservados = ( 01 - 27 - 48 )");
        assertEq(vars.tu_numero_tus_numeros, "tus números", "E5: concordancia plural");

        const r = await resolverConsulta({ tipo: "mis_numeros", evento: { tabla: "t" }, usuario: { id: "u1" } });
        assertEq(r.mensaje, "Tus números reservados son: ( 01 - 27 - 48 )", "E5: fallback fijo exacto");
        assertFormatoValido(r.mensaje, "E5 fallback");
    }

    console.log("\n=== Escenario 6: número específico (45) ===\n");
    {
        const resultado = { tipo: "numero_especifico", numero: "45", estadoReal: "libre" };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.numeros_solicitados, "( 45 )", "E6: numeros_solicitados = ( 45 )");
        assertEq(vars.tu_numero_tus_numeros, "tu número", "E6: concordancia singular (siempre, por definición del tipo)");

        const r = await resolverConsulta({ tipo: "numero_especifico", numeros: ["45"], evento: { tabla: "t" }, usuario: { id: "u1" } });
        assertEq(r.mensaje, "El número ( 45 ) está libre.", "E6: fallback fijo exacto (TEXTO_ESTADO)");
        assertFormatoValido(r.mensaje, "E6 fallback");
    }

    console.log("\n=== Escenario 7: número ocupado (45) ===\n");
    {
        const ctx = ctxBase({ reserva: { ok: false, mensaje: "" }, textoOriginal: "el 45" });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "numero_ocupado", "E7: tipoPresentacion = numero_ocupado");
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.numeros_solicitados, "( 45 )", "E7: numeros_solicitados = ( 45 )");
        assertEq(vars.tu_numero_tus_numeros, "tu número", "E7: concordancia singular");
        assertEq(vars.ocupado_ocupados, "ocupado", "E7: concordancia singular (ocupado)");
        const texto = aplicarPlantilla("{{tu_numero_tus_numeros}} solicitado {{numeros_solicitados}} ya está {{ocupado_ocupados}}.", vars);
        assertEq(texto, "tu número solicitado ( 45 ) ya está ocupado.", "E7: texto final exacto");
        assertFormatoValido(texto, "E7");
    }

    console.log("\n=== Escenario 8: disponibilidad con varios números ===\n");
    {
        mockDisponibles = ["00", "03", "04", "05"];
        mockOcupados = [];
        const resultado = { tipo: "disponibilidad", numerosDisponibles: mockDisponibles, numerosOcupados: mockOcupados };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.numeros_disponibles, "( 00 - 03 - 04 - 05 )", "E8: numeros_disponibles = ( 00 - 03 - 04 - 05 )");
        assertEq(vars.disponible_disponibles, "disponibles", "E8: concordancia plural (disponibles)");
        assertEq(vars.numero_numeros, "números", "E8: concordancia plural (números)");

        const r = await resolverConsulta({ tipo: "disponibilidad", evento: { tabla: "t" }, usuario: { id: "u1" } });
        assertEq(r.mensaje, "Números disponibles (4): ( 00 - 03 - 04 - 05 )", "E8: fallback fijo exacto");
        // No se usa assertFormatoValido aquí: el "(4)" es la etiqueta de
        // CANTIDAD (preexistente, ajena a este cambio, ver resolverConsulta.js),
        // no una lista de números — el detector genérico de "paréntesis sin
        // espacio interno" la marcaría como falso positivo. La lista de
        // números en sí ("( 00 - 03 - 04 - 05 )") ya se verificó exacta arriba.
    }

    console.log("\n=== detectarReserva.js — mensaje interno (SOLO texto, negocio intacto) ===\n");
    const mensajesDetectarReserva = [];
    {
        // reservados=['27'] -> ( 27 ), sin ocupados
        const det = cargarDetectarReservaCon(() => ({ disponibles: [{ numero: "27" }], ocupadosPorOtros: [], yaSonMios: [] }));
        const r = await det({ evento: {}, texto: "27", usuario: { nombre: "Carlos", telefono: "1" }, lib: {} });
        assert(r.ok === true, "detectarReserva: resultado lógico ok=true intacto (reservados=['27'])");
        assertEq(r.reservados.join(","), "27", "detectarReserva: arreglo 'reservados' SIN modificar (sigue siendo ['27'])");
        assert(r.mensaje.includes("( 27 )"), `detectarReserva reservados=['27'] -> contiene "( 27 )" → "${r.mensaje}"`);
        mensajesDetectarReserva.push(r.mensaje);
    }
    {
        // reservados=['27','45'] -> ( 27 - 45 )
        const det = cargarDetectarReservaCon(() => ({ disponibles: [{ numero: "27" }, { numero: "45" }], ocupadosPorOtros: [], yaSonMios: [] }));
        const r = await det({ evento: {}, texto: "27 45", usuario: { nombre: "Carlos", telefono: "1" }, lib: {} });
        assertEq(r.reservados.join(","), "27,45", "detectarReserva: arreglo 'reservados' SIN modificar (sigue siendo ['27','45'])");
        assert(r.mensaje.includes("( 27 - 45 )"), `detectarReserva reservados=['27','45'] -> contiene "( 27 - 45 )" → "${r.mensaje}"`);
        mensajesDetectarReserva.push(r.mensaje);
    }
    {
        // 1 reservado + ocupados=['60'] -> ( 60 )
        const det = cargarDetectarReservaCon(() => ({ disponibles: [{ numero: "27" }], ocupadosPorOtros: [{ numero: "60" }], yaSonMios: [] }));
        const r = await det({ evento: {}, texto: "27 60", usuario: { nombre: "Carlos", telefono: "1" }, lib: {} });
        assertEq(r.ocupados.join(","), "60", "detectarReserva: arreglo 'ocupados' SIN modificar (sigue siendo ['60'])");
        assert(r.mensaje.includes("( 60 )"), `detectarReserva ocupados=['60'] -> contiene "( 60 )" → "${r.mensaje}"`);
        mensajesDetectarReserva.push(r.mensaje);
    }
    {
        // todos ocupados, ocupados=['60','70'] -> ( 60 - 70 )
        const det = cargarDetectarReservaCon(() => ({ disponibles: [], ocupadosPorOtros: [{ numero: "60" }, { numero: "70" }], yaSonMios: [] }));
        const r = await det({ evento: {}, texto: "60 70", usuario: { nombre: "Carlos", telefono: "1" }, lib: {} });
        assertEq(r.ok, false, "detectarReserva: resultado lógico ok=false intacto (todos ocupados)");
        assert(r.mensaje.includes("( 60 - 70 )"), `detectarReserva ocupados=['60','70'] (todos ocupados) -> contiene "( 60 - 70 )" → "${r.mensaje}"`);
        mensajesDetectarReserva.push(r.mensaje);
    }
    for (const m of mensajesDetectarReserva) {
        assertFormatoValido(m, "detectarReserva mensaje");
    }

    console.log("\n=== Barrido final: NUNCA deben aparecer los formatos prohibidos ===\n");
    {
        const prohibidos = [
            "27, 45", "27 / 45", "[27, 45]", "27-45", "(27 - 45)", "( 27,45 )", "(27,45)", "(( 27 - 45 ))"
        ];
        for (const p of prohibidos) {
            assert(formatosProhibidosEncontrados(p).length > 0, `detector reconoce el patrón prohibido: "${p}"`);
        }
        // Y el formato correcto NO debe dispararlos.
        assert(formatosProhibidosEncontrados("( 27 )").length === 0, `formato correcto no dispara falsos positivos: "( 27 )"`);
        assert(formatosProhibidosEncontrados("( 27 - 45 )").length === 0, `formato correcto no dispara falsos positivos: "( 27 - 45 )"`);
        assert(formatosProhibidosEncontrados("( 27 - 45 - 60 )").length === 0, `formato correcto no dispara falsos positivos: "( 27 - 45 - 60 )"`);
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
