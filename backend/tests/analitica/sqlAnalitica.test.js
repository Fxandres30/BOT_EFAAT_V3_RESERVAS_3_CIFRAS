// ==========================================================================
// PRUEBAS SQL — migración 020_analitica_privada.sql contra un Postgres REAL
// (PGlite: Postgres compilado a WASM, en memoria). Ejecuta el archivo de
// migración tal cual y ejercita las funciones con los escenarios de la
// especificación: visitante nuevo/recurrente, nueva sesión tras 30 min,
// varias pestañas, navegación, heartbeat, idle/resume/exit, permisos de
// anon/authenticated y retención de IP.
//
// PGlite NO es dependencia del proyecto (a propósito: no se añaden
// dependencias al backend por una prueba). Para ejecutarla:
//
//     npm install --no-save @electric-sql/pglite --prefix <carpeta>
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/analitica/sqlAnalitica.test.js
//
// Sin PGlite disponible la prueba se omite (exit 0) avisándolo.
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

const MIGRACION = path.join(__dirname, "..", "..", "supabase_migrations", "020_analitica_privada.sql");

const resultados = [];

async function test(nombre, fn) {

    try {

        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

}

// Roles que Supabase crea de fábrica (en PGlite hay que crearlos).
const ROLES_SUPABASE = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    insert into auth.users (id, email) values
        ('2491cbd0-5fb5-4cef-a06d-6092e69d40c4', 'admin@ejemplo.test'),
        ('99999999-9999-4999-8999-999999999999', 'registrado@ejemplo.test');
`;

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const S2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const S3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

async function crearDb() {

    const db = new PGlite();
    await db.exec(ROLES_SUPABASE);
    await db.exec(fs.readFileSync(MIGRACION, "utf8"));
    return db;

}

function evento(db, tipo, visitorId, sessionId, pagina, extra = {}) {

    return db.query(
        `select public.analitica_registrar_evento(
            p_tipo => $1, p_visitor_id => $2, p_session_id => $3, p_pagina => $4,
            p_referrer => $5, p_user_agent => $6, p_ip => $7::inet,
            p_device_type => $8, p_operating_system => $9, p_browser => $10,
            p_screen_width => $11, p_screen_height => $12
        ) as r`,
        [
            tipo, visitorId, sessionId, pagina,
            extra.referrer ?? null, extra.userAgent ?? "UA-test", extra.ip ?? null,
            extra.device ?? "desktop", extra.os ?? "Windows", extra.browser ?? "Chrome 140",
            extra.w ?? 1920, extra.h ?? 1080
        ]
    ).then(r => r.rows[0].r);

}

async function uno(db, sql, params = []) {
    return (await db.query(sql, params)).rows[0];
}

async function eventos(db, sessionId) {
    return (await db.query(
        "select event_type, page from public.visitor_events where session_id = $1 order by id",
        [sessionId]
    )).rows.map(e => `${e.event_type}:${e.page}`);
}

// Retrocede el reloj de una sesión (simula el paso del tiempo).
async function retroceder(db, sessionId, segundos) {
    await db.query(
        `update public.visitor_sessions
            set last_activity_at = last_activity_at - make_interval(secs => $2),
                started_at = started_at - make_interval(secs => $2)
          where session_id = $1`,
        [sessionId, segundos]
    );
    await db.query(
        `update public.visitor_events
            set created_at = created_at - make_interval(secs => $2)
          where session_id = $1`,
        [sessionId, segundos]
    );
}

async function main() {

    await test("1. migración se aplica y es idempotente (2 ejecuciones)", async () => {
        const db = await crearDb();
        await db.exec(fs.readFileSync(MIGRACION, "utf8"));
        const t = await uno(db, "select count(*)::int n from pg_tables where schemaname='public' and tablename in ('visitors','visitor_sessions','visitor_events')");
        assert.strictEqual(t.n, 3);
    });

    await test("2. visitante nuevo: crea visitor + sesión + new_visitor/session_start/page_view", async () => {
        const db = await crearDb();
        const r = await evento(db, "page_view", V1, S1, "/login", { referrer: "https://google.com/", ip: "190.24.10.7", device: "mobile", os: "Android 14", browser: "Chrome 140" });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.nueva_sesion, true);
        assert.strictEqual(r.nuevo_visitante, true);
        assert.strictEqual(r.session_id, S1);
        const v = await uno(db, "select * from public.visitors where visitor_id=$1", [V1]);
        assert.strictEqual(v.total_sessions, 1);
        assert.strictEqual(v.device_type, "mobile");
        const s = await uno(db, "select *, host(ip) h from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.landing_page, "/login");
        assert.strictEqual(s.page_views, 1);
        assert.strictEqual(s.h, "190.24.10.7");
        assert.strictEqual(s.referrer, "https://google.com/");
        assert.deepStrictEqual(await eventos(db, S1), ["new_visitor:/login", "session_start:/login", "page_view:/login"]);
    });

    await test("3. navegación entre páginas: page_view por ruta, current_page y page_views", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/login");
        await evento(db, "page_view", V1, S1, "/sesiones");
        await evento(db, "page_view", V1, S1, "/tablas");
        const s = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.current_page, "/tablas");
        assert.strictEqual(s.landing_page, "/login");
        assert.strictEqual(s.page_views, 3);
        const n = await uno(db, "select count(*)::int n from public.visitor_sessions");
        assert.strictEqual(n.n, 1, "una sola sesión");
    });

    await test("4. doble disparo de la misma página (<3 s) no duplica page_view", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        const r = await evento(db, "page_view", V1, S1, "/sesiones");
        assert.strictEqual(r.accion, "duplicado");
        const s = await uno(db, "select page_views from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.page_views, 1);
    });

    await test("5. visitante recurrente: nueva sesión suma total_sessions, sin new_visitor", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/login");
        await retroceder(db, S1, 3 * 3600);
        const r = await evento(db, "page_view", V1, S2, "/sesiones");
        assert.strictEqual(r.nueva_sesion, true);
        assert.strictEqual(r.nuevo_visitante, false);
        const v = await uno(db, "select total_sessions from public.visitors where visitor_id=$1", [V1]);
        assert.strictEqual(v.total_sessions, 2);
        assert.deepStrictEqual(await eventos(db, S2), ["session_start:/sesiones", "page_view:/sesiones"]);
    });

    await test("6. nueva sesión tras 30 min de inactividad (el servidor rota aunque el cliente reuse el id)", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        await retroceder(db, S1, 31 * 60);
        const r = await evento(db, "page_view", V1, S1, "/tablas");
        assert.strictEqual(r.nueva_sesion, true);
        assert.strictEqual(r.rotada, true);
        assert.notStrictEqual(r.session_id, S1);
        const vieja = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(vieja.end_reason, "timeout");
        assert.strictEqual(vieja.continued_as, r.session_id);
        assert.ok(vieja.ended_at, "la sesión vieja queda cerrada");
        const v = await uno(db, "select total_sessions from public.visitors where visitor_id=$1", [V1]);
        assert.strictEqual(v.total_sessions, 2);
    });

    await test("7. 29 min de inactividad NO abre sesión nueva", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        await retroceder(db, S1, 29 * 60);
        const r = await evento(db, "page_view", V1, S1, "/tablas");
        assert.strictEqual(r.session_id, S1);
        assert.ok(!r.nueva_sesion);
    });

    await test("8. varias pestañas tras expirar: la 2ª pestaña se une a la sucesora (sin duplicar)", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        await retroceder(db, S1, 40 * 60);
        const a = await evento(db, "heartbeat", V1, S1, "/sesiones");
        const b = await evento(db, "heartbeat", V1, S1, "/tablas");
        assert.strictEqual(a.rotada, true);
        assert.strictEqual(b.session_id, a.session_id, "misma sucesora");
        const n = await uno(db, "select count(*)::int n from public.visitor_sessions");
        assert.strictEqual(n.n, 2, "vieja + una sola sucesora");
    });

    await test("9. varias pestañas simultáneas estrenando la misma sesión: una sola fila", async () => {
        const db = await crearDb();
        const rs = await Promise.all([
            evento(db, "page_view", V1, S1, "/sesiones"),
            evento(db, "page_view", V1, S1, "/tablas"),
            evento(db, "page_view", V1, S1, "/mensajes")
        ]);
        assert.ok(rs.every(r => r.ok && r.session_id === S1));
        const n = await uno(db, "select count(*)::int n from public.visitor_sessions");
        assert.strictEqual(n.n, 1);
        const v = await uno(db, "select total_sessions from public.visitors");
        assert.strictEqual(v.total_sessions, 1);
        const s = await uno(db, "select page_views from public.visitor_sessions");
        assert.strictEqual(s.page_views, 3);
    });

    await test("10. heartbeat: throttle (<30 s sin escritura) y actualización de last_activity_at", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        const r1 = await evento(db, "heartbeat", V1, S1, "/sesiones");
        assert.strictEqual(r1.accion, "throttled");
        await retroceder(db, S1, 60);
        const antes = await uno(db, "select last_activity_at from public.visitor_sessions where session_id=$1", [S1]);
        const r2 = await evento(db, "heartbeat", V1, S1, "/sesiones");
        assert.strictEqual(r2.accion, "heartbeat");
        const despues = await uno(db, "select last_activity_at from public.visitor_sessions where session_id=$1", [S1]);
        assert.ok(despues.last_activity_at > antes.last_activity_at);
        const ev = await uno(db, "select count(*)::int n from public.visitor_events where session_id=$1", [S1]);
        assert.strictEqual(ev.n, 3, "heartbeat NO inserta eventos");
    });

    await test("11. idle -> resume con heartbeat; idle duplicado se ignora", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        const i1 = await evento(db, "idle", V1, S1, "/sesiones");
        const i2 = await evento(db, "idle", V1, S1, "/sesiones");
        assert.strictEqual(i1.accion, "idle");
        assert.strictEqual(i2.accion, "duplicado");
        let s = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.end_reason, "idle");
        const h = await evento(db, "heartbeat", V1, S1, "/sesiones");
        assert.strictEqual(h.accion, "heartbeat", "tras idle el heartbeat no se throttlea");
        s = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.ended_at, null);
        assert.deepStrictEqual((await eventos(db, S1)).slice(-2), ["idle:/sesiones", "resume:/sesiones"]);
    });

    await test("12. exit cierra la sesión; recarga (<30 min) la reabre sin sesión nueva", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        const e = await evento(db, "exit", V1, S1, "/sesiones");
        assert.strictEqual(e.accion, "exit");
        assert.strictEqual((await evento(db, "exit", V1, S1, "/sesiones")).accion, "duplicado");
        let s = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.end_reason, "exit");
        await retroceder(db, S1, 10);
        const r = await evento(db, "page_view", V1, S1, "/sesiones");
        assert.strictEqual(r.session_id, S1);
        s = await uno(db, "select * from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.ended_at, null);
        const n = await uno(db, "select count(*)::int n from public.visitor_sessions");
        assert.strictEqual(n.n, 1);
    });

    await test("13. idle/exit sobre una sesión desconocida no crean nada", async () => {
        const db = await crearDb();
        assert.strictEqual((await evento(db, "exit", V1, S1, "/x")).accion, "ignorado_sin_sesion");
        assert.strictEqual((await evento(db, "idle", V1, S1, "/x")).accion, "ignorado_sin_sesion");
        const n = await uno(db, "select count(*)::int n from public.visitors");
        assert.strictEqual(n.n, 0);
    });

    await test("14. un visitante no puede escribir en la sesión de otro", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones");
        const r = await evento(db, "page_view", V2, S1, "/tablas");
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.motivo, "sesion_ajena");
        const s = await uno(db, "select current_page from public.visitor_sessions where session_id=$1", [S1]);
        assert.strictEqual(s.current_page, "/sesiones");
    });

    await test("15. tipo inválido es rechazado por la función", async () => {
        const db = await crearDb();
        await assert.rejects(() => evento(db, "session_start", V1, S1, "/x"), /tipo de evento inválido/);
    });

    await test("16. anon y authenticated NO pueden leer, escribir ni ejecutar funciones", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/sesiones", { ip: "190.24.10.7" });
        for (const rol of ["anon", "authenticated"]) {
            await db.exec(`set role ${rol}`);
            await assert.rejects(() => db.query("select * from public.visitor_sessions"), /permission denied/, `${rol} select`);
            await assert.rejects(() => db.query("select * from public.visitors"), /permission denied/, `${rol} select visitors`);
            await assert.rejects(() => db.query("select * from public.visitor_events"), /permission denied/, `${rol} select events`);
            await assert.rejects(() => db.query(`insert into public.visitors (visitor_id) values ('${V2}')`), /permission denied/, `${rol} insert`);
            await assert.rejects(() => evento(db, "page_view", V2, S2, "/x"), /permission denied/, `${rol} rpc registrar`);
            await assert.rejects(() => db.query("select public.analitica_resumen(now() - interval '1 day', now())"), /permission denied/, `${rol} rpc resumen`);
            await assert.rejects(() => db.query("select public.analitica_historial(now() - interval '1 day', now())"), /permission denied/, `${rol} rpc historial`);
            await assert.rejects(() => db.query(`select public.analitica_sesion_detalle('${S1}')`), /permission denied/, `${rol} rpc detalle`);
            await db.exec("reset role");
        }
    });

    await test("17. RLS activo en las 4 tablas y sin policies", async () => {
        const db = await crearDb();
        const r = (await db.query("select relname, relrowsecurity from pg_class where relname in ('visitors','visitor_sessions','visitor_events','analitica_admins')")).rows;
        assert.strictEqual(r.length, 4);
        assert.ok(r.every(x => x.relrowsecurity === true));
        const p = await uno(db, "select count(*)::int n from pg_policies where tablename in ('visitors','visitor_sessions','visitor_events','analitica_admins')");
        assert.strictEqual(p.n, 0);
    });

    await test("17b. analitica_admins: sembrada SOLO con el administrador existente; anon/authenticated no la leen", async () => {
        const db = await crearDb();
        const r = (await db.query("select user_id from public.analitica_admins")).rows;
        assert.deepStrictEqual(r.map(x => x.user_id), ["2491cbd0-5fb5-4cef-a06d-6092e69d40c4"]);
        for (const rol of ["anon", "authenticated"]) {
            await db.exec(`set role ${rol}`);
            await assert.rejects(() => db.query("select * from public.analitica_admins"), /permission denied/, rol);
            await assert.rejects(() => db.query("insert into public.analitica_admins (user_id) values ('99999999-9999-4999-8999-999999999999')"), /permission denied/, rol);
            await db.exec("reset role");
        }
    });

    await test("18. service_role sí puede operar", async () => {
        const db = await crearDb();
        await db.exec("set role service_role");
        const r = await evento(db, "page_view", V1, S1, "/sesiones");
        assert.strictEqual(r.ok, true);
        const res = await uno(db, "select public.analitica_resumen(now() - interval '1 day', now() + interval '1 minute') r");
        assert.strictEqual(res.r.visitantes_unicos, 1);
        await db.exec("reset role");
    });

    await test("19. retención: IP > 30 días se anonimiza (/24 y /48); la reciente no", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/a", { ip: "190.24.10.7" });
        await evento(db, "page_view", V1, S2, "/b", { ip: "2800:484:1234:5678::1" });
        await evento(db, "page_view", V2, S3, "/c", { ip: "181.50.3.9" });
        await retroceder(db, S1, 31 * 86400);
        await retroceder(db, S2, 31 * 86400);
        const r = await uno(db, "select public.analitica_anonimizar_ips(30) n");
        assert.strictEqual(r.n, 2);
        const ips = Object.fromEntries((await db.query("select session_id, host(ip) h, ip_anonymized_at is not null a from public.visitor_sessions")).rows.map(x => [x.session_id, x]));
        assert.strictEqual(ips[S1].h, "190.24.10.0");
        assert.strictEqual(ips[S2].h, "2800:484:1234::");
        assert.strictEqual(ips[S3].h, "181.50.3.9");
        assert.strictEqual(ips[S3].a, false);
        const r2 = await uno(db, "select public.analitica_anonimizar_ips(30) n");
        assert.strictEqual(r2.n, 0, "idempotente");
    });

    await test("20. resumen: únicos, sesiones, activos, dispositivos, primera/última visita", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/a", { device: "mobile" });
        await evento(db, "page_view", V2, S2, "/b", { device: "desktop" });
        await evento(db, "page_view", V2, S2, "/c", { device: "desktop" });
        await evento(db, "exit", V2, S2, "/c");
        const r = (await uno(db, "select public.analitica_resumen(now() - interval '1 hour', now() + interval '1 minute') r")).r;
        assert.strictEqual(r.visitantes_unicos, 2);
        assert.strictEqual(r.visitantes_nuevos, 2);
        assert.strictEqual(r.sesiones, 2);
        assert.strictEqual(r.paginas_vistas, 3);
        assert.strictEqual(r.activos_ahora, 1, "la sesión con exit no cuenta como activa");
        assert.deepStrictEqual(r.dispositivos, { mobile: 1, tablet: 0, desktop: 1, unknown: 0 });
        assert.ok(r.primera_visita && r.ultima_visita);
    });

    await test("21. activos: solo sesiones abiertas con actividad reciente, con IP como texto", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/a", { ip: "190.24.10.7" });
        await evento(db, "page_view", V2, S2, "/b");
        await retroceder(db, S2, 10 * 60);
        const a = (await uno(db, "select public.analitica_activos(150) r")).r;
        assert.strictEqual(a.length, 1);
        assert.strictEqual(a[0].session_id, S1);
        assert.strictEqual(a[0].ip, "190.24.10.7");
    });

    await test("22. historial por rango + paginación + detalle de sesión con eventos", async () => {
        const db = await crearDb();
        await evento(db, "page_view", V1, S1, "/a");
        await evento(db, "page_view", V1, S1, "/b");
        await evento(db, "page_view", V2, S2, "/c");
        await retroceder(db, S2, 3 * 86400);
        const h = (await uno(db, "select public.analitica_historial(now() - interval '1 day', now() + interval '1 minute', 50, 0) r")).r;
        assert.strictEqual(h.total, 1);
        assert.strictEqual(h.filas[0].session_id, S1);
        const h7 = (await uno(db, "select public.analitica_historial(now() - interval '7 day', now() + interval '1 minute', 1, 1) r")).r;
        assert.strictEqual(h7.total, 2);
        assert.strictEqual(h7.filas.length, 1);
        assert.strictEqual(h7.filas[0].session_id, S2, "página 2 = la más antigua");
        const d = (await uno(db, "select public.analitica_sesion_detalle($1) r", [S1])).r;
        assert.strictEqual(d.sesion.page_views, 2);
        assert.deepStrictEqual(d.eventos.map(e => e.event_type), ["new_visitor", "session_start", "page_view", "page_view"]);
        assert.strictEqual(d.visitante.total_sessions, 1);
        const nada = (await uno(db, "select public.analitica_sesion_detalle('00000000-0000-4000-8000-000000000000') r")).r;
        assert.strictEqual(nada, null);
    });

    const fallidas = resultados.filter(r => !r.ok);

    console.log("");
    console.log(`TOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas.length}  ❌ FALLA: ${fallidas.length}`);

    if (fallidas.length) process.exit(1);

}

main();
