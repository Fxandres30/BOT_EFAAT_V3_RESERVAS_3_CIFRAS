// FASE 2 — pruebas de CANTIDADES INDEPENDIENTES (bot/ai/gramatica.js).
// Verifica que numeros_reservados y numeros_ocupados (y numeros_disponibles)
// nunca se mezclen: la cantidad de una lista jamás debe determinar la
// concordancia de otra. Caso real: reserva_parcial, donde ambas conviven
// en el mismo mensaje y pueden diferir.
// Ejecutar: node backend/_test_gramatica_fase2.js
const {
    construirVariablesGramaticales,
    construirVariablesPorConjunto,
    calcularNumerosRelevantes
} = require("./bot/ai/gramatica.js");
const { construirVariables, aplicarPlantilla } = require("./bot/ai/plantillaMensaje.js");
const { construirContextoReserva } = require("./bot/ai/contextBuilder.js");

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

function numerosDeCantidad(n) {
    const base = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "99"];
    return base.slice(0, n);
}

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-03", hora_fin: "22:00" },
        textoOriginal: "",
        ...extra
    };
}

// ctx.reserva con reservados/ocupados de cantidades arbitrarias e
// independientes (parcial real: ok:true con ambas listas no vacías).
function ctxReservaParcial(nReservados, nOcupados) {
    const reservados = numerosDeCantidad(nReservados);
    const ocupados = numerosDeCantidad(nOcupados).map(n => "9" + n); // distintos de los reservados
    return ctxBase({
        reserva: { ok: true, reservados, ocupados, mensaje: "" },
        textoOriginal: `quiero ${reservados.concat(ocupados).join(", ")}`
    });
}

console.log("\n=== 1) construirVariablesPorConjunto — mecánica pura ===\n");

{
    const formas = construirVariablesPorConjunto({ reservados: 1, ocupados: 2, disponibles: 0 });
    assertEq(formas.numero_numeros_reservados, "número", "por-conjunto: numero_numeros_reservados (1)");
    assertEq(formas.reservado_reservados_reservados, "reservado", "por-conjunto: reservado_reservados_reservados (1)");
    assertEq(formas.numero_numeros_ocupados, "números", "por-conjunto: numero_numeros_ocupados (2)");
    assertEq(formas.ocupado_ocupados_ocupados, "ocupados", "por-conjunto: ocupado_ocupados_ocupados (2)");
    assertEq(formas.numero_numeros_disponibles, "números", "por-conjunto: numero_numeros_disponibles (0 -> plural)");
}

{
    // undefined/null se omiten (no ensucian el objeto con NaN ni "undefined").
    const formas = construirVariablesPorConjunto({ reservados: 1, ocupados: undefined });
    assertEq(Object.keys(formas).some(k => k.endsWith("_ocupados")), false, "por-conjunto: cantidad undefined no genera claves");
}

console.log("\n=== 2) calcularNumerosRelevantes — cantidades independientes en reserva_parcial ===\n");

for (const nR of [0, 1, 2, 3, 10]) {
    const ctx = ctxReservaParcial(nR, 5); // ocupados fijo en 5 para aislar la variación de reservados
    const r = calcularNumerosRelevantes(ctx, ctx.reserva);
    assertEq(r.cantidadReservados, nR, `cantidadReservados independiente (reservados=${nR}, ocupados=5)`);
    assertEq(r.cantidadOcupados, 5, `cantidadOcupados NO cambia cuando solo varían los reservados (reservados=${nR})`);
}

for (const nO of [0, 1, 2, 3, 10]) {
    const ctx = ctxReservaParcial(5, nO); // reservados fijo en 5 para aislar la variación de ocupados
    const r = calcularNumerosRelevantes(ctx, ctx.reserva);
    assertEq(r.cantidadOcupados, nO, `cantidadOcupados independiente (reservados=5, ocupados=${nO})`);
    assertEq(r.cantidadReservados, 5, `cantidadReservados NO cambia cuando solo varían los ocupados (ocupados=${nO})`);
}

console.log("\n=== 3) numero_ocupado / todos_ocupados — inferencia de cantidadOcupados cuando ok:false ===\n");

{
    // numero_ocupado: 1 solicitado, ok:false (detectarReserva.js no devuelve "ocupados" en este caso)
    const ctx = ctxBase({ reserva: { ok: false, mensaje: "" }, textoOriginal: "el 45" });
    const r = calcularNumerosRelevantes(ctx, ctx.reserva);
    assertEq(r.cantidadOcupados, 1, "numero_ocupado: cantidadOcupados inferida de los solicitados (1)");
}
{
    // todos_ocupados: 3 solicitados, ok:false
    const ctx = ctxBase({ reserva: { ok: false, mensaje: "" }, textoOriginal: "quiero 10, 20 y 30" });
    const r = calcularNumerosRelevantes(ctx, ctx.reserva);
    assertEq(r.cantidadOcupados, 3, "todos_ocupados: cantidadOcupados inferida de los solicitados (3)");
}
{
    // reserva_completa: ok:true, ocupados=[] real (no inferido) -> debe seguir en 0
    const ctx = ctxBase({ reserva: { ok: true, reservados: ["10", "20"], ocupados: [], mensaje: "" }, textoOriginal: "quiero 10 y 20" });
    const r = calcularNumerosRelevantes(ctx, ctx.reserva);
    assertEq(r.cantidadOcupados, 0, "reserva_completa: cantidadOcupados real es 0 (no se infiere nada en ok:true)");
}

console.log("\n=== 4) Ejemplo exacto del pedido: reservados=1, ocupados=2 ===\n");

{
    const ctx = ctxReservaParcial(1, 2);
    const vars = construirVariables(ctx, ctx.reserva);
    const texto = aplicarPlantilla(
        "{{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}} y {{numeros_ocupados}} {{numero_numeros_ocupados}} {{ocupado_ocupados_ocupados}}",
        vars
    );
    assertEq(texto.includes("número reservado") || texto.startsWith(ctx.reserva.reservados.join(", ")) , true, "sanity: texto generado no vacío");
    // La cláusula de reservados (1) debe ir en singular; la de ocupados (2) en plural.
    assertEq(/reservado\b(?!s)/.test(texto), true, "reservados=1: aparece 'reservado' en singular");
    assertEq(/reservados\b/.test(texto), false, "reservados=1: NUNCA aparece 'reservados' en plural");
    assertEq(/números? ocupados/.test(texto) && /\bocupados\b/.test(texto), true, "ocupados=2: aparece 'ocupados' en plural");
    assertEq(/\bocupado\b(?!s)/.test(texto), false, "ocupados=2: NUNCA aparece 'ocupado' en singular");
    console.log("   texto:", texto);
    assertEq(texto, `${ctx.reserva.reservados[0]} quedó reservado y ${ctx.reserva.ocupados.join(", ")} números ocupados`, "texto exacto esperado");
}

console.log("\n=== 5) Matriz cruzada reservados × ocupados (0/1/2/3/10 cada uno, + combinaciones pedidas) ===\n");

const CASOS = [];
for (const nR of [0, 1, 2, 3, 10]) for (const nO of [0, 1, 2, 3, 10]) CASOS.push([nR, nO]);
// Combinaciones explícitas del pedido (ya cubiertas arriba por la matriz completa,
// se listan aparte para que el reporte las nombre una a una).
const COMBINACIONES_PEDIDAS = [[1, 1], [1, 2], [2, 1], [2, 3], [3, 10]];

function formaEsperada(n, singular, plural) {
    return n === 1 ? singular : plural;
}

for (const [nR, nO] of CASOS) {

    const ctx = ctxReservaParcial(nR, nO);
    const vars = construirVariables(ctx, ctx.reserva);

    const esperadoReservado = formaEsperada(nR, "reservado", "reservados");
    const esperadoOcupado = formaEsperada(nO, "ocupado", "ocupados");
    const esperadoNumeroReservados = formaEsperada(nR, "número", "números");
    const esperadoNumeroOcupados = formaEsperada(nO, "número", "números");

    const esCombinacionPedida = COMBINACIONES_PEDIDAS.some(([r, o]) => r === nR && o === nO);
    const etiqueta = esCombinacionPedida ? " [combinación pedida]" : "";

    assertEq(vars.reservado_reservados_reservados, esperadoReservado, `matriz R=${nR},O=${nO}${etiqueta}: reservado_reservados_reservados`);
    assertEq(vars.ocupado_ocupados_ocupados, esperadoOcupado, `matriz R=${nR},O=${nO}${etiqueta}: ocupado_ocupados_ocupados`);
    assertEq(vars.numero_numeros_reservados, esperadoNumeroReservados, `matriz R=${nR},O=${nO}${etiqueta}: numero_numeros_reservados`);
    assertEq(vars.numero_numeros_ocupados, esperadoNumeroOcupados, `matriz R=${nR},O=${nO}${etiqueta}: numero_numeros_ocupados`);

    // La prueba de independencia real: cambiar SOLO ocupados nunca debe
    // tocar la forma de reservados, y viceversa (ya lo prueba la matriz al
    // recorrer todas las combinaciones, pero se deja una aserción directa
    // comparando contra el caso de referencia ocupados=0 / reservados=0).
    const refR = construirVariables(ctxReservaParcial(nR, 0), ctxReservaParcial(nR, 0).reserva);
    assertEq(vars.reservado_reservados_reservados, refR.reservado_reservados_reservados,
        `matriz R=${nR},O=${nO}: reservado_reservados_reservados NO cambia al variar solo ocupados`);

    const refO = construirVariables(ctxReservaParcial(0, nO), ctxReservaParcial(0, nO).reserva);
    assertEq(vars.ocupado_ocupados_ocupados, refO.ocupado_ocupados_ocupados,
        `matriz R=${nR},O=${nO}: ocupado_ocupados_ocupados NO cambia al variar solo reservados`);

}

console.log("\n=== 6) contextBuilder — Gemini recibe las 3 cantidades y sus formas, independientes ===\n");

for (const [nR, nO] of COMBINACIONES_PEDIDAS) {

    const ctx = ctxReservaParcial(nR, nO);
    const contexto = construirContextoReserva(ctx);
    const g = contexto.resultado.gramatica;

    assertEq(g.cantidadReservados, nR, `contextBuilder R=${nR},O=${nO}: cantidadReservados`);
    assertEq(g.cantidadOcupados, nO, `contextBuilder R=${nR},O=${nO}: cantidadOcupados`);
    assertEq(g.formasReservados.reservado_reservados, formaEsperada(nR, "reservado", "reservados"), `contextBuilder R=${nR},O=${nO}: formasReservados.reservado_reservados`);
    assertEq(g.formasOcupados.ocupado_ocupados, formaEsperada(nO, "ocupado", "ocupados"), `contextBuilder R=${nR},O=${nO}: formasOcupados.ocupado_ocupados`);

}

console.log("\n============================");
console.log(`TOTAL: ${pasaron + fallaron}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
console.log("============================\n");

if (fallaron > 0) {
    console.log("Fallos:");
    fallos.forEach(f => console.log(" -", f));
    process.exit(1);
}
