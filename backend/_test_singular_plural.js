// Prueba enfocada — capa de presentación singular/plural ({{tu_numero_tus_numeros}},
// {{es_son}}) agregada en plantillaMensaje.js + fallback fijo de resolverConsulta.js.
// NO usa Supabase real: consultarMisNumeros se reemplaza en cache de require()
// (mismo patrón que _test_fase7_dinamismo.js) para poder probar 0/1/varios
// sin depender de datos reales. Script de verificación, no forma parte del
// flujo de producción.
// Ejecutar: node backend/_test_singular_plural.js
const path = require("path");
const CONSULTAS_DIR = path.join(__dirname, "bot", "funciones", "consultas");
const LIB_DIR = path.join(__dirname, "lib");

let mockNumerosDelUsuario = [];

function fakeModule(modId, exportsObj, baseDir) {
    const resolved = require.resolve(modId, { paths: [baseDir] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

// consultarNumero.js / consultarDisponibilidad.js crean el cliente Supabase
// real al cargar (top-level); esta prueba no los ejercita (no forman parte
// de este cambio), así que se reemplaza el módulo por un stub para que
// resolverConsulta.js pueda requerirlos sin credenciales reales.
fakeModule("./supabase", {}, LIB_DIR);

fakeModule("./consultarMisNumeros", {
    consultarMisNumeros: async () => mockNumerosDelUsuario
}, CONSULTAS_DIR);

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

function ctxBase(extra) {
    return {
        usuario: { nombre: "Carlos" },
        evento: { nombre_evento: "Evento Test", fecha_evento: "2026-09-03", hora_fin: "22:00", valor: 5000 },
        textoOriginal: "",
        ...extra
    };
}

(async () => {

    console.log("\n=== 1) construirVariables + aplicarPlantilla — ctx.reserva ===\n");

    // --- reserva_completa, 1 número ---
    {
        const ctx = ctxBase({ reserva: { ok: true, reservados: ["45"], ocupados: [], mensaje: "" }, textoOriginal: "quiero el 45" });
        const resultado = ctx.reserva;
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tu número", "reserva_completa (1): tu_numero_tus_numeros");
        assertEq(vars.es_son, "es", "reserva_completa (1): es_son");
        assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_completa", "reserva_completa (1): tipoPresentacion");
        const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 🎟️", vars);
        assertEq(texto, "Carlos, tu número es: 45 🎟️", "reserva_completa (1): plantilla nueva con variables");
    }

    // --- reserva_completa, 3 números ---
    {
        const ctx = ctxBase({ reserva: { ok: true, reservados: ["12", "45", "78"], ocupados: [], mensaje: "" }, textoOriginal: "quiero el 12, 45 y 78" });
        const resultado = ctx.reserva;
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tus números", "reserva_completa (3): tu_numero_tus_numeros");
        assertEq(vars.es_son, "son", "reserva_completa (3): es_son");
        const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 🎟️", vars);
        assertEq(texto, "Carlos, tus números son: 12, 45, 78 🎟️", "reserva_completa (3): plantilla nueva con variables");
    }

    // --- reserva_completa, 2 números ---
    {
        const ctx = ctxBase({ reserva: { ok: true, reservados: ["12", "45"], ocupados: [], mensaje: "" }, textoOriginal: "quiero el 12 y el 45" });
        const vars = construirVariables(ctx, ctx.reserva);
        assertEq(vars.tu_numero_tus_numeros, "tus números", "reserva_completa (2): tu_numero_tus_numeros");
        assertEq(vars.es_son, "son", "reserva_completa (2): es_son");
    }

    // --- reserva_parcial: 1 reservado + 1 ocupado (cuenta manda "reservados") ---
    {
        const ctx = ctxBase({ reserva: { ok: true, reservados: ["12"], ocupados: ["45"], mensaje: "" }, textoOriginal: "quiero el 12 y el 45" });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "reserva_parcial", "reserva_parcial: tipoPresentacion");
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tu número", "reserva_parcial (1 reservado): tu_numero_tus_numeros");
        assertEq(vars.es_son, "es", "reserva_parcial (1 reservado): es_son");
    }

    // --- numero_ocupado: 1 solicitado, 0 reservados ---
    {
        const ctx = ctxBase({ reserva: { ok: false, reservados: [], ocupados: ["45"], mensaje: "" }, textoOriginal: "el 45" });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "numero_ocupado", "numero_ocupado: tipoPresentacion");
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tu número", "numero_ocupado (1): tu_numero_tus_numeros");
        assertEq(vars.es_son, "es", "numero_ocupado (1): es_son");
        const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} solicitado ({{numeros_solicitados}}) ya está ocupado.", vars);
        assertEq(texto, "Carlos, tu número solicitado (45) ya está ocupado.", "numero_ocupado (1): plantilla nueva con variables");
    }

    // --- todos_ocupados: 3 solicitados, 0 reservados ---
    {
        const ctx = ctxBase({ reserva: { ok: false, reservados: [], ocupados: ["12", "45", "78"], mensaje: "" }, textoOriginal: "el 12, 45 y 78" });
        const resultado = ctx.reserva;
        assertEq(calcularTipoPresentacion(ctx, resultado), "todos_ocupados", "todos_ocupados: tipoPresentacion");
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tus números", "todos_ocupados (3): tu_numero_tus_numeros");
        assertEq(vars.es_son, "son", "todos_ocupados (3): es_son");
    }

    console.log("\n=== 2) construirVariables — ctx.consulta (mis_numeros / mis_reservas / numero_especifico) ===\n");

    for (const tipoConsulta of ["mis_numeros", "mis_reservas"]) {

        // 1 número
        {
            const resultado = { tipo: tipoConsulta, numerosDelUsuario: ["45"] };
            const ctx = ctxBase({ consulta: resultado });
            const vars = construirVariables(ctx, resultado);
            assertEq(vars.tu_numero_tus_numeros, "tu número", `${tipoConsulta} (1): tu_numero_tus_numeros`);
            assertEq(vars.es_son, "es", `${tipoConsulta} (1): es_son`);
            const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 🎟️", vars);
            assertEq(texto, "Carlos, tu número es: 45 🎟️", `${tipoConsulta} (1): plantilla nueva con variables`);
        }

        // varios números
        {
            const resultado = { tipo: tipoConsulta, numerosDelUsuario: ["12", "45", "78"] };
            const ctx = ctxBase({ consulta: resultado });
            const vars = construirVariables(ctx, resultado);
            assertEq(vars.tu_numero_tus_numeros, "tus números", `${tipoConsulta} (3): tu_numero_tus_numeros`);
            assertEq(vars.es_son, "son", `${tipoConsulta} (3): es_son`);
            const texto = aplicarPlantilla("{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 🎟️", vars);
            assertEq(texto, "Carlos, tus números son: 12, 45, 78 🎟️", `${tipoConsulta} (3): plantilla nueva con variables`);
        }

        // 0 números — plantilla nueva no debe quedar rota (aunque su redacción de "0" es
        // responsabilidad del texto de la plantilla en sí, la sustitución no debe fallar)
        {
            const resultado = { tipo: tipoConsulta, numerosDelUsuario: [] };
            const ctx = ctxBase({ consulta: resultado });
            const vars = construirVariables(ctx, resultado);
            assertEq(vars.tu_numero_tus_numeros, "tus números", `${tipoConsulta} (0): tu_numero_tus_numeros (fallback plural, no rompe)`);
            assertEq(vars.numeros_reservados, "", `${tipoConsulta} (0): numeros_reservados vacío`);
        }
    }

    // numero_especifico
    {
        const resultado = { tipo: "numero_especifico", numero: "45", estadoReal: "libre" };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        assertEq(vars.tu_numero_tus_numeros, "tu número", "numero_especifico: siempre singular (regla 4)");
        assertEq(vars.es_son, "es", "numero_especifico: es_son singular");
    }

    console.log("\n=== 3) Compatibilidad con plantillas EXISTENTES (sin variables nuevas) ===\n");

    {
        const resultado = { tipo: "mis_numeros", numerosDelUsuario: ["45"] };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        // Plantilla real ya existente en plantillasBase.ts (mis_numeros, estilo "Natural")
        const texto = aplicarPlantilla("{{cliente}}, tus números son: {{numeros_reservados}}", vars);
        assertEq(texto, "Carlos, tus números son: 45", "Plantilla existente con 1 número sigue literal (sin auto-corregir)");
    }

    {
        const resultado = { tipo: "mis_numeros", numerosDelUsuario: ["12", "45", "78"] };
        const ctx = ctxBase({ consulta: resultado });
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{cliente}}, tus números son: {{numeros_reservados}}", vars);
        assertEq(texto, "Carlos, tus números son: 12, 45, 78", "Plantilla existente con varios números — comportamiento previo intacto");
    }

    console.log("\n=== 4) resolverConsulta — fallback fijo mis_numeros / mis_reservas ===\n");

    for (const tipo of ["mis_numeros", "mis_reservas"]) {

        mockNumerosDelUsuario = [];
        {
            const r = await resolverConsulta({ tipo, evento: { tabla: "t" }, usuario: { id: "u1" } });
            assertEq(r.mensaje, "No tienes números reservados actualmente.", `${tipo} fallback (0): mensaje`);
        }

        mockNumerosDelUsuario = ["45"];
        {
            const r = await resolverConsulta({ tipo, evento: { tabla: "t" }, usuario: { id: "u1" } });
            assertEq(r.mensaje, "Tu número reservado es: 45", `${tipo} fallback (1): mensaje singular`);
        }

        mockNumerosDelUsuario = ["12", "45"];
        {
            const r = await resolverConsulta({ tipo, evento: { tabla: "t" }, usuario: { id: "u1" } });
            assertEq(r.mensaje, "Tus números reservados son: 12, 45", `${tipo} fallback (2): mensaje plural`);
        }

        mockNumerosDelUsuario = ["12", "45", "78"];
        {
            const r = await resolverConsulta({ tipo, evento: { tabla: "t" }, usuario: { id: "u1" } });
            assertEq(r.mensaje, "Tus números reservados son: 12, 45, 78", `${tipo} fallback (3+): mensaje plural`);
        }
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
