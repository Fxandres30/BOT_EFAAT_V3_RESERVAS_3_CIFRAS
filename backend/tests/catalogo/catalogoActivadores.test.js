// ==========================================================================
// PRUEBAS — Catálogo de activadores del panel (Fase 1, solo lectura).
//
// El catálogo (frontend/services/activadores/catalogoActivadores.ts) es
// documentación tipada del comportamiento real del bot. Esta prueba lo
// contrasta con el código para que nunca muestre algo que ya no existe:
//   1. Cada archivo citado existe y contiene el símbolo citado.
//   2. Cada frase de ejemplo aparece literalmente en su archivo fuente.
//   3. Cada tipo de plantilla existe en tiposMensaje.ts y cada ruta del
//      panel existe en frontend/app.
//   4. Lo marcado como "código sin uso" de verdad no se usa.
//   5. Estructura: ids únicos y valores válidos.
//
// No toca Supabase ni ejecuta el bot: solo lee archivos.
//
//     node backend/tests/catalogo/catalogoActivadores.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../../..");
const FRONTEND = path.join(REPO, "frontend");

const ts = require(path.join(FRONTEND, "node_modules/typescript"));

function cargarCatalogo() {

    const fuente = fs.readFileSync(path.join(FRONTEND, "services/activadores/catalogoActivadores.ts"), "utf8");
    const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const modulo = { exports: {} };

    new Function("module", "exports", "require", js)(modulo, modulo.exports, require);

    return modulo.exports;

}

const leidos = new Map();

function leer(relativo) {
    if (!leidos.has(relativo)) leidos.set(relativo, fs.readFileSync(path.join(REPO, relativo), "utf8"));
    return leidos.get(relativo);
}

function escaparRegex(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Todos los .js del backend (sin node_modules ni pruebas) — para comprobar
// que un módulo marcado como "sin uso" no lo requiere nadie.
function archivosBackend(dir = path.join(REPO, "backend"), acc = []) {

    for (const nombre of fs.readdirSync(dir)) {
        if (nombre === "node_modules" || nombre === "tests") continue;
        const completo = path.join(dir, nombre);
        if (fs.statSync(completo).isDirectory()) archivosBackend(completo, acc);
        else if (nombre.endsWith(".js")) acc.push(completo);
    }

    return acc;

}

let ok = 0;
let fallidas = 0;

function test(nombre, fn) {
    try {
        fn();
        ok++;
        console.log(`✅ ${nombre}`);
    } catch (error) {
        fallidas++;
        console.log(`❌ ${nombre}\n   ${error.message}`);
    }
}

const { CATALOGO_ACTIVADORES, ETIQUETA_TIPO_ACTIVADOR, ETIQUETA_ESTADO, ETIQUETA_EDICION } = cargarCatalogo();
const entradas = CATALOGO_ACTIVADORES.flatMap(m => m.entradas.map(e => ({ ...e, modulo: m.id })));
const tiposMensaje = leer("frontend/services/mensajes/tiposMensaje.ts");

test(`estructura: ${CATALOGO_ACTIVADORES.length} módulos, ${entradas.length} entradas, ids únicos`, () => {
    const ids = entradas.map(e => e.id);
    assert.strictEqual(new Set(ids).size, ids.length, "ids repetidos");
    assert.strictEqual(new Set(CATALOGO_ACTIVADORES.map(m => m.id)).size, CATALOGO_ACTIVADORES.length);
});

for (const e of entradas) {

    test(`[${e.modulo}/${e.id}] valores válidos`, () => {
        assert.ok(ETIQUETA_ESTADO[e.estado], `estado ${e.estado}`);
        assert.ok(ETIQUETA_EDICION[e.edicion.nivel], `edición ${e.edicion.nivel}`);
        assert.ok(e.activadores.length > 0, "sin activadores");
        for (const a of e.activadores) assert.ok(ETIQUETA_TIPO_ACTIVADOR[a.tipo], `tipo ${a.tipo}`);
        assert.ok(e.codigo.length > 0, "sin código citado");
    });

    for (const ref of e.codigo) {
        test(`[${e.id}] ${ref.archivo}${ref.simbolo ? ` contiene «${ref.simbolo}»` : " existe"}`, () => {
            assert.ok(fs.existsSync(path.join(REPO, ref.archivo)), "archivo inexistente");
            if (ref.simbolo) assert.ok(new RegExp(`\\b${escaparRegex(ref.simbolo)}\\b`).test(leer(ref.archivo)), "símbolo no encontrado");
        });
    }

    for (const a of e.activadores) {
        for (const ejemplo of a.ejemplos || []) {
            test(`[${e.id}] frase «${ejemplo}» existe en ${a.fuente}`, () => {
                assert.ok(a.fuente, "ejemplo sin archivo fuente");
                const texto = leer(a.fuente);
                const literal = new RegExp(`["']${escaparRegex(ejemplo)}["']|\\b${escaparRegex(ejemplo)}\\s*:`);
                assert.ok(literal.test(texto), "no aparece literalmente en el código");
            });
        }
    }

    for (const tipo of e.plantillas || []) {
        test(`[${e.id}] tipo de plantilla «${tipo}» existe en el panel`, () => {
            assert.ok(tiposMensaje.includes(`id: "${tipo}"`));
        });
    }

    for (const p of e.panel || []) {
        test(`[${e.id}] ruta del panel ${p.ruta} existe`, () => {
            assert.ok(fs.existsSync(path.join(FRONTEND, "app", p.ruta, "page.tsx")));
        });
    }

}

// ---------------------------------------------------------- código sin uso ---

const fuentesBackend = archivosBackend().map(f => ({ f, texto: fs.readFileSync(f, "utf8") }));

const relativoAlRepo = (f) => path.relative(REPO, f).replace(/\\/g, "/");

// Quién importa `relativo`, resolviendo cada require/import a su ruta real
// (archivo.js o carpeta/index.js). Los scripts sueltos de diagnóstico
// ("_*.js") no son parte del bot en producción y no cuentan como uso.
function requeridoPor(relativo) {

    const objetivo = path.join(REPO, relativo);

    return fuentesBackend
        .filter(({ f }) => !path.basename(f).startsWith("_") && f !== objetivo)
        .filter(({ f, texto }) => {
            const especificadores = [...texto.matchAll(/(?:require\(|from\s+)["'](\.[^"']*)["']/g)].map(m => m[1]);
            return especificadores.some(esp => {
                const base = path.resolve(path.dirname(f), esp);
                return [base, `${base}.js`, path.join(base, "index.js")].includes(objetivo);
            });
        })
        .map(({ f }) => relativoAlRepo(f));

}

test("control: la búsqueda de uso sí encuentra módulos usados (no pasa en vacío)", () => {
    assert.ok(requeridoPor("backend/bot/funciones/consultas/detectarIntencion.js").includes("backend/bot/handlers/eventHandler.js"));
    assert.ok(requeridoPor("backend/bot/funciones/eventos/lifecycle/procesarSorteo.js").length > 0);
});

test("código sin uso: los módulos del ciclo de vida marcados no los requiere nadie", () => {
    const entrada = entradas.find(e => e.id === "ciclo-codigo-muerto");
    for (const ref of entrada.codigo) {
        const usuarios = requeridoPor(ref.archivo).filter(u => !entrada.codigo.some(r => r.archivo === u));
        assert.deepStrictEqual(usuarios, [], `${ref.archivo} lo requiere ${usuarios.join(", ")}`);
    }
});

test("código sin uso: commandHandler.js solo exporta una función vacía", () => {
    assert.match(leer("backend/bot/handlers/commandHandler.js").trim(), /^module\.exports\s*=\s*async\s*\(\)\s*=>\s*\{\s*\};?$/);
});

test("código sin uso: eventos/index.js reexporta archivos que no existen", () => {
    for (const faltante of ["crearEvento", "programarCierreEvento", "verificarEventosPendientes"]) {
        assert.ok(leer("backend/bot/funciones/eventos/index.js").includes(`./${faltante}.js`));
        assert.ok(!fs.existsSync(path.join(REPO, `backend/bot/funciones/eventos/${faltante}.js`)), `${faltante}.js existe`);
    }
});

test("sin efecto: iniciarWorkers() no se llama fuera de su archivo y procesarReserva no existe", () => {
    const llamadas = fuentesBackend.filter(({ f, texto }) => !f.endsWith(path.join("workers", "index.js")) && /\biniciarWorkers\s*\(/.test(texto));
    assert.deepStrictEqual(llamadas.map(x => x.f), []);
    assert.ok(!fs.existsSync(path.join(REPO, "backend/bot/services/reservas/procesarReserva.js")));
});

test("sin efecto: ningún flujo lee automation_configs.stickers", () => {
    const lectores = fuentesBackend.filter(({ texto }) => /config(uracion)?\??\.stickers\b/.test(texto));
    assert.deepStrictEqual(lectores.map(x => x.f), []);
});

console.log(`\nPruebas: ${ok + fallidas}  |  OK: ${ok}  |  Fallidas: ${fallidas}`);

process.exit(fallidas > 0 ? 1 : 0);
