// ==========================================================================
// Calendario MAESTRO de loterías: 27 chances + 15 tradicionales precargados.
//
//   - Los horarios se comprueban contra el TEXTO del listado del
//     administrador (analizado aquí, sin reutilizar catalogoBase.js).
//   - Causa del fallo en producción: sin la 026 se sembraban 27 nombres sin
//     horario y 0 tradicionales. Se comprueba la reparación segura de esos
//     calendarios (sin pisar ediciones, sin duplicar, sin resucitar borrados).
//   - Restaurar, aislamiento entre clientes, frecuencia (044 opcional),
//     próximo sorteo e integración con la creación de sorteos.
//   - SQL real de 025 + 026 + 044 en PGlite (si PGLITE_MODULE está).
//
//     node backend/tests/sorteos/calendarioMaestro.test.js
//
// Supabase FALSO en memoria: no toca producción.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};
process.env.SESSIONS_API_TOKEN = "token-servicio-pruebas";

const calendario = require(r("sorteos/calendario.js"));
const loterias = require(r("sorteos/loterias.js"));
const servicio = require(r("sorteos/servicio.js"));
const { CATALOGO_BASE, NOTA_SIEMBRA_ANTIGUA, claveDe } = require(r("sorteos/catalogoBase.js"));
const { SQL_026, catalogoGlobalDe026 } = require("./catalogo026");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

// ------------------------------------------------ la fuente, tal cual ---
const FUENTE = `
Antioqueñita Día:
- Lunes a Sábado 10:00 AM
- Domingos y Días Feriados 12:00 PM
Antioqueñita Tarde:
- Todos los días y Días Feriados 4:00 PM
Dorado Mañana:
- Lunes a Sábado 10:58 AM
Dorado Tarde:
- Lunes a Sábado 3:28 PM
Dorado Noche:
- Sábado 10:15 PM
- Domingos y Festivos 7:25 PM
Fantástica Día:
- Lunes a Sábado 12:57 PM
Fantástica Noche:
- Lunes a Sábado 8:30 PM
El Samán de la Suerte:
- Lunes a Sábado 1:00 PM
- Domingos y Días Feriados 7:00 PM
Paisita Día:
- Lunes a Sábado 1:00 PM
- Domingos y Días Festivos 2:00 PM
Paisita Noche:
- Lunes a Sábado 6:00 PM
- Domingos y Días Festivos 8:00 PM
Chontico Día:
- Todos los días 1:00 PM
Chontico Noche:
- Lunes a Viernes 7:00 PM
- Sábado 10:00 PM
- Domingos y Festivos 8:00 PM
Pijao de Oro:
- Lunes a Viernes 2:00 PM
- Sábado 9:00 PM
- Domingo 10:00 PM
- Días Festivos 8:00 PM
Super Astro Sol:
- Lunes a Sábado a las 2:30 PM
Super Astro Luna:
- Lunes a Sábado 10:30 PM
- Domingos y Días Festivos 8:30 PM
Sinuano Día:
- Lunes a Sábado 2:30 PM
- Domingos y Días Festivos a la 1:00 pm
Sinuano Noche:
- Lunes a Sábado 10:30 Pm
- Domingos y Días Festivos 8:30 PM
La Caribeña Día:
- Todos los días 2:30 PM
La Caribeña Noche:
- Lunes a Sábado a las 10:30 PM
- Domingos y Días Festivos 8:30 PM
Motilón Tarde:
- Todos los días 3:00 PM
Motilón Noche:
- Todos los días 9:00 PM
Cafeterito Tarde:
- Lunes a Sábado 12:00 PM
Cafeterito Noche:
- Lunes a Viernes 10:00 PM
- Sábado 11:00 PM
- Domingos y Festivos 9:00 PM
Paisa Lotto:
- Sábado 10:00 PM
La Culona Día:
- Todos los días incluso los días feriados 2:30 PM
La Culona Noche:
- Lunes a Sábado 9:30 PM
- Domingos y Días Festivos 8:00 PM
SuperMillonaria:
- Viernes 11:00 PM
Lotería de Cundinamarca
- Lunes 10:30 PM
Lotería de Tolima
- Lunes 11:00 PM
Lotería Cruz Roja
- Martes 10:30 PM
Lotería de Huila
- Martes 10:30 PM
Lotería de Manizales
- Miércoles 10:30 PM
Lotería del Meta
- Miércoles 10:30 PM
Lotería del Valle
- Miércoles 10:30 PM
Lotería Quindío
- Jueves 10:30 PM
Lotería de Bogotá
- Jueves 10:30 PM
Lotería de Santander
- Viernes 11:00 PM
Lotería de Medellín
- Viernes 11:00 PM
Lotería Risaralda
- Viernes 11:00 PM
Lotería de Boyacá
- Sábado 10:40 PM
Lotería de Cauca
- Sábado 9:40 PM
Extra de Colombia (Mensual)
- Sábado 11:00 PM
`;

const TRADICIONALES_FUENTE = 15;
const DIA = { lunes: 1, martes: 2, "miércoles": 3, jueves: 4, viernes: 5, "sábado": 6, domingo: 7, domingos: 7 };

function hora24(h, m, ampm) {
    let x = Number(h) % 12;
    if (/pm/i.test(ampm)) x += 12;
    return `${String(x).padStart(2, "0")}:${m}`;
}

// -> [{ etiqueta, dias: {1..7: "HH:MM"}, festivo: "HH:MM" | undefined, mensual }]
function analizarFuente(texto) {
    const salida = [];
    let actual = null;
    for (const linea of texto.split("\n").map(l => l.trim()).filter(Boolean)) {
        if (!linea.startsWith("-")) {
            // Nombres EXACTOS de la fuente; «(Mensual)» es la modalidad del Extra.
            const nombre = linea.replace(/:$/, "").replace(" (Mensual)", " Mensual");
            actual = { etiqueta: nombre, dias: {}, festivo: undefined, mensual: /mensual/i.test(linea) };
            salida.push(actual);
            continue;
        }
        const m = /^-\s*(.+?)\s+(?:a las?\s+)?(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(linea);
        assert.ok(m, `línea no reconocida: ${linea}`);
        const h = hora24(m[2], m[3], m[4]);
        const que = m[1].toLowerCase();
        const poner = (ds) => ds.forEach(d => { actual.dias[d] = h; });
        if (/feriados|festivos/.test(que)) actual.festivo = h;
        const parte = que.replace(/\s*(y|incluso los)\s*(días\s*)?(feriados|festivos)/g, "").replace(/^(días\s*)?(feriados|festivos)$/, "").trim();
        if (!parte) continue;
        if (parte === "todos los días") poner([1, 2, 3, 4, 5, 6, 7]);
        else if (parte === "lunes a sábado") poner([1, 2, 3, 4, 5, 6]);
        else if (parte === "lunes a viernes") poner([1, 2, 3, 4, 5]);
        else if (DIA[parte]) poner([DIA[parte]]);
        else assert.fail(`días no reconocidos: ${parte}`);
    }
    return salida;
}

// Semana sin festivos (lunes 9 … domingo 15 de noviembre de 2026) y festivos
// en distintos días: lun 16/11, mar 08/12, jue 02/04 (Jueves Santo), vie 25/12.
const SEMANA = { 1: "2026-11-09", 2: "2026-11-10", 3: "2026-11-11", 4: "2026-11-12", 5: "2026-11-13", 6: "2026-11-14", 7: "2026-11-15" };
const FESTIVOS = ["2026-11-16", "2026-12-08", "2026-04-02", "2026-12-25"];

// ------------------------------------------------------------- entorno ---
function escenario({ con026 = true } = {}) {
    fake = crearFake();
    loterias._reiniciarDeteccion();
    const t = fake.tablas;
    if (con026) t.loterias_catalogo_global = catalogoGlobalDe026();
    else fake.control.tablasInexistentes = new Set(["loterias_catalogo_global", "loterias_catalogo_ofrecidas"]);
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: B, grupo_id: "gb@g.us", activo: true }];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", activa: true }];
    t.eventos_bot = [];
    t["5k_15k_reservas_2_cifras"] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
}

// La siembra antigua y la 026 usaban estos nombres sin artículo.
const NOMBRE_ANTIGUO = { "La Caribeña": "Caribeña", "El Samán de la Suerte": "Samán de la Suerte" };

// Calendario como lo dejó la siembra ANTIGUA (producción hoy): 27 chances sin horario.
function siembraAntigua(usuarioId) {
    const chances = CATALOGO_BASE.filter(b => b.categoria === "chance");
    assert.strictEqual(chances.length, 27);
    fake.tablas.loterias_catalogo = (fake.tablas.loterias_catalogo || []).concat(chances.map((b, i) => ({
        id: `11111111-0000-4000-8000-${usuarioId.slice(0, 4)}${String(i).padStart(8, "0")}`,
        usuario_id: usuarioId, nombre: NOMBRE_ANTIGUO[b.nombre] || b.nombre, modalidad: b.modalidad, categoria: "chance",
        dias: [], hora: null, horas_por_dia: {}, regla_festivo: "sin_regla", hora_festivo: null,
        notas: NOTA_SIEMBRA_ANTIGUA, activo: true
    })));
}

// Simula la base SIN la columna frecuencia (044 sin aplicar), como PostgREST.
function sinColumnaFrecuencia() {
    const real = fake.client.from;
    fake.client.from = (tabla) => {
        const b = real(tabla);
        let usa = false;
        const marca = (x) => { if (JSON.stringify(x || "").includes("frecuencia")) usa = true; };
        for (const m of ["select", "insert", "upsert", "update"]) {
            const original = b[m];
            b[m] = (x, ...resto) => { marca(x); return original(x, ...resto); };
        }
        const entonces = b.then;
        b.then = (ok, ko) => (usa && tabla === "loterias_catalogo"
            ? Promise.resolve({ data: null, error: { code: "42703", message: "column loterias_catalogo.frecuencia does not exist" } }).then(ok, ko)
            : entonces(ok, ko));
        return b;
    };
}

const propiasDe = (u) => fake.tablas.loterias_catalogo.filter(f => f.usuario_id === u);
const pendientes = (lista) => lista.filter(l => !l.hora && !Object.keys(l.horas_por_dia).length);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------ catálogo ---
prueba("fuente: 27 chances y 15 tradicionales; el catálogo base tiene exactamente esas 42 entradas", () => {
    const fuente = analizarFuente(FUENTE);
    assert.strictEqual(fuente.length, 42);
    const etiquetas = CATALOGO_BASE.map(b => (b.modalidad ? `${b.nombre} ${b.modalidad}` : b.nombre));
    assert.deepStrictEqual([...etiquetas].sort(), fuente.map(f => f.etiqueta).sort());
    assert.strictEqual(CATALOGO_BASE.filter(b => b.categoria === "chance").length, 27);
    assert.strictEqual(CATALOGO_BASE.filter(b => b.categoria === "tradicional").length, TRADICIONALES_FUENTE);
    assert.deepStrictEqual(CATALOGO_BASE.slice(-15).map(b => b.categoria), Array(15).fill("tradicional"), "los 15 últimos del listado son tradicionales");
});

prueba("catálogo base = carga de la migración 026, campo a campo (nombres antiguos = mismo sorteo)", () => {
    const g = catalogoGlobalDe026();
    assert.strictEqual(g.length, CATALOGO_BASE.length);
    const renombradas = [];
    CATALOGO_BASE.forEach((b, i) => {
        const x = g[i];
        assert.strictEqual(claveDe(x), claveDe(b), `misma clave: ${x.clave}`);
        if (x.nombre !== b.nombre) renombradas.push(`${x.nombre} -> ${b.nombre}`);
        assert.deepStrictEqual(
            [x.modalidad, x.categoria, x.dias, x.hora, x.horas_por_dia, x.regla_festivo, x.hora_festivo, x.notas],
            [b.modalidad, b.categoria, b.dias, b.hora, b.horas_por_dia, b.regla_festivo, b.hora_festivo, b.notas], x.clave);
    });
    assert.deepStrictEqual(renombradas, ["Samán de la Suerte -> El Samán de la Suerte", "Caribeña -> La Caribeña", "Caribeña -> La Caribeña"]);
    assert.strictEqual(new Set(CATALOGO_BASE.map(claveDe)).size, 42);
});

prueba("horarios: los 42 sorteos, cada día de la semana, coinciden con el listado (días ausentes = sin sorteo)", () => {
    const fuente = analizarFuente(FUENTE);
    let comprobaciones = 0;
    for (const f of fuente) {
        const b = CATALOGO_BASE.find(x => (x.modalidad ? `${x.nombre} ${x.modalidad}` : x.nombre) === f.etiqueta);
        for (let d = 1; d <= 7; d++) {
            const h = calendario.horarioPara(b, SEMANA[d]).data;
            if (f.dias[d]) {
                assert.deepStrictEqual([h.juega, h.hora], [true, f.dias[d]], `${f.etiqueta} ${h.dia_nombre}`);
            } else {
                assert.deepStrictEqual([h.juega, h.hora], [false, null], `${f.etiqueta} ${h.dia_nombre}: sin sorteo`);
            }
            comprobaciones++;
        }
    }
    assert.strictEqual(comprobaciones, 42 * 7);
});

prueba("festivos: hora especial de la fuente cuando la da; si no, hora habitual del día marcada «a confirmar»", () => {
    const fuente = analizarFuente(FUENTE);
    const conRegla = fuente.filter(f => f.festivo).map(f => f.etiqueta).sort();
    assert.deepStrictEqual(conRegla, [
        "Antioqueñita Día", "Antioqueñita Tarde", "La Caribeña Noche", "Cafeterito Noche", "Chontico Noche", "Dorado Noche",
        "La Culona Día", "La Culona Noche", "Paisita Día", "Paisita Noche", "Pijao de Oro", "El Samán de la Suerte",
        "Sinuano Día", "Sinuano Noche", "Super Astro Luna"
    ].sort());
    for (const f of fuente) {
        const b = CATALOGO_BASE.find(x => (x.modalidad ? `${x.nombre} ${x.modalidad}` : x.nombre) === f.etiqueta);
        for (const fecha of FESTIVOS) {
            const h = calendario.horarioPara(b, fecha).data;
            assert.ok(h.festivo, fecha);
            if (f.festivo) {
                assert.deepStrictEqual([h.juega, h.hora], [true, f.festivo], `${f.etiqueta} festivo ${fecha}`);
                assert.strictEqual(h.origen === "festivo_sin_regla", false);
            } else if (f.dias[h.dia_semana]) {
                assert.deepStrictEqual([h.juega, h.hora, h.origen, h.confirmar], [true, f.dias[h.dia_semana], "festivo_sin_regla", true], `${f.etiqueta} ${fecha}`);
                assert.ok(h.avisos.some(a => /no tiene una regla para festivos definida/.test(a)));
            } else {
                assert.deepStrictEqual([h.juega, h.hora], [false, null], `${f.etiqueta} ${fecha}: ese día no se juega`);
            }
        }
    }
    // Pijao: el festivo manda aunque caiga en sábado o domingo; Dorado Noche juega el festivo aunque sea lunes.
    const pijao = CATALOGO_BASE.find(b => b.nombre === "Pijao de Oro");
    assert.strictEqual(calendario.horarioPara(pijao, "2026-11-16").data.hora, "20:00");
    const doradoNoche = CATALOGO_BASE.find(b => b.nombre === "Dorado" && b.modalidad === "Noche");
    assert.deepStrictEqual([calendario.horarioPara(doradoNoche, "2026-11-16").data.juega, calendario.horarioPara(doradoNoche, "2026-11-16").data.hora], [true, "19:25"]);
});

prueba("tradicionales semanales y Extra de Colombia mensual", () => {
    const trad = CATALOGO_BASE.filter(b => b.categoria === "tradicional");
    assert.ok(trad.every(b => b.dias.length === 1), "cada tradicional se juega un solo día por semana");
    assert.deepStrictEqual(trad.filter(b => b.frecuencia === "mensual").map(b => b.nombre), ["Extra de Colombia"]);
    assert.ok(CATALOGO_BASE.filter(b => b.frecuencia === "mensual").length === 1);
    const extra = trad.find(b => b.nombre === "Extra de Colombia");
    const h = calendario.horarioPara(extra, SEMANA[6]).data;
    assert.deepStrictEqual([h.hora, h.frecuencia, h.confirmar], ["23:00", "mensual", true]);
    assert.ok(h.avisos.some(a => /Sorteo mensual/.test(a)));
    assert.strictEqual(calendario.horarioPara(extra, SEMANA[5]).data.juega, false);
    const medellin = trad.find(b => b.nombre === "Lotería de Medellín");
    const hm = calendario.horarioPara(medellin, SEMANA[5]).data;
    assert.deepStrictEqual([hm.hora, hm.frecuencia, hm.confirmar, hm.avisos.length], ["23:00", "semanal", false, 0]);
});

// --------------------------------------------------- precarga por cliente ---
prueba("cliente nuevo SIN la 026 (producción hoy): recibe los 42 con horarios, 0 pendientes", async () => {
    escenario({ con026: false });
    const l = (await loterias.listar(A)).data;
    assert.strictEqual(l.length, 42);
    assert.strictEqual(l.filter(x => x.categoria === "chance").length, 27);
    assert.strictEqual(l.filter(x => x.categoria === "tradicional").length, 15);
    assert.deepStrictEqual(pendientes(l), []);
    assert.ok(l.every(x => x.dias.length && x.notas && x.notas.startsWith("Listado:")));
    await Promise.all([loterias.listar(A), loterias.listar(A), loterias.listar(A)]);
    assert.strictEqual(propiasDe(A).length, 42, "sin duplicados ni en paralelo");
});

prueba("cliente nuevo CON la 026: mismos 42 con horarios", async () => {
    escenario();
    const l = (await loterias.listar(A)).data;
    assert.deepStrictEqual([l.length, pendientes(l).length, l.filter(x => x.categoria === "tradicional").length], [42, 0, 15]);
    assert.strictEqual(l.find(x => x.etiqueta === "Extra de Colombia Mensual").frecuencia, "mensual");
});

prueba("CAUSA REAL: calendario antiguo (27 sin horario, 0 tradicionales) sin la 026 -> se completa a 42 sin pisar ediciones", async () => {
    escenario({ con026: false });
    siembraAntigua(A);
    // El cliente ya había editado dos (una hora a mano y otra solo desactivada con nota propia).
    const editada = propiasDe(A).find(f => f.nombre === "Chontico" && f.modalidad === "Día");
    Object.assign(editada, { hora: "13:15", dias: [1, 2, 3], notas: "mi hora" });
    const conNota = propiasDe(A).find(f => f.nombre === "Motilón" && f.modalidad === "Noche");
    Object.assign(conNota, { notas: "la configuro luego" });

    const l = (await loterias.listar(A)).data;
    assert.strictEqual(l.length, 42);
    assert.strictEqual(l.filter(x => x.categoria === "tradicional").length, 15, "llegan los 15 tradicionales");
    const chontico = l.find(x => x.etiqueta === "Chontico Día");
    assert.deepStrictEqual([chontico.hora, chontico.dias, chontico.notas], ["13:15", [1, 2, 3], "mi hora"], "su edición se conserva");
    assert.strictEqual(l.find(x => x.etiqueta === "Motilón Noche").hora, null, "una fila con nota propia no se toca");
    assert.deepStrictEqual(pendientes(l).map(x => x.etiqueta), ["Motilón Noche"], "solo queda pendiente la que el cliente tocó");
    const pijao = l.find(x => x.etiqueta === "Pijao de Oro");
    assert.deepStrictEqual([pijao.hora, pijao.horas_por_dia, pijao.regla_festivo, pijao.hora_festivo], ["14:00", { 6: "21:00", 7: "22:00" }, "hora_especial", "20:00"]);
    assert.ok(propiasDe(A).filter(f => f.nombre === "Pijao de Oro").length === 1, "se actualiza la misma fila, no se duplica");

    // Lo que borre después no vuelve.
    const cauca = l.find(x => x.etiqueta === "Lotería de Cauca");
    await loterias.eliminar(A, cauca.id);
    await Promise.all([loterias.listar(A), loterias.listar(A)]);
    const otra = (await loterias.listar(A)).data;
    assert.strictEqual(otra.length, 41);
    assert.ok(!otra.some(x => x.etiqueta === "Lotería de Cauca"));
});

prueba("CAUSA REAL: calendario antiguo cuando la 026 SÍ existe -> tradicionales por sincronización y chances completados", async () => {
    escenario();
    siembraAntigua(A);
    const l = (await loterias.listar(A)).data;
    assert.deepStrictEqual([l.length, pendientes(l).length, l.filter(x => x.categoria === "tradicional").length], [42, 0, 15]);
    await loterias.listar(A);
    assert.strictEqual(propiasDe(A).length, 42);
});

prueba("completar no pisa una edición hecha entre la lectura y la escritura", async () => {
    escenario({ con026: false });
    siembraAntigua(A);
    const fila = propiasDe(A).find(f => f.nombre === "Sinuano" && f.modalidad === "Día");
    let una = true;
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla === "loterias_catalogo" && una) { una = false; Object.assign(fila, { hora: "09:09", notas: "editada en otra pestaña" }); }
    };
    await loterias.listar(A);
    fake.control.antesDeEscribir = null;
    assert.strictEqual(fila.hora, "09:09");
    assert.strictEqual(fila.notas, "editada en otra pestaña");
});

// ------------------------------------------------ edición y aislamiento ---
prueba("edición individual: horarios por día, domingos, festivos, días y activo; persiste; no toca a B", async () => {
    escenario({ con026: false });
    const a = (await loterias.listar(A)).data;
    const b0 = JSON.stringify((await loterias.listar(B)).data.map(x => [x.etiqueta, x.dias, x.hora, x.horas_por_dia, x.regla_festivo, x.hora_festivo, x.activo]));
    const sinuano = a.find(x => x.etiqueta === "Sinuano Día");
    const e = await loterias.actualizar(A, sinuano.id, { dias: [1, 3, 5, 7], hora: "15:00", horas_por_dia: { 5: "16:00", 7: "11:00" }, regla_festivo: "no_se_juega", activo: false });
    assert.ok(e.ok, JSON.stringify(e));
    const recarga = (await loterias.listar(A)).data.find(x => x.id === sinuano.id);
    assert.deepStrictEqual([recarga.dias, recarga.hora, recarga.horas_por_dia, recarga.regla_festivo, recarga.activo], [[1, 3, 5, 7], "15:00", { 5: "16:00", 7: "11:00" }, "no_se_juega", false]);
    assert.strictEqual(calendario.horarioPara(recarga, "2026-11-16").data.juega, false, "festivo: su nueva regla manda");
    assert.strictEqual(calendario.horarioPara(recarga, SEMANA[7]).data.hora, "11:00");
    const b1 = JSON.stringify((await loterias.listar(B)).data.map(x => [x.etiqueta, x.dias, x.hora, x.horas_por_dia, x.regla_festivo, x.hora_festivo, x.activo]));
    assert.strictEqual(b1, b0, "el calendario de B no cambió");
    assert.strictEqual((await loterias.actualizar(B, sinuano.id, { hora: "01:00" })).motivo, "no_encontrado");
    assert.strictEqual((await loterias.restaurar(B, sinuano.id)).motivo, "no_encontrado");
});

prueba("restaurar UNA: vuelve a la configuración inicial; una lotería propia no tiene a qué volver", async () => {
    escenario();
    const a = (await loterias.listar(A)).data;
    const chontico = a.find(x => x.etiqueta === "Chontico Noche");
    await loterias.actualizar(A, chontico.id, { dias: [1], hora: "05:00", horas_por_dia: {}, regla_festivo: "no_se_juega", activo: false, notas: "x" });
    const r1 = await loterias.restaurar(A, chontico.id);
    assert.ok(r1.ok, JSON.stringify(r1));
    assert.deepStrictEqual([r1.data.dias, r1.data.hora, r1.data.horas_por_dia, r1.data.regla_festivo, r1.data.hora_festivo, r1.data.activo],
        [[1, 2, 3, 4, 5, 6, 7], "19:00", { 6: "22:00", 7: "20:00" }, "hora_especial", "20:00", true]);
    const propia = await loterias.crear(A, { nombre: "Mi rifa", dias: [2], hora: "20:00" });
    assert.strictEqual(propia.data.restaurable, false);
    assert.strictEqual((await loterias.restaurar(A, propia.data.id)).motivo, "sin_configuracion_inicial");
});

prueba("restaurar TODO: 42 a sus valores, lo borrado vuelve, lo propio se conserva, B intacto", async () => {
    escenario();
    const a = (await loterias.listar(A)).data;
    await loterias.listar(B);
    const bAntes = JSON.stringify(propiasDe(B));
    await loterias.actualizar(A, a[0].id, { hora: "01:01" });
    await loterias.eliminar(A, a[1].id);
    await loterias.crear(A, { nombre: "Mi rifa", dias: [2], hora: "20:00" });
    const r = await loterias.restaurarTodo(A);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepStrictEqual(r.data, { restauradas: 41, agregadas: 1, conservadas: 1 });
    const l = (await loterias.listar(A)).data;
    assert.strictEqual(l.length, 43);
    assert.strictEqual(l.find(x => x.etiqueta === a[0].etiqueta).hora, a[0].hora);
    assert.ok(l.some(x => x.etiqueta === a[1].etiqueta));
    assert.ok(l.some(x => x.etiqueta === "Mi rifa"));
    assert.strictEqual(JSON.stringify(propiasDe(B)), bAntes);
    await loterias.restaurarTodo(A);
    assert.strictEqual(propiasDe(A).length, 43, "restaurar dos veces no duplica");
});

// ----------------------------------------------------------- frecuencia ---
prueba("frecuencia con la 044: se edita y persiste", async () => {
    escenario();
    const a = (await loterias.listar(A)).data;
    const medellin = a.find(x => x.etiqueta === "Lotería de Medellín");
    assert.strictEqual(medellin.frecuencia, "semanal");
    const e = await loterias.actualizar(A, medellin.id, { frecuencia: "mensual" });
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual((await loterias.obtener(A, medellin.id)).data.frecuencia, "mensual");
    assert.strictEqual((await loterias.actualizar(A, medellin.id, { frecuencia: "diaria" })).motivo, "validacion");
});

prueba("frecuencia SIN la 044: todo funciona; Extra sigue mensual; cambiarla avisa la migración sin escribir nada", async () => {
    escenario({ con026: false });
    sinColumnaFrecuencia();
    const a = await loterias.listar(A);
    assert.ok(a.ok, JSON.stringify(a));
    assert.strictEqual(a.data.length, 42);
    assert.ok(propiasDe(A).every(f => !("frecuencia" in f)), "no se intentó guardar la columna");
    assert.strictEqual(a.data.find(x => x.etiqueta === "Extra de Colombia Mensual").frecuencia, "mensual");
    const medellin = a.data.find(x => x.etiqueta === "Lotería de Medellín");
    const antes = JSON.stringify(propiasDe(A).find(f => f.id === medellin.id));
    const e = await loterias.actualizar(A, medellin.id, { frecuencia: "mensual", hora: "22:00" });
    assert.deepStrictEqual([e.motivo, e.migracion], ["migracion_pendiente", "044"]);
    assert.strictEqual(JSON.stringify(propiasDe(A).find(f => f.id === medellin.id)), antes, "nada escrito");
    const ok = await loterias.actualizar(A, medellin.id, { frecuencia: "semanal", hora: "22:00" });
    assert.ok(ok.ok, "el formulario completo (misma frecuencia) se guarda");
    assert.strictEqual(ok.data.hora, "22:00");
    assert.ok((await loterias.restaurarTodo(A)).ok);
});

// -------------------------------------------------------- próximo sorteo ---
prueba("próximo sorteo: hora de Colombia, salta días sin sorteo, festivo a confirmar, mensual/inactiva sin fecha", async () => {
    escenario();
    // Viernes 13/11/2026 15:00 en Colombia (20:00 UTC).
    const ahora = new Date("2026-11-13T20:00:00Z");
    const l = (await loterias.listar(A, { ahora })).data;
    const p = (et) => l.find(x => x.etiqueta === et);
    assert.deepStrictEqual(p("Dorado Mañana").proximo, { fecha: "2026-11-14", hora: "10:58", dia_nombre: "sábado", festivo: null, confirmar: false });
    assert.deepStrictEqual([p("Dorado Tarde").proximo.fecha, p("Dorado Tarde").proximo.hora], ["2026-11-13", "15:28"], "15:28 de hoy aún no pasa (son las 15:00)");
    assert.deepStrictEqual([p("Lotería de Medellín").proximo.fecha, p("Lotería de Medellín").proximo.hora], ["2026-11-13", "23:00"], "hoy mismo");
    assert.deepStrictEqual([p("Lotería de Cundinamarca").proximo.fecha, p("Lotería de Cundinamarca").proximo.festivo, p("Lotería de Cundinamarca").proximo.confirmar], ["2026-11-16", "Independencia de Cartagena", true]);
    assert.deepStrictEqual([p("Antioqueñita Día").proximo.fecha, p("Antioqueñita Día").proximo.hora], ["2026-11-14", "10:00"]);
    assert.strictEqual(p("Extra de Colombia Mensual").proximo, null);
    assert.match(p("Extra de Colombia Mensual").proximo_nota, /mensual/i);
    const inactiva = await loterias.actualizar(A, p("Paisa Lotto").id, { activo: false });
    assert.ok(inactiva.ok);
    assert.strictEqual((await loterias.listar(A, { ahora })).data.find(x => x.etiqueta === "Paisa Lotto").proximo, null);
    // Domingo 15/11 21:30: Dorado Mañana -> lunes 16 (festivo, sin regla en la fuente).
    const dom = (await loterias.listar(A, { ahora: new Date("2026-11-16T02:30:00Z") })).data.find(x => x.etiqueta === "Dorado Mañana").proximo;
    assert.deepStrictEqual(dom, { fecha: "2026-11-16", hora: "10:58", dia_nombre: "lunes", festivo: "Independencia de Cartagena", confirmar: true });
    assert.ok(Date.now() > 0 && calendario.proximoSorteo({ dias: [], hora: "10:00" }).data === null);
});

// ---------------------------------------------- festivos de Colombia ---
prueba("festivos 2027 = calendario oficial: fijos, trasladados al lunes (Emiliani) y según la Pascua (28/03/2027)", () => {
    assert.deepStrictEqual([...calendario.festivosColombia(2027).entries()], [
        ["2027-01-01", "Año Nuevo"], ["2027-01-11", "Reyes Magos"], ["2027-03-22", "San José"],
        ["2027-03-25", "Jueves Santo"], ["2027-03-26", "Viernes Santo"], ["2027-05-01", "Día del Trabajo"],
        ["2027-05-10", "Ascensión del Señor"], ["2027-05-31", "Corpus Christi"], ["2027-06-07", "Sagrado Corazón"],
        ["2027-07-05", "San Pedro y San Pablo"], ["2027-07-20", "Independencia de Colombia"], ["2027-08-07", "Batalla de Boyacá"],
        ["2027-08-16", "Asunción de la Virgen"], ["2027-10-18", "Día de la Raza"], ["2027-11-01", "Todos los Santos"],
        ["2027-11-15", "Independencia de Cartagena"], ["2027-12-08", "Inmaculada Concepción"], ["2027-12-25", "Navidad"]
    ]);
    // Trasladados: la fecha original NO es festivo; el lunes sí.
    for (const [original, lunes] of [["2026-11-11", "2026-11-16"], ["2027-06-29", "2027-07-05"], ["2027-10-12", "2027-10-18"], ["2026-01-06", "2026-01-12"]]) {
        assert.strictEqual(calendario.festivoDe(original), null, original);
        assert.ok(calendario.festivoDe(lunes), lunes);
        assert.strictEqual(calendario.diaSemana(lunes), 1);
    }
    // Ya en lunes: no se mueve una semana (1/11/2027 es lunes).
    assert.strictEqual(calendario.festivoDe("2027-11-01"), "Todos los Santos");
    assert.strictEqual(calendario.festivoDe("2027-11-08"), null);
    // Fechas inválidas o fuera de formato.
    assert.strictEqual(calendario.horarioPara(CATALOGO_BASE[0], "2027-02-30").ok, true, "formato válido; se normaliza");
    assert.strictEqual(calendario.horarioPara(CATALOGO_BASE[0], "2027-2-3").ok, false);
});

prueba("festivo en sábado/domingo: la regla de festivos manda; el cruce con la hora propia del día se marca para confirmar", () => {
    const de = (et) => CATALOGO_BASE.find(b => (b.modalidad ? `${b.nombre} ${b.modalidad}` : b.nombre) === et);
    // 2027-12-25 sábado (Navidad); 2025-07-20 domingo (Independencia).
    const pijaoSab = calendario.horarioPara(de("Pijao de Oro"), "2027-12-25").data;
    assert.deepStrictEqual([pijaoSab.hora, pijaoSab.confirmar], ["20:00", true]);
    assert.ok(pijaoSab.avisos.some(a => /21:00/.test(a) && /20:00/.test(a)));
    const pijaoDom = calendario.horarioPara(de("Pijao de Oro"), "2025-07-20").data;
    assert.deepStrictEqual([pijaoDom.hora, pijaoDom.confirmar], ["20:00", true]);
    for (const [et, hora] of [["Chontico Noche", "20:00"], ["Dorado Noche", "19:25"], ["Cafeterito Noche", "21:00"]]) {
        const h = calendario.horarioPara(de(et), "2027-12-25").data;
        assert.deepStrictEqual([h.juega, h.hora, h.confirmar], [true, hora, true], et);
    }
    // «Domingos y festivos» con la misma hora: no hay cruce, no se pide confirmar.
    for (const et of ["Antioqueñita Día", "Sinuano Noche", "Chontico Noche", "La Culona Noche"]) {
        const h = calendario.horarioPara(de(et), "2025-07-20").data;
        assert.strictEqual(h.confirmar, false, et);
        assert.strictEqual(h.hora, de(et).hora_festivo, et);
    }
    // Festivo en día laboral: festivo sin cruce (Pijao lunes festivo 20:00 en vez de 14:00).
    const pijaoLun = calendario.horarioPara(de("Pijao de Oro"), "2026-11-16").data;
    assert.deepStrictEqual([pijaoLun.hora, pijaoLun.confirmar, pijaoLun.origen], ["20:00", false, "festivo"]);
    // Fecha civil en Colombia: 23:30 del domingo 15/11 en Bogotá = 04:30 UTC del lunes festivo.
    const p = calendario.proximoSorteo(de("Antioqueñita Día"), new Date("2026-11-16T04:30:00Z")).data;
    assert.deepStrictEqual([p.fecha, p.hora, p.festivo], ["2026-11-16", "12:00", "Independencia de Cartagena"]);
});

// ----------------------------------------------------- nombres exactos ---
prueba("nombres: los nuevos reciben «La Caribeña» y «El Samán de la Suerte»; los antiguos sin tocar se corrigen sin duplicar", async () => {
    escenario({ con026: false });
    const nuevo = (await loterias.listar(A)).data.map(x => x.etiqueta);
    assert.ok(["La Caribeña Día", "La Caribeña Noche", "El Samán de la Suerte"].every(e => nuevo.includes(e)));
    assert.ok(!nuevo.some(e => e === "Caribeña Día" || e === "Samán de la Suerte"));

    siembraAntigua(B);
    const editada = propiasDe(B).find(f => f.nombre === "Caribeña" && f.modalidad === "Noche");
    Object.assign(editada, { hora: "22:00", dias: [1, 2, 3], notas: "la mía" });
    const b = (await loterias.listar(B)).data;
    assert.strictEqual(b.length, 42, "sin duplicados por el cambio de nombre");
    assert.ok(b.some(x => x.etiqueta === "La Caribeña Día"), "la siembra intacta toma el nombre de la fuente");
    assert.ok(b.some(x => x.etiqueta === "El Samán de la Suerte"));
    const suya = b.find(x => x.id === editada.id);
    assert.deepStrictEqual([suya.etiqueta, suya.hora, suya.notas], ["Caribeña Noche", "22:00", "la mía"], "la personalizada conserva nombre y datos");
    assert.ok(suya.restaurable, "sigue enlazada con su configuración inicial");
    const todo = await loterias.restaurarTodo(B);
    assert.deepStrictEqual(todo.data, { restauradas: 42, agregadas: 0, conservadas: 0 }, "no agrega un «La Caribeña Noche» repetido");
    const tras = (await loterias.listar(B)).data;
    assert.strictEqual(tras.length, 42);
    assert.strictEqual(tras.find(x => x.id === editada.id).etiqueta, "La Caribeña Noche", "restaurar = nombre de la fuente");
});

prueba("nombres: con la 026 (nombres antiguos en el global) no se duplica; restaurar no choca con una propia del mismo nombre", async () => {
    escenario();
    const a = (await loterias.listar(A)).data;
    assert.strictEqual(a.length, 42);
    const caribena = a.find(x => x.etiqueta === "Caribeña Día");
    assert.ok(caribena, "copiada del global tal cual (la 044 renombra el global)");
    // El cliente crea además una «La Caribeña Día» propia: restaurar la antigua no puede chocar.
    const propia = await loterias.crear(A, { nombre: "La Caribeña", modalidad: "Día", dias: [1], hora: "09:00" });
    assert.ok(propia.ok);
    const real = fake.client.from;
    fake.client.from = (tabla) => {
        const q = real(tabla);
        const update = q.update;
        q.update = (x) => {
            if (tabla === "loterias_catalogo" && x.nombre === "La Caribeña") {
                const chocaria = { then: (ok, ko) => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value" } }).then(ok, ko) };
                const cadena = new Proxy(chocaria, { get: (o, k) => (k === "then" ? o.then : () => cadena) });
                return cadena;
            }
            return update(x);
        };
        return q;
    };
    const r1 = await loterias.restaurar(A, caribena.id);
    fake.client.from = real;
    assert.ok(r1.ok, JSON.stringify(r1));
    assert.deepStrictEqual([r1.data.etiqueta, r1.data.hora], ["Caribeña Día", "14:30"], "restaurada con su nombre actual");
    assert.strictEqual((await loterias.obtener(A, propia.data.id)).data.hora, "09:00", "la propia intacta");
});

prueba("historial: renombrar o restaurar la lotería no cambia los sorteos ya creados (nombre copiado + loteria_id)", async () => {
    escenario();
    const a = (await loterias.listar(A)).data;
    const samán = a.find(x => x.etiqueta === "Samán de la Suerte");
    const s = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Samán de la Suerte", loteria_id: samán.id, hora_fin: "13:00", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: new Date(Date.now() + 86400000).toISOString(), mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(s.ok, JSON.stringify(s));
    const r1 = await loterias.restaurar(A, samán.id);
    assert.strictEqual(r1.data.etiqueta, "El Samán de la Suerte");
    assert.strictEqual(r1.data.id, samán.id, "misma fila: el loteria_id del sorteo sigue apuntando a ella");
    const guardado = fake.tablas.sorteos_programados.find(x => x.id === s.data.id);
    assert.deepStrictEqual([guardado.config.nombre, guardado.config.loteria_id, guardado.config.hora_fin], ["Samán de la Suerte", samán.id, "13:00"]);
    assert.strictEqual((await loterias.horario(A, samán.id, "2026-11-15")).data.loteria, "El Samán de la Suerte");
});

// --------------------------------------------------- integración sorteos ---
prueba("integración: un sorteo con lotería tradicional guarda su loteria_id y el horario sugerido sale del calendario del cliente", async () => {
    escenario({ con026: false });
    const l = (await loterias.listar(A)).data;
    const bogota = l.find(x => x.etiqueta === "Lotería de Bogotá");
    const manana = new Date(Date.now() + 86400000).toISOString();
    const s = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Lotería de Bogotá", loteria_id: bogota.id, hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: manana, mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(s.ok, JSON.stringify(s));
    assert.strictEqual(s.data.config.loteria_id, bogota.id);
    assert.strictEqual(s.data.config.hora_fin, "22:30", "la hora la decide el usuario");
    assert.strictEqual((await loterias.horario(A, bogota.id, SEMANA[4])).data.hora, "22:30");
    assert.strictEqual((await loterias.horario(A, bogota.id, SEMANA[3])).data.juega, false);
    // Si el cliente cambia su calendario, la sugerencia cambia solo para él; el sorteo ya creado no.
    await loterias.actualizar(A, bogota.id, { hora: "21:00" });
    assert.strictEqual((await loterias.horario(A, bogota.id, SEMANA[4])).data.hora, "21:00");
    assert.strictEqual(fake.tablas.sorteos_programados[0].config.hora_fin, "22:30");
    assert.strictEqual((await loterias.horario(B, bogota.id, SEMANA[4])).motivo, "no_encontrado");
});

prueba("HTTP: GET /loterias trae próximo sorteo; POST /loterias/restaurar y /loterias/:id/restaurar; ajeno 404; propia 409", async () => {
    escenario({ con026: false });
    const app = express();
    app.use(express.json());
    delete require.cache[r("routes/sorteos.js")];
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const base = `http://127.0.0.1:${server.address().port}/sorteos`;
    const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-pruebas", authorization: `Bearer ${jwt}` });
    try {
        const lista = await (await fetch(`${base}/loterias`, { headers: h("jwt-A") })).json();
        assert.strictEqual(lista.data.length, 42);
        assert.ok(lista.data.every(x => "proximo" in x && "frecuencia" in x && "restaurable" in x));
        assert.ok(!lista.data.some(x => "usuario_id" in x), "no se expone usuario_id");
        const pijao = lista.data.find(x => x.etiqueta === "Pijao de Oro");
        await fetch(`${base}/loterias/${pijao.id}`, { method: "PATCH", headers: h("jwt-A"), body: JSON.stringify({ hora: "03:00" }) });
        assert.strictEqual((await fetch(`${base}/loterias/${pijao.id}/restaurar`, { method: "POST", headers: h("jwt-B") })).status, 404);
        const una = await (await fetch(`${base}/loterias/${pijao.id}/restaurar`, { method: "POST", headers: h("jwt-A") })).json();
        assert.strictEqual(una.data.hora, "14:00");
        const todo = await (await fetch(`${base}/loterias/restaurar`, { method: "POST", headers: h("jwt-A") })).json();
        assert.deepStrictEqual(todo.data, { restauradas: 42, agregadas: 0, conservadas: 0 });
        const propia = await (await fetch(`${base}/loterias`, { method: "POST", headers: h("jwt-A"), body: JSON.stringify({ nombre: "Propia", dias: [1], hora: "10:00" }) })).json();
        assert.strictEqual((await fetch(`${base}/loterias/${propia.data.id}/restaurar`, { method: "POST", headers: h("jwt-A") })).status, 409);
    } finally {
        // Esperar el cierre (con conexiones keep-alive) evita el fallo de libuv al salir.
        server.closeAllConnections?.();
        await new Promise(res => server.close(res));
    }
});

// ---------------------------------------------------- SQL real (PGlite) ---
prueba("SQL real: 025 + 026 + 044 idempotentes; 044 marca el Extra mensual y funciona también sin la 026", async () => {
    let PGlite;
    try { ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite")); } catch { console.log("   ⏭️  PGlite no disponible: parte SQL omitida"); return; }
    const sql025 = fs.readFileSync(r("supabase_migrations/025_calendario_loterias.sql"), "utf8");
    const sql044 = fs.readFileSync(r("supabase_migrations/044_frecuencia_loterias.sql"), "utf8");
    const preparar = async (db) => db.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        create schema auth; create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        insert into auth.users values ('${A}'), ('${B}');`);
    const db = new PGlite();
    try {
        await preparar(db);
        await db.exec(sql025);
        await db.exec(`insert into public.loterias_catalogo (usuario_id, nombre, modalidad, categoria, dias, hora) values
            ('${A}', 'Extra de Colombia', 'Mensual', 'tradicional', '{6}', '23:00'), ('${A}', 'Lotería de Medellín', '', 'tradicional', '{5}', '23:00')`);
        await db.exec(SQL_026);
        // Copia ya hecha desde el global con el nombre antiguo (enlazada por origen_global_id).
        await db.exec(`insert into public.loterias_catalogo (usuario_id, nombre, modalidad, origen_global_id)
            select '${B}', nombre, modalidad, id from public.loterias_catalogo_global where clave = 'caribeña|día'`);
        await db.exec(sql044);
        await db.exec(sql044);
        const filas = (await db.query(`select nombre, frecuencia from public.loterias_catalogo where usuario_id = '${A}' order by nombre`)).rows;
        assert.deepStrictEqual(filas, [{ nombre: "Extra de Colombia", frecuencia: "mensual" }, { nombre: "Lotería de Medellín", frecuencia: "semanal" }]);
        const renombradas = (await db.query("select clave, nombre from public.loterias_catalogo_global where clave in ('caribeña|día', 'caribeña|noche', 'samán de la suerte|') order by clave")).rows;
        assert.deepStrictEqual(renombradas, [
            { clave: "caribeña|día", nombre: "La Caribeña" }, { clave: "caribeña|noche", nombre: "La Caribeña" }, { clave: "samán de la suerte|", nombre: "El Samán de la Suerte" }
        ], "global renombrado; la clave no cambia");
        const copia = (await db.query(`select c.nombre, g.clave from public.loterias_catalogo c join public.loterias_catalogo_global g on g.id = c.origen_global_id where c.usuario_id = '${B}'`)).rows;
        assert.deepStrictEqual(copia, [{ nombre: "Caribeña", clave: "caribeña|día" }], "la copia del cliente conserva su nombre y su enlace");
        // Volver a ejecutar la 026 (on conflict por clave) no duplica ni rompe nada.
        await db.exec(SQL_026);
        assert.strictEqual(Number((await db.query("select count(*)::int n from public.loterias_catalogo_global")).rows[0].n), 42);
        await db.exec(sql044);
        const g = (await db.query("select frecuencia, count(*)::int n from public.loterias_catalogo_global group by 1 order by 1")).rows;
        assert.deepStrictEqual(g, [{ frecuencia: "mensual", n: 1 }, { frecuencia: "semanal", n: 41 }]);
        let error = null;
        try { await db.exec(`update public.loterias_catalogo set frecuencia = 'diaria'`); } catch (e) { error = e; }
        assert.ok(error, "frecuencia inválida rechazada");
        // La carga de la 026 en Postgres = catálogo base (horas como time).
        const pg = (await db.query("select nombre, modalidad, categoria, dias, hora::text h, horas_por_dia, regla_festivo, hora_festivo::text hf from public.loterias_catalogo_global")).rows;
        for (const b of CATALOGO_BASE) {
            const x = pg.find(y => y.nombre === b.nombre && y.modalidad === b.modalidad);
            assert.deepStrictEqual([x.categoria, x.dias, x.h && x.h.slice(0, 5), x.horas_por_dia, x.regla_festivo, x.hf && x.hf.slice(0, 5)],
                [b.categoria, b.dias, b.hora, b.horas_por_dia, b.regla_festivo, b.hora_festivo], b.nombre);
        }
    } finally {
        await db.close();
    }
    const sola = new PGlite();
    try {
        await preparar(sola);
        await sola.exec(sql025);
        await sola.exec(sql044);
        assert.strictEqual((await sola.query("select to_regclass('public.loterias_catalogo_global') t")).rows[0].t, null);
        assert.ok((await sola.query("select 1 from information_schema.columns where table_name = 'loterias_catalogo' and column_name = 'frecuencia'")).rows.length);
    } finally {
        await sola.close();
    }
});

(async () => {
    let ok = 0, falla = 0;
    const log = console.log;
    for (const { n, fn } of pruebas) {
        try {
            console.log = (...a) => { if (!String(a[0]).startsWith("🗓️")) log(...a); };
            await fn();
            console.log = log;
            ok++; log(`✅ ${n}`);
        } catch (e) { console.log = log; falla++; log(`❌ ${n}`); log(String(e && e.stack || e)); }
    }
    log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    // Sin process.exit inmediato: en Windows, salir con handles cerrándose
    // (HTTP keep-alive, PGlite) dispara la aserción de libuv (código 127).
    process.exitCode = falla ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 200).unref();
})();
