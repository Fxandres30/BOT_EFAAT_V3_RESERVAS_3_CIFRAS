// ==========================================================================
// PRUEBAS — "/tablas/2000: Tu cuadrícula todavía no se puede crear" con el
// SQL REAL (2026-10-22).
//
// cuadriculaSegundoCliente.test.js prueba la ruta contra una RPC SIMULADA.
// Aquí la ruta HTTP y el servicio REALES del backend (routes/tablas.js ->
// tablasCliente.prepararCuadricula) hablan con un Postgres en memoria
// (PGlite) que reproduce producción: UNIQUE(numero) en las 2 tablas
// físicas, políticas abiertas, sin Parte A, sin 033 y sin 027, y la cuenta
// A con sus 2 cuadrículas. Sobre esa base se aplican los ARCHIVOS REALES
// en el orden de ACTIVACION.md §2f (Parte A -> 033 -> 027) y se comprueba:
//   - hoy (sin A/033/027): B (evento activo a $2000) -> migracion_pendiente,
//     nada escrito; la 027 se niega a aplicarse antes de A y de la 033;
//   - con A + 033 + 027: B y C (sin cuadrícula) reciben su 00-99, A queda
//     idéntica, sin números repetidos, idempotente, sin completar ni
//     corregir una cuadrícula incompleta;
//   - aislamiento real (RLS): cada cliente lee/modifica solo lo suyo; anon
//     nada; el navegador no puede llamar la función; el usuarioId del cuerpo
//     se ignora.
//
// La cuenta de servicio del adaptador imita a PostgREST: tabla inexistente
// -> PGRST205, función inexistente -> PGRST202. No se conecta a ninguna
// base remota.
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//       node backend/tests/seguridad/cuadriculaClienteSqlReal.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

let PGlite;
try {
    ({ PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite"));
} catch {
    console.log("⏭️  Sin PGlite (PGLITE_MODULE) — prueba SQL omitida.");
    process.exit(0);
}

const RAIZ = path.resolve(__dirname, "../..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, "..", p), "utf8").replace(/\r\n/g, "\n");
const inyectar = (rel, exp) => { const abs = path.join(RAIZ, rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const PARTE_A = leer("docs/activacion/propuesta_rls_tablas_antiguas.sql");
const M033 = leer("backend/supabase_migrations/033_cuadricula_por_cliente.sql");
const M027 = leer("backend/supabase_migrations/027_tablas_cliente.sql");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = "cccccccc-0000-4000-8000-00000000000c";
const T2 = "reservas_dos_cifras";
const T5K = "5k_15k_reservas_2_cifras";

const COLUMNAS_RESERVA = `
    id serial primary key, numero text not null, estado text, usuario_id uuid,
    comprador text, telefono text, evento_id text, fecha_pago text,
    identidad_evento_real text`;

// Producción hoy: sin RLS útil (políticas abiertas), UNIQUE(numero), anon
// con permisos por defecto, A con sus 2 cuadrículas y reservas reales.
const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}'), ('${C}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.sesiones (id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text, activa boolean default false);
    create table public.eventos_bot (id serial primary key, usuario_id uuid, tabla text, valor int, activo boolean, nombre_evento text);
    create table public.${T2} (${COLUMNAS_RESERVA}, constraint ${T2}_numero_key unique (numero));
    create table public."${T5K}" (${COLUMNAS_RESERVA}, constraint "${T5K}_numero_key" unique (numero));
    create policy "Enable read access for all users" on public.${T2} for select using (true);
    create policy "Permitir todo" on public."${T5K}" for all to public using (true) with check (true);

    insert into public.${T2} (usuario_id, numero, estado) select '${A}', lpad(g::text, 2, '0'), 'libre' from generate_series(0, 99) g;
    insert into public."${T5K}" (usuario_id, numero, estado) select '${A}', lpad(g::text, 2, '0'), 'libre' from generate_series(0, 99) g;
    update public.${T2} set estado = 'pagado', comprador = 'Juan de A', telefono = '3104445566', fecha_pago = '2026-10-22' where numero = '13';
    update public.${T2} set estado = 'reservado', comprador = 'Ana de A', telefono = '3001112233' where numero = '14';

    insert into public.sesiones (usuario_id, nombre, activa) values ('${A}', 'A', true), ('${B}', 'B', true);
    insert into public.eventos_bot (usuario_id, tabla, valor, activo, nombre_evento) values
        ('${A}', '${T5K}', 5000, true, 'Sorteo de A'),
        ('${B}', '${T2}', 2000, true, 'Lotería de Bogotá');`;

// ----------------------------------------- cliente "service_role" falso ---
// Lo justo que usan routes/tablas.js (POST /:precio/preparar) y
// tablasCliente.js, ejecutado como service_role en el Postgres de la prueba.

let db;
const tokens = { "jwt-A": A, "jwt-B": B, "jwt-C": C };

function errorDe(e) {
    return { code: e.code || null, message: e.message };
}

async function comoServicio(sql, params) {
    return db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        return tx.query(sql, params);
    });
}

async function existeTabla(t) {
    const r = await db.query("select to_regclass($1) is not null as e", [`public."${t}"`]);
    return r.rows[0].e;
}

function from(tabla) {

    const q = { cols: "*", count: false, head: false, filtros: [], orden: null };

    const builder = {
        select(cols, opts = {}) { q.cols = cols; q.count = opts.count === "exact"; q.head = !!opts.head; return builder; },
        eq(col, val) { q.filtros.push([col, val]); return builder; },
        order(col, { ascending = true } = {}) { q.orden = [col, ascending]; return builder; },
        then(ok, ko) { return ejecutar().then(ok, ko); }
    };

    async function ejecutar() {

        if (!(await existeTabla(tabla))) {
            return { data: null, count: null, error: { code: "PGRST205", message: `Could not find the table 'public.${tabla}' in the schema cache` } };
        }

        const params = q.filtros.map(([, v]) => v);
        const where = q.filtros.length ? " where " + q.filtros.map(([c], i) => `"${c}" = $${i + 1}`).join(" and ") : "";

        try {
            if (q.head) {
                const r = await comoServicio(`select count(*)::int as n from public."${tabla}"${where}`, params);
                return { data: null, count: r.rows[0].n, error: null };
            }
            const cols = q.cols === "*" ? "*" : q.cols.split(",").map(c => `"${c.trim()}"`).join(", ");
            const orden = q.orden ? ` order by "${q.orden[0]}" ${q.orden[1] ? "asc" : "desc"}` : "";
            const r = await comoServicio(`select ${cols} from public."${tabla}"${where}${orden}`, params);
            return { data: r.rows, count: q.count ? r.rows.length : null, error: null };
        } catch (e) {
            return { data: null, count: null, error: errorDe(e) };
        }

    }

    return builder;

}

async function rpc(nombre, args) {

    const existe = (await db.query("select count(*)::int n from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [nombre])).rows[0].n > 0;
    if (!existe) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${nombre}` } };

    try {
        const r = await comoServicio(`select public.${nombre}($1::uuid, $2::jsonb) as r`, [args.p_usuario, JSON.stringify(args.p_configuraciones)]);
        return { data: r.rows[0].r, error: null };
    } catch (e) {
        return { data: null, error: errorDe(e) };
    }

}

const auth = {
    async getUser(token) {
        const id = tokens[token];
        return id ? { data: { user: { id, email: `${id.slice(0, 1)}@prueba.co` } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
    }
};

inyectar("lib/supabase.js", { from, rpc, auth });
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));

const tablasCliente = require("../../bot/funciones/eventos/tablasCliente");

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

let base;

function pedir(metodo, camino, { token, cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const datos = JSON.stringify(cuerpo || {});
        const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos), "x-service-token": process.env.SESSIONS_API_TOKEN };
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        req.end(datos);
    });
}

const preparar = (token, precio = 2000, cuerpo) => pedir("POST", `/tablas/${precio}/preparar`, { token, cuerpo });

// ------------------------------------------------------------ ayudas ---

async function aplicar(sql) {
    try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* sin transacción abierta */ } return e; }
}

async function filas(usuario, tabla = T2) {
    return (await db.query(`select numero, estado, comprador, telefono, fecha_pago from public."${tabla}" where usuario_id = $1 order by numero`, [usuario])).rows;
}

async function foto(usuario) {
    return JSON.stringify([await filas(usuario, T2), await filas(usuario, T5K)]);
}

async function repetidos() {
    let n = 0;
    for (const t of [T2, T5K]) {
        n += (await db.query(`select count(*)::int n from (select 1 from public."${t}" group by usuario_id, numero having count(*) > 1) d`)).rows[0].n;
    }
    return n;
}

// Sesión del navegador (PostgREST con el JWT del cliente) o anon.
async function como(rol, usuario, sql) {
    return db.transaction(async (tx) => {
        await tx.exec(`set local role ${rol}`);
        if (usuario) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [usuario]);
        return tx.query(sql);
    });
}

async function silencio(fn) {
    const original = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = original; }
}

const CUADRICULA = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ----------------------------------------------------------- pruebas ---
// Secuenciales: cada una parte del estado que dejó la anterior, como en
// producción (hoy -> Parte A -> 033 -> 027 -> uso).

let fotoA;

prueba("producción hoy: B con evento activo a $2000 y 0 filas -> 503 migracion_pendiente (motivo real, no 'vacía'); nada escrito; A intacta", async () => {
    fotoA = await foto(A);
    const evento = (await db.query("select tabla, valor, activo from public.eventos_bot where usuario_id = $1", [B])).rows[0];
    assert.deepStrictEqual(evento, { tabla: T2, valor: 2000, activo: true });

    const r = await silencio(() => preparar("jwt-B"));
    assert.strictEqual(r.status, 503, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.ok, r.json.motivo, r.json.estado, r.json.filas, r.json.tabla, r.json.migracion],
        [false, "migracion_pendiente", "vacia", 0, T2, "027_tablas_cliente.sql"]);
    assert.strictEqual((await filas(B)).length + (await filas(B, T5K)).length, 0);
    assert.strictEqual(await foto(A), fotoA);
});

prueba("la causa no es el código: con UNIQUE(numero) un segundo 00-99 es imposible (23505), y la base no admite el de B sin la 033", async () => {
    const e = await aplicar(`begin; insert into public.${T2} (usuario_id, numero, estado) values ('${B}', '00', 'libre'); commit;`);
    assert.ok(e && e.code === "23505", e && e.message);
    assert.strictEqual((await filas(B)).length, 0);
});

prueba("la 027 se niega a aplicarse hoy (sin Parte A): no crea tablas_cliente ni la función", async () => {
    const e = await aplicar(M027);
    assert.ok(e && /027 abortada: .* no tiene RLS/.test(e.message), e && e.message);
    assert.strictEqual((await db.query("select to_regclass('public.tablas_cliente') is null as n")).rows[0].n, true);
});

prueba("Parte A aplicada: la 027 sigue negándose (UNIQUE(numero), falta la 033) y B sigue con migracion_pendiente", async () => {
    const eA = await aplicar(PARTE_A);
    assert.strictEqual(eA, null, eA && eA.message);
    const e = await aplicar(M027);
    assert.ok(e && /Aplica antes la 033/.test(e.message), e && e.message);
    const r = await silencio(() => preparar("jwt-B"));
    assert.strictEqual(r.json.motivo, "migracion_pendiente");
    assert.strictEqual(await foto(A), fotoA);
});

prueba("033 + 027 aplicadas: no tocan ninguna fila (A idéntica, B y C siguen sin cuadrícula)", async () => {
    const e33 = await aplicar(M033);
    assert.strictEqual(e33, null, e33 && e33.message);
    const e27 = await aplicar(M027);
    assert.strictEqual(e27, null, e27 && e27.message);
    assert.strictEqual(await foto(A), fotoA);
    assert.strictEqual((await filas(B)).length + (await filas(C)).length, 0);
});

prueba("cliente sin cuadrícula (C): el estado real es 'vacia' (0 de 100), no un error", async () => {
    const e = await tablasCliente.estadoCuadricula(C, 2000);
    assert.deepStrictEqual([e.ok, e.estado, e.filas, e.esperadas, e.tabla], [true, "vacia", 0, 100, T2]);
});

prueba("B abre /tablas/2000: recibe SU 00-99 (completa), aunque mande el usuarioId de A en el cuerpo; A idéntica", async () => {
    const r = await preparar("jwt-B", 2000, { usuarioId: A, usuario_id: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.ok, r.json.estado, r.json.filas, r.json.esperadas, r.json.tabla], [true, "completa", 100, 100, T2]);
    const deB = await filas(B);
    assert.deepStrictEqual(deB.map(f => f.numero), CUADRICULA);
    assert.ok(deB.every(f => f.estado === "libre" && f.comprador === null));
    assert.strictEqual(await foto(A), fotoA);
});

prueba("idempotente: repetir y lanzar 3 a la vez no crea ni repite ningún número", async () => {
    for (const r of [await preparar("jwt-B"), ...(await Promise.all([preparar("jwt-B"), preparar("jwt-B"), preparar("jwt-B")]))]) {
        assert.deepStrictEqual([r.status, r.json.estado, r.json.filas], [200, "completa", 100]);
    }
    const directo = await tablasCliente.inicializarCliente(B);
    assert.ok(directo.ok && directo.data.cuadriculas.every(c => c.estado === "existente" && c.filas === 100), JSON.stringify(directo));
    assert.strictEqual((await filas(B)).length, 100);
    assert.strictEqual((await filas(B, T5K)).length, 100);
    assert.strictEqual(await repetidos(), 0);
});

prueba("A (cuenta principal) abre /tablas/2000: 'completa' con SUS filas; no se inserta, reinicia ni cambia nada suyo", async () => {
    const r = await preparar("jwt-A");
    assert.deepStrictEqual([r.status, r.json.estado, r.json.filas], [200, "completa", 100]);
    const directo = await tablasCliente.inicializarCliente(A);
    assert.ok(directo.data.cuadriculas.every(c => c.estado === "existente"), JSON.stringify(directo));
    assert.strictEqual(await foto(A), fotoA);
});

prueba("C (sin cuadrícula ni evento) también recibe la suya; 3 clientes x 100 en la misma tabla física, sin repetidos", async () => {
    const r = await preparar("jwt-C");
    assert.deepStrictEqual([r.status, r.json.estado, r.json.filas], [200, "completa", 100]);
    assert.deepStrictEqual((await filas(C)).map(f => f.numero), CUADRICULA);
    const total = (await db.query(`select count(*)::int n, count(distinct usuario_id)::int u from public.${T2}`)).rows[0];
    assert.deepStrictEqual(total, { n: 300, u: 3 });
    assert.strictEqual(await repetidos(), 0);
});

prueba("la base rechaza un número repetido dentro del mismo cliente (UNIQUE(usuario_id, numero))", async () => {
    const e = await aplicar(`begin; insert into public.${T2} (usuario_id, numero, estado) values ('${B}', '13', 'libre'); commit;`);
    assert.ok(e && e.code === "23505", e && e.message);
});

prueba("aislamiento (RLS real): B lee solo sus 100; no puede cambiar el 13 pagado de A; A no ve nada de B", async () => {
    const leeB = (await como("authenticated", B, `select usuario_id, numero from public.${T2}`)).rows;
    assert.strictEqual(leeB.length, 100);
    assert.ok(leeB.every(f => f.usuario_id === B));

    const upd = await como("authenticated", B, `update public.${T2} set estado = 'libre', comprador = null where usuario_id = '${A}' and numero = '13'`);
    assert.strictEqual(upd.affectedRows, 0);
    const trampa = await aplicar(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${B}', true);
        update public.${T2} set usuario_id = '${A}' where usuario_id = '${B}' and numero = '50'; commit;`);
    assert.ok(trampa, "B no debe poder pasar una fila suya a A");
    assert.strictEqual(await foto(A), fotoA);

    const leeA = (await como("authenticated", A, `select usuario_id from public.${T2}`)).rows;
    assert.ok(leeA.length === 100 && leeA.every(f => f.usuario_id === A));
});

prueba("anon no lee ninguna cuadrícula y el navegador no puede llamar inicializar_tablas_cliente para nadie", async () => {
    const eAnon = await aplicar(`begin; set local role anon; select count(*) from public.${T2}; commit;`);
    assert.ok(eAnon && eAnon.code === "42501", eAnon && eAnon.message);
    const eFn = await aplicar(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${B}', true);
        select public.inicializar_tablas_cliente('${C}', '[]'::jsonb); commit;`);
    assert.ok(eFn && eFn.code === "42501", eFn && eFn.message);
});

prueba("cuadrícula incompleta: no se completa ni se corrige (se informa), y nada cambia", async () => {
    await db.exec(`delete from public.${T2} where usuario_id = '${C}' and numero = '99'`);
    const r = await preparar("jwt-C");
    assert.deepStrictEqual([r.status, r.json.ok, r.json.estado, r.json.filas], [200, true, "incompleta", 99]);
    assert.strictEqual((await filas(C)).length, 99);
});

prueba("sin sesión o con token inválido: 401 sin consultar ni crear nada", async () => {
    const antes = (await db.query(`select count(*)::int n from public.${T2}`)).rows[0].n;
    assert.strictEqual((await preparar(null)).status, 401);
    assert.strictEqual((await preparar("jwt-falso")).status, 401);
    assert.strictEqual((await db.query(`select count(*)::int n from public.${T2}`)).rows[0].n, antes);
});

// ------------------------------------------------------------- correr ---

(async () => {

    db = new PGlite();
    await db.exec(ENTORNO);

    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;

    let ok = 0, falla = 0;

    for (const { n, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${n}`);
        } catch (e) {
            falla++;
            console.log(`❌ ${n}\n   ${e.message}`);
        }
    }

    servidor.close();
    await db.close();

    console.log(`\nTOTAL: ${ok}/${ok + falla}`);
    process.exit(falla ? 1 : 0);

})();
