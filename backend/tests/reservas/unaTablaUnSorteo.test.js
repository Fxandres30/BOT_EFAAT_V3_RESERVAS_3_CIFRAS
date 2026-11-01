// ==========================================================================
// PRUEBAS — UNA TABLA = UN SORTEO (31/10/2026).
//
// La pertenencia de un número a un sorteo la decide su TABLA (la cuadrícula
// del cliente: tabla física + usuario_id). El origen (panel, WhatsApp,
// cualquier grupo, «sin sorteo», ciclo anterior conservado) es historia:
//   - sorteoReal.estadoDelSorteo (contadores del panel y cierre por pagos)
//     cuenta todos los números de la tabla según su estado real;
//   - estadoNumeros (bot) decide propio/ocupado solo por estado y dueño;
//   - tablas distintas y clientes distintos NUNCA se mezclan.
//
// Supabase en memoria. Sin red ni WhatsApp.
//
//     node backend/tests/reservas/unaTablaUnSorteo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const db = {};

// Cliente mínimo: from(t).select(...).eq(c, v)... thenable con las filas.
const fake = {
    from(tabla) {
        const filtros = [];
        const q = {
            select: () => q,
            eq: (c, v) => { filtros.push(f => f[c] === v); return q; },
            then: (ok, ko) => Promise.resolve({ data: (db[tabla] || []).filter(f => filtros.every(p => p(f))), error: null }).then(ok, ko)
        };
        return q;
    }
};
const abs = path.join(RAIZ, "lib/supabase.js");
require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: fake };

const { estadoDelSorteo } = require("../../bot/funciones/eventos/sorteoReal");
const { clasificarSolicitud } = require("../../bot/funciones/reservas/estadoNumeros");

const A = "cliente-A";
const B = "cliente-B";
const T5 = "5k_15k_reservas_2_cifras";
const T1 = "reservas_dos_cifras";
const KATY = { id: "c-katy", telefono: "3001112233" };
const LUIS = { id: "c-luis", telefono: "3004445566" };

const evento = (extra = {}) => ({ id: "ev-g1", usuario_id: A, tabla: T5, cifras: 2, cantidad_numeros: 100, identidad_evento_real: "id-actual", grupo_id: "g1@g.us", ...extra });

// Cuadrícula 00-99 de `usuario` en `tabla`, con los números dados.
function cuadricula(tabla, usuario, ocupados = {}) {
    db[tabla] = (db[tabla] || []).filter(f => f.usuario_id !== usuario);
    for (let i = 0; i < 100; i++) {
        const numero = String(i).padStart(2, "0");
        db[tabla].push({ numero, estado: "libre", usuario_id: usuario, ...(ocupados[numero] || {}) });
    }
}

// Origen de cada fila tal como lo escribe cada flujo.
const ORIGEN = {
    whatsapp: { evento_id: "ev-g1", grupo_id: "g1@g.us", identidad_evento_real: "id-actual" },
    otroGrupo: { evento_id: "ev-g2", grupo_id: "g2@g.us", identidad_evento_real: "id-actual" },
    manualSinSorteo: { evento_id: null, grupo_id: null, identidad_evento_real: null },
    anticipada: { evento_id: null, grupo_id: "g1@g.us", identidad_evento_real: "id-actual" },
    cicloAnterior: { evento_id: "ev-viejo", grupo_id: "g1@g.us", identidad_evento_real: "id-anterior" }
};

// 10 WhatsApp + 5 manuales + 8 otros grupos + 5 otros flujos = 28 pagados.
function escenarioEnunciado() {
    const ocupados = {};
    let i = 0;
    const poner = (cantidad, estado, origen) => {
        for (let k = 0; k < cantidad; k++, i++) ocupados[String(i).padStart(2, "0")] = { estado, usuario_global_id: KATY.id, ...origen };
    };
    poner(10, "pagado", ORIGEN.whatsapp);
    poner(5, "pagado", ORIGEN.manualSinSorteo);
    poner(8, "pagado", ORIGEN.otroGrupo);
    poner(3, "pagado", ORIGEN.cicloAnterior);
    poner(2, "pagado", ORIGEN.anticipada);
    poner(4, "reservado", ORIGEN.manualSinSorteo);
    poner(3, "reservado", ORIGEN.otroGrupo);
    cuadricula(T5, A, ocupados);
}

let ok = 0;
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("28 pagados de cinco orígenes en la misma tabla: el sorteo los cuenta todos (recaudo $140.000 a $5.000)", async () => {
    escenarioEnunciado();
    const e = await estadoDelSorteo(evento());
    assert.strictEqual(e.ok, true);
    assert.deepStrictEqual([e.pagados, e.reservados, e.libres, e.total], [28, 7, 65, 100]);
    assert.strictEqual(e.pagados * 5000, 140000);
    assert.ok(!("ocupadosOtroSorteo" in e), "ya no hay una clase «de otro sorteo» dentro de la tabla");
});

prueba("el sorteo es el mismo visto desde cualquier grupo o evento de esa tabla (mismos totales)", async () => {
    escenarioEnunciado();
    const desdeG1 = await estadoDelSorteo(evento());
    const desdeG2 = await estadoDelSorteo(evento({ id: "ev-g2", grupo_id: "g2@g.us" }));
    const sinIdentidad = await estadoDelSorteo(evento({ id: "ev-legacy", identidad_evento_real: null }));
    for (const r of [desdeG2, sinIdentidad]) assert.deepStrictEqual([r.pagados, r.reservados, r.libres], [desdeG1.pagados, desdeG1.reservados, desdeG1.libres]);
});

prueba("tablas diferentes del mismo cliente no se mezclan, aunque compartan identidad o grupo", async () => {
    escenarioEnunciado();
    cuadricula(T1, A, { "00": { estado: "pagado", ...ORIGEN.whatsapp }, "01": { estado: "reservado", ...ORIGEN.whatsapp } });
    const t5 = await estadoDelSorteo(evento());
    const t1 = await estadoDelSorteo(evento({ id: "ev-t1", tabla: T1 }));
    assert.deepStrictEqual([t5.pagados, t5.reservados], [28, 7]);
    assert.deepStrictEqual([t1.pagados, t1.reservados], [1, 1]);
});

prueba("la cuadrícula de otro cliente en la misma tabla física nunca cuenta", async () => {
    escenarioEnunciado();
    const todoPagado = {};
    for (let i = 0; i < 100; i++) todoPagado[String(i).padStart(2, "0")] = { estado: "pagado", ...ORIGEN.whatsapp };
    cuadricula(T5, B, todoPagado);
    const deA = await estadoDelSorteo(evento());
    const deB = await estadoDelSorteo(evento({ id: "ev-b", usuario_id: B }));
    assert.deepStrictEqual([deA.pagados, deA.completo], [28, false]);
    assert.deepStrictEqual([deB.pagados, deB.completo], [100, true]);
});

prueba("tabla completa con pagos de distintos orígenes: el sorteo queda completo (cierre por pagos)", async () => {
    const ocupados = {};
    const origenes = Object.values(ORIGEN);
    for (let i = 0; i < 100; i++) ocupados[String(i).padStart(2, "0")] = { estado: "pagado", ...origenes[i % origenes.length] };
    cuadricula(T5, A, ocupados);
    assert.strictEqual((await estadoDelSorteo(evento())).completo, true);
});

prueba("bot: un número del cliente en la tabla es suyo, lo reservara por otro grupo, a mano o en otro ciclo; el de otra persona, ocupado", () => {
    const evt = evento();
    const filas = [
        { numero: "01", estado: "reservado", usuario_global_id: KATY.id, ...ORIGEN.otroGrupo },
        { numero: "02", estado: "pagado", usuario_global_id: KATY.id, ...ORIGEN.manualSinSorteo },
        { numero: "03", estado: "reservado", usuario_global_id: KATY.id, ...ORIGEN.cicloAnterior },
        { numero: "04", estado: "reservado", usuario_global_id: LUIS.id, ...ORIGEN.whatsapp },
        { numero: "05", estado: "libre" }
    ];
    const clases = clasificarSolicitud({ numeros: ["01", "02", "03", "04", "05"], filas, evento: evt, usuario: KATY });
    assert.deepStrictEqual(Object.fromEntries(clases), { "01": "propio", "02": "propio", "03": "propio", "04": "ocupado", "05": "libre" });
});

prueba("el origen se conserva: la clasificación no escribe ni borra identidad, evento ni grupo", async () => {
    escenarioEnunciado();
    const antes = JSON.stringify(db[T5]);
    await estadoDelSorteo(evento());
    assert.strictEqual(JSON.stringify(db[T5]), antes);
});

(async () => {
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}\n============================`);
    if (ok !== pruebas.length) process.exit(1);
})();
