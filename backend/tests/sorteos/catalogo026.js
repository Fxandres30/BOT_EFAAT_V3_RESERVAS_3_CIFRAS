// Lee el catálogo global TAL COMO lo carga la migración 026 (del propio SQL),
// para que las pruebas usen exactamente los datos de la carga.
const fs = require("fs");
const path = require("path");

const SQL_026 = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_migrations", "026_calendario_loterias_global.sql"), "utf8");

function catalogoGlobalDe026() {

    const bloque = SQL_026.split(/^values$/m)[1].split(/^on conflict/m)[0];

    return bloque.split("\n").filter(l => l.startsWith("    (")).map((linea, i) => {
        const v = [...linea.matchAll(/'((?:[^']|'')*)'|null/g)].map(m => (m[0] === "null" ? null : m[1].replace(/''/g, "'")));
        const [clave, nombre, modalidad, categoria, dias, hora, horasPorDia, regla, horaFestivo, notas] = v;
        return {
            id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
            clave, nombre, modalidad, categoria,
            dias: dias.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number),
            hora, horas_por_dia: JSON.parse(horasPorDia), regla_festivo: regla, hora_festivo: horaFestivo, notas,
            activo: true
        };
    });

}

module.exports = { SQL_026, catalogoGlobalDe026 };
