// ==========================================================================
// PRUEBAS — regla única de pertenencia de reservas (fuga real 65/86).
//
// Una reserva de OTRO propietario (usuario_global_id distinto) nunca es
// propia por teléfono, contacto ni nombre. Las antiguas sin propietario
// interno se resuelven por el LID de la fila (o, si no tiene LID, por el
// teléfono). Datos ficticios; módulos reales: obtenerUsuarioGlobal.js
// (reservaPerteneceAUsuario), consultarMisNumeros.js, consultarNumero.js,
// validarReservas.js, resolverConsulta.js.
//
//     node backend/tests/identidad/pertenenciaReservas.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const tablas = { t: [] };

function condicionOr(expr) {
    const conds = String(expr).split(",").map(c => {
        const [col, op, ...resto] = c.split(".");
        const val = resto.join(".");
        if (op === "eq") return f => String(f[col]) === val;
        if (op === "is" && val === "null") return f => f[col] == null;
        return () => false;
    });
    return f => conds.some(fn => fn(f));
}

const fakeSupabase = {
    from(tabla) {
        const q = { filtros: [] };
        const b = {
            select() { return b; },
            order() { return b; },
            eq(c, v) { q.filtros.push(f => f[c] === v); return b; },
            neq(c, v) { q.filtros.push(f => f[c] !== v); return b; },
            in(c, vs) { q.filtros.push(f => vs.includes(f[c])); return b; },
            or(e) { q.filtros.push(condicionOr(e)); return b; },
            maybeSingle() { q.unico = true; return b; },
            then(ok, ko) {
                const sel = (tablas[tabla] || []).filter(f => q.filtros.every(fn => fn(f))).map(f => ({ ...f }));
                return Promise.resolve({ data: q.unico ? sel[0] || null : sel, error: null }).then(ok, ko);
            }
        };
        return b;
    }
};

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fakeSupabase };

const { reservaPerteneceAUsuario } = require(r("bot/funciones/usuarios/obtenerUsuarioGlobal.js"));
const { consultarMisNumeros, consultarMisNumerosPorEstado } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));
const { consultarNumero } = require(r("bot/funciones/consultas/consultarNumero.js"));
const { validarReservas } = require(r("bot/funciones/reservas/validarReservas.js"));

const EVENTO = { tabla: "t", usuario_id: "tenant-1", identidad_evento_real: "S1" };

// Perfiles ficticios (como los guarda obtenerUsuarioGlobal: LID completo, teléfono de 10 dígitos).
const ANA = { id: "ana", lid: "100000000000001@lid", telefono: "3000000001", nombre: "Cliente" };
const BETO = { id: "beto", lid: "200000000000002@lid", telefono: "3000000002", nombre: "Cliente" };   // mismo nombre visible
const CARLA = { id: "carla", lid: "300000000000003@lid", telefono: null, nombre: "Carla" };              // solo LID

const fila = (numero, campos) => ({ numero, estado: "reservado", usuario_id: "tenant-1", identidad_evento_real: "S1", usuario_global_id: null, lid: null, telefono: null, contacto: null, nombre: null, ...campos });

function sembrar() {
    tablas.t = [
        fila("10", { usuario_global_id: "ana", lid: ANA.lid, telefono: ANA.telefono, contacto: ANA.telefono }),
        // Caso real 65: propietario Ana, pero la fila lleva el teléfono de Beto.
        fila("65", { estado: "pagado", usuario_global_id: "ana", lid: ANA.lid, telefono: BETO.telefono, contacto: BETO.telefono, nombre: "Cliente" }),
        // Caso real 86: sin propietario interno, LID de Carla y teléfono de Beto.
        fila("86", { estado: "pagado", lid: CARLA.lid, telefono: BETO.telefono, contacto: BETO.telefono }),
        // Antigua sin propietario ni LID, solo teléfono de Beto.
        fila("20", { telefono: BETO.telefono, contacto: BETO.telefono }),
        // Antigua sin propietario, con LID de Ana.
        fila("30", { lid: ANA.lid }),
        fila("40", { usuario_global_id: "beto", lid: BETO.lid, telefono: BETO.telefono, contacto: BETO.telefono })
    ];
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("regla: con propietario interno solo cuenta el propietario (nunca teléfono/contacto/nombre)", () => {
    sembrar();
    const r65 = tablas.t.find(f => f.numero === "65");
    assert.strictEqual(reservaPerteneceAUsuario(r65, ANA), true);
    assert.strictEqual(reservaPerteneceAUsuario(r65, BETO), false, "teléfono de Beto en la fila de Ana");
    assert.strictEqual(reservaPerteneceAUsuario(tablas.t.find(f => f.numero === "40"), ANA), false, "mismo nombre visible no cuenta");
});

prueba("regla: antigua sin propietario con LID → decide el LID; un teléfono distinto en la fila no prueba nada", () => {
    sembrar();
    const r86 = tablas.t.find(f => f.numero === "86");
    assert.strictEqual(reservaPerteneceAUsuario(r86, CARLA), true);
    assert.strictEqual(reservaPerteneceAUsuario(r86, BETO), false);
    assert.strictEqual(reservaPerteneceAUsuario(tablas.t.find(f => f.numero === "30"), ANA), true);
    assert.strictEqual(reservaPerteneceAUsuario(fila("31", { lid: "100000000000001:12@lid" }), ANA), true, "LID con sufijo de dispositivo");
});

prueba("regla: antigua sin propietario ni LID → por teléfono del perfil; sin teléfono → no es de nadie", () => {
    sembrar();
    const r20 = tablas.t.find(f => f.numero === "20");
    assert.strictEqual(reservaPerteneceAUsuario(r20, BETO), true);
    assert.strictEqual(reservaPerteneceAUsuario(r20, ANA), false);
    assert.strictEqual(reservaPerteneceAUsuario(r20, CARLA), false, "teléfono ausente: no se atribuye");
    assert.strictEqual(reservaPerteneceAUsuario(r20, null), false);
    assert.strictEqual(reservaPerteneceAUsuario(r20, { lid: null, telefono: BETO.telefono }), false, "sin identidad interna no hay pertenencia");
});

prueba("mis números / estados / pagos: Beto ya NO ve el 65 de Ana ni el 86 de Carla (fuga cerrada)", async () => {
    sembrar();
    assert.deepStrictEqual((await consultarMisNumeros({ evento: EVENTO, usuario: BETO })).sort(), ["20", "40"]);
    const porEstado = await consultarMisNumerosPorEstado({ evento: EVENTO, usuario: BETO });
    assert.ok(!JSON.stringify(porEstado).includes("65") && !JSON.stringify(porEstado).includes("86"), JSON.stringify(porEstado));
    assert.deepStrictEqual((await consultarMisNumeros({ evento: EVENTO, usuario: ANA })).sort(), ["10", "30", "65"]);
    assert.deepStrictEqual((await consultarMisNumeros({ evento: EVENTO, usuario: CARLA })).sort(), ["86"]);
});

prueba("consulta de un número: el 65 es «pagado por otro» para Beto y «pagado por usuario» para Ana", async () => {
    sembrar();
    assert.strictEqual((await consultarNumero({ evento: EVENTO, usuario: BETO, numero: "65" })).estadoReal, "pagado_por_otro");
    assert.strictEqual((await consultarNumero({ evento: EVENTO, usuario: ANA, numero: "65" })).estadoReal, "pagado_por_usuario");
});

prueba("reservar: el 65 de Ana nunca cuenta como «ya es mío» para Beto (sigue ocupado por otra persona)", () => {
    sembrar();
    const res = validarReservas([tablas.t.find(f => f.numero === "65")], BETO);
    assert.strictEqual(res.yaSonMios.length, 0);
    assert.strictEqual(res.ocupadosPorOtros.length, 1);
});

prueba("no cambia ningún dato: estados, propietarios y números quedan igual", async () => {
    sembrar();
    const antes = JSON.stringify(tablas.t);
    for (const u of [ANA, BETO, CARLA]) {
        await consultarMisNumeros({ evento: EVENTO, usuario: u });
        await consultarMisNumerosPorEstado({ evento: EVENTO, usuario: u });
    }
    assert.strictEqual(JSON.stringify(tablas.t), antes);
});

(async () => {
    let ok = 0, falla = 0;
    const log = console.log;
    for (const { n, fn } of pruebas) {
        console.log = () => {};
        let error = null;
        try { await fn(); } catch (e) { error = e; }
        console.log = log;
        if (error) { falla++; console.log(`❌ ${n}`); console.log(String(error && error.stack || error)); }
        else { ok++; console.log(`✅ ${n}`); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
