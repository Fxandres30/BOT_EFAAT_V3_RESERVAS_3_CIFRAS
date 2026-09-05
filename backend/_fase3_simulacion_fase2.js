// FASE 3 (Fase 2 de la gramática) — simula las 66 propuestas SEGURO de
// _migracion_propuesta_fase2.js contra el código REAL (construirVariables +
// aplicarPlantilla). Extiende _fase3_simulacion.js original: además de los
// escenarios de una sola cantidad (0/1/2/3/10), ahora prueba también los
// 14 casos de reserva_parcial y los 2 de disponibilidad con dos listas
// INDEPENDIENTES (reservados×ocupados, disponibles×ocupados), incluidas
// las combinaciones pedidas: (1,1) (1,2) (2,1) (2,3) (3,10).
// NO toca Supabase. Ejecutar: node backend/_fase3_simulacion_fase2.js
const { construirVariables, aplicarPlantilla } = require("./bot/ai/plantillaMensaje.js");
const propuestas = require("./_migracion_propuesta_fase2.js");

// Lista ORIGINAL (idéntica a _fase3_simulacion.js) — se usa tal cual para
// no reabrir falsos positivos ya descartados en Fase 1. Las 6 palabras
// NUEVAS de Fase 2 (quedo_quedaron, tuyo_tuyos, libre_libres, queda_quedan,
// estaba_estaban, su_numero_sus_numeros) NO se agregan aquí: "tuyo"/"libre"/
// "queda" son palabras comunes que también aparecen en texto literal
// preexistente sin relación con la gramática de cantidad (p.ej. "elige el
// tuyo"), así que un escaneo léxico ciego sobre ellas produce falsos
// positivos. Se verifican aparte, de forma dirigida, en verificarPalabrasNuevas().
const FORMAS_PLURALES = ["tus números", "los números", "esos números", "están", "estaban", "son", "reservados", "ocupados", "disponibles", "números"];
const SINGULARES_EXCLUSIVOS = ["tu número", "el número", "ese número", "reservado", "ocupado", "disponible"];

function contienePluralIncorrectoEn1(texto) {
    return FORMAS_PLURALES.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto));
}
function contieneSingularIncorrectoEn2Mas(texto) {
    return SINGULARES_EXCLUSIVOS.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto))
        || /(^|[^a-záéíóúñ])(está|es)([^a-záéíóúñ]|$)/i.test(texto);
}

// Verificación DIRIGIDA para las 6 palabras nuevas de Fase 2 (y sus
// variantes "_ocupados"/"_disponibles"): en vez de buscar la palabra en
// cualquier parte del texto (riesgo de falso positivo contra texto literal
// preexistente), confirma que el valor EXACTO que produjo construirVariables()
// para cada variable realmente usada en la plantilla aparece en el
// resultado final — es una verificación de sustitución, no de vocabulario.
const VARIABLES_NUEVAS_FASE2 = [
    "quedo_quedaron", "tuyo_tuyos", "libre_libres", "queda_quedan",
    "estaba_estaban", "su_numero_sus_numeros"
];

function extraerVariables(plantilla) {
    const nombres = new Set();
    (plantilla.match(/\{\{\s*(\w+)\s*\}\}/g) || []).forEach(m => {
        nombres.add(m.replace(/[{}]/g, "").trim());
    });
    return nombres;
}

function verificarPalabrasNuevas(plantilla, vars, texto) {
    const referenciadas = extraerVariables(plantilla);
    const problemas = [];
    for (const nombre of referenciadas) {
        const esNueva = VARIABLES_NUEVAS_FASE2.some(base => nombre === base || nombre.startsWith(base + "_"));
        if (!esNueva) continue;
        const valorEsperado = vars[nombre];
        if (valorEsperado === undefined) { problemas.push(`variable "${nombre}" no existe en construirVariables()`); continue; }
        if (!texto.includes(valorEsperado)) { problemas.push(`"${nombre}" debía producir "${valorEsperado}" y no aparece en el texto`); }
    }
    return problemas;
}

function numerosDeCantidad(n, prefijo = "") {
    const base = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "99"];
    return base.slice(0, n).map(x => prefijo + x);
}

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-03", hora_fin: "22:00", valor: 5000 },
        textoOriginal: "",
        ...extra
    };
}

// ---- generadores de escenario (single-count, igual que Fase 3 original) ----
function generarEscenarioSimple(tipo, n) {
    switch (tipo) {
        case "cantidad_reservas": {
            const resultado = { tipo, cantidad: n };
            return { ctx: ctxBase({ consulta: resultado }), resultado };
        }
        case "mis_numeros":
        case "mis_reservas": {
            const resultado = { tipo, numerosDelUsuario: numerosDeCantidad(n) };
            return { ctx: ctxBase({ consulta: resultado }), resultado };
        }
        case "disponibilidad": {
            const resultado = { tipo, numerosDisponibles: numerosDeCantidad(n), numerosOcupados: [] };
            return { ctx: ctxBase({ consulta: resultado }), resultado };
        }
        case "reserva_completa": {
            const reservados = numerosDeCantidad(n);
            const reserva = { ok: true, reservados, ocupados: [], mensaje: "" };
            return { ctx: ctxBase({ reserva, textoOriginal: `quiero ${reservados.join(", ")}` }), resultado: reserva };
        }
        case "todos_ocupados": {
            // Siempre >=2 solicitados por definición del tipo real.
            const solicitados = numerosDeCantidad(n);
            const reserva = { ok: false, reservados: [], ocupados: solicitados, mensaje: "" };
            return { ctx: ctxBase({ reserva, textoOriginal: `quiero ${solicitados.join(", ")}` }), resultado: reserva };
        }
        default:
            return null;
    }
}

// ---- generador de escenario DUAL (reserva_parcial: reservados × ocupados independientes) ----
function generarEscenarioParcial(nR, nO) {
    const reservados = numerosDeCantidad(nR);
    const ocupados = numerosDeCantidad(nO, "9"); // prefijo distinto para no chocar con reservados
    const reserva = { ok: true, reservados, ocupados, mensaje: "" };
    return { ctx: ctxBase({ reserva, textoOriginal: `quiero ${reservados.concat(ocupados).join(", ")}` }), resultado: reserva };
}

// ---- generador de escenario DUAL (disponibilidad: disponibles × ocupados independientes) ----
function generarEscenarioDisponibilidadDual(nDisp, nOcup) {
    const resultado = { tipo: "disponibilidad", numerosDisponibles: numerosDeCantidad(nDisp), numerosOcupados: numerosDeCantidad(nOcup, "9") };
    return { ctx: ctxBase({ consulta: resultado }), resultado };
}

const RANGOS_SIMPLE = {
    cantidad_reservas: [0, 1, 2, 3, 10],
    mis_numeros: [0, 1, 2, 3, 10],
    mis_reservas: [0, 1, 2, 3, 10],
    disponibilidad: [0, 1, 2, 3, 10],
    reserva_completa: [1, 2, 3, 10],
    todos_ocupados: [2, 3, 10]
};

// IDs de las filas que Fase 2 volvió SEGURO usando DOS listas
// independientes (reserva_parcial siempre; disponibilidad solo las 2 que
// mencionan numeros_ocupados). El resto de disponibilidad/mis_numeros/
// reserva_completa reclasificadas son de una sola lista y usan RANGOS_SIMPLE.
const IDS_DUAL_PARCIAL = new Set(require("./_migracion_propuesta.js")
    .filter(r => r.tipo === "reserva_parcial")
    .map(r => r.id));

const IDS_DUAL_DISPONIBILIDAD = new Set([
    "c5792222-f259-4d89-87b3-aedfb3b4053c", // Detallada
    "13370614-1447-4493-a1e6-49b05823a118"  // Resumen
]);

const COMBINACIONES_DUAL = [[1, 1], [1, 2], [2, 1], [2, 3], [3, 10]];
const COMBINACIONES_DUAL_CON_CERO = [[0, 0], [1, 1], [1, 2], [2, 1], [3, 10]];

let pasaron = 0, fallaron = 0;
const fallos = [];
const muestras = [];

console.log("\n=== FASE 3 (extendida) — simulación de las 66 propuestas SEGURO ===\n");

for (const fila of propuestas) {

    if (fila.clasificacion !== "SEGURO") continue;

    // ---- caso dual: reserva_parcial (reservados × ocupados independientes) ----
    if (IDS_DUAL_PARCIAL.has(fila.id)) {

        for (const [nR, nO] of COMBINACIONES_DUAL) {

            const escenario = generarEscenarioParcial(nR, nO);
            const vars = construirVariables(escenario.ctx, escenario.resultado);
            const texto = aplicarPlantilla(fila.propuesto, vars);

            let ok = true, razon = "";
            if (/\{\{\s*\w+\s*\}\}/.test(texto)) { ok = false; razon = "quedó una variable sin sustituir"; }

            const problemas = verificarPalabrasNuevas(fila.propuesto, vars, texto);
            if (problemas.length) { ok = false; razon = problemas.join("; "); }

            muestras.push({ id: fila.id, tipo: fila.tipo, nombre: fila.nombre, etiqueta: `R=${nR},O=${nO}`, texto, ok });

            if (ok) pasaron++; else { fallaron++; fallos.push(`[${fila.tipo}] "${fila.nombre}" (${fila.id}) R=${nR},O=${nO}: ${razon} → "${texto}"`); }

        }

        continue;

    }

    // ---- caso dual: disponibilidad con cláusula de ocupados ----
    if (IDS_DUAL_DISPONIBILIDAD.has(fila.id)) {

        for (const [nD, nO] of COMBINACIONES_DUAL_CON_CERO) {

            const escenario = generarEscenarioDisponibilidadDual(nD, nO);
            const vars = construirVariables(escenario.ctx, escenario.resultado);
            const texto = aplicarPlantilla(fila.propuesto, vars);

            let ok = true, razon = "";
            if (/\{\{\s*\w+\s*\}\}/.test(texto)) { ok = false; razon = "quedó una variable sin sustituir"; }

            const problemas = verificarPalabrasNuevas(fila.propuesto, vars, texto);
            if (problemas.length) { ok = false; razon = problemas.join("; "); }

            muestras.push({ id: fila.id, tipo: fila.tipo, nombre: fila.nombre, etiqueta: `Disp=${nD},Ocup=${nO}`, texto, ok });

            if (ok) pasaron++; else { fallaron++; fallos.push(`[${fila.tipo}] "${fila.nombre}" (${fila.id}) Disp=${nD},Ocup=${nO}: ${razon} → "${texto}"`); }

        }

        continue;

    }

    // ---- caso simple: una sola cantidad gobierna toda la plantilla ----
    const rango = RANGOS_SIMPLE[fila.tipo];

    if (!rango) {
        console.log(`⚠️  Sin generador de escenario para tipo "${fila.tipo}" (fila ${fila.id}) — se omite simulación.`);
        continue;
    }

    for (const n of rango) {

        const escenario = generarEscenarioSimple(fila.tipo, n);
        const vars = construirVariables(escenario.ctx, escenario.resultado);
        const texto = aplicarPlantilla(fila.propuesto, vars);

        let ok = true;
        let razon = "";

        if (n === 1) {
            if (contienePluralIncorrectoEn1(texto)) { ok = false; razon = "contiene forma plural incorrecta"; }
        } else {
            if (contieneSingularIncorrectoEn2Mas(texto)) { ok = false; razon = "contiene forma singular incorrecta"; }
        }
        if (/\{\{\s*\w+\s*\}\}/.test(texto)) { ok = false; razon = "quedó una variable sin sustituir"; }

        const problemas = verificarPalabrasNuevas(fila.propuesto, vars, texto);
        if (problemas.length) { ok = false; razon = (razon ? razon + "; " : "") + problemas.join("; "); }

        muestras.push({ id: fila.id, tipo: fila.tipo, nombre: fila.nombre, etiqueta: `n=${n}`, texto, ok });

        if (ok) pasaron++; else { fallaron++; fallos.push(`[${fila.tipo}] "${fila.nombre}" (${fila.id}) n=${n}: ${razon} → "${texto}"`); }

    }

}

console.log(`Filas SEGURO simuladas: ${propuestas.filter(f => f.clasificacion === "SEGURO").length}`);
console.log(`Escenarios probados: ${pasaron + fallaron}`);
console.log(`✅ Correctos: ${pasaron}`);
console.log(`❌ Incorrectos: ${fallaron}\n`);

if (fallos.length) {
    console.log("FALLOS:");
    fallos.forEach(f => console.log(" -", f));
}

console.log("\n=== Muestra — filas de reserva_parcial (dos listas independientes) ===\n");
for (const fila of propuestas.filter(f => IDS_DUAL_PARCIAL.has(f.id) && f.clasificacion === "SEGURO")) {
    console.log(`[reserva_parcial] "${fila.nombre}"`);
    console.log(`  PROPUESTO: ${fila.propuesto}`);
    for (const m of muestras.filter(x => x.id === fila.id)) {
        console.log(`  ${m.etiqueta}: "${m.texto}" ${m.ok ? "✅" : "❌"}`);
    }
    console.log("");
}

console.log("\n=== Muestra — disponibilidad con dos listas ===\n");
for (const fila of propuestas.filter(f => IDS_DUAL_DISPONIBILIDAD.has(f.id))) {
    console.log(`[disponibilidad] "${fila.nombre}"`);
    console.log(`  PROPUESTO: ${fila.propuesto}`);
    for (const m of muestras.filter(x => x.id === fila.id)) {
        console.log(`  ${m.etiqueta}: "${m.texto}" ${m.ok ? "✅" : "❌"}`);
    }
    console.log("");
}

const conteoPorClasificacion = propuestas.reduce((acc, f) => {
    acc[f.clasificacion] = (acc[f.clasificacion] || 0) + 1;
    return acc;
}, {});

console.log("=== Totales por clasificación (151 filas, Fase 2) ===");
console.log(conteoPorClasificacion);

if (fallaron > 0) {
    process.exit(1);
}
