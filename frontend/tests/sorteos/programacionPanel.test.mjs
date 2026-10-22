// ==========================================================================
// PRUEBAS (frontend) — programación de sorteos en el panel.
//
//   1. La imagen de WhatsApp (/tablas/imprimir) y la vista previa usan el
//      MISMO componente (TablaImprimible), con el diseño elegido y los mismos
//      datos (número + libre/ocupado, sin datos personales).
//   2. La vista previa respeta el orden: fecha -> tabla -> anuncio ->
//      cuentas -> grupos -> advertencias; el reinicio exige su confirmación.
//   3. El formulario: reinicio NUNCA por defecto, fecha del sorteo, cuentas
//      creadas sin salir, estilo de tabla.
//
//     node frontend/tests/sorteos/programacionPanel.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

// TablaImprimible real (JSX transpilado); Grid sustituido por un espía que
// recibe exactamente las props que recibiría el Grid real.
const recibidoPorGrid = [];
function cargarTs(rel, cache = new Map()) {
    const abs = path.join(FRONT, rel);
    if (cache.has(abs)) return cache.get(abs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    cache.set(abs, modulo);
    const requerir = (spec) => {
        if (spec === "@/components/tablas/Grid") return { __esModule: true, default: (props) => { recibidoPorGrid.push(props); return null; } };
        if (spec.startsWith("@/")) {
            for (const ext of [".ts", ".tsx"]) if (fs.existsSync(path.join(FRONT, spec.slice(2) + ext))) return cargarTs(spec.slice(2) + ext, cache);
        }
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

const { default: TablaImprimible, construirNumerosParaImprimir } = cargarTs("components/tablas/TablaImprimible.tsx");
const { DEFAULT_TABLA_DISENO_CONFIG, TABLA_DISENO_PRESETS } = cargarTs("services/tablas/disenoDefaults.ts");

// Renderiza la función componente (sin DOM): devuelve el árbol React.
const renderizar = (props) => TablaImprimible(props);
const grid = (arbol) => arbol.props.children;   // <div><Grid .../></div>

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("TablaImprimible: el Grid recibe el diseño ELEGIDO (no el genérico) y el fondo del diseño", () => {
    const oscuro = TABLA_DISENO_PRESETS.find(p => p.key === "oscuro").config;
    const arbol = renderizar({ numerosDisponibles: ["00", "02"], numerosOcupados: ["01"], diseno: oscuro });
    assert.strictEqual(grid(arbol).props.diseno, oscuro);
    assert.strictEqual(arbol.props.style.background, oscuro.theme.pageBg);
    assert.strictEqual(grid(arbol).props.limpio, true);
    const porDefecto = renderizar({ numerosDisponibles: [], numerosOcupados: [], diseno: null });
    assert.deepStrictEqual(grid(porDefecto).props.diseno, DEFAULT_TABLA_DISENO_CONFIG, "sin diseño: el de por defecto");
});

prueba("TablaImprimible: solo número + libre/ocupado, sin datos personales; ordenados", () => {
    const filas = construirNumerosParaImprimir(["02", "00"], ["01"]);
    assert.deepStrictEqual(filas.map(f => [f.numero, f.estado]), [["00", "libre"], ["01", "reservado"], ["02", "libre"]]);
    assert.ok(filas.every(f => f.comprador === null && f.telefono === null && f.contacto === null && f.nombre === null));
});

prueba("TablaImprimible: solo la vista de impresión lleva el contenedor que captura Puppeteer", () => {
    assert.ok("data-tabla-imprimir" in renderizar({ numerosDisponibles: [], numerosOcupados: [], imprimir: true }).props);
    assert.ok(!("data-tabla-imprimir" in renderizar({ numerosDisponibles: [], numerosOcupados: [] }).props));
});

prueba("imagen y vista previa usan el MISMO componente con el diseño correspondiente", () => {
    const imprimir = leer("app/tablas/imprimir/[precio]/page.tsx");
    assert.ok(imprimir.includes("<TablaImprimible") && imprimir.includes("diseno={datos.diseno}") && imprimir.includes("imprimir"));
    assert.ok(!imprimir.includes("DEFAULT_TABLA_DISENO_CONFIG"), "la imagen ya no fuerza el diseño por defecto");
    const vista = leer("components/sorteos/VistaPreviaModal.tsx");
    assert.ok(vista.includes("<TablaImprimible") && vista.includes("diseno={vista.diseno.config}"));
    assert.ok(vista.includes("numerosDisponibles={vista.numeros.numerosDisponibles}"));
});

prueba("vista previa: orden fecha -> tabla -> anuncio -> cuentas -> grupos -> advertencias", () => {
    const vista = leer("components/sorteos/VistaPreviaModal.tsx");
    const marcas = ['aria-label="Fecha y hora"', 'aria-label="Tabla de números"', "Anuncio que se publicará", "Cuentas de pago de este sorteo", ">Grupos<", "No se puede programar todavía", "vista.avisos.length"];
    const pos = marcas.map(m => vista.indexOf(m));
    assert.ok(pos.every(p => p >= 0), JSON.stringify(marcas.filter((_, i) => pos[i] < 0)));
    assert.deepStrictEqual([...pos].sort((a, b) => a - b), pos, "en el orden pedido");
    assert.ok(vista.includes("styles.tablaVista"), "la tabla tiene su propio scroll (no oculta los botones del pie)");
});

prueba("vista previa: el reinicio se confirma para hacerse AL PUBLICAR; programar no reinicia", () => {
    const vista = leer("components/sorteos/VistaPreviaModal.tsx");
    assert.ok(vista.includes("const pideConfirmarReinicio = !!vista?.reinicio?.al_publicar;"));
    assert.ok(vista.includes("(pideConfirmarReinicio && !reinicioConfirmado)"));
    assert.ok(vista.includes("pideConfirmarReinicio ? { confirmado: reinicioConfirmado } : undefined"));
    assert.ok(!vista.includes("Reiniciar tabla y programar"), "el botón ya no promete reiniciar al programar");
    assert.ok(vista.includes("Confirmo que la tabla se reinicie al publicar"));
    // Muestra la opción guardada en los dos casos.
    assert.ok(vista.includes("Conservar la tabla actual.") && vista.includes("Reiniciar la tabla antes de publicar."));
    assert.ok(vista.includes("vista.tabla_al_publicar?.reiniciado_en"));
    assert.ok(/se_liberarian\.map/.test(vista), "muestra qué se liberaría");
});

prueba("vista previa: distingue «Listo para publicar», «Programado» y «Bloqueado por un conflicto real», por sorteo y por grupo", () => {
    const vista = leer("components/sorteos/VistaPreviaModal.tsx");
    for (const t of ["Listo para publicar", "Programado", "Bloqueado por un conflicto real"]) assert.ok(vista.includes(`"${t}"`), t);
    assert.ok(vista.includes("ESTADO_PUBLICACION[vista.estado_publicacion]"), "estado del sorteo");
    assert.ok(vista.includes("ESTADO_PUBLICACION[g.estado_previo]") && vista.includes("g.motivo"), "estado y motivo por grupo");
    assert.ok(!/g\.bloqueo \? "Bloqueado" : "Listo"/.test(vista), "ya no es solo bloqueado/listo por activo=true");
});

prueba("formulario de edición: carga por id desde el backend, título y botón de edición, sin guardar si no cargó", () => {
    const f = leer("components/sorteos/FormularioSorteo.tsx");
    assert.ok(f.includes("apiSorteos.obtener(sorteoId)"), "pide el sorteo al backend");
    assert.ok(f.includes('edicion ? "Editar sorteo" : "Nuevo sorteo"') && f.includes('edicion ? "Guardar cambios"'));
    assert.ok(f.includes("disabled={edicion && !sorteo}") && f.includes("if (edicion && !sorteo) return;"), "sin sorteo cargado no se guarda");
    assert.ok(f.includes("apiSorteos.editar(sorteo.id"), "guarda sobre el mismo id");
    // Ningún llamador pasa ya el sorteo de la lista (podía estar desactualizado).
    for (const rel of ["components/sorteos/SorteosPage.tsx", "components/tablas/AnuncioSorteoModal.tsx", "components/eventos/CrearSorteoModal/CrearSorteoModal.tsx"]) {
        assert.ok(!/<FormularioSorteo[^>]*\ssorteo=\{/.test(leer(rel)), rel);
    }
    const anuncio = leer("components/tablas/AnuncioSorteoModal.tsx");
    assert.ok(anuncio.includes('"sin_editable"') && anuncio.includes("Crear sorteo nuevo"), "Tablas no abre un formulario vacío en silencio");
});

prueba("formulario: reinicio NUNCA por defecto; fecha del sorteo; cuentas sin salir; estilo de tabla", () => {
    const f = leer("components/sorteos/FormularioSorteo.tsx");
    assert.ok(/reiniciarTabla: false,/.test(f), "por defecto se conserva la tabla");
    assert.ok(f.includes("Conservar la tabla actual") && f.includes("Reiniciar la tabla antes de publicar"));
    assert.ok(!f.includes("antes de programar"), "sin la etiqueta antigua");
    assert.ok(f.includes("los números se liberarán únicamente cuando llegue el momento de publicar el sorteo, no al programarlo"), "explicación visible");
    assert.ok(f.includes("reiniciarTabla: config.tabla?.reiniciar === true"), "al editar se conserva la opción guardada");
    assert.ok(f.includes("tabla: { reiniciar: f.reiniciarTabla, liberar_bloqueados: f.reiniciarTabla && f.liberarBloqueados }"));
    assert.ok(/liberarBloqueados: false,/.test(f) && f.includes("También liberar los números bloqueados a mano"), "bloqueados conservados salvo elección expresa");
    assert.ok(leer("components/sorteos/VistaPreviaModal.tsx").includes("vista.reinicio.se_conservan"), "la vista previa dice qué se conserva");
    assert.ok(f.includes('label="Fecha del sorteo"') && f.includes("fecha_sorteo:"));
    assert.ok(f.includes("apiSorteos.crearCuenta(") && f.includes("Agregar cuenta de pago"), "crear cuenta sin salir");
    assert.ok(f.includes("cuentas: [...prev.cuentas, r.data.id]"), "la cuenta creada queda seleccionada");
    assert.ok(!/usuario_id/.test(f.slice(f.indexOf("async function crearCuenta"), f.indexOf("async function crearCuenta") + 800)), "no envía ningún usuario");
    assert.ok(f.includes('label="Estilo de la tabla"') && f.includes("TABLA_DISENO_PRESETS") && f.includes("listarDisenos(uid)"));
    assert.ok(f.includes("diseno: disenoAForm(config.diseno)"), "el estilo se recupera al editar");
});

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
