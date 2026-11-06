// ==========================================================================
// PRUEBAS: conteo de números de un sorteo, fuente única (F1-B, 06/11/2026).
//
// repo.contarNumerosIdentidad sustituye a las dos copias que había en
// gestionEventos.js y sorteosActivos.js; repo.contarNumerosTabla comparte
// con ella el mismo conteo. Se fija el contrato que las dos copias tenían:
//   - sin tabla o sin identidad: { ok:true, 0, 0 } sin consultar;
//   - solo cuenta las filas del usuario (y de la identidad);
//   - error de lectura: ok=false y null, NUNCA «0 reservados».
//
//     node backend/tests/sorteos/contarNumeros.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// Supabase falso mínimo: from(tabla).select().eq().eq() -> filtra FILAS.
const estado = { filas: [], error: null, consultas: 0 };
function consulta() {
    const filtros = [];
    const q = {
        select() { return q; },
        eq(col, val) { filtros.push([col, val]); return q; },
        then(ok, ko) {
            estado.consultas++;
            const res = estado.error
                ? { data: null, error: { message: estado.error } }
                : { data: estado.filas.filter(f => filtros.every(([c, v]) => f[c] === v)).map(f => ({ estado: f.estado })), error: null };
            return Promise.resolve(res).then(ok, ko);
        }
    };
    return q;
}
require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: { from: () => consulta() } };

const repo = require(r("sorteos/repo.js"));

const A = "usuario-a", B = "usuario-b";
const FILAS = [
    { usuario_id: A, identidad_evento_real: "id-1", estado: "reservado" },
    { usuario_id: A, identidad_evento_real: "id-1", estado: "reservado" },
    { usuario_id: A, identidad_evento_real: "id-1", estado: "pagado" },
    { usuario_id: A, identidad_evento_real: "id-1", estado: "libre" },
    { usuario_id: A, identidad_evento_real: "id-2", estado: "pagado" },
    { usuario_id: B, identidad_evento_real: "id-1", estado: "reservado" }
];

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });
const reiniciar = () => { estado.filas = FILAS; estado.error = null; estado.consultas = 0; };

prueba("por identidad: solo las filas del usuario y de esa identidad", async () => {
    reiniciar();
    assert.deepStrictEqual(await repo.contarNumerosIdentidad(A, "tabla_3000", "id-1"), { ok: true, reservados: 2, pagados: 1 });
    assert.deepStrictEqual(await repo.contarNumerosIdentidad(A, "tabla_3000", "id-2"), { ok: true, reservados: 0, pagados: 1 });
    assert.deepStrictEqual(await repo.contarNumerosIdentidad(B, "tabla_3000", "id-1"), { ok: true, reservados: 1, pagados: 0 });
});

prueba("por tabla: todas las filas del usuario, sin separar por identidad", async () => {
    reiniciar();
    assert.deepStrictEqual(await repo.contarNumerosTabla(A, "tabla_3000"), { ok: true, reservados: 2, pagados: 2 });
});

prueba("sin tabla o sin identidad: 0 y 0, sin consultar", async () => {
    reiniciar();
    for (const [t, i] of [[null, "id-1"], ["tabla_3000", null], ["", ""]]) {
        assert.deepStrictEqual(await repo.contarNumerosIdentidad(A, t, i), { ok: true, reservados: 0, pagados: 0 });
    }
    assert.deepStrictEqual(await repo.contarNumerosTabla(null, "tabla_3000"), { ok: true, reservados: 0, pagados: 0 });
    assert.strictEqual(estado.consultas, 0);
});

prueba("error de lectura: ok=false y null en las dos (nunca «0 reservados»)", async () => {
    reiniciar();
    estado.error = "timeout";
    const errores = [];
    const original = console.error;
    console.error = (...a) => errores.push(a.join(" "));
    try {
        assert.deepStrictEqual(await repo.contarNumerosIdentidad(A, "tabla_3000", "id-1"), { ok: false, reservados: null, pagados: null });
        assert.deepStrictEqual(await repo.contarNumerosTabla(A, "tabla_3000"), { ok: false, reservados: null, pagados: null });
    } finally { console.error = original; }
    assert.strictEqual(errores.length, 2);
    assert.ok(errores.every(e => e.includes("tabla_3000") && e.includes("timeout")));
});

prueba("ya no quedan copias locales en gestionEventos ni sorteosActivos", () => {
    const fs = require("fs");
    for (const f of ["sorteos/gestionEventos.js", "sorteos/sorteosActivos.js"]) {
        assert.ok(!/function\s+contarNumeros\s*\(/.test(fs.readFileSync(r(f), "utf8")), f);
    }
});

(async () => {
    let fallos = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
    process.exitCode = fallos ? 1 : 0;
})();
