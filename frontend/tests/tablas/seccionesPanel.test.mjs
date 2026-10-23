// ==========================================================================
// PRUEBAS (frontend) — el panel de tablas recuerda qué secciones («Reservas
// recientes», «Grupos», «Actividad reciente») están contraídas:
//   - se guardan y se restauran por sección, de forma independiente;
//   - una clave por usuario: otra cuenta en el mismo navegador no las hereda;
//   - sin preferencia (o con datos corruptos / almacenamiento bloqueado) se
//     usa el predeterminado de siempre: todo abierto;
//   - solo se guardan booleanos de secciones conocidas;
//   - las tres secciones reciben el estado de la vista (useSeccionesPanel)
//     en lugar de un useState(true) local que se perdía al recargar.
//
// Carga el servicio TypeScript REAL (mismo cargador que
// tests/estado/estadoVerificado.test.mjs).
//
//     node frontend/tests/tablas/seccionesPanel.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("require", "module", "exports", outputText)(require, modulo, modulo.exports);
    return modulo.exports;
}

const {
    SECCIONES_PREDETERMINADAS,
    claveSecciones,
    leerSecciones,
    guardarSecciones
} = cargarTs(path.join(FRONT, "services/tablas/preferenciasSecciones.ts"));

// localStorage en memoria (mismo contrato getItem/setItem).
function almacenFalso() {
    const datos = new Map();
    return {
        datos,
        getItem: (k) => (datos.has(k) ? datos.get(k) : null),
        setItem: (k, v) => { datos.set(k, String(v)); }
    };
}

const bloqueado = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); }
};

const USUARIO_A = "11111111-1111-4111-8111-111111111111";
const USUARIO_B = "22222222-2222-4222-8222-222222222222";
const TODO_ABIERTO = { reservas: true, grupos: true, actividad: true };

let pasadas = 0;
function prueba(nombre, fn) {
    fn();
    pasadas++;
    console.log(`  ✔ ${nombre}`);
}

console.log("Preferencias de secciones del panel de tablas");

prueba("sin preferencia guardada: todo abierto (comportamiento actual)", () => {
    assert.deepStrictEqual(SECCIONES_PREDETERMINADAS, TODO_ABIERTO);
    assert.deepStrictEqual(leerSecciones(almacenFalso(), USUARIO_A), TODO_ABIERTO);
});

prueba("se guarda y se restaura tras «recargar» (nueva lectura)", () => {
    const almacen = almacenFalso();
    guardarSecciones(almacen, USUARIO_A, { reservas: false, grupos: false, actividad: false });
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: false, grupos: false, actividad: false });
});

prueba("cada sección conserva su estado independientemente", () => {
    const almacen = almacenFalso();
    let estado = leerSecciones(almacen, USUARIO_A);
    estado = { ...estado, grupos: !estado.grupos };
    guardarSecciones(almacen, USUARIO_A, estado);
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: true, grupos: false, actividad: true });

    estado = { ...leerSecciones(almacen, USUARIO_A), actividad: false };
    guardarSecciones(almacen, USUARIO_A, estado);
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: true, grupos: false, actividad: false });

    estado = { ...leerSecciones(almacen, USUARIO_A), grupos: true };
    guardarSecciones(almacen, USUARIO_A, estado);
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: true, grupos: true, actividad: false });
});

prueba("preferencias por usuario: otra cuenta no las comparte", () => {
    const almacen = almacenFalso();
    guardarSecciones(almacen, USUARIO_A, { reservas: false, grupos: true, actividad: false });
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_B), TODO_ABIERTO);
    guardarSecciones(almacen, USUARIO_B, { reservas: true, grupos: false, actividad: true });
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: false, grupos: true, actividad: false });
    assert.notStrictEqual(claveSecciones(USUARIO_A), claveSecciones(USUARIO_B));
    assert.ok(claveSecciones(USUARIO_A).includes(USUARIO_A));
});

prueba("sin usuario no se lee ni se escribe nada", () => {
    const almacen = almacenFalso();
    guardarSecciones(almacen, null, { reservas: false, grupos: false, actividad: false });
    assert.strictEqual(almacen.datos.size, 0);
    assert.deepStrictEqual(leerSecciones(almacen, null), TODO_ABIERTO);
});

prueba("datos corruptos, ajenos o almacenamiento bloqueado: predeterminado sin errores", () => {
    const almacen = almacenFalso();
    almacen.setItem(claveSecciones(USUARIO_A), "{no es json");
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), TODO_ABIERTO);

    almacen.setItem(claveSecciones(USUARIO_A), JSON.stringify({ reservas: "no", grupos: false, otra: false }));
    assert.deepStrictEqual(leerSecciones(almacen, USUARIO_A), { reservas: true, grupos: false, actividad: true });

    assert.deepStrictEqual(leerSecciones(bloqueado, USUARIO_A), TODO_ABIERTO);
    assert.doesNotThrow(() => guardarSecciones(bloqueado, USUARIO_A, TODO_ABIERTO));
    assert.deepStrictEqual(leerSecciones(null, USUARIO_A), TODO_ABIERTO);
});

prueba("solo se guardan booleanos de las tres secciones (nada de reservas)", () => {
    const almacen = almacenFalso();
    guardarSecciones(almacen, USUARIO_A, {
        reservas: false, grupos: true, actividad: false,
        comprador: "Ana", numeros: ["07", "12"], telefono: "573001234567"
    });
    assert.strictEqual(almacen.datos.size, 1);
    const guardado = JSON.parse(almacen.getItem(claveSecciones(USUARIO_A)));
    assert.deepStrictEqual(guardado, { reservas: false, grupos: true, actividad: false });
});

prueba("las tres secciones usan el estado recordado de la vista", () => {
    const leer = (r) => fs.readFileSync(path.join(FRONT, r), "utf8");
    for (const c of ["ReservasRecientes", "GruposPanel", "ActividadReciente"]) {
        const src = leer(`components/tablas/${c}.tsx`);
        assert.ok(!/useState\(true\)/.test(src), `${c} no debe tener un useState(true) local para expandido`);
        assert.ok(/onToggle=\{onToggleExpandido\}/.test(src), `${c} debe usar onToggleExpandido`);
    }
    const vista = leer("components/tablas/TablaPrecioView.tsx");
    assert.ok(/useSeccionesPanel\(usuarioId\)/.test(vista));
    for (const s of ["reservas", "grupos", "actividad"]) {
        assert.ok(vista.includes(`expandido={secciones.${s}}`), `falta expandido de ${s}`);
        assert.ok(vista.includes(`alternarSeccion("${s}")`), `falta alternar ${s}`);
    }
});

console.log(`\n${pasadas} pruebas pasadas`);
