// FASE 3 — simula cada propuesta SEGURO de _migracion_propuesta.js contra
// el código REAL (construirVariables + aplicarPlantilla), para 0/1/2/3/10
// números, y verifica que nunca aparezca una forma incorrecta. NO toca
// Supabase (usa el contenido ya descargado, ningún SELECT/UPDATE aquí).
// Ejecutar: node backend/_fase3_simulacion.js
const { construirVariables, aplicarPlantilla } = require("./bot/ai/plantillaMensaje.js");
const propuestas = require("./_migracion_propuesta.js");

const FORMAS_PLURALES = ["tus números", "los números", "esos números", "están", "son", "reservados", "ocupados", "disponibles", "números"];
const SINGULARES_EXCLUSIVOS = ["tu número", "el número", "ese número", "reservado", "ocupado", "disponible"];

function contienePluralIncorrectoEn1(texto) {
    return FORMAS_PLURALES.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto));
}
function contieneSingularIncorrectoEn2Mas(texto) {
    return SINGULARES_EXCLUSIVOS.some(f => new RegExp(`(^|[^a-záéíóúñ])${f}([^a-záéíóúñ]|$)`, "i").test(texto))
        || /(^|[^a-záéíóúñ])(está|es)([^a-záéíóúñ]|$)/i.test(texto);
}

function numerosDeCantidad(n) {
    const base = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "99"];
    return base.slice(0, n);
}

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-03", hora_fin: "22:00", valor: 5000 },
        textoOriginal: "",
        ...extra
    };
}

// Genera {ctx, resultado} para un tipo + cantidad n, replicando exactamente
// cómo responderResultado.js arma ctx en producción para ese tipo.
function generarEscenario(tipo, n) {

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
            // Siempre >=2 solicitados por definición del tipo real — se simula
            // igual, dejando n=1 fuera del rango probado para este tipo.
            const solicitados = numerosDeCantidad(n);
            const reserva = { ok: false, reservados: [], ocupados: solicitados, mensaje: "" };
            return { ctx: ctxBase({ reserva, textoOriginal: `quiero ${solicitados.join(", ")}` }), resultado: reserva };
        }

        default:
            return null;

    }

}

// Rango de cantidades a simular por tipo (según lo que ese tipo puede
// producir realmente en el BOT).
const RANGOS = {
    cantidad_reservas: [0, 1, 2, 3, 10],
    mis_numeros: [0, 1, 2, 3, 10],
    mis_reservas: [0, 1, 2, 3, 10],
    disponibilidad: [0, 1, 2, 3, 10],
    reserva_completa: [1, 2, 3, 10],
    todos_ocupados: [2, 3, 10]
};

let pasaron = 0, fallaron = 0;
const fallos = [];
const detalleSimulacion = [];

console.log("\n=== FASE 3 — simulación de las propuestas SEGURO (0/1/2/3/10) ===\n");

for (const fila of propuestas) {

    if (fila.clasificacion !== "SEGURO") continue;

    const rango = RANGOS[fila.tipo];

    if (!rango) {
        console.log(`⚠️  Sin generador de escenario para tipo "${fila.tipo}" (fila ${fila.id}) — se omite simulación.`);
        continue;
    }

    for (const n of rango) {

        const escenario = generarEscenario(fila.tipo, n);
        const vars = construirVariables(escenario.ctx, escenario.resultado);
        const texto = aplicarPlantilla(fila.propuesto, vars);

        let ok = true;
        let razon = "";

        if (n === 1) {
            if (contienePluralIncorrectoEn1(texto)) { ok = false; razon = "contiene forma plural incorrecta"; }
        } else {
            if (contieneSingularIncorrectoEn2Mas(texto)) { ok = false; razon = "contiene forma singular incorrecta"; }
        }

        // También verifica que no queden variables sin sustituir ({{...}})
        // y que el texto no quede vacío por error de plantilla.
        if (/\{\{\s*\w+\s*\}\}/.test(texto)) { ok = false; razon = "quedó una variable sin sustituir"; }

        detalleSimulacion.push({ id: fila.id, tipo: fila.tipo, nombre: fila.nombre, n, texto, ok });

        if (ok) {
            pasaron++;
        } else {
            fallaron++;
            fallos.push(`[${fila.tipo}] "${fila.nombre}" (${fila.id}) cantidad=${n}: ${razon} → "${texto}"`);
        }

    }

}

console.log(`Filas SEGURO simuladas: ${propuestas.filter(f => f.clasificacion === "SEGURO").length}`);
console.log(`Escenarios de cantidad probados: ${pasaron + fallaron}`);
console.log(`✅ Correctos: ${pasaron}`);
console.log(`❌ Incorrectos: ${fallaron}\n`);

if (fallos.length) {
    console.log("FALLOS:");
    fallos.forEach(f => console.log(" -", f));
}

// Muestra ejemplos ANTES/PROPUESTO/simulación para 1 y 3 de cada fila SEGURO.
console.log("\n=== Muestra de simulación (cantidad=1 y cantidad=3) por fila SEGURO ===\n");
for (const fila of propuestas) {
    if (fila.clasificacion !== "SEGURO") continue;
    const d1 = detalleSimulacion.find(d => d.id === fila.id && d.n === 1);
    const d3 = detalleSimulacion.find(d => d.id === fila.id && d.n === 3) || detalleSimulacion.find(d => d.id === fila.id && d.n === 2);
    console.log(`[${fila.tipo}] "${fila.nombre}"`);
    console.log(`  ANTES:      ${fila.antes}`);
    console.log(`  PROPUESTO:  ${fila.propuesto}`);
    if (d1) console.log(`  cantidad=1: "${d1.texto}" ${d1.ok ? "✅" : "❌"}`);
    if (d3) console.log(`  cantidad=${d3.n}: "${d3.texto}" ${d3.ok ? "✅" : "❌"}`);
    console.log("");
}

const conteoPorClasificacion = propuestas.reduce((acc, f) => {
    acc[f.clasificacion] = (acc[f.clasificacion] || 0) + 1;
    return acc;
}, {});

console.log("=== Totales por clasificación (151 filas) ===");
console.log(conteoPorClasificacion);

if (fallaron > 0) {
    process.exit(1);
}
