// ==========================================================================
// Cliente "tipo supabase-js" sobre PGlite con las migraciones REALES 032 y
// 050, para probar backend/rifas/repositorio.js de punta a punta sin red.
//
//   - rpc(nombre, args): llama a public.<nombre> con argumentos por NOMBRE
//     y los tipos reales de la función (leídos de pg_proc), como service_role.
//   - from(tabla): subconjunto de lectura de PostgREST que usa el
//     repositorio: select, eq, in, is, or (a.eq.x,b.eq.y), order, range,
//     limit, maybeSingle. Sin escrituras: el repositorio no las hace.
//
// Mismo entorno que backend/tests/rifas/motorRifasSql.test.js: roles
// anon/authenticated/service_role, permisos por defecto de Supabase,
// auth.users y auth.uid().
// ==========================================================================

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

function cargarPGlite() {
    try {
        return require(process.env.PGLITE_MODULE || "@electric-sql/pglite").PGlite;
    } catch {
        return null;
    }
}

const entorno = (usuarios) => `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    ${usuarios.map(u => `insert into auth.users values ('${u}');`).join("\n")}
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
`;

const identificador = (s) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`identificador no admitido en la prueba: ${s}`);
    return `"${s}"`;
};

// extra: SQL que se aplica después de la 050 y ANTES de leer las firmas
// (p. ej. tablas base + 030 + 051 + 054 en tests/rifasApp/sorteosPorRifa).
async function crearBase({ usuarios, extra = [] }) {
    const PGlite = cargarPGlite();
    if (!PGlite) return null;
    const pg = new PGlite();
    await pg.exec(entorno(usuarios));
    await pg.exec(leer("backend/supabase_migrations/032_auditoria_reservas.sql"));
    await pg.exec(leer("backend/supabase_migrations/050_motor_rifas_centralizado.sql"));
    for (const sql of extra) await pg.exec(sql);

    // Tipos reales de los argumentos de cada rifa_*.
    const firmas = new Map();
    const { rows } = await pg.query(`
        select p.proname, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rifa\\_%'`);
    for (const r of rows) firmas.set(r.proname, Object.fromEntries(r.proargnames.map((n, i) => [n, r.tipos[i]])));

    const llamadas = [];

    // Ejecuta como el BACKEND (service_role) y vuelve al rol inicial.
    async function comoServicio(sql, params) {
        await pg.exec("set role service_role");
        try {
            return await pg.query(sql, params);
        } finally {
            await pg.exec("reset role");
        }
    }

    function valor(tipo, v) {
        if (v === null || v === undefined) return null;
        if (tipo === "jsonb") return JSON.stringify(v);
        if (tipo.endsWith("[]")) return `{${v.map(x => String(x)).join(",")}}`;
        if (typeof v === "boolean" || typeof v === "number") return v;
        return String(v);
    }

    async function rpc(nombre, args = {}) {
        llamadas.push({ nombre, args });
        const firma = firmas.get(nombre);
        if (!firma) return { data: null, error: { message: `función ${nombre} no existe`, code: "PGRST202" } };
        const nombres = Object.keys(args);
        const params = [];
        const partes = nombres.map((n) => {
            if (!(n in firma)) throw new Error(`${nombre}: argumento desconocido ${n}`);
            params.push(valor(firma[n], args[n]));
            return `${n} => $${params.length}::${firma[n]}`;
        });
        try {
            const { rows: r } = await comoServicio(`select public.${nombre}(${partes.join(", ")}) as r`, params);
            return { data: r[0].r, error: null };
        } catch (e) {
            return { data: null, error: { message: e.message, code: e.code } };
        }
    }

    function from(tabla) {
        const filtros = [];
        const params = [];
        let columnas = "*";
        let orden = "";
        let limite = "";
        let unico = false;
        const p = (v) => { params.push(v); return `$${params.length}`; };
        const b = {
            select(c = "*") { columnas = c === "*" ? "*" : c.split(",").map(x => identificador(x.trim())).join(", "); return b; },
            eq(c, v) { filtros.push(`${identificador(c)} = ${p(typeof v === "boolean" ? v : String(v))}`); return b; },
            neq(c, v) { filtros.push(`${identificador(c)}::text <> ${p(String(v))}`); return b; },
            in(c, vs) { filtros.push(`${identificador(c)}::text = any(${p(`{${vs.map(String).join(",")}}`)}::text[])`); return b; },
            is(c, v) { filtros.push(`${identificador(c)} is ${v === null ? "null" : v ? "true" : "false"}`); return b; },
            or(expr) {
                const partes = expr.split(",").map((x) => {
                    const m = x.match(/^([a-z_]+)\.eq\.(.+)$/);
                    if (!m) throw new Error(`or() no admitido: ${x}`);
                    return `${identificador(m[1])}::text = ${p(m[2])}`;
                });
                filtros.push(`(${partes.join(" or ")})`);
                return b;
            },
            order(c, { ascending = true } = {}) { orden = ` order by ${identificador(c)} ${ascending ? "asc" : "desc"}`; return b; },
            range(desde, hasta) { limite = ` limit ${hasta - desde + 1} offset ${desde}`; return b; },
            limit(n) { limite = ` limit ${Number(n)}`; return b; },
            maybeSingle() { unico = true; return b; },
            // El repositorio no escribe con from(); otras capas sí (actividad,
            // bloqueos). Aquí se registran y se responden como tabla ausente.
            insert(filas) { llamadas.push({ nombre: `insert:${tabla}`, args: filas }); return Promise.resolve({ data: null, error: { code: "42P01", message: `tabla ${tabla} fuera de la prueba` } }); },
            // Como supabase-js: nunca rechaza; el error viaja en { error }.
            async then(resolver) {
                const sql = `select ${columnas} from public.${identificador(tabla)}${filtros.length ? " where " + filtros.join(" and ") : ""}${orden}${limite}`;
                let salida;
                try {
                    const { rows: r } = await comoServicio(sql, params);
                    salida = unico ? { data: r[0] || null, error: null } : { data: r, error: null };
                } catch (e) {
                    salida = { data: null, error: { message: e.message, code: e.code } };
                }
                return resolver(salida);
            }
        };
        return b;
    }

    return { client: { rpc, from }, pg, llamadas, comoServicio };
}

module.exports = { crearBase, cargarPGlite };
