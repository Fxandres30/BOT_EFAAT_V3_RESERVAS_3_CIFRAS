// ==========================================================================
// PRUEBA SQL (requiere entorno): docs/activacion/
// estado_sorteos_contradicciones_solo_lectura.sql se ejecuta en PGlite
// (Postgres en memoria, LOCAL, sin red ni base remota) y debe dar EXACTAMENTE
// lo que dicen las funciones de shared/eventos/estadosGestion.js (F2,
// 06/11/2026). Así la consulta de diagnóstico no se aparta del código.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/caracterizacion/estadoSorteosSqlReal.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  Sin PGlite (PGLITE_MODULE) — prueba SQL omitida.");
    process.exit(0);
}

const RAIZ = path.resolve(__dirname, "../..");
const g = require(path.join(RAIZ, "shared/eventos/estadosGestion.js"));
const SQL = fs.readFileSync(path.join(RAIZ, "../docs/activacion/estado_sorteos_contradicciones_solo_lectura.sql"), "utf8");

const FILAS = [
    { activo: true, estado: "abierto" }, { activo: true, estado: "abierto", cierre_estado: "fallido" },
    { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora_cierre" }, { activo: false, estado: "cerrado" },
    { activo: false, estado: "desactivado" }, { activo: false, estado: "cerrado", cierre_motivo: "panel:cancelado por el administrador" },
    { activo: false, estado: "eliminado", cierre_motivo: "panel:eliminado" }, { activo: false, estado: "cerrado", cierre_motivo: "sustituido por el sorteo X" },
    { activo: false, estado: "abierto" }, { activo: true, estado: "abierto", cierre_estado: "cerrado" }, { activo: true, estado: "cerrado" },
    { activo: true, estado: "abierto", cierre_motivo: "panel:desactivado" }, { activo: null, estado: "abierto" }, { activo: null, estado: "cerrado" },
    { activo: true, estado: "abierto", cierre_motivo: "panel:eliminado:x" }, { activo: true, estado: "abierto", cierre_motivo: "panel:eliminados" },
    { activo: true, estado: null, cierre_motivo: "panel:" }, { activo: true, estado: "abierto", cierre_motivo: "recuperado: hora pasó" },
    { activo: null, estado: "abierto", cierre_motivo: "panel:cancelado" },
    // F3: filas normalizadas (el motivo original sigue mandando).
    { activo: true, estado: "cerrado", cierre_motivo: "normalizado: panel:cancelado" },
    { activo: false, estado: "cerrado", cierre_motivo: "normalizado: hora" }
];
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

(async () => {
    const db = new PGlite();
    await db.exec(`
        create table eventos_bot (id uuid primary key, usuario_id uuid, tabla text, valor text, fecha_evento date, hora_cierre text,
          activo boolean, abierto boolean, estado text, cierre_estado text, cierre_motivo text, reservados int, pagados int,
          creado_en timestamptz default now(), actualizado_en timestamptz);
        create table event_sessions (id serial, evento_id uuid, estado text);
        create table sorteos_programados_grupos (id serial, evento_bot_id uuid);`);
    for (let i = 0; i < FILAS.length; i++) {
        const f = FILAS[i];
        await db.query(`insert into eventos_bot (id, usuario_id, tabla, activo, estado, cierre_estado, cierre_motivo, reservados, pagados)
            values ($1, '11111111-1111-4111-8111-111111111111', 't', $2, $3, $4, $5, $6, 0)`,
            [id(i), f.activo, f.estado, f.cierre_estado ?? null, f.cierre_motivo ?? null, i % 3]);
    }
    await db.query(`insert into event_sessions (evento_id, estado) values ($1, 'abierto'), ($1, 'cerrado')`, [id(9)]);
    await db.query(`insert into sorteos_programados_grupos (evento_bot_id) values ($1)`, [id(10)]);

    const resultados = (await db.exec(SQL)).filter(r => r.fields && r.fields.length);
    const pruebas = [];
    const prueba = (n, fn) => pruebas.push({ n, fn });

    prueba("devuelve exactamente 3 resultados (global, por cliente, casos)", () => assert.strictEqual(resultados.length, 3));

    prueba("casos: misma interpretación que estadosGestion.js fila a fila", () => {
        const casos = resultados[2].rows;
        const esperadas = FILAS.map((f, i) => ({ f, i })).filter(x => g.contradicciones(x.f).length);
        assert.strictEqual(casos.length, esperadas.length);
        for (const { f, i } of esperadas) {
            const r = casos.find(x => x.evento_id === id(i));
            assert.ok(r, `falta ${JSON.stringify(f)}`);
            assert.strictEqual(r.vigente, g.vigente(f), `vigente ${JSON.stringify(f)}`);
            assert.strictEqual(r.b_abierto, g.abiertoPorEstado(f), `B ${JSON.stringify(f)}`);
            assert.strictEqual(r.c_en_curso, g.enCursoPorActivo(f), `C ${JSON.stringify(f)}`);
            assert.strictEqual(r.motivo, g.motivoGestion(f), `motivo ${JSON.stringify(f)}`);
            assert.strictEqual(r.fin, g.finDelEvento(f), `fin ${JSON.stringify(f)}`);
            assert.strictEqual(r.contradiccion, g.contradicciones(f)[0], `contradicción ${JSON.stringify(f)}`);
        }
        assert.strictEqual(Number(casos.find(x => x.evento_id === id(9)).ciclos_en_curso), 1);
        assert.strictEqual(Number(casos.find(x => x.evento_id === id(10)).grupos_programados), 1);
    });

    prueba("resumen global: recuentos = funciones del backend", () => {
        const r = resultados[0].rows[0];
        const n = (p) => FILAS.filter(p).length;
        assert.strictEqual(Number(r.filas), FILAS.length);
        assert.strictEqual(Number(r.vigentes_canonico), n(g.vigente));
        assert.strictEqual(Number(r.en_curso_criterio_c), n(g.enCursoPorActivo));
        assert.strictEqual(Number(r.abiertas_criterio_b), n(g.abiertoPorEstado));
        assert.strictEqual(Number(r.activo_true_ya_cerrado), n(f => g.contradicciones(f).includes("activo_terminado")));
        assert.strictEqual(Number(r.activo_null), n(f => f.activo == null));
        assert.strictEqual(Number(r.regla1_dejan_de_aceptar_reservas), n(f => g.abiertoPorEstado(f) && !g.vigente(f)));
        assert.strictEqual(Number(r.regla2_sin_recordatorios), n(f => f.activo !== false && !g.vigente(f)));
    });

    prueba("la consulta no deja nada creado ni cambia datos (solo lectura + rollback)", async () => {
        assert.strictEqual((await db.query("select count(*)::int n from eventos_bot")).rows[0].n, FILAS.length);
        assert.ok(!/\b(create|insert|update|delete|alter|drop|truncate|grant)\b/i.test(SQL.replace(/--.*$/gm, "")), "solo SELECT");
    });

    let fallos = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
    process.exitCode = fallos ? 1 : 0;
})();
