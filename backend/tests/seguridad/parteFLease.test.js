// ==========================================================================
// PRUEBA SQL — docs/activacion/parte_f_permisos_lease.sql (NO aplicada en
// producción) contra Postgres real en memoria (PGlite).
//
// Reproduce los permisos por defecto de Supabase (las funciones nuevas del
// esquema public se conceden a anon, authenticated y service_role, y Postgres
// además a PUBLIC), ejecuta la migración REAL 004 y comprueba:
//   - ANTES: anon/authenticated/cualquier rol pueden leer el dueño del lease,
//     liberarlo y quedárselo;
//   - DESPUÉS: ninguno puede ejecutar ninguna de las 3 funciones; el bot
//     (service_role) conserva el ciclo completo, probado con el módulo REAL
//     services/baileys/lease.js;
//   - guardias (sobrecargas, funciones ausentes, herencia de roles), que no
//     toca funciones ajenas, idempotencia y vuelta atrás exacta.
//
// LÍMITE: no valida los permisos reales de Supabase (otros roles internos,
// ACL actuales de producción). Eso lo da la consulta ANTES/DESPUÉS del
// archivo, ejecutada a mano en el SQL Editor.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/parteFLease.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  PGlite no disponible — prueba SQL omitida (ver cabecera).");
    process.exit(0);
}

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = r => fs.readFileSync(path.join(RAIZ, r), "utf8");

const PARTE_F = leer("docs/activacion/parte_f_permisos_lease.sql");
const MIGRACION_004 = leer("backend/supabase_migrations/004_lease_sesiones.sql");

// Bloque "VUELTA ATRÁS" comentado: líneas "--   <sql>" descomentadas.
const VUELTA_F = PARTE_F.split("-- VUELTA ATRÁS (una transacción)")[1]
    .split("\n").filter(l => /^--\s{3}\S/.test(l)).map(l => l.replace(/^--\s{3}/, "")).join("\n");

const SES = "11111111-0000-4000-8000-000000000001";
const FIRMAS = [
    "public.lease_sesiones_acquire(uuid, text, integer)",
    "public.lease_sesiones_heartbeat(uuid, text, integer)",
    "public.lease_sesiones_release(uuid, text)"
];
const ROLES_PUBLICOS = ["anon", "authenticated", "cualquiera"];

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role cualquiera nologin;   -- un rol sin ningún permiso propio: solo hereda de PUBLIC
    grant usage on schema public to anon, authenticated, service_role, cualquiera;
    -- Permisos por defecto de Supabase para objetos nuevos de public:
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.sesiones (id uuid primary key, usuario_id uuid, nombre text);
    insert into public.sesiones (id, nombre) values ('${SES}', 'bot');
    -- Una función AJENA que no debe tocarse.
    create function public.otra_funcion() returns int language sql as $$ select 1 $$;
`;

const abiertas = [];
async function crearDb({ conF = false, extra = "" } = {}) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    await db.exec(MIGRACION_004);
    if (extra) await db.exec(extra);
    if (conF) await db.exec(PARTE_F);
    return db;
}

async function como(db, rol, sql, params) {
    await db.exec(`set role ${rol};`);
    try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role;"); }
}

async function aclDe(db, firma) {
    const { rows } = await db.query(`
        select string_agg(x, ',' order by x) as acl from (
            select (case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) || ':' || a.privilege_type as x
            from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = $1::regprocedure) y`, [firma]);
    return rows[0].acl;
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ── Estado actual ────────────────────────────────────────────────────────

prueba("ANTES (004 tal cual): anon, authenticated y cualquier rol (vía PUBLIC) leen el dueño, liberan y roban el lease", async () => {
    const db = await crearDb();
    for (const rol of ROLES_PUBLICOS) {
        await como(db, "service_role", `select * from public.lease_sesiones_acquire('${SES}', 'bot-vps', 60)`);
        const espia = await como(db, rol, `select owner_id from public.lease_sesiones_acquire('${SES}', 'x', 1)`);
        assert.strictEqual(espia[0].owner_id, "bot-vps", `${rol} lee el dueño`);
        const lib = await como(db, rol, `select liberado from public.lease_sesiones_release('${SES}', 'bot-vps')`);
        assert.strictEqual(lib[0].liberado, true, `${rol} libera el lease del bot`);
        const robo = await como(db, rol, `select adquirido from public.lease_sesiones_acquire('${SES}', 'atacante', 86400)`);
        assert.strictEqual(robo[0].adquirido, true, `${rol} se queda el lease`);
        const bot = await como(db, "service_role", `select renovado from public.lease_sesiones_heartbeat('${SES}', 'bot-vps', 60)`);
        assert.strictEqual(bot[0].renovado, false, "el bot pierde el lease");
        await db.exec(`delete from public.sesiones_lease`);
    }
});

// ── Con la Parte F ───────────────────────────────────────────────────────

prueba("DESPUÉS: anon, authenticated y cualquier rol NO pueden ejecutar ninguna de las 3 funciones", async () => {
    const db = await crearDb({ conF: true });
    await como(db, "service_role", `select * from public.lease_sesiones_acquire('${SES}', 'bot-vps', 60)`);
    const llamadas = [
        `select * from public.lease_sesiones_acquire('${SES}', 'x', 1)`,
        `select * from public.lease_sesiones_heartbeat('${SES}', 'bot-vps', 60)`,
        `select * from public.lease_sesiones_release('${SES}', 'bot-vps')`
    ];
    for (const rol of ROLES_PUBLICOS) {
        for (const sql of llamadas) {
            await assert.rejects(como(db, rol, sql), /permission denied for function/i, `${rol}: ${sql}`);
        }
    }
    const fila = (await db.query("select owner_id from public.sesiones_lease")).rows;
    assert.deepStrictEqual(fila, [{ owner_id: "bot-vps" }], "el lease del bot sigue intacto");
});

prueba("DESPUÉS: tampoco pueden leer ni escribir la tabla sesiones_lease directamente", async () => {
    const db = await crearDb({ conF: true });
    await como(db, "service_role", `select * from public.lease_sesiones_acquire('${SES}', 'bot-vps', 60)`);
    for (const rol of ["anon", "authenticated"]) {
        assert.strictEqual((await como(db, rol, "select * from public.sesiones_lease")).length, 0, `${rol} no ve el lease`);
        assert.strictEqual((await como(db, rol, "delete from public.sesiones_lease returning session_id")).length, 0, `${rol} no lo borra`);
        await assert.rejects(como(db, rol, `insert into public.sesiones_lease (session_id, owner_id, lease_until) values ('${SES}', 'x', now())`), /row-level security|duplicate/i);
    }
});

prueba("DESPUÉS: service_role conserva el ciclo completo (adquirir, renovar, rechazar a otro dueño vigente, liberar, robar uno vencido)", async () => {
    const db = await crearDb({ conF: true });
    const q = sql => como(db, "service_role", sql);
    assert.strictEqual((await q(`select adquirido from public.lease_sesiones_acquire('${SES}', 'vps-1', 60)`))[0].adquirido, true);
    assert.strictEqual((await q(`select renovado from public.lease_sesiones_heartbeat('${SES}', 'vps-1', 60)`))[0].renovado, true);
    const otro = await q(`select adquirido, owner_id from public.lease_sesiones_acquire('${SES}', 'local-1', 60)`);
    assert.deepStrictEqual(otro[0], { adquirido: false, owner_id: "vps-1" }, "otra instancia no lo roba mientras está vigente");
    assert.strictEqual((await q(`select liberado from public.lease_sesiones_release('${SES}', 'vps-1')`))[0].liberado, true);
    await q(`select * from public.lease_sesiones_acquire('${SES}', 'vps-1', 60)`);
    await db.exec(`update public.sesiones_lease set lease_until = now() - interval '1 second'`); // vencido
    assert.strictEqual((await q(`select adquirido from public.lease_sesiones_acquire('${SES}', 'local-1', 60)`))[0].adquirido, true, "uno vencido sí se toma");
});

prueba("DESPUÉS: el módulo REAL services/baileys/lease.js funciona como service_role y falla limpio con anon", async () => {
    const db = await crearDb({ conF: true });
    // Adaptador mínimo supabase.rpc() -> Postgres, con el rol de la clave.
    let rolCliente = "service_role";
    const cliente = {
        async rpc(nombre, params) {
            const claves = Object.keys(params);
            const args = claves.map((k, i) => `${k} => $${i + 1}`).join(", ");
            try {
                return { data: await como(db, rolCliente, `select * from public.${nombre}(${args})`, claves.map(k => params[k])), error: null };
            } catch (e) {
                return { data: null, error: { message: e.message } };
            }
        }
    };
    const abs = path.join(RAIZ, "backend", "lib", "supabase.js");
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: cliente };
    const rutaLease = path.join(RAIZ, "backend", "services", "baileys", "lease.js");
    delete require.cache[rutaLease];
    const lease = require(rutaLease);

    const log = console.log, err = console.error;
    console.log = () => {}; console.error = () => {};
    try {
        const a = await lease.acquire(SES, "vps-1", 30);
        const h = await lease.heartbeat(SES, "vps-1", 30);
        const r = await lease.release(SES, "vps-1");
        rolCliente = "anon";
        const x = await lease.acquire(SES, "vps-1", 30);
        console.log = log; console.error = err;
        assert.strictEqual(a.adquirido, true, "acquire del bot");
        assert.strictEqual(h.renovado, true, "heartbeat del bot");
        assert.strictEqual(r.liberado, true, "release del bot");
        assert.strictEqual(x.adquirido, false, "con clave anon: no adquiere (el bot NO crearía el socket)");
        assert.match(x.error.message, /permission denied/i);
    } finally {
        console.log = log; console.error = err;
    }
});

prueba("DESPUÉS: no toca funciones ajenas (su ACL queda igual y anon la sigue ejecutando)", async () => {
    const db = await crearDb();
    const antes = await aclDe(db, "public.otra_funcion()");
    await db.exec(PARTE_F);
    assert.strictEqual(await aclDe(db, "public.otra_funcion()"), antes);
    assert.deepStrictEqual(await como(db, "anon", "select public.otra_funcion() as v"), [{ v: 1 }]);
});

prueba("DESPUÉS: ACL final exacta de las 3 = solo el dueño y service_role", async () => {
    const db = await crearDb({ conF: true });
    for (const f of FIRMAS) assert.strictEqual(await aclDe(db, f), "postgres:EXECUTE,service_role:EXECUTE", f);
});

// ── Guardias ─────────────────────────────────────────────────────────────

prueba("guardia: una SOBRECARGA no prevista (acquire(text, text, integer)) -> aborta y no aplica nada", async () => {
    const db = await crearDb({ extra: `create function public.lease_sesiones_acquire(p text, o text, t integer) returns int language sql security definer as $$ select 1 $$;` });
    let error = null;
    try { await db.exec(PARTE_F); } catch (e) { error = e; }
    assert.ok(error && /variantes no previstas.*lease_sesiones_acquire\(p text/.test(error.message), String(error && error.message));
    await db.exec("rollback;");
    assert.strictEqual((await como(db, "anon", `select owner_id from public.lease_sesiones_acquire('${SES}'::uuid, 'x', 1)`)).length, 1, "nada aplicado: sigue como antes");
});

prueba("guardia: variante con el mismo nombre en OTRO esquema -> aborta", async () => {
    const db = await crearDb({ extra: `create schema api; create function api.lease_sesiones_release(uuid, text) returns boolean language sql as $$ select true $$;` });
    await assert.rejects(db.exec(PARTE_F), /variantes no previstas.*api\.lease_sesiones_release/);
});

prueba("guardia: falta una función (004 no aplicada o firma distinta) -> aborta", async () => {
    const db = await crearDb({ extra: `drop function public.lease_sesiones_heartbeat(uuid, text, integer);` });
    await assert.rejects(db.exec(PARTE_F), /no existen estas funciones.*heartbeat/);
});

prueba("validación: si authenticated HEREDA el permiso de otro rol -> aborta y no aplica nada", async () => {
    const db = await crearDb({ extra: `create role con_permiso nologin;
        grant execute on function public.lease_sesiones_acquire(uuid, text, integer) to con_permiso;
        grant con_permiso to authenticated;` });
    const antes = await aclDe(db, FIRMAS[0]);
    let error = null;
    try { await db.exec(PARTE_F); } catch (e) { error = e; }
    assert.ok(error && /validación.*authenticated/.test(error.message), String(error && error.message));
    await db.exec("rollback;");
    assert.strictEqual(await aclDe(db, FIRMAS[0]), antes);
});

prueba("idempotente: aplicarla dos veces no falla y deja lo mismo", async () => {
    const db = await crearDb({ conF: true });
    await db.exec(PARTE_F);
    for (const f of FIRMAS) assert.strictEqual(await aclDe(db, f), "postgres:EXECUTE,service_role:EXECUTE");
});

// ── Vuelta atrás y riesgo documentado ────────────────────────────────────

prueba("vuelta atrás: restaura EXACTAMENTE la ACL por defecto de Supabase en las 3", async () => {
    const db = await crearDb();
    const antes = await Promise.all(FIRMAS.map(f => aclDe(db, f)));
    assert.ok(antes.every(a => a.includes("PUBLIC:EXECUTE") && a.includes("anon:EXECUTE")), "estado de partida = el de Supabase");
    await db.exec(PARTE_F);
    assert.ok(VUELTA_F.includes("grant execute"), "se extrajo el bloque");
    await db.exec(VUELTA_F);
    assert.deepStrictEqual(await Promise.all(FIRMAS.map(f => aclDe(db, f))), antes);
});

prueba("RIESGO documentado: volver a ejecutar la 004 (DROP + CREATE de acquire) la reabre -> hay que repetir la Parte F", async () => {
    const db = await crearDb({ conF: true });
    await db.exec(MIGRACION_004);
    const reabierta = await como(db, "anon", `select owner_id from public.lease_sesiones_acquire('${SES}', 'x', 1)`);
    assert.strictEqual(reabierta.length, 1, "acquire vuelve a estar abierta");
    await assert.rejects(como(db, "anon", `select * from public.lease_sesiones_release('${SES}', 'x')`), /permission denied/i,
        "release (CREATE OR REPLACE) conserva el cierre");
    await db.exec(PARTE_F);
    await assert.rejects(como(db, "anon", `select * from public.lease_sesiones_acquire('${SES}', 'x', 1)`), /permission denied/i);
});

// ── Condición previa: verificador del rol de la clave del backend ─────────

prueba("scripts/verificarRolSupabase.js reconoce el rol sin exponer la clave (claves inventadas)", async () => {
    const { rolDeClave } = require(path.join(RAIZ, "backend", "scripts", "verificarRolSupabase.js"));
    const jwt = role => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.firma`;
    assert.strictEqual(rolDeClave(jwt("service_role")).rol, "service_role");
    assert.strictEqual(rolDeClave(jwt("anon")).rol, "anon");
    assert.strictEqual(rolDeClave("sb_secret_inventada").rol, "service_role");
    assert.strictEqual(rolDeClave("sb_publishable_inventada").rol, "anon");
    assert.strictEqual(rolDeClave(undefined).rol, null);
    assert.strictEqual(rolDeClave("basura").rol, null);
    assert.ok(!JSON.stringify(rolDeClave(jwt("anon"))).includes("firma"), "nunca devuelve la clave");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    await Promise.allSettled(abiertas.map(db => db.close()));
    process.exit(falla ? 1 : 0);
})();
