// ==========================================================================
// PRUEBAS — cada sorteo programado publica SU PROPIA fila de eventos_bot.
//
// Incidente 23/10/2026: al publicar «Antioqueñita Día» ($3.000) el
// publicador reescribió la fila del grupo que era de «Lotería de Bogotá»
// ($2.000, ya cerrada): 90 números (65 pagados, 25 reservados) quedaron sin
// evento. Ahora: sorteo distinto -> fila nueva; reintento del mismo sorteo
// (misma identidad) -> la misma fila; la del anterior queda intacta.
//
// Reales: sorteos/{servicio,publicador,disponibilidad,repo}.js,
// guardarEvento.js, consultarEvento.js, abrirGrupo.js, executionGuard.js,
// actualizarEvento.js, reservarNumeros.js, marcarReservasPagadasPorAdmin.js,
// consultarDisponibilidad.js. Simulados: Supabase (memoria), la 030
// (misma clasificación que la función SQL), el socket y el envío.
//
//     node backend/tests/sorteos/publicacionEventoNuevo.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [] };

// Simulación de reiniciar_tabla_cliente (030), igual que reinicioAlPublicar.test.js.
function reinicio030(args) {

    const filas = (fake.tablas[args.p_tabla] || []).filter(f => f.usuario_id === args.p_usuario);
    const eventos = (fake.tablas.eventos_bot || []).filter(e => e.usuario_id === args.p_usuario && (e.tabla === args.p_tabla || e.tabla == null));
    const activas = new Set(eventos.filter(e => e.activo !== false && e.identidad_evento_real).map(e => e.identidad_evento_real));

    const clase = (f) => {
        if (f.estado === "libre") return "libre";
        if (["reservado", "pagado"].includes(f.estado)) {
            if (f.identidad_evento_real && activas.has(f.identidad_evento_real)) return "protegido_activo";
            return f.identidad_evento_real ? "liberable" : "protegido_sin_sorteo";
        }
        if (f.estado === "en_proceso") return "protegido_en_proceso";
        return "conservado";
    };

    const huella = filas.filter(f => f.estado !== "libre").map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`).sort().join(",");
    const ocupadas = filas.filter(f => clase(f) !== "libre");
    const por = new Map();
    for (const f of ocupadas) {
        const k = `${f.identidad_evento_real}|${clase(f)}`;
        const g = por.get(k) || { identidad: f.identidad_evento_real || null, nombre_evento: null, clase: clase(f), reservados: 0, pagados: 0, otros: 0 };
        if (f.estado === "reservado") g.reservados++; else if (f.estado === "pagado") g.pagados++; else g.otros++;
        por.set(k, g);
    }
    const resumen = {
        liberables: ocupadas.filter(f => clase(f) === "liberable").length,
        protegidos: ocupadas.filter(f => clase(f).startsWith("protegido")).length,
        conservados: ocupadas.filter(f => clase(f) === "conservado").length,
        por_sorteo: [...por.values()]
    };

    if (resumen.protegidos > 0) return { data: { ok: false, motivo: "protegido", huella, ...resumen }, error: null };
    if (!args.p_aplicar) return { data: { ok: true, aplicado: false, huella, ...resumen }, error: null };
    if (args.p_huella !== huella) return { data: { ok: false, motivo: "tabla_cambio", huella, ...resumen }, error: null };

    let archivados = 0;
    for (const f of ocupadas.filter(x => clase(x) === "liberable")) {
        fake.tablas.reservas_archivo.push({ usuario_id: args.p_usuario, tabla: args.p_tabla, numero: f.numero, estado: f.estado, identidad_evento_real: f.identidad_evento_real, evento_id: f.evento_id, fila: { ...f } });
        Object.assign(f, { estado: "libre", identidad_evento_real: null, evento_id: null, usuario_global_id: null });
        archivados++;
    }
    return { data: { ok: true, aplicado: true, archivados, huella, ...resumen }, error: null };

}

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args }); return reinicio030(args); }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const repo = require(r("sorteos/repo.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento, consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { depsCompartir } = require("./compartirSimulado");
const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const { marcarReservasPagadasPorAdmin } = require(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"));
const { consultarDisponibilidad } = require(r("bot/funciones/consultas/consultarDisponibilidad.js"));

// Hoy 15/10; se publica el 22/10 08:00 (Colombia) y se juega ese día.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000 (configuración base)
const T1K = "reservas_dos_cifras";        // $2.000
const BOGOTA = "identidad-bogota-21-10";

const CONFIG_DISENO = (accent) => ({
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent },
    cells: {
        available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" },
        reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" },
        pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
});

// A: «Lotería de Bogotá» ya cerrada en g1 y g2 (filas de septiembre
// reutilizadas, como en producción), con 65 pagados + 25 reservados en la
// tabla de $2.000. B (otro cliente) tiene una fila cerrada MÁS RECIENTE en
// g1 y un sorteo activo en su propio grupo.
function escenario() {
    fake = crearFake();
    rpc.llamadas = [];
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }, { jid: "gb@g.us", nombre: "Grupo B" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    const cerrado = { activo: false, abierto: false, estado: "cerrado", cifras: 2, cantidad_numeros: 100, hora_fin: "22:30", hora_cierre: "22:26" };
    t.eventos_bot = [
        { ...cerrado, id: "ev-bogota-g1", grupo_id: "g1@g.us", usuario_id: A, identidad_evento_real: BOGOTA, nombre_evento: "Lotería de Bogotá", tabla: T1K, valor: "2000", fecha_evento: "2026-10-21", creado_en: new Date("2026-09-30T21:32:28Z") },
        { ...cerrado, id: "ev-bogota-g2", grupo_id: "g2@g.us", usuario_id: A, identidad_evento_real: BOGOTA, nombre_evento: "Lotería de Bogotá", tabla: T1K, valor: "2000", fecha_evento: "2026-10-21", creado_en: new Date("2026-09-03T18:16:32Z") },
        { ...cerrado, id: "ev-b-g1", grupo_id: "g1@g.us", usuario_id: B, identidad_evento_real: "b-viejo", nombre_evento: "Sorteo de B", tabla: T5K, valor: "5000", fecha_evento: "2026-10-21", creado_en: new Date("2026-10-21T12:00:00Z") },
        { ...cerrado, activo: true, abierto: true, estado: "abierto", id: "ev-b-activo", grupo_id: "gb@g.us", usuario_id: B, identidad_evento_real: "b-activo", nombre_evento: "Activo de B", tabla: T5K, valor: "5000", fecha_evento: "2026-10-22", creado_en: new Date("2026-10-22T10:00:00Z") }
    ];
    t.reservas_archivo = [];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    // Los 90 históricos: 00-64 pagados, 65-89 reservados (cliente u1 y u2).
    t[T1K].filter(f => f.usuario_id === A).slice(0, 90).forEach((f, i) => Object.assign(f, {
        estado: i < 65 ? "pagado" : "reservado", identidad_evento_real: BOGOTA, evento_id: "ev-bogota-g1",
        grupo_id: "g1@g.us", usuario_global_id: i % 2 ? "u1" : "u2", comprador: `Cliente ${i}`
    }));
    t[T5K].filter(f => f.usuario_id === B).slice(0, 5).forEach(f => Object.assign(f, {
        estado: "reservado", identidad_evento_real: "b-activo", evento_id: "ev-b-activo", usuario_global_id: "ub"
    }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us", "g2@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "{{nombre}} {{fecha}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

function deps(cambios = {}) {
    const enviados = [];
    const d = {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); },
        ...cambios
    };
    // El anuncio sale por «Compartir» (imagen + pie) hacia el mismo registro.
    Object.assign(d, depsCompartir(() => d.sendMessage), cambios);
    return { enviados, d };
}

const sock = (usuarioId = A) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {}
});

async function programar(datos, reinicio) {
    const c = await servicio.crearSorteo(A, datos);
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true, ...(reinicio ? { reinicio } : {}) });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

async function tick(ahora, d) {
    const log = console.log, tabla = console.table, dir = console.dir;
    console.log = console.table = console.dir = () => {};
    try { return await publicador.tick(sock(A), { ahora, deps: d }); } finally { Object.assign(console, { log, table: tabla, dir }); }
}

const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const filasEvento = (g, u = A) => fake.tablas.eventos_bot.filter(e => e.grupo_id === g && e.usuario_id === u);
const eventoDe = (s, g) => fake.tablas.eventos_bot.find(e => e.grupo_id === g && e.usuario_id === A && e.identidad_evento_real === s.identidad_evento_real);

// Foto de lo que NUNCA debe cambiar: los eventos de Bogotá, los de B y las
// filas no libres de la tabla de $2.000 y de B.
const historico = () => JSON.stringify({
    eventos: fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === BOGOTA || e.usuario_id === B),
    reservas: fake.tablas[T1K].filter(f => f.estado !== "libre"),
    deB: fake.tablas[T5K].filter(f => f.usuario_id === B)
});

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("1. sorteo nuevo -> fila nueva por grupo; la del sorteo anterior queda intacta", async () => {
    escenario();
    const antes = historico();
    const s = await programar(entrada());
    const d = deps();
    await tick(EN_PUBLICACION, d.d);

    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    for (const g of ["g1@g.us", "g2@g.us"]) {
        assert.strictEqual(filasEvento(g).length, 2, `${g}: Bogotá + Antioqueñita`);
        const nuevo = eventoDe(s, g);
        assert.ok(nuevo && nuevo.activo === true, `${g}: fila propia activa`);
        assert.ok(!nuevo.id.startsWith("ev-bogota"), "id nuevo, no el de Bogotá");
        assert.strictEqual(grupoDe(s.id, g).evento_bot_id, nuevo.id);
        assert.strictEqual(nuevo.nombre_evento, "Antioqueñita Día");
    }
    assert.strictEqual(historico(), antes, "Bogotá, sus 90 números y el cliente B no cambian");
    assert.deepStrictEqual(d.enviados.map(e => e.jid).sort(), ["g1@g.us", "g2@g.us"]);
});

prueba("2. la tabla física es la guardada en el sorteo (precio), no la del evento anterior; disponibilidad real", async () => {
    escenario();
    const s = await programar(entrada());
    assert.strictEqual(s.tabla, T5K);
    await tick(EN_PUBLICACION, deps().d);
    const nuevo = eventoDe(s, "g1@g.us");
    assert.strictEqual(nuevo.tabla, s.tabla);
    assert.strictEqual(String(nuevo.valor), "3000");
    const { numerosDisponibles, numerosOcupados } = await consultarDisponibilidad({ evento: nuevo });
    assert.strictEqual(numerosDisponibles.length, 100);
    assert.strictEqual(numerosOcupados.length, 0);
});

prueba("3. el diseño es del evento: el sorteo siguiente no cambia el del anterior", async () => {
    escenario();
    const s1 = await programar(entrada({ grupos: ["g1@g.us"], diseno: { origen: "preset", nombre: "Morado", config: CONFIG_DISENO("#8B7BFF") } }));
    await tick(EN_PUBLICACION, deps().d);
    const ev1 = eventoDe(s1, "g1@g.us");
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === ev1.id), { activo: false, estado: "cerrado" });   // cerró

    const PUB2 = new Date("2026-10-22T15:00:00Z");
    const s2 = await programar(entrada({ grupos: ["g1@g.us"], nombre: "Lotería de Boyacá", publicar_en: PUB2.toISOString(), diseno: { origen: "preset", nombre: "Verde", config: CONFIG_DISENO("#3DCB8F") } }));
    await tick(new Date(PUB2.getTime() + 60000), deps().d);
    const ev2 = eventoDe(s2, "g1@g.us");

    assert.ok(ev2 && ev2.id !== ev1.id);
    assert.strictEqual((await repo.disenoDelEvento(A, ev1.id)).data.config.theme.accent, "#8B7BFF");
    assert.strictEqual((await repo.disenoDelEvento(A, ev2.id)).data.config.theme.accent, "#3DCB8F");
    assert.strictEqual((await repo.disenoDelEvento(A, "ev-bogota-g1")).data, null, "Bogotá (detectado) sigue sin diseño propio");
    assert.strictEqual(filasEvento("g1@g.us").length, 3);
});

prueba("4. «Conservar»: nunca reinicia; con números de otro sorteo en SU tabla no publica ni escribe evento", async () => {
    escenario();
    const s = await programar(entrada());
    // Tras programar aparecen en la tabla de $3.000 números de otro sorteo ya cerrado.
    fake.tablas.eventos_bot.push({ id: "ev-viejo-5k", grupo_id: "g9@g.us", usuario_id: A, activo: false, estado: "cerrado", identidad_evento_real: "viejo-5k", tabla: T5K, creado_en: new Date("2026-10-01T00:00:00Z") });
    fake.tablas[T5K].filter(f => f.usuario_id === A).slice(0, 2).forEach(f => Object.assign(f, { estado: "pagado", identidad_evento_real: "viejo-5k", evento_id: "ev-viejo-5k" }));
    const t5kAntes = JSON.stringify(fake.tablas[T5K]);
    const eventosAntes = fake.tablas.eventos_bot.length;

    await tick(EN_PUBLICACION, deps().d);

    assert.strictEqual(rpc.llamadas.length, 0, "ninguna llamada a la 030");
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), t5kAntes, "la tabla no se toca");
    assert.strictEqual(fake.tablas.eventos_bot.length, eventosAntes, "ningún evento nuevo");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("5a. «Reiniciar»: usa la 030; archiva con su identidad y evento originales; evento nuevo; el anterior intacto", async () => {
    escenario();
    fake.tablas.eventos_bot.push({ id: "ev-viejo-5k", grupo_id: "g1@g.us", usuario_id: A, activo: false, estado: "cerrado", identidad_evento_real: "viejo-5k", nombre_evento: "Manizales", tabla: T5K, creado_en: new Date("2026-10-10T00:00:00Z") });
    fake.tablas[T5K].filter(f => f.usuario_id === A).slice(0, 3).forEach(f => Object.assign(f, { estado: "pagado", identidad_evento_real: "viejo-5k", evento_id: "ev-viejo-5k" }));
    const viejo = JSON.stringify(fake.tablas.eventos_bot.find(e => e.id === "ev-viejo-5k"));

    const s = await programar(entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    await tick(EN_PUBLICACION, deps().d);

    assert.ok(rpc.llamadas.some(l => l.args.p_aplicar === true && l.args.p_tabla === T5K), "reinicio aplicado sobre la tabla del sorteo");
    assert.strictEqual(fake.tablas.reservas_archivo.length, 3);
    assert.ok(fake.tablas.reservas_archivo.every(a => a.identidad_evento_real === "viejo-5k" && a.evento_id === "ev-viejo-5k"));
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot.find(e => e.id === "ev-viejo-5k")), viejo);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.ok(eventoDe(s, "g1@g.us"));
});

prueba("5b. «Reiniciar» bloqueado por la 030 (pago en proceso): no publica, no escribe evento, no toca la tabla", async () => {
    escenario();
    const s = await programar(entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    // Aparece después de programar (al confirmar ya se habría rechazado).
    fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "07").estado = "en_proceso";
    const t5kAntes = JSON.stringify(fake.tablas[T5K]);
    const eventosAntes = JSON.stringify(fake.tablas.eventos_bot);
    const d = deps();
    await tick(EN_PUBLICACION, d.d);
    assert.strictEqual(d.enviados.length, 0);
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), t5kAntes);
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), eventosAntes);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("6. reservas y pagos del sorteo nuevo no tocan los 90 históricos (estado, evento_id, identidad)", async () => {
    escenario();
    const s = await programar(entrada());
    await tick(EN_PUBLICACION, deps().d);
    const antes = historico();

    // u1 tiene reservas pendientes de Bogotá y ahora reserva y paga en Antioqueñita.
    const evento = await consultarEvento("g1@g.us", A);
    assert.strictEqual(evento.identidad_evento_real, s.identidad_evento_real);
    await reservarNumeros({ evento, numeros: ["10"], usuario: { id: "u1" }, comprador: "Cliente", contacto: "573" });
    const fila = fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "10");
    assert.strictEqual(fila.estado, "reservado");
    assert.strictEqual(fila.evento_id, evento.id);
    assert.strictEqual(fila.identidad_evento_real, s.identidad_evento_real);

    const log = console.log; console.log = () => {};
    try { await marcarReservasPagadasPorAdmin({ evento, usuario: { id: "u1" }, realizadoPor: "admin" }); } finally { console.log = log; }
    assert.strictEqual(fila.estado, "pagado");
    assert.strictEqual(historico(), antes, "los 25 reservados de Bogotá de u1 siguen reservados");
    assert.strictEqual(fake.tablas[T1K].filter(f => f.estado === "pagado").length, 65);
    assert.strictEqual(fake.tablas[T1K].filter(f => f.estado === "reservado").length, 25);
});

prueba("7. reintento del mismo sorteo (envío fallido + reintento manual) reutiliza su fila: sin duplicados", async () => {
    escenario();
    const s = await programar(entrada());
    const falla = deps({ sendMessage: async ({ jid }) => { if (jid === "g2@g.us") throw new Error("Connection Closed (simulado)"); } });
    await tick(EN_PUBLICACION, falla.d);
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "requiere_revision");
    const fila = eventoDe(s, "g2@g.us");
    assert.ok(fila, "la fila del sorteo existe tras el primer intento");

    await servicio.reintentarGrupo(A, s.id, "g2@g.us");
    const sano = deps();
    await tick(EN_PUBLICACION, sano.d);
    await tick(new Date(EN_PUBLICACION.getTime() + 30000), sano.d);

    assert.deepStrictEqual(sano.enviados.map(e => e.jid), ["g2@g.us"]);
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "publicado");
    const delSorteo = filasEvento("g2@g.us").filter(e => e.identidad_evento_real === s.identidad_evento_real);
    assert.strictEqual(delSorteo.length, 1, "una sola fila por grupo y sorteo");
    assert.strictEqual(delSorteo[0].id, fila.id);
    assert.strictEqual(filasEvento("g2@g.us").length, 2);
});

prueba("8. fallos de lectura, guardado o envío nunca terminan en «publicado»", async () => {
    // Lectura del evento del grupo falla.
    escenario();
    let s = await programar(entrada({ grupos: ["g1@g.us"] }));
    const eventosAntes = JSON.stringify(fake.tablas.eventos_bot);
    await tick(EN_PUBLICACION, deps({ consultarEventoDelSorteo: async () => ({ ok: false }) }).d);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), eventosAntes, "no escribe ningún evento");

    // guardarEvento falla.
    escenario();
    s = await programar(entrada({ grupos: ["g1@g.us"] }));
    const d = deps({ guardarEvento: async () => null });
    await tick(EN_PUBLICACION, d.d);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "fallido");
    assert.strictEqual(d.enviados.length, 0);
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");

    // El envío falla: en revisión, nunca «publicado»; el evento anterior intacto.
    escenario();
    const antes = historico();
    s = await programar(entrada({ grupos: ["g1@g.us"] }));
    await tick(EN_PUBLICACION, deps({ sendMessage: async () => { throw new Error("Connection Closed (simulado)"); } }).d);
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
    assert.notStrictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(historico(), antes);
});

prueba("9. clientes y grupos no se mezclan: consultarEvento nunca devuelve la fila de otro cliente", async () => {
    escenario();
    const s = await programar(entrada());
    const antes = historico();
    await tick(EN_PUBLICACION, deps().d);

    assert.strictEqual((await consultarEvento("g1@g.us", A)).identidad_evento_real, s.identidad_evento_real);
    assert.strictEqual((await consultarEvento("g1@g.us", B)).id, "ev-b-g1", "B solo ve su fila en g1");
    assert.strictEqual((await consultarEvento("gb@g.us", B)).id, "ev-b-activo");
    assert.strictEqual(await consultarEvento("gb@g.us", A), null);
    assert.strictEqual(filasEvento("gb@g.us", B).length, 1);
    assert.strictEqual(historico(), antes);
});

prueba("10. bot y pagos resuelven el evento correcto: activo; sin activo, el más reciente (nunca Bogotá)", async () => {
    escenario();
    // Antes de publicar: el más reciente de A en g1 es Bogotá (único), como hoy.
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, "ev-bogota-g1");

    const s = await programar(entrada());
    await tick(EN_PUBLICACION, deps().d);
    const nuevo = eventoDe(s, "g1@g.us");
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, nuevo.id, "el activo");

    // Cierra el nuevo: los pagos posteriores al cierre siguen yendo a él.
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === nuevo.id), { activo: false, estado: "cerrado" });
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, nuevo.id, "sin activo: el más reciente");

    // Una fila antigua marcada activa por error tiene prioridad sobre una
    // cerrada (mismo criterio que el bot aplica hoy con activo = true).
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === "ev-bogota-g1"), { activo: true });
    assert.strictEqual((await consultarEvento("g1@g.us", A)).id, "ev-bogota-g1");
});

prueba("11. con varias filas en el grupo, un sorteo ACTIVO detrás de una cerrada sigue bloqueando la publicación", async () => {
    escenario();
    const s = await programar(entrada({ grupos: ["g1@g.us"] }));
    // Después de programar, el grupo abre otro sorteo (fila nueva); la de
    // Bogotá (cerrada) sigue primero en la tabla.
    fake.tablas.eventos_bot.push({ id: "ev-boyaca", grupo_id: "g1@g.us", usuario_id: A, activo: true, abierto: true, estado: "abierto", identidad_evento_real: "boyaca", nombre_evento: "Boyacá", tabla: T1K, valor: "2000", fecha_evento: "2026-10-22", hora_fin: "22:30", hora_cierre: "22:26", creado_en: new Date("2026-10-22T12:00:00Z") });
    const eventosAntes = JSON.stringify(fake.tablas.eventos_bot);
    const d = deps();
    await tick(EN_PUBLICACION, d.d);
    const g = grupoDe(s.id, "g1@g.us");
    assert.strictEqual(d.enviados.length, 0);
    assert.strictEqual(g.estado, "pendiente");
    assert.ok(/^En espera: .*Boyacá/.test(g.ultimo_error), g.ultimo_error);
    assert.strictEqual(JSON.stringify(fake.tablas.eventos_bot), eventosAntes, "no reemplaza ni crea nada");
});

// ---------------------------------------------------------------- runner ---

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    process.exit(falla ? 1 : 0);
})();
