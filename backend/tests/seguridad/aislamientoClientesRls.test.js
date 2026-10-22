// ==========================================================================
// PRUEBA SQL — aislamiento entre clientes A y B en las tablas que el panel
// toca DIRECTAMENTE desde el navegador (clave pública + JWT del usuario):
// eventos_bot, sesiones, reservas_dos_cifras, 5k_15k_reservas_2_cifras y
// mensajes_grupos_sorteos. Postgres real en memoria (PGlite): las políticas
// RLS y los permisos por columna se evalúan de verdad, no hay mocks.
//
// Aplica, en este orden, las propuestas NO aplicadas en producción:
//   docs/activacion/propuesta_rls_tablas_antiguas.sql  (Parte A)
//   docs/activacion/parte_d_sesiones_columnas.sql      (Parte D)
//   docs/activacion/parte_e_mensajes_por_cliente.sql   (Parte E, diseño:
//       columna + el bloque RLS comentado del paso 4)
//
// Las consultas de "B intenta…" son las mismas que hace el panel
// (services/tablas/*, services/sessions/*), pero apuntando a A: es lo que
// haría alguien que edite las peticiones en el navegador.
//
// LÍMITE: el esquema es una réplica de las columnas que usa el código; el
// real de producción no está en el repo (sesiones/eventos_bot/reservas son
// tablas heredadas). Validar allí con las consultas de solo lectura de cada
// archivo antes de aplicar.
//
//     PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//         node backend/tests/seguridad/aislamientoClientesRls.test.js
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

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "activacion");
const leer = f => fs.readFileSync(path.join(DOCS, f), "utf8");

const PARTE_A = leer("propuesta_rls_tablas_antiguas.sql");
const PARTE_D = leer("parte_d_sesiones_columnas.sql");
const PARTE_E_TEXTO = leer("parte_e_mensajes_por_cliente.sql");

// Parte E: el bloque ejecutable (columna) + el paso 4 comentado, descomentado.
const PARTE_E_COLUMNA = PARTE_E_TEXTO.split("-- ---------------------------------------------- PASO 4")[0];
const PARTE_E_RLS = PARTE_E_TEXTO
    .split("PASO 4 (más adelante) ---")[1]
    .split("-- VUELTA ATRÁS del paso 4")[0]
    .split("\n")
    .filter(l => l.startsWith("-- "))
    .map(l => l.slice(3))
    .join("\n");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SES_A = "11111111-0000-4000-8000-000000000001";
const SES_B = "22222222-0000-4000-8000-000000000002";
const T5K = '"5k_15k_reservas_2_cifras"';

const COLUMNAS_RESERVA = `
    id serial primary key, numero text, estado text, usuario_id uuid,
    comprador text, contacto text, contacto_lower text, nombre text, telefono text, lib text,
    grupo_id text, grupo_nombre text, evento_id text, nombre_evento text,
    fecha_reserva text, hora_reserva text, fecha_pago text, hora_pago text,
    temporal_por text, bloqueado_hasta timestamptz, usuario_global_id uuid,
    telefono_bot text, ip_reserva text`;

const ENTORNO = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.eventos_bot (id serial primary key, usuario_id uuid, grupo_id text, tabla text, activo boolean, fecha_evento date, creado_en timestamptz default now());
    create table public.sesiones (
        id uuid primary key default gen_random_uuid(), usuario_id uuid, nombre text,
        estado text default 'desconectado', activa boolean default false, principal boolean default false,
        preferida boolean default false, qr text, telefono text, created_at timestamptz default now());
    create table public.reservas_dos_cifras (${COLUMNAS_RESERVA});
    create table public.${T5K} (${COLUMNAS_RESERVA});
    create table public.mensajes_grupos_sorteos (
        id serial primary key, mensaje_id text, grupo_id text, grupo_nombre text,
        usuario_id uuid, telefono text, lid text, nombre text, texto text,
        timestamp_whatsapp bigint, creado_en timestamptz default now());

    insert into public.eventos_bot (usuario_id, grupo_id, tabla, activo, fecha_evento) values
        ('${A}', 'gA@g.us', '5k_15k_reservas_2_cifras', true, '2026-10-21'),
        ('${B}', 'gB@g.us', '5k_15k_reservas_2_cifras', true, '2026-10-21'),
        (null,   'gX@g.us', '5k_15k_reservas_2_cifras', true, '2026-10-21');
    insert into public.sesiones (id, usuario_id, nombre, estado, activa, principal, telefono) values
        ('${SES_A}', '${A}', 'bot A', 'conectado', true, true, '573000000001'),
        ('${SES_B}', '${B}', 'bot B', 'desconectado', false, false, null);
    insert into public.${T5K} (numero, estado, usuario_id, comprador, contacto) values
        ('01', 'reservado', '${A}', 'Cliente de A', '3000000001'),
        ('02', 'pagado',    '${A}', 'Otro de A',    '3000000003'),
        ('03', 'libre',     '${A}', null, null),
        ('01', 'reservado', '${B}', 'Cliente de B', '3000000002'),
        ('09', 'reservado', null,   'Sin dueño',    '3000000009');
    insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('05', 'reservado', '${A}');
    insert into public.mensajes_grupos_sorteos (mensaje_id, grupo_id, usuario_id, telefono, texto) values
        ('m1', 'gA@g.us', 'c0000000-0000-4000-8000-000000000001', '3000000001', 'quiero el 01'),
        ('m2', 'gB@g.us', 'c0000000-0000-4000-8000-000000000002', '3000000002', 'quiero el 01'),
        ('m3', 'gV@g.us', null, null, 'mensaje antiguo sin dueño');
`;

const abiertas = [];

async function crearDb({ partes = ["A", "D", "E"] } = {}) {
    const db = new PGlite();
    abiertas.push(db);
    await db.exec(ENTORNO);
    if (partes.includes("A")) await db.exec(PARTE_A);
    if (partes.includes("D")) await db.exec(PARTE_D);
    if (partes.includes("E")) {
        await db.exec(PARTE_E_COLUMNA);
        // Paso 2/3 de la Parte E: el bot ya guarda el dueño de la sesión receptora.
        await db.exec(`update public.mensajes_grupos_sorteos set cliente_usuario_id = '${A}' where mensaje_id = 'm1';
                       update public.mensajes_grupos_sorteos set cliente_usuario_id = '${B}' where mensaje_id = 'm2';`);
        await db.exec(PARTE_E_RLS);
    }
    return db;
}

async function como(db, rol, usuario, sql) {
    await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${usuario || ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); }
}

const fila = async (db, sql) => (await db.query(sql)).rows[0];

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ── Estado actual (sin las propuestas) ───────────────────────────────────

prueba("ESTADO ACTUAL reproducido (sin propuestas): B lee los sorteos de A y se apropia de su sesión", async () => {
    const db = await crearDb({ partes: [] });
    const ev = await como(db, "authenticated", B, `select usuario_id from public.eventos_bot where usuario_id = '${A}'`);
    assert.strictEqual(ev.length, 1, "B ve el sorteo de A");
    const r = await como(db, "authenticated", B, `update public.sesiones set usuario_id = '${B}' where id = '${SES_A}' returning id`);
    assert.strictEqual(r.length, 1, "B se reasigna la sesión de A");
    const chats = await como(db, "anon", null, "select texto, telefono from public.mensajes_grupos_sorteos");
    assert.strictEqual(chats.length, 3, "anon lee chats y teléfonos");
});

// ── Sorteos (eventos_bot) ────────────────────────────────────────────────

prueba("sorteos: cada cliente ve solo los suyos, aunque pida los del otro; anon nada", async () => {
    const db = await crearDb();
    const todosB = await como(db, "authenticated", B, "select usuario_id, grupo_id from public.eventos_bot");
    assert.deepStrictEqual(todosB.map(e => e.grupo_id), ["gB@g.us"]);
    assert.strictEqual((await como(db, "authenticated", B, `select * from public.eventos_bot where usuario_id = '${A}'`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", A, "select * from public.eventos_bot")).length, 1);
    await assert.rejects(como(db, "anon", null, "select * from public.eventos_bot"), /permission denied/i);
});

prueba("sorteos: B no puede modificar, cancelar ni borrar los de A (ni los suyos: solo el bot escribe)", async () => {
    const db = await crearDb();
    assert.strictEqual((await como(db, "authenticated", B, `update public.eventos_bot set activo = false where usuario_id = '${A}' returning id`)).length, 0);
    assert.strictEqual((await como(db, "authenticated", B, `delete from public.eventos_bot where usuario_id = '${A}' returning id`)).length, 0);
    assert.strictEqual((await fila(db, `select activo from public.eventos_bot where usuario_id = '${A}'`)).activo, true);
});

// ── Sesiones ─────────────────────────────────────────────────────────────

prueba("sesiones: B no ve ni toca la sesión de A", async () => {
    const db = await crearDb();
    assert.deepStrictEqual((await como(db, "authenticated", B, "select id from public.sesiones")).map(s => s.id), [SES_B]);
    assert.strictEqual((await como(db, "authenticated", B, `update public.sesiones set nombre = 'mía' where id = '${SES_A}' returning id`)).length, 0);
    const a = await fila(db, `select usuario_id, nombre, activa from public.sesiones where id = '${SES_A}'`);
    assert.deepStrictEqual(a, { usuario_id: A, nombre: "bot A", activa: true });
});

prueba("sesiones: nadie cambia desde el navegador usuario_id, activa, principal, preferida, estado, qr ni telefono (ni en su propia fila)", async () => {
    const db = await crearDb();
    for (const set of [`usuario_id = '${A}'`, "activa = true", "principal = true", "preferida = true", "estado = 'conectado'", "qr = 'x'", "telefono = '57300'"]) {
        await assert.rejects(
            como(db, "authenticated", B, `update public.sesiones set ${set} where id = '${SES_B}'`),
            /permission denied/i, set
        );
    }
    await assert.rejects(como(db, "authenticated", A, `update public.sesiones set usuario_id = '${B}' where id = '${SES_A}'`), /permission denied/i);
});

prueba("sesiones: renombrar la propia funciona (services/sessions/updateSession.ts)", async () => {
    const db = await crearDb();
    const r = await como(db, "authenticated", B, `update public.sesiones set nombre = 'Ventas' where id = '${SES_B}' returning nombre`);
    assert.deepStrictEqual(r, [{ nombre: "Ventas" }]);
});

prueba("sesiones: alta desde el panel (payload real de createSession) nace desconectada, no activa ni principal", async () => {
    const db = await crearDb();
    await como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${B}', 'Nueva sesión', 'desconectado', false)`);
    // Intento de colarse: aunque mande principal/estado distintos, se fuerzan.
    await como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, estado, principal) values ('${B}', 'trampa', 'conectado', true)`);
    const t = await fila(db, "select estado, principal, activa, preferida from public.sesiones where nombre = 'trampa'");
    assert.deepStrictEqual(t, { estado: "desconectado", principal: false, activa: false, preferida: false });
});

prueba("sesiones: alta con activa/qr/telefono/id elegido o a nombre de otro cliente -> rechazada", async () => {
    const db = await crearDb();
    await assert.rejects(como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre, activa) values ('${B}', 'x', true)`), /permission denied/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.sesiones (id, usuario_id, nombre) values ('33333333-0000-4000-8000-000000000003', '${B}', 'x')`), /permission denied/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.sesiones (usuario_id, nombre) values ('${A}', 'para A')`), /row-level security/i);
});

prueba("sesiones: borrar directamente desde el navegador -> rechazado (ni la propia; va por el backend)", async () => {
    const db = await crearDb();
    await assert.rejects(como(db, "authenticated", B, `delete from public.sesiones where id = '${SES_B}'`), /permission denied/i);
    await assert.rejects(como(db, "authenticated", B, `delete from public.sesiones where id = '${SES_A}'`), /permission denied/i);
    assert.strictEqual((await fila(db, "select count(*)::int n from public.sesiones")).n, 2);
});

prueba("sesiones: el bot (service_role) sigue activando, cambiando estado y borrando", async () => {
    const db = await crearDb();
    await como(db, "service_role", null, `update public.sesiones set activa = true, principal = true, estado = 'conectado', qr = null where id = '${SES_B}'`);
    await como(db, "service_role", null, `insert into public.sesiones (usuario_id, nombre, activa, estado) values ('${B}', 'del bot', true, 'conectado')`);
    const s = await fila(db, "select activa, estado from public.sesiones where nombre = 'del bot'");
    assert.deepStrictEqual(s, { activa: true, estado: "conectado" }, "el trigger no toca al bot");
    await como(db, "service_role", null, "delete from public.sesiones where nombre = 'del bot'");
});

// ── Reservas ─────────────────────────────────────────────────────────────

prueba("reservas: B no puede marcar pagada, liberar, bloquear ni reiniciar las de A (consultas reales del panel apuntando a A)", async () => {
    const db = await crearDb();
    const ops = [
        `update public.${T5K} set estado = 'pagado', fecha_pago = '2026-10-21', hora_pago = '10:00:00' where numero = '01' and usuario_id = '${A}' and estado = 'reservado' returning id`,
        `update public.${T5K} set estado = 'libre', comprador = null, contacto = null, nombre = null, telefono = null where numero = '02' and usuario_id = '${A}' returning id`,
        `update public.${T5K} set estado = 'bloqueado', temporal_por = 'x' where numero = '03' and usuario_id = '${A}' and estado = 'libre' returning id`,
        `update public.${T5K} set estado = 'libre', comprador = null where usuario_id = '${A}' returning id`,
        `update public.reservas_dos_cifras set estado = 'libre' where usuario_id = '${A}' returning id`,
        `delete from public.${T5K} where usuario_id = '${A}' returning id`
    ];
    for (const sql of ops) {
        const r = await como(db, "authenticated", B, sql).catch(e => e);
        if (r instanceof Error) assert.match(r.message, /permission denied|row-level security/i, sql);
        else assert.strictEqual(r.length, 0, sql);
    }
    // "Reiniciar todo" sin filtro: solo alcanza las filas de B.
    const sinFiltro = await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre', comprador = null returning usuario_id`);
    assert.deepStrictEqual(sinFiltro.map(x => x.usuario_id), [B]);
    const filasA = await db.query(`select numero, estado, comprador from public.${T5K} where usuario_id = '${A}' order by numero`);
    assert.deepStrictEqual(filasA.rows, [
        { numero: "01", estado: "reservado", comprador: "Cliente de A" },
        { numero: "02", estado: "pagado", comprador: "Otro de A" },
        { numero: "03", estado: "libre", comprador: null }
    ], "las reservas de A siguen intactas");
    assert.strictEqual((await fila(db, `select estado from public.reservas_dos_cifras where usuario_id = '${A}'`)).estado, "reservado");
});

prueba("reservas: B no puede pasarse las filas de A ni regalarle las suyas (usuario_id)", async () => {
    const db = await crearDb();
    assert.strictEqual((await como(db, "authenticated", B, `update public.${T5K} set usuario_id = '${B}' where usuario_id = '${A}' returning id`)).length, 0);
    await assert.rejects(como(db, "authenticated", B, `update public.${T5K} set usuario_id = '${A}' where usuario_id = '${B}'`), /row-level security/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.${T5K} (numero, estado, usuario_id) values ('50', 'libre', '${A}')`), /row-level security/i);
});

prueba("reservas: el flujo legítimo de B sobre lo suyo funciona (pagar, liberar, reiniciar)", async () => {
    const db = await crearDb();
    const pagada = await como(db, "authenticated", B, `update public.${T5K} set estado = 'pagado' where numero = '01' and usuario_id = '${B}' and estado = 'reservado' returning id`);
    assert.strictEqual(pagada.length, 1);
    const liberada = await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre', comprador = null where numero = '01' and usuario_id = '${B}' returning id`);
    assert.strictEqual(liberada.length, 1);
    await como(db, "authenticated", B, `update public.${T5K} set estado = 'libre' where usuario_id = '${B}'`);
    await como(db, "authenticated", B, `insert into public.reservas_dos_cifras (numero, estado, usuario_id) values ('00', 'libre', '${B}')`);
});

prueba("filas sin dueño (usuario_id NULL): invisibles e intocables para A y B; el bot sí las ve", async () => {
    const db = await crearDb();
    for (const u of [A, B]) {
        assert.strictEqual((await como(db, "authenticated", u, `select * from public.${T5K} where usuario_id is null`)).length, 0);
        assert.strictEqual((await como(db, "authenticated", u, `update public.${T5K} set estado = 'libre' where usuario_id is null returning id`)).length, 0);
        assert.strictEqual((await como(db, "authenticated", u, "select * from public.eventos_bot where usuario_id is null")).length, 0);
    }
    assert.strictEqual((await como(db, "service_role", null, `select * from public.${T5K} where usuario_id is null`)).length, 1);
});

// ── Chats (Parte E, diseño) ──────────────────────────────────────────────

prueba("chats (Parte E): cada cliente lee solo los mensajes que recibió su bot; sin dueño: nadie; anon nada", async () => {
    const db = await crearDb();
    assert.deepStrictEqual((await como(db, "authenticated", A, "select mensaje_id from public.mensajes_grupos_sorteos")).map(m => m.mensaje_id), ["m1"]);
    assert.deepStrictEqual((await como(db, "authenticated", B, "select mensaje_id, telefono from public.mensajes_grupos_sorteos where grupo_id = 'gA@g.us'")), []);
    await assert.rejects(como(db, "anon", null, "select * from public.mensajes_grupos_sorteos"), /permission denied/i);
    await assert.rejects(como(db, "authenticated", B, `insert into public.mensajes_grupos_sorteos (mensaje_id, grupo_id, cliente_usuario_id) values ('m9', 'gA@g.us', '${A}')`), /permission denied/i);
    assert.strictEqual((await como(db, "service_role", null, "select * from public.mensajes_grupos_sorteos")).length, 3, "el bot no se ve afectado");
});

prueba("chats (Parte E): el usuario_id del PARTICIPANTE no da acceso (no es el cliente)", async () => {
    const db = await crearDb();
    const participante = "c0000000-0000-4000-8000-000000000001";
    assert.strictEqual((await como(db, "authenticated", participante, "select * from public.mensajes_grupos_sorteos")).length, 0);
});

// ── Guardias ─────────────────────────────────────────────────────────────

prueba("Parte D sin Parte A -> aborta y no aplica nada", async () => {
    const db = await crearDb({ partes: [] });
    let error = null;
    try { await db.exec(PARTE_D); } catch (e) { error = e; }
    assert.ok(error && /Parte D abortada/.test(error.message));
    await db.exec("rollback;");
    const r = await como(db, "authenticated", B, `update public.sesiones set activa = true where id = '${SES_B}' returning id`);
    assert.strictEqual(r.length, 1, "nada cambió (sigue el estado actual)");
});

prueba("Partes A, D y E idempotentes: aplicarlas dos veces no falla", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await db.exec(PARTE_D);
    await db.exec(PARTE_E_COLUMNA);
    await db.exec(PARTE_E_RLS);
});

prueba("Parte A vuelve a aplicarse tras D sin reabrir permisos de columna en sesiones", async () => {
    const db = await crearDb();
    await db.exec(PARTE_A);
    await assert.rejects(como(db, "authenticated", B, `update public.sesiones set activa = true where id = '${SES_B}'`), /permission denied/i);
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
