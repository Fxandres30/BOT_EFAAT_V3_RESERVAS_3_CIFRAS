// ==========================================================================
// PRUEBAS — Sistema de Variables Globales (catálogo dinámico administrable)
// Fase "Variables Globales + Bloqueados".
//
// No depende de Supabase real (la tabla variables_globales todavía no está
// aplicada en producción al momento de escribir esto) — prueba el código
// REAL de resolución (catalogoVariables.js, resolverVariables.js,
// plantillaMensaje.js) usando filas ya normalizadas, exactamente como
// llegarían desde variablesGlobalesRepo.js una vez aplicada la migración
// 017. Complementa (no reemplaza) sistemaVariablesGlobales.test.js.
//
//     node backend/tests/variables/variablesGlobales.test.js
// ==========================================================================

const assert = require("assert");

const catalogo = require("../../shared/variables/catalogoVariables");
const { resolverTexto, aplicarModificadorTexto } = require("../../shared/variables/resolverVariables");
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

// Fila tal como la devolvería Supabase (variables_globales) para el
// ejemplo usado en toda la fase de auditoría: {{suyo_suyos}}.
const FILA_SUYO_SUYOS = {
    identificador: "suyo_suyos",
    nombre_visible: "Suyo / Suyos",
    tipo: "concordancia",
    singular: "suyo",
    plural: "suyos",
    categoria: "PERSONALIZADA",
    descripcion: "Posesivo informal, según cantidad",
    ejemplo: "",
    activa: true
};

const FILA_SOPORTE = {
    identificador: "whatsapp_soporte",
    nombre_visible: "WhatsApp de soporte",
    tipo: "texto",
    valor: "3001234567",
    categoria: "PERSONALIZADA",
    descripcion: "Número de soporte fijo",
    ejemplo: "3001234567",
    activa: true
};

function ctxDisponibilidad(numerosDisponibles) {
    const resultado = { tipo: "disponibilidad", numerosDisponibles, numerosOcupados: [] };
    return { ctx: { usuario: {}, evento: { nombre_evento: "Sinuano Noche" }, consulta: resultado }, resultado };
}

function ctxReserva(reservados) {
    const resultado = { ok: true, reservados, ocupados: [] };
    return { ctx: { usuario: { nombre: "Andrés" }, evento: { nombre_evento: "Sinuano Noche" }, textoOriginal: reservados.join(" "), reserva: resultado }, resultado };
}

async function main() {

    // ====================================================================
    // 1-2. "Crear" / "editar" variable — normalizarVariableDinamica()
    //      produce la MISMA forma que una entrada del catálogo estático.
    // ====================================================================
    await test("1. normalizarVariableDinamica() produce una definición con la forma del catálogo", () => {

        const def = catalogo.normalizarVariableDinamica(FILA_SUYO_SUYOS);

        assert.strictEqual(def.key, "suyo_suyos");
        assert.strictEqual(def.type, "concordancia");
        assert.strictEqual(def.dinamica, true);
        assert.strictEqual(def.singular, "suyo");
        assert.strictEqual(def.plural, "suyos");
        assert.strictEqual(def.estado, "NUEVA");
        assert.strictEqual(def.example, "suyo / suyos", "sin ejemplo propio, cae al fallback automático singular/plural");

    });

    // ====================================================================
    // J-1. Campo "Ejemplo" — metadata de presentación, nunca se usa para
    //      resolver el valor real (eso sigue leyendo singular/plural/valor
    //      directo). Si está vacío, se conserva el fallback automático.
    // ====================================================================
    await test("J-1. Ejemplo personalizado se usa en el catálogo cuando no está vacío (concordancia)", () => {

        const conEjemplo = catalogo.normalizarVariableDinamica({ ...FILA_SUYO_SUYOS, ejemplo: "el número es suyo" });
        assert.strictEqual(conEjemplo.example, "el número es suyo");

        // La RESOLUCIÓN real nunca lee "ejemplo" -- sigue dependiendo solo
        // de singular/plural, sin importar qué diga el ejemplo.
        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, [conEjemplo]);
        assert.strictEqual(vars.suyo_suyos, "suyo", "el ejemplo es solo metadata -- la resolución real no cambia");

    });

    await test("J-1. Ejemplo vacío conserva el fallback automático (concordancia y texto)", () => {

        const concordanciaVacia = catalogo.normalizarVariableDinamica({ ...FILA_SUYO_SUYOS, ejemplo: "" });
        assert.strictEqual(concordanciaVacia.example, "suyo / suyos");

        const textoVacio = catalogo.normalizarVariableDinamica(FILA_SOPORTE);
        assert.strictEqual(textoVacio.example, "3001234567", "sin ejemplo propio, el tipo texto cae al valor fijo");

        const textoConEjemplo = catalogo.normalizarVariableDinamica({ ...FILA_SOPORTE, ejemplo: "Llámanos" });
        assert.strictEqual(textoConEjemplo.example, "Llámanos");

    });

    await test("2. Editar (cambiar singular/plural en la fila) cambia la resolución sin reiniciar nada", () => {

        const original = catalogo.normalizarVariableDinamica(FILA_SUYO_SUYOS);
        const editada = catalogo.normalizarVariableDinamica({ ...FILA_SUYO_SUYOS, singular: "de él", plural: "de ellos" });

        const { ctx, resultado } = ctxReserva(["45"]);

        const textoOriginal = resolverTexto("{{suyo_suyos}}", require("../../shared/variables/contextoVariables").construirContextoGlobal(ctx), [original]);
        const textoEditado = resolverTexto("{{suyo_suyos}}", require("../../shared/variables/contextoVariables").construirContextoGlobal(ctx), [editada]);

        assert.strictEqual(textoOriginal, "suyo");
        assert.strictEqual(textoEditado, "de él");
        void resultado;

    });

    // ====================================================================
    // 3-4. Duplicar / eliminar -- lógica de identificador independiente y
    //      de "no eliminar silenciosamente" (probadas como reglas puras;
    //      el CRUD contra Supabase real requiere la migración 017 aplicada
    //      -- ver informe final).
    // ====================================================================
    await test("3. Duplicar: la copia debe tener un identificador DISTINTO al original", () => {

        const original = FILA_SUYO_SUYOS.identificador;
        const sugerido = `${original}_copia`;

        assert.notStrictEqual(sugerido, original);
        assert.ok(catalogo.esIdentificadorValido(sugerido));

    });

    await test("4. Antes de eliminar: detectar colisión de identificador contra el catálogo ESTÁTICO (no duplicados silenciosos)", () => {

        // Un identificador que YA es una clave o alias estático (p. ej.
        // "evento", alias "nombre_evento") debe rechazarse al crear -- esta
        // es la validación que el servicio de creación debe ejecutar antes
        // del INSERT.
        assert.strictEqual(catalogo.esVariableConocida("evento"), true, "\"evento\" ya existe en el catálogo estático");
        assert.strictEqual(catalogo.esVariableConocida("nombre_evento"), true, "\"nombre_evento\" ya es alias de \"evento\"");
        assert.strictEqual(catalogo.esVariableConocida("suyo_suyos"), false, "\"suyo_suyos\" NO existe todavía en el catálogo estático -- válido para crear");

    });

    // ====================================================================
    // 5-9. Variable gramatical dinámica: crear, usar en una plantilla, en
    //      OTRO tipo de plantilla, singular, plural.
    // ====================================================================
    const catalogoExtra = [catalogo.normalizarVariableDinamica(FILA_SUYO_SUYOS)];

    await test("5-6. {{suyo_suyos}} en una plantilla de RESERVA (1 número) -> singular", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("Este número es {{suyo_suyos}}.", vars, {}, catalogoExtra);

        assert.strictEqual(texto, "Este número es suyo.");

    });

    await test("7. {{suyo_suyos}} en OTRO tipo de plantilla (disponibilidad, 3 disponibles) -> plural", () => {

        const { ctx, resultado } = ctxDisponibilidad(["01", "02", "03"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("Estos números son {{suyo_suyos}} si los reservas.", vars, {}, catalogoExtra);

        assert.strictEqual(texto, "Estos números son suyos si los reservas.");

    });

    await test("8. Cantidad = 1 -> forma singular exacta", () => {

        const { ctx, resultado } = ctxReserva(["07"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        assert.strictEqual(vars.suyo_suyos, "suyo");

    });

    await test("9. Cantidad > 1 -> forma plural exacta", () => {

        const { ctx, resultado } = ctxReserva(["07", "08", "09"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        assert.strictEqual(vars.suyo_suyos, "suyos");

    });

    // ====================================================================
    // 10-14. Posición dentro del texto.
    // ====================================================================
    await test("10. Variable dinámica al INICIO del texto", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("{{suyo_suyos}}, ¡felicidades!", vars, {}, catalogoExtra);
        assert.strictEqual(texto, "suyo, ¡felicidades!");

    });

    await test("11. Variable dinámica en MEDIO del texto", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("Este número ya es {{suyo_suyos}}, guárdelo.", vars, {}, catalogoExtra);
        assert.strictEqual(texto, "Este número ya es suyo, guárdelo.");

    });

    await test("12. Variable dinámica al FINAL del texto", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("Confirmado: {{suyo_suyos}}", vars, {}, catalogoExtra);
        assert.strictEqual(texto, "Confirmado: suyo");

    });

    await test("13. Variable dinámica SOLA en un renglón (con saltos de línea alrededor)", () => {

        const { ctx, resultado } = ctxReserva(["45", "46"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("Línea 1\n{{suyo_suyos}}\nLínea 3", vars, {}, catalogoExtra);
        assert.strictEqual(texto, "Línea 1\nsuyos\nLínea 3");

    });

    await test("14. Varias variables (estáticas + dinámica) juntas en el mismo mensaje", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("{{cliente}}, {{numeros_reservados}} {{quedo_quedaron}} {{suyo_suyos}} 🎉", vars, {}, catalogoExtra);
        assert.strictEqual(texto, "Andrés, ( 45 ) quedó suyo 🎉");

    });

    // ====================================================================
    // 15-18. Modificadores de texto — sobre una variable ESTÁTICA existente
    //        (disponible_disponibles) Y sobre la DINÁMICA nueva.
    // ====================================================================
    await test("15. |lower sobre variable estática", () => {

        assert.strictEqual(aplicarModificadorTexto("DISPONIBLES", "lower"), "disponibles");

    });

    await test("16. |upper end-to-end en aplicarPlantilla (variable estática real)", () => {

        const { ctx, resultado } = ctxDisponibilidad(["01", "02", "03"]);
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{disponible_disponibles|upper}}", vars);
        assert.strictEqual(texto, "DISPONIBLES");

    });

    await test("17. |capitalize end-to-end (variable estática real)", () => {

        const { ctx, resultado } = ctxDisponibilidad(["01", "02", "03"]);
        const vars = construirVariables(ctx, resultado);
        const texto = aplicarPlantilla("{{disponible_disponibles|capitalize}}", vars);
        assert.strictEqual(texto, "Disponibles");

    });

    await test("18. |title end-to-end sobre variable DINÁMICA de tipo texto (varias palabras)", () => {

        const filaFrase = catalogo.normalizarVariableDinamica({
            identificador: "frase_bienvenida", tipo: "texto", valor: "bienvenido a la familia", nombre_visible: "Frase"
        });

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, [filaFrase]);
        const texto = aplicarPlantilla("{{frase_bienvenida|title}}", vars, {}, [filaFrase]);

        assert.strictEqual(texto, "Bienvenido A La Familia");

    });

    // ====================================================================
    // 19-20. Variable existente sigue funcionando / variable desconocida.
    // ====================================================================
    await test("19. Variables EXISTENTES (estáticas) siguen funcionando idénticas con catalogoExtra presente", () => {

        const { ctx, resultado } = ctxReserva(["12", "45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);

        assert.strictEqual(vars.cliente, "Andrés");
        assert.strictEqual(vars.numeros_reservados, "( 12 - 45 )");
        assert.strictEqual(vars.evento, "Sinuano Noche");

    });

    await test("20. Variable DESCONOCIDA nunca produce undefined/null/[object Object]", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const texto = aplicarPlantilla("{{esto_no_existe}} y {{tampoco_esto|upper}}", vars, {}, catalogoExtra);

        assert.strictEqual(texto, " y ");
        assert.ok(!texto.includes("undefined"));
        assert.ok(!texto.includes("null"));
        assert.ok(!texto.includes("[object Object]"));

    });

    // ====================================================================
    // 21. Saltos de línea (plantilla completa, multilinea real).
    // ====================================================================
    await test("21. Plantilla completa con saltos de línea reales", () => {

        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        const contenido = "🎉 {{cliente}}\n\nTu número {{suyo_suyos}} es:\n{{numeros_reservados}}\n\n¡Gracias!";
        const texto = aplicarPlantilla(contenido, vars, {}, catalogoExtra);

        assert.strictEqual(texto, "🎉 Andrés\n\nTu número suyo es:\n( 45 )\n\n¡Gracias!");

    });

    // ====================================================================
    // 22. "Catálogo global actualizado después de crear variable" — antes
    //     de pasar catalogoExtra, la variable NO se reconoce; en cuanto se
    //     pasa (equivalente a "ya se creó y el panel volvió a cargar el
    //     catálogo"), se reconoce de inmediato -- sin reiniciar nada.
    // ====================================================================
    await test("22. Catálogo se actualiza de inmediato al incluir la variable nueva (sin reiniciar el proceso)", () => {

        assert.strictEqual(catalogo.esVariableConocida("suyo_suyos"), false, "antes de crearla, no existe");
        assert.strictEqual(catalogo.esVariableConocida("suyo_suyos", catalogoExtra), true, "en cuanto se incluye en catalogoExtra, se reconoce");

        const desconocidasAntes = catalogo.extraerVariablesDesconocidas("{{suyo_suyos}}");
        const desconocidasDespues = catalogo.extraerVariablesDesconocidas("{{suyo_suyos}}", catalogoExtra);

        assert.deepStrictEqual(desconocidasAntes, ["suyo_suyos"]);
        assert.deepStrictEqual(desconocidasDespues, []);

        const lista = catalogo.listarCatalogo(catalogoExtra);
        assert.ok(lista.some(v => v.key === "suyo_suyos"));

    });

    // ====================================================================
    // Variable de tipo "texto" dinámica — no gramatical, valor fijo.
    // ====================================================================
    await test("EXTRA. Variable dinámica de tipo \"texto\" resuelve su valor fijo, sin requires", () => {

        const filaSoporte = catalogo.normalizarVariableDinamica(FILA_SOPORTE);
        const { ctx, resultado } = ctxReserva(["45"]);
        const vars = construirVariables(ctx, resultado, [filaSoporte]);

        assert.strictEqual(vars.whatsapp_soporte, "3001234567");

    });

    // ====================================================================
    // Concordancia dinámica con cantidad = 0 -> plural (misma regla que
    // gramatica.js: cero concuerda en plural, ver auditoría).
    // ====================================================================
    await test("EXTRA. Cantidad = 0 (0 disponibles) -> forma PLURAL, igual que las 15 estáticas", () => {

        const { ctx, resultado } = ctxDisponibilidad([]);
        const vars = construirVariables(ctx, resultado, catalogoExtra);
        assert.strictEqual(vars.suyo_suyos, "suyos");

    });

    // ====================================================================
    // Resumen
    // ====================================================================

    const total = resultados.length;
    const pasa = resultados.filter(r => r.ok).length;

    console.log("");
    console.log("============================");
    console.log(`TOTAL: ${total}  ✅ PASA: ${pasa}  ❌ FALLA: ${total - pasa}`);
    console.log("============================");

    if (pasa !== total) {
        process.exitCode = 1;
    }

}

main().catch(err => {
    console.error("💥 Error inesperado:", err);
    process.exitCode = 1;
});
