// ==========================================================================
// PRUEBAS — FASE UX-03: la política de tabla que eligió el administrador
// («Conservar la tabla actual» / «Reiniciar la tabla antes de publicar») se
// respeta igual en vista previa, confirmación, publicación instantánea,
// publicación programada, edición y reintento.
//
//   1. Conservar con todos los números libres.
//   2. Conservar con reservas de otro sorteo (cerrado).
//   3. Conservar con pagados de otro sorteo ACTIVO (otro grupo).
//   4. Reiniciar con reservas protegidas (sorteo activo): excepción técnica
//      documentada (la 030 nunca toca un sorteo activo); y reiniciar con
//      números de un sorteo terminado: se archivan y liberan al publicar.
//   5. Publicación instantánea.            6. Publicación programada.
//   7. Publicación después de editar.      8. Reintento de publicación.
//   9. Las filas de otro sorteo nunca cambian (comparación completa).
//   +  Bloqueos que se mantienen: tabla incompleta y números repetidos; sin
//      números libres solo se avisa.
//
// Servicio y publicador REALES sobre Supabase en memoria; la función SQL
// de reinicio (030) simulada con su misma clasificación; WhatsApp simulado.
//
//     node backend/tests/sorteos/politicaTabla.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [] };

// reiniciar_tabla_cliente (030), misma clasificación que la SQL: todo o nada.
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
    const huella = filas.filter(f => f.estado !== "libre").map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`).sort().join(",");
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
        fake.tablas.reservas_archivo.push({ usuario_id: args.p_usuario, tabla: args.p_tabla, numero: f.numero, estado: f.estado, identidad: f.identidad_evento_real, sorteo_id: args.p_sorteo });
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
        rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args }); return reinicio030(args); }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// Hoy 15/10 10:00 Colombia; el sorteo se juega hoy a las 22:30.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = "2026-10-15T15:30:00Z";
const EN_PUBLICACION = new Date("2026-10-15T15:31:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const OTRO = "id-otro-sorteo";
const PNG = Buffer.from("\x89PNG-simulado", "binary");

let enviados = [];
let fallaEnvio = () => null;
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        const error = fallaEnvio(jid);
        if (error) throw new Error(error);
        enviados.push({ jid, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

function deps() {
    return {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async () => PNG,
        textoParaCompartir: destinos.textoParaCompartir,
        compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
    };
}

// Tabla de $5.000 de A. `otro`: números de OTRO sorteo (identidad OTRO) con
// su evento en el grupo g3 (activo o cerrado).
function escenario({ reservados = 0, pagados = 0, otroActivo = false, quitar = 0, duplicar = null } = {}) {
    fake = crearFake();
    rpc.llamadas = [];
    enviados = [];
    fallaEnvio = () => null;
    servicio._reloj.ahora = () => T0;
    const t = fake.tablas;
    t.grupos_autorizados = ["g1@g.us", "g2@g.us", "g3@g.us"].map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }, { jid: "g3@g.us", nombre: "Grupo 3" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.reservas_actividad = [];
    t.reservas_archivo = [];
    t.eventos_bot = (reservados || pagados) ? [{
        id: "ev-otro", grupo_id: "g3@g.us", usuario_id: A, activo: otroActivo, abierto: otroActivo, estado: otroActivo ? "abierto" : "cerrado",
        identidad_evento_real: OTRO, nombre_evento: "Lotería de Bogotá", tabla: T5K, valor: "5000", cifras: 2, cantidad_numeros: 100,
        hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-15", creado_en: new Date("2026-10-14T12:00:00Z")
    }] : [];
    t[T5K] = Array.from({ length: 100 - quitar }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    t[T5K].slice(0, reservados + pagados).forEach((f, i) => Object.assign(f, {
        estado: i < reservados ? "reservado" : "pagado", identidad_evento_real: OTRO, evento_id: "ev-otro",
        comprador: `Cliente ${i}`, contacto: `57300000${String(i).padStart(4, "0")}`, nombre_evento: "Lotería de Bogotá"
    }));
    if (duplicar) t[T5K].push({ numero: duplicar, estado: "libre", usuario_id: A });
}

// Foto exacta de las filas del otro sorteo para compararlas al final.
const filasDelOtro = () => JSON.stringify(fake.tablas[T5K].filter(f => f.identidad_evento_real === OTRO).map(f => ({ ...f })));

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras", nombre: "Lotería de Manizales", hora_fin: "22:30", valor: 5000, fecha_sorteo: "2026-10-15",
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR, mensajes: { publicacion: "{{nombre}}", aviso_cierre: "" }, recordatorios: [],
        tabla: { reiniciar: false, liberar_bloqueados: false },
        ...extra
    };
}

async function silencio(fn) {
    const { log, table, dir, warn, error, info } = console;
    console.log = console.table = console.dir = console.warn = console.error = console.info = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error, info }); }
}

async function crear(extra) {
    const c = await silencio(() => servicio.crearSorteo(A, entrada(extra)));
    assert.ok(c.ok, JSON.stringify(c));
    return c.data;
}

const vista = async (s) => (await silencio(() => servicio.vistaPrevia(A, s.id))).data;
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDb = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const eventoDe = (s, g) => fake.tablas.eventos_bot.find(e => e.grupo_id === g && e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real);

function usarInstantaneo() {
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = deps();
}

async function publicarAhora(s, extra = {}) {
    usarInstantaneo();
    return silencio(() => servicio.publicarAhora(A, s.id, { version: s.version, confirmacion: true, ...extra }));
}

async function programarYPublicar(s, { ahora = EN_PUBLICACION, reinicio } = {}) {
    const conf = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true, ...(reinicio ? { reinicio } : {}) }));
    assert.ok(conf.ok, JSON.stringify(conf));
    await silencio(() => publicador.tick(sock(), { ahora, deps: deps() }));
    return conf.data;
}

const resultados = [];
async function prueba(nombre, fn) {
    try { await fn(); resultados.push(true); console.log(`✅ ${nombre}`); }
    catch (e) { resultados.push(false); console.log(`❌ ${nombre}\n   ${e.stack || e.message}`); }
}

(async () => {

await prueba("1. Conservar con todos los números libres: vista previa sin bloqueos ni avisos de otros sorteos y se publica", async () => {
    escenario();
    const s = await crear({ publicacion_inmediata: true });
    const v = await vista(s);
    assert.deepStrictEqual(v.bloqueos, []);
    assert.ok(v.puede_confirmar && v.tabla_al_publicar.reiniciar === false);
    assert.ok(!v.avisos.some(a => a.includes("otros sorteos")), JSON.stringify(v.avisos));
    const p = await publicarAhora(s);
    assert.ok(p.ok, JSON.stringify(p));
    assert.strictEqual(enviados.length, 1);
    assert.ok(eventoDe(s, "g1@g.us")?.activo);
});

await prueba("2 + 5. Conservar con RESERVAS de otro sorteo (cerrado): publicación instantánea con aviso; nada del otro sorteo cambia", async () => {
    escenario({ reservados: 40, pagados: 0 });
    const antes = filasDelOtro();
    const s = await crear({ publicacion_inmediata: true });
    const v = await vista(s);
    assert.deepStrictEqual(v.bloqueos, [], "la decisión de conservar no se contradice");
    assert.ok(v.puede_confirmar);
    const aviso = v.avisos.find(a => a.startsWith("Se conserva la tabla actual"));
    assert.ok(aviso && aviso.includes("40 número(s) de otros sorteos") && aviso.includes("«Lotería de Bogotá»") && aviso.includes("Quedan 60 número(s) libres"), aviso);
    assert.ok(!aviso.includes("(activo)"), "el otro sorteo está cerrado");
    assert.strictEqual(v.tabla.ocupadosOtroSorteo, 40);
    assert.strictEqual(v.tabla.libres, 60);
    const p = await publicarAhora(s);
    assert.ok(p.ok, JSON.stringify(p));
    assert.strictEqual(enviados.length, 1, "un anuncio");
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(filasDelOtro(), antes, "las 40 reservas del otro sorteo intactas");
    assert.strictEqual(rpc.llamadas.length, 0, "con conservar nunca se llama al reinicio");
});

await prueba("3 + 6. Conservar con PAGADOS de otro sorteo ACTIVO (otro grupo): publicación programada; el otro sigue activo e intacto", async () => {
    escenario({ reservados: 0, pagados: 27, otroActivo: true });
    const antes = filasDelOtro();
    const s = await crear();
    const v = await vista(s);
    assert.deepStrictEqual(v.bloqueos, [], "otro sorteo activo no bloquea por sí solo");
    assert.ok(v.avisos.some(a => a.includes("27 número(s) de otros sorteos") && a.includes("«Lotería de Bogotá» (activo)") && a.includes("27 pagado(s)")), JSON.stringify(v.avisos));
    await programarYPublicar(s);
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "publicado", JSON.stringify(grupoDb(s.id, "g1@g.us")));
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(filasDelOtro(), antes, "los 27 pagados del otro sorteo intactos");
    assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === "ev-otro").activo, true, "el otro sorteo sigue activo");
    assert.strictEqual(rpc.llamadas.length, 0);
});

await prueba("4a. Reiniciar con reservas PROTEGIDAS (sorteo activo): excepción técnica documentada, no se toca nada ni se publica", async () => {
    escenario({ reservados: 10, pagados: 5, otroActivo: true });
    const antes = filasDelOtro();
    const s = await crear({ publicacion_inmediata: true, tabla: { reiniciar: true, liberar_bloqueados: false } });
    const v = await vista(s);
    assert.ok(v.bloqueos.some(b => b.startsWith("No se puede reiniciar la tabla") && b.includes("del sorteo activo")), JSON.stringify(v.bloqueos));
    const p = await publicarAhora(s, { reinicio: { confirmado: true } });
    assert.ok(!p.ok, "no se publica sin poder reiniciar");
    assert.strictEqual(enviados.length, 0);
    assert.ok(rpc.llamadas.every(l => l.args.p_aplicar !== true), "el reinicio nunca se aplicó");
    assert.strictEqual(filasDelOtro(), antes);
});

await prueba("4b. Reiniciar con números de un sorteo TERMINADO: con confirmación, se archivan y liberan al publicar", async () => {
    escenario({ reservados: 10, pagados: 5, otroActivo: false });
    const s = await crear({ publicacion_inmediata: true, tabla: { reiniciar: true, liberar_bloqueados: false } });
    const v = await vista(s);
    assert.deepStrictEqual(v.bloqueos, []);
    assert.ok(v.reinicio?.al_publicar, "pide confirmar el reinicio");
    const sinConfirmar = await publicarAhora(s);
    assert.strictEqual(sinConfirmar.motivo, "confirmacion_reinicio_requerida", "la confirmación explícita se mantiene");
    const p = await publicarAhora(s, { reinicio: { confirmado: true } });
    assert.ok(p.ok, JSON.stringify(p));
    assert.strictEqual(fake.tablas.reservas_archivo.length, 15, "archivados, no borrados");
    assert.strictEqual(fake.tablas[T5K].filter(f => f.identidad_evento_real === OTRO).length, 0);
    assert.strictEqual(enviados.length, 1);
});

await prueba("7. Editar el sorteo y publicar: la política guardada se mantiene en la nueva versión", async () => {
    escenario({ reservados: 20, pagados: 10 });
    const antes = filasDelOtro();
    const s = await crear();
    const e = await silencio(() => servicio.editar(A, s.id, { ...entrada({ premios: [{ nombre: "Premio mayor", premio: 500000 }] }), version: s.version }));
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual(e.data.version, 2);
    assert.strictEqual(sorteoDb(s.id).config.tabla.reiniciar, false, "conservar persiste tras editar");
    const v = await vista(e.data);
    assert.deepStrictEqual(v.bloqueos, []);
    await programarYPublicar(e.data);
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(sorteoDb(s.id).config.premios[0].premio, 500000, "se publicó la versión editada");
    assert.strictEqual(sorteoDb(s.id).confirmado_version, 2);
    assert.strictEqual(filasDelOtro(), antes);
});

await prueba("8. Reintento: tras un envío fallido, el reintento publica con la misma política, sin tocar el otro sorteo", async () => {
    escenario({ reservados: 30, pagados: 7, otroActivo: true });
    const antes = filasDelOtro();
    const s = await crear();
    fallaEnvio = () => "Connection Closed (simulado)";
    await programarYPublicar(s);
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "requiere_revision", JSON.stringify(grupoDb(s.id, "g1@g.us")));
    assert.strictEqual(enviados.length, 0);
    fallaEnvio = () => null;
    const rr = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us"));
    assert.ok(rr.ok, JSON.stringify(rr));
    await silencio(() => publicador.tick(sock(), { ahora: new Date(EN_PUBLICACION.getTime() + 60000), deps: deps() }));
    assert.strictEqual(grupoDb(s.id, "g1@g.us").estado, "publicado", JSON.stringify(grupoDb(s.id, "g1@g.us")));
    assert.strictEqual(enviados.length, 1, "un solo anuncio");
    assert.strictEqual(filasDelOtro(), antes);
    assert.strictEqual(rpc.llamadas.length, 0);
});

await prueba("9 + extra. Sin números libres solo se avisa; tabla incompleta y números repetidos siguen bloqueando (integridad)", async () => {
    escenario({ reservados: 60, pagados: 40 });
    const antes = filasDelOtro();
    const lleno = await vista(await crear());
    assert.deepStrictEqual(lleno.bloqueos, [], "decisión comercial del administrador: no se bloquea");
    assert.ok(lleno.avisos.some(a => a.startsWith("No queda ningún número libre")), JSON.stringify(lleno.avisos));
    assert.strictEqual(filasDelOtro(), antes);

    escenario({ quitar: 3 });
    const incompleta = await vista(await crear());
    assert.ok(incompleta.bloqueos.some(b => b.includes("incompleta (97/100)")), JSON.stringify(incompleta.bloqueos));
    assert.strictEqual(incompleta.puede_confirmar, false);

    escenario({ duplicar: "07" });
    const repetidos = await vista(await crear());
    assert.ok(repetidos.bloqueos.some(b => b.includes("números repetidos (07)")), JSON.stringify(repetidos.bloqueos));
    assert.strictEqual(repetidos.puede_confirmar, false);
    // La confirmación aplica la misma regla (el publicador usa la misma revisarTabla).
    const s = await crear();
    fake.tablas[T5K].push({ numero: "07", estado: "libre", usuario_id: A });
    const conf = await silencio(() => servicio.confirmar(A, s.id, { version: s.version, confirmacion: true }));
    assert.ok(!conf.ok, "no se confirma con la tabla corrupta");
});

const fallidas = resultados.filter(x => !x).length;
console.log(`\n============================\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas}  ❌ FALLA: ${fallidas}\n============================`);
process.exit(fallidas ? 1 : 0);

})();
