// ==========================================================================
// PRUEBAS — «Reiniciar la tabla antes de publicar»: el reinicio elegido al
// programar un sorteo se hace en el PROCESO DE PUBLICACIÓN (un minuto antes
// del anuncio), nunca al guardar ni al confirmar.
//
//   G. Programar (con o sin reinicio) no modifica números, reservas ni pagos.
//   P. Al llegar la publicación: se revalida y se reinicia solo si está
//      autorizado y es seguro; luego se publica.
//   S. Reserva o pago nuevo antes de publicar: no se reinicia ni se publica.
//   I. Reintentos del publicador (o dos procesos): un solo reinicio.
//   C. Otro cliente nunca modifica esta tabla; sorteo alterado: no se toca.
//   F. El anuncio solo sale si el estado final de la tabla lo permite.
//
// Servicio y publicador REALES; Supabase en memoria + la función de la 030
// simulada con su MISMA clasificación (liberable / protegido_* / conservado),
// huella y archivo de respaldo (reservas_archivo). Ninguna toca la base real
// ni WhatsApp.
//
//     node backend/tests/sorteos/reinicioAlPublicar.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [], antesDeAplicar: null };

// Simulación de reiniciar_tabla_cliente (030): misma clasificación que la
// función SQL, huella de la tabla y archivo antes de liberar.
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
        if (f.estado === "bloqueado") return args.p_liberar_bloqueados ? "liberable" : "conservado";
        if (f.estado === "en_proceso") return "protegido_en_proceso";
        return "protegido_desconocido";
    };

    const huella = filas.filter(f => f.estado !== "libre")
        .map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`).sort().join(",");

    const ocupadas = filas.filter(f => clase(f) !== "libre");
    const grupos = new Map();
    for (const f of ocupadas) {
        const k = `${f.identidad_evento_real}|${clase(f)}`;
        const g = grupos.get(k) || { identidad: f.identidad_evento_real || null, nombre_evento: f.nombre_evento || null, clase: clase(f), reservados: 0, pagados: 0, otros: 0 };
        if (f.estado === "reservado") g.reservados++; else if (f.estado === "pagado") g.pagados++; else g.otros++;
        grupos.set(k, g);
    }

    const resumen = {
        liberables: ocupadas.filter(f => clase(f) === "liberable").length,
        protegidos: ocupadas.filter(f => clase(f).startsWith("protegido")).length,
        conservados: ocupadas.filter(f => clase(f) === "conservado").length,
        por_sorteo: [...grupos.values()]
    };

    if (resumen.protegidos > 0) return { data: { ok: false, motivo: "protegido", huella, ...resumen }, error: null };
    if (!args.p_aplicar) return { data: { ok: true, aplicado: false, huella, ...resumen }, error: null };
    if (args.p_huella !== huella) return { data: { ok: false, motivo: "tabla_cambio", huella, ...resumen }, error: null };

    let archivados = 0;
    for (const f of ocupadas.filter(x => clase(x) === "liberable")) {
        fake.tablas.reservas_archivo.push({ usuario_id: args.p_usuario, tabla: args.p_tabla, numero: f.numero, estado: f.estado, identidad: f.identidad_evento_real, sorteo_id: args.p_sorteo, fila: { ...f } });
        Object.assign(f, { estado: "libre", identidad_evento_real: null, evento_id: null, nombre_evento: null, comprador: null });
        archivados++;
    }
    return { data: { ok: true, aplicado: true, archivados, huella, ...resumen }, error: null };

}

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async (nombre, args) => {
            rpc.llamadas.push({ nombre, args });
            if (args.p_aplicar && rpc.antesDeAplicar) { const f = rpc.antesDeAplicar; rpc.antesDeAplicar = null; f(); }
            return reinicio030(args);
        }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// Hoy 15/10 10:00 Colombia; se publica el 22/10 08:00 y se juega ese día.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const seg = (s) => new Date(PUBLICAR.getTime() + s * 1000);
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T1K = "reservas_dos_cifras";

// La tabla de $5.000 de A tiene 3 pagados y 2 reservados del sorteo
// ANTERIOR (ya cerrado: activo = false). La de B, 2 reservados de su propio
// sorteo anterior.
function escenario() {
    fake = crearFake();
    rpc.llamadas = [];
    rpc.antesDeAplicar = null;
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "gb@g.us", nombre: "Grupo B" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", activa: true }
    ];
    t.eventos_bot = [
        { id: "ev-ant-a", grupo_id: "g1@g.us", usuario_id: A, activo: false, estado: "cerrado", identidad_evento_real: "anterior-a", nombre_evento: "Boyacá 14/10", tabla: T5K, valor: "5000", cifras: 2, cantidad_numeros: 100, fecha_evento: "2026-10-14", hora_fin: "22:30", hora_cierre: "22:26" },
        { id: "ev-ant-b", grupo_id: "gb@g.us", usuario_id: B, activo: false, estado: "cerrado", identidad_evento_real: "anterior-b", nombre_evento: "Cauca 14/10", tabla: T5K, valor: "5000", cifras: 2, cantidad_numeros: 100, fecha_evento: "2026-10-14", hora_fin: "22:30", hora_cierre: "22:26" }
    ];
    t.reservas_archivo = [];
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    t[T5K].filter(f => f.usuario_id === A).slice(0, 5).forEach((f, i) => Object.assign(f, {
        estado: i < 3 ? "pagado" : "reservado", identidad_evento_real: "anterior-a", evento_id: "ev-ant-a", nombre_evento: "Boyacá 14/10", comprador: `Cliente ${i}`
    }));
    t[T5K].filter(f => f.usuario_id === B).slice(0, 2).forEach(f => Object.assign(f, {
        estado: "reservado", identidad_evento_real: "anterior-b", evento_id: "ev-ant-b", nombre_evento: "Cauca 14/10", comprador: "Cliente B"
    }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Lotería de Manizales",
        hora_fin: "22:30",
        valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "{{nombre}} {{fecha}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

const entradaB = (extra = {}) => entrada({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"], ...extra });

function deps() {
    const enviados = [];
    return {
        enviados,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); }
        }
    };
}

const sock = (usuarioId = A) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
    groupSettingUpdate: async () => {}
});

const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g = "g1@g.us") => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const filasDe = (u, tabla = T5K) => JSON.stringify(fake.tablas[tabla].filter(f => f.usuario_id === u));
const aplicadas = () => rpc.llamadas.filter(l => l.args.p_aplicar === true);

async function programar(usuario, datos, reinicio) {
    const c = await servicio.crearSorteo(usuario, datos);
    assert.ok(c.ok, JSON.stringify(c));
    const v = await servicio.vistaPrevia(usuario, c.data.id);
    assert.deepStrictEqual(v.data.bloqueos, [], JSON.stringify(v.data.bloqueos));
    const conf = await servicio.confirmar(usuario, c.data.id, { version: c.data.version, confirmacion: true, ...(reinicio ? { reinicio } : {}) });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

async function tick(usuario, ahora, d) {
    const log = console.log; console.log = () => {};
    try { return await publicador.tick(sock(usuario), { ahora, deps: d }); } finally { console.log = log; }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------- G. programar no toca ---

prueba("G1. programar CON «Reiniciar la tabla antes de publicar» no modifica la tabla (ni archiva nada)", async () => {
    escenario();
    const antes = filasDe(A);
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    assert.strictEqual(s.estado, "programado");
    assert.strictEqual(s.config.tabla.reiniciar_al_publicar, true);
    assert.strictEqual(filasDe(A), antes);
    assert.strictEqual(aplicadas().length, 0);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 0);
});

prueba("G2. programar con «Conservar la tabla actual» no modifica la tabla y nunca se reinicia, ni al publicar", async () => {
    escenario();
    const antes5k = filasDe(A), antes1k = filasDe(A, T1K);
    const s = await programar(A, entrada({ valor: 1000 }));
    assert.strictEqual(s.config.tabla.reiniciar, false);
    assert.ok(!s.config.tabla.reiniciar_al_publicar);
    const { d, enviados } = deps();
    await tick(A, seg(-30), d);
    await tick(A, seg(30), d);
    assert.strictEqual(enviados.length, 1, "se publica");
    assert.strictEqual(rpc.llamadas.length, 0, "nunca se consulta ni se aplica el reinicio");
    assert.strictEqual(filasDe(A), antes5k);
    assert.strictEqual(filasDe(A, T1K), antes1k);
});

prueba("G3. «Conservar» con la marca de reinicio inyectada en la fila: el publicador NO reinicia", async () => {
    escenario();
    const s = await programar(A, entrada({ valor: 1000 }));
    sorteoDb(s.id).config = { ...sorteoDb(s.id).config, tabla: { reiniciar: false, reiniciar_al_publicar: true } };
    await tick(A, seg(-30), deps().d);
    await tick(A, seg(30), deps().d);
    assert.strictEqual(aplicadas().length, 0);
});

// ------------------------------------------- P. al llegar la publicación ---

prueba("P1. un minuto antes: revalida y reinicia (archiva y libera); el anuncio sale a su hora, sobre la tabla libre", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d, enviados } = deps();

    await tick(A, seg(-90), d);
    assert.strictEqual(aplicadas().length, 0, "más de un minuto antes: nada");
    assert.strictEqual(fake.tablas.reservas_archivo.length, 0);

    await tick(A, seg(-45), d);
    assert.strictEqual(aplicadas().length, 1, "reinicio en el minuto previo");
    const a = aplicadas()[0].args;
    assert.deepStrictEqual([a.p_usuario, a.p_tabla, a.p_sorteo, a.p_liberar_bloqueados], [A, T5K, s.id, false]);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 5, "copia de respaldo de lo liberado");
    assert.ok(fake.tablas.reservas_archivo.every(x => x.sorteo_id === s.id && x.usuario_id === A));
    assert.ok(fake.tablas[T5K].filter(f => f.usuario_id === A).every(f => f.estado === "libre"));
    assert.ok(sorteoDb(s.id).config.tabla.reiniciado_en);
    assert.strictEqual(sorteoDb(s.id).estado, "programado", "todavía no se publica");
    assert.strictEqual(enviados.length, 0);

    await tick(A, seg(30), d);
    assert.strictEqual(grupoDe(s.id).estado, "publicado");
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(aplicadas().length, 1, "no se reinicia otra vez al publicar");
});

prueba("P2. si el bot no estuvo en el minuto previo, el reinicio se hace justo antes del anuncio, en el mismo ciclo", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d, enviados } = deps();
    await tick(A, seg(20), d);
    assert.strictEqual(aplicadas().length, 1);
    assert.strictEqual(grupoDe(s.id).estado, "publicado");
    assert.strictEqual(enviados.length, 1);
});

// --------------------------------------- S. cambios antes de publicar ---

prueba("S1. reserva NUEVA sin sorteo atribuible antes de publicar: no se reinicia, no se publica, queda en revisión", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    Object.assign(fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "50"), { estado: "reservado", identidad_evento_real: null, comprador: "Nuevo" });
    const antes = filasDe(A);
    const { d, enviados } = deps();
    await tick(A, seg(-45), d);
    await tick(A, seg(30), d);
    assert.strictEqual(aplicadas().length, 0);
    assert.strictEqual(filasDe(A), antes, "sin cambios");
    assert.strictEqual(enviados.length, 0, "no se anuncia");
    assert.strictEqual(grupoDe(s.id).estado, "requiere_revision");
    assert.ok(/No se reinició la tabla ni se publicó/.test(grupoDe(s.id).ultimo_error) && /no se pueden atribuir/.test(grupoDe(s.id).ultimo_error), grupoDe(s.id).ultimo_error);
});

prueba("S2. pago EN PROCESO antes de publicar: no se reinicia ni se publica", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    Object.assign(fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "60"), { estado: "en_proceso" });
    const antes = filasDe(A);
    const { d, enviados } = deps();
    await tick(A, seg(30), d);
    assert.strictEqual(aplicadas().length, 0);
    assert.strictEqual(filasDe(A), antes);
    assert.strictEqual(enviados.length, 0);
    assert.ok(/pago en proceso/.test(grupoDe(s.id).ultimo_error), grupoDe(s.id).ultimo_error);
});

prueba("S3. el sorteo anterior volvió a estar ACTIVO: se espera sin tocar nada; al cerrar, reinicia y publica", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === "ev-ant-a"), { activo: true, estado: "abierto" });
    const antes = filasDe(A);
    const { d, enviados } = deps();
    await tick(A, seg(30), d);
    assert.strictEqual(aplicadas().length, 0);
    assert.strictEqual(filasDe(A), antes);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(grupoDe(s.id).estado, "pendiente");
    assert.ok(/^En espera: /.test(grupoDe(s.id).ultimo_error));
    Object.assign(fake.tablas.eventos_bot.find(e => e.id === "ev-ant-a"), { activo: false, estado: "cerrado" });
    await tick(A, seg(90), d);
    assert.strictEqual(aplicadas().length, 1);
    assert.strictEqual(grupoDe(s.id).estado, "publicado");
});

prueba("S4. una reserva entra ENTRE la revisión y la escritura: la 030 no hace nada (tabla_cambio) y no se publica en ese ciclo", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    rpc.antesDeAplicar = () => Object.assign(fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "70"), { estado: "reservado", identidad_evento_real: null });
    const { d, enviados } = deps();
    await tick(A, seg(30), d);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 0, "nada archivado");
    assert.strictEqual(fake.tablas[T5K].filter(f => f.usuario_id === A && f.estado !== "libre").length, 6, "nada liberado");
    assert.strictEqual(enviados.length, 0);
    assert.ok(/la tabla cambió/.test(grupoDe(s.id).ultimo_error));
    // Siguiente ciclo: la reserva nueva no es atribuible -> revisión, sin cambios.
    await tick(A, seg(60), d);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 0);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(grupoDe(s.id).estado, "requiere_revision");
});

// ------------------------------------------------------- I. reintentos ---

prueba("I1. reintentos y ciclos repetidos: un solo reinicio (marca reiniciado_en)", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d } = deps();
    for (const t of [-55, -40, -20, -5]) await tick(A, seg(t), d);
    await tick(A, seg(10), d);
    await tick(A, seg(40), d);
    assert.strictEqual(aplicadas().length, 1);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 5);
    assert.strictEqual(grupoDe(s.id).estado, "publicado");
});

prueba("I2. dos procesos a la vez: la huella de la 030 impide un segundo reinicio; nada se archiva dos veces", async () => {
    escenario();
    await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    await Promise.all([tick(A, seg(-45), deps().d), tick(A, seg(-45), deps().d)]);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 5);
    const ok = rpc.llamadas.filter(l => l.args.p_aplicar).length;
    assert.ok(ok >= 1 && ok <= 2);
});

prueba("I3. si la marca no se pudo guardar, el siguiente ciclo ve la tabla libre y solo anota (no archiva otra vez)", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d } = deps();
    await tick(A, seg(-45), d);
    // Simula que la marca se perdió (p. ej. falló la escritura).
    sorteoDb(s.id).config = { ...sorteoDb(s.id).config, tabla: { ...sorteoDb(s.id).config.tabla, reiniciado_en: null } };
    await tick(A, seg(30), d);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 5);
    assert.strictEqual(grupoDe(s.id).estado, "publicado");
});

// ------------------------------------------------- C. aislamiento ---

prueba("C1. la programación de OTRO cliente nunca modifica la tabla de A", async () => {
    escenario();
    const antesA = filasDe(A);
    const sB = await programar(B, entradaB({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d } = deps();
    await tick(B, seg(-45), d);
    await tick(B, seg(30), d);
    assert.ok(rpc.llamadas.every(l => l.args.p_usuario === B));
    assert.strictEqual(filasDe(A), antesA, "la tabla de A sigue igual");
    assert.ok(fake.tablas.reservas_archivo.every(x => x.usuario_id === B));
    assert.strictEqual(grupoDe(sB.id, "gb@g.us").estado, "publicado");
    // Y el ciclo de A no toma el sorteo de B.
    await tick(A, seg(60), d);
    assert.ok(rpc.llamadas.every(l => l.args.p_usuario === B));
});

prueba("C2. sorteo de A alterado (otro evento u otra tabla): al publicar se revalida y no se toca nada", async () => {
    for (const [alterar, motivo] of [
        [(fila) => { fila.config = { ...fila.config, nombre: "Otro sorteo" }; }, /no corresponde al evento confirmado/],
        [(fila) => { fila.tabla = T1K; }, /ya no es la configurada/]
    ]) {
        escenario();
        const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
        alterar(sorteoDb(s.id));
        const antes = filasDe(A) + filasDe(A, T1K);
        const { d, enviados } = deps();
        await tick(A, seg(30), d);
        assert.strictEqual(aplicadas().length, 0);
        assert.strictEqual(filasDe(A) + filasDe(A, T1K), antes);
        assert.strictEqual(enviados.length, 0);
        assert.strictEqual(grupoDe(s.id).estado, "requiere_revision");
        assert.ok(motivo.test(grupoDe(s.id).ultimo_error), grupoDe(s.id).ultimo_error);
    }
});

// -------------------------------------------- F. estado final de la tabla ---

prueba("F1. tras el reinicio aparece un número ocupado de otro sorteo: el anuncio NO sale (revisión)", async () => {
    escenario();
    const s = await programar(A, entrada({ tabla: { reiniciar: true } }), { confirmado: true });
    const { d, enviados } = deps();
    await tick(A, seg(-45), d);
    assert.strictEqual(aplicadas().length, 1);
    Object.assign(fake.tablas[T5K].find(f => f.usuario_id === A && f.numero === "80"), { estado: "pagado", identidad_evento_real: "anterior-a" });
    await tick(A, seg(30), d);
    assert.strictEqual(enviados.length, 0, "no promete números que no están libres");
    assert.strictEqual(grupoDe(s.id).estado, "requiere_revision");
    assert.strictEqual(aplicadas().length, 1, "tampoco reinicia otra vez por su cuenta");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const err = console.error; console.error = () => {};
        try { await fn(); ok++; console.error = err; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.error = err; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
