// ==========================================================================
// PRUEBA SQL — docs/activacion/cierres_pendientes_primer_worker_solo_lectura.sql
// contra un Postgres REAL en memoria (PGlite), comparada fila a fila con lo
// que decide el código del worker (verificarHoraCierre, finDelEvento,
// cierreAtrasado y la regla de «grupo en uso» de procesarSorteo) sobre las
// MISMAS filas. Si el SQL y el código divergen, esta prueba falla.
//
// PGlite NO es dependencia del proyecto (mismo criterio que
// tests/inactividad/migracion022.test.js):
//
//     npm install --no-save @electric-sql/pglite --prefix <carpeta>
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/eventos/sqlCierresPendientes.test.js
//
// Sin PGlite la prueba se omite (exit 0). NUNCA se conecta a Supabase.
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  PGlite no disponible — prueba SQL omitida (ver cabecera del archivo).");
    process.exit(0);
}

const RAIZ = path.resolve(__dirname, "../..");
const SQL = fs.readFileSync(path.join(RAIZ, "..", "docs", "activacion", "cierres_pendientes_primer_worker_solo_lectura.sql"), "utf8");
const { verificarHoraCierre, cierreAtrasado } = require(path.join(RAIZ, "bot/funciones/eventos/lifecycle/verificarHoraCierre.js"));
const { finDelEvento } = require(path.join(RAIZ, "shared/eventos/estadosGestion.js"));
const { fechaEventoHoy } = require(path.join(RAIZ, "bot/funciones/eventos/identidadEventoReal.js"));

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";

const dia = (n) => fechaEventoHoy(new Date(Date.now() + n * 86400000));
const AYER = dia(-1), HOY = dia(0), MANANA = dia(1);

// Filas de prueba: [id, cliente, grupo, identidad, fecha, hora_cierre, extra]
const FILAS = [
    ["1-ayer-g1", T1, "g1", "s1", AYER, "22:26"],
    ["2-hoy-tarde-g1", T1, "g1", "s2", HOY, "23:59"],
    ["3-ayer-g2", T1, "g2", "s3", AYER, "21:00"],
    ["4-hoy-g3", T1, "g3", "s4", HOY, "00:00"],
    ["5-manana-g3", T1, "g3", "s5", MANANA, "00:00"],
    ["6-sinfecha-g4", T1, "g4", "s6", null, "00:00"],
    ["7-zombi-g4", T1, "g4", "s7", AYER, "10:00", { cierre_estado: "cerrado" }],
    ["8-cancelado-g5", T1, "g5", "s8", AYER, "10:00", { estado: "cancelado" }],
    ["9-desactivado-g5", T1, "g5", "s9", AYER, "10:00", { cierre_motivo: "panel:desactivado" }],
    ["10-sustituido-g5", T1, "g5", "s10", AYER, "10:00", { cierre_motivo: "sustituido por s11" }],
    ["11-hora-invalida-g6", T1, "g6", "s11", AYER, "25:99"],
    ["12-sin-hora-g6", T1, "g6", "s12", AYER, null],
    ["13-ayer-g6", T1, "g6", "s13", AYER, "08:00"],
    ["14-no-autorizado-g9", T1, "g9", "s14", AYER, "08:00"],
    ["15-otro-cliente-g1", T2, "g1", "s15", AYER, "08:00"],
    ["16a-mismo-sorteo-g7", T1, "g7", "s16", AYER, "20:00"],
    ["16b-mismo-sorteo-g8", T1, "g8", "s16", AYER, "20:00"],
    ["17-inactivo-g7", T1, "g7", "s17", AYER, "20:00", { activo: false }],
    ["18-cancelado-con-detalle", T1, "g5", "s18", AYER, "10:00", { cierre_motivo: "panel:cancelado: lluvia" }],
    ["19-panel-no-gestion", T1, "g2", "s19", AYER, "10:00", { cierre_motivo: "panel:otra cosa" }],
    ["20-sin-identidad-g3", T1, "g3", null, AYER, "10:00"],
    ["21-segundos-g8", T1, "g8", "s21", HOY, "00:00:00"]
];

const AUTORIZADOS = [[T1, "g1"], [T1, "g2"], [T1, "g3"], [T1, "g4"], [T1, "g5"], [T1, "g6"], [T1, "g7"], [T1, "g8"], [T2, "g1"]];

function filasJs() {
    return FILAS.map(([id, usuario_id, grupo_id, identidad, fecha, hora, extra = {}]) => ({
        id, usuario_id, grupo_id, identidad_evento_real: identidad, fecha_evento: fecha, hora_cierre: hora,
        activo: true, estado: "abierto", cierre_estado: null, cierre_motivo: null, ...extra
    }));
}

// Lo que el worker haría, con el código real.
function esperadoJs(ahora) {
    const aut = new Set(AUTORIZADOS.map(([u, g]) => `${u}|${g}`));
    const vigentes = filasJs().filter(f => f.activo && !finDelEvento(f) && aut.has(`${f.usuario_id}|${f.grupo_id}`));
    const clave = (f) => f.identidad_evento_real || `evento:${f.id}`;
    return vigentes.filter(f => verificarHoraCierre(f, ahora)).map(f => ({
        id: f.id,
        recuperado: cierreAtrasado(f, ahora),
        enUso: vigentes.some(o => o !== f && o.usuario_id === f.usuario_id && o.grupo_id === f.grupo_id && clave(o) !== clave(f) && !verificarHoraCierre(o, ahora))
    })).sort((a, b) => a.id.localeCompare(b.id));
}

async function ejecutar(tipoHora) {

    const db = new PGlite();
    const lit = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

    await db.exec(`
        create table public.eventos_bot (
            id text primary key, usuario_id uuid, grupo_id text, identidad_evento_real text,
            nombre_evento text, fecha_evento date, hora_cierre ${tipoHora}, activo boolean, estado text,
            cierre_estado text, cierre_motivo text, cierre_intentos int default 0,
            reservados int default 0, pagados int default 0, creado_en timestamptz default now());
        create table public.grupos_autorizados (usuario_id uuid, grupo_id text, activo boolean);
        insert into public.grupos_autorizados values ${AUTORIZADOS.map(([u, g]) => `(${lit(u)}, ${lit(g)}, true)`).join(", ")},
            (${lit(T1)}, 'g9', false);
    `);

    for (const f of filasJs()) {
        // Una hora ilegible no cabe en una columna time: allí se omite esa fila.
        if (tipoHora === "time" && f.hora_cierre === "25:99") continue;
        await db.query(`insert into public.eventos_bot (id, usuario_id, grupo_id, identidad_evento_real, nombre_evento, fecha_evento, hora_cierre, activo, estado, cierre_estado, cierre_motivo)
            values (${[f.id, f.usuario_id, f.grupo_id, f.identidad_evento_real, f.id, f.fecha_evento, f.hora_cierre, f.activo, f.estado, f.cierre_estado, f.cierre_motivo].map(v => typeof v === "boolean" ? String(v) : lit(v)).join(", ")})`);
    }

    const antes = JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows);
    const ahora = new Date();
    const resultados = await db.exec(SQL);
    const despues = JSON.stringify((await db.query("select * from public.eventos_bot order by id")).rows);

    // Sentencias: begin, detalle, resumen, control, rollback.
    const conFilas = resultados.filter(r => r.fields?.length);
    assert.strictEqual(conFilas.length, 3, "detalle, resumen y control");
    const [detalle, resumen, control] = conFilas;

    const sql = detalle.rows.map(r => ({ id: r.evento_id, recuperado: r.cierre_recuperado_sin_aviso, enUso: r.solo_marca_fila_grupo_sigue_abierto }))
        .sort((a, b) => a.id.localeCompare(b.id));

    return { sql, esperado: esperadoJs(ahora), resumen: resumen.rows, control: control.rows, antes, despues };

}

(async () => {

    let ok = 0;

    for (const tipoHora of ["text", "time"]) {

        const r = await ejecutar(tipoHora);

        const esperado = tipoHora === "time" ? r.esperado.filter(e => e.id !== "11-hora-invalida-g6") : r.esperado;
        assert.deepStrictEqual(r.sql, esperado, `hora_cierre ${tipoHora}: el SQL debe coincidir con el worker`);
        console.log(`✅ hora_cierre ${tipoHora}: el SQL marca las mismas ${r.sql.length} filas, «recuperado» y «grupo en uso» que el código`);

        assert.strictEqual(r.despues, r.antes, "la consulta no modifica nada");
        console.log(`✅ hora_cierre ${tipoHora}: no modifica ninguna fila (READ ONLY + ROLLBACK)`);

        assert.strictEqual(r.resumen.reduce((s, x) => s + Number(x.filas), 0), r.sql.length, "el resumen suma lo mismo que el detalle");
        assert.ok(r.resumen.every(x => ["cliente", "grupo", "estado", "fecha", "filas"].every(k => k in x)));
        console.log(`✅ hora_cierre ${tipoHora}: resumen por cliente, grupo, estado y fecha (${r.resumen.length} grupos)`);

        const ignoradas = r.control.reduce((s, x) => s + Number(x.filas), 0);
        assert.strictEqual(ignoradas, 5, "zombi, cancelado, desactivado, sustituido y cancelado con detalle (activas ya terminadas)");
        console.log(`✅ hora_cierre ${tipoHora}: control de filas activas ya terminadas que el worker ignora (${ignoradas})`);

        ok += 4;

    }

    // Comprobaciones explícitas del escenario (además de la igualdad con el código).
    const r = await ejecutar("text");
    const ids = r.sql.map(x => x.id);
    for (const id of ["1-ayer-g1", "3-ayer-g2", "4-hoy-g3", "6-sinfecha-g4", "13-ayer-g6", "16a-mismo-sorteo-g7", "16b-mismo-sorteo-g8", "15-otro-cliente-g1", "19-panel-no-gestion", "20-sin-identidad-g3", "21-segundos-g8"]) {
        assert.ok(ids.includes(id), `${id} se cerraría`);
    }
    for (const id of ["5-manana-g3", "7-zombi-g4", "8-cancelado-g5", "9-desactivado-g5", "10-sustituido-g5", "11-hora-invalida-g6", "12-sin-hora-g6", "14-no-autorizado-g9", "17-inactivo-g7", "18-cancelado-con-detalle"]) {
        assert.ok(!ids.includes(id), `${id} NO se cerraría`);
    }
    const por = Object.fromEntries(r.sql.map(x => [x.id, x]));
    assert.strictEqual(por["1-ayer-g1"].enUso, true, "g1 tiene un sorteo vigente hasta las 23:59");
    assert.strictEqual(por["13-ayer-g6"].enUso, true, "g6 tiene un sorteo sin hora de cierre (vigente)");
    assert.strictEqual(por["15-otro-cliente-g1"].enUso, false, "el sorteo vigente de OTRO cliente en el mismo grupo no cuenta");
    assert.strictEqual(por["3-ayer-g2"].recuperado, true);
    assert.strictEqual(por["6-sinfecha-g4"].recuperado, false, "sin fecha: nunca recuperado");
    console.log("✅ escenario: futuros, terminados, no autorizados y otros clientes fuera; grupos en uso y recuperados marcados");
    ok++;

    console.log(`\nPruebas: ${ok}  |  OK: ${ok}  |  Fallidas: 0`);

})().catch((e) => {
    console.log(`❌ ${e.message}`);
    console.log("\nPruebas: fallidas");
    process.exit(1);
});
