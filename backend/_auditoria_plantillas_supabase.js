// Auditoría de SOLO LECTURA de backend/../plantillas_mensaje (Supabase).
// NO hace ningún UPDATE/INSERT/DELETE — únicamente SELECT. Cuenta cuántas
// plantillas existentes contienen frases rígidas de género/número que
// deberían migrarse a las nuevas variables gramaticales centrales
// (bot/ai/gramatica.js).
// Ejecutar: node backend/_auditoria_plantillas_supabase.js
require("dotenv").config();
const supabase = require("./lib/supabase");

// Frases rígidas a detectar (case-insensitive, sin acentos ya normalizados
// aparte — comparamos tal cual están escritas en las plantillas reales).
const PATRONES = [
    { nombre: "tu número", re: /\btu número\b/i },
    { nombre: "tus números", re: /\btus números\b/i },
    { nombre: "el número", re: /\bel número\b/i },
    { nombre: "los números", re: /\blos números\b/i },
    { nombre: "ese número / esos números", re: /\bes[ea]s? números?\b/i },
    { nombre: "está", re: /\bestá\b/i },
    { nombre: "están", re: /\bestán\b/i },
    { nombre: "es (verbo)", re: /(^|[^a-záéíóúñ])es([^a-záéíóúñ]|$)/i },
    { nombre: "son", re: /\bson\b/i },
    { nombre: "reservado", re: /\breservado\b/i },
    { nombre: "reservados", re: /\breservados\b/i },
    { nombre: "ocupado", re: /\bocupado\b/i },
    { nombre: "ocupados", re: /\bocupados\b/i },
    { nombre: "disponible", re: /\bdisponible\b/i },
    { nombre: "disponibles", re: /\bdisponibles\b/i }
];

async function main() {

    console.log("\n=== AUDITORÍA DE SOLO LECTURA — plantillas_mensaje ===\n");

    const { data, error } = await supabase
        .from("plantillas_mensaje")
        .select("id, usuario_id, tipo_respuesta, nombre, contenido, habilitada")
        .order("tipo_respuesta", { ascending: true });

    if (error) {
        console.log("❌ No se pudo leer plantillas_mensaje:", error.message);
        console.log("(Auditoría abortada — no se realizó ningún cambio.)");
        process.exit(1);
    }

    const filas = data || [];

    console.log(`Total de plantillas encontradas: ${filas.length}\n`);

    if (filas.length === 0) {
        console.log("No hay plantillas en Supabase todavía (tabla vacía). Nada que migrar.");
        return;
    }

    const porTipo = {};
    let conFraseRigida = 0;
    let sinFraseRigida = 0;

    const detalle = [];

    for (const p of filas) {

        const contenido = p.contenido || "";
        const coincidencias = PATRONES.filter(pat => pat.re.test(contenido)).map(pat => pat.nombre);

        porTipo[p.tipo_respuesta] = porTipo[p.tipo_respuesta] || { total: 0, conFraseRigida: 0 };
        porTipo[p.tipo_respuesta].total++;

        if (coincidencias.length > 0) {
            conFraseRigida++;
            porTipo[p.tipo_respuesta].conFraseRigida++;
        } else {
            sinFraseRigida++;
        }

        detalle.push({
            id: p.id,
            tipo: p.tipo_respuesta,
            nombre: p.nombre,
            habilitada: p.habilitada,
            coincidencias,
            contenido
        });

    }

    console.log("--- Resumen por tipo de respuesta ---\n");
    for (const tipo of Object.keys(porTipo).sort()) {
        const { total, conFraseRigida: c } = porTipo[tipo];
        console.log(`${tipo}: ${c}/${total} plantillas con frases rígidas`);
    }

    console.log("\n--- Totales ---");
    console.log(`Con frases rígidas (candidatas a migrar): ${conFraseRigida}`);
    console.log(`Sin frases rígidas (ya neutras / sin problema): ${sinFraseRigida}`);

    console.log("\n--- Detalle de plantillas candidatas a migrar ---\n");
    for (const d of detalle) {
        if (d.coincidencias.length === 0) continue;
        console.log(`[${d.tipo}] id=${d.id} "${d.nombre}" (habilitada=${d.habilitada})`);
        console.log(`  contenido: ${d.contenido}`);
        console.log(`  frases rígidas detectadas: ${d.coincidencias.join(", ")}`);
        console.log("");
    }

    console.log("=== FIN — ningún registro fue modificado (solo SELECT) ===\n");

}

main().catch(err => {
    console.error("💥 ERROR en auditoría:", err.message);
    process.exit(1);
});
