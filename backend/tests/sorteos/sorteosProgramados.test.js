// ==========================================================================
// PRUEBAS — sorteos creados y programados desde el panel (Fases 2-4).
//
// Reales: sorteos/{validar,mensajes,repo,disponibilidad,servicio,publicador}
// .js, guardarEvento.js, consultarEvento.js, abrirGrupo.js, groupQueue.js,
// automation/executionGuard.js, routes/sorteos.js,
// middleware/autenticacionUsuario.js, tokenServicio.js, sorteoReal.js,
// workerEventos.js (cierre).
// Simulados: Supabase (memoria), el socket de WhatsApp y el envío de
// mensajes (espía). Nunca se envía nada real ni se toca Supabase real.
//
//     node backend/tests/sorteos/sorteosProgramados.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.SESSIONS_API_TOKEN = "token-servicio-pruebas";

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

// --------------------------------------------------------------- tiempo ---

// 10:00 en Colombia; se publica a las 10:30; el sorteo es a las 22:30.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-15T15:30:00Z");
const EN_PUBLICACION = new Date("2026-10-15T15:31:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABLA = "5k_15k_reservas_2_cifras";

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: A, grupo_id: "g3@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-a2", usuario_id: A, nombre: "Vieja", tipo: "otro", numero: "1", activa: false },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", activa: true }
    ];
    t.eventos_bot = [];
    t[TABLA] = [
        ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A })),
        ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: B }))
    ];
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Lotería de Manizales",
        hora_fin: "22:30",
        valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us", "g2@g.us", "g3@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        mensajes: { publicacion: "", aviso_cierre: "🔒 {{nombre}} cerrado" },
        recordatorios: [{ minutos_antes_cierre: 60, texto: "⏰ Falta 1 hora para {{nombre}}" }],
        ...extra
    };
}

// Socket simulado del cliente A (sesión activa).
function crearSock(usuarioId = A, { falla = new Set() } = {}) {
    const ajustes = [];
    return {
        ajustes,
        sock: {
            context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
            groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
            groupSettingUpdate: async (jid, ajuste) => {
                ajustes.push({ jid, ajuste });
                if (falla.has(jid)) throw new Error("not-authorized (simulado)");
            }
        }
    };
}

// Dependencias del publicador: todo real salvo el envío (espía).
function deps({ fallaEnvio = () => false } = {}) {
    const enviados = [];
    return {
        enviados,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            sendMessage: async ({ jid, text }) => {
                if (fallaEnvio(jid)) throw new Error("Connection Closed (simulado)");
                enviados.push({ jid, text });
            }
        }
    };
}

async function creadoYConfirmado(extra = {}, usuario = A) {
    const c = await servicio.crearSorteo(usuario, entrada(extra));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(usuario, c.data.id, { version: c.data.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const grupoDe = (sorteoId, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === sorteoId && x.grupo_id === g);
const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("F2-1. crear: borrador con tabla, identidad y cuentas COPIADAS; grupos pendientes", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada());
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(c.data.estado, "borrador");
    assert.strictEqual(c.data.tabla, TABLA);
    assert.strictEqual(c.data.cantidad_numeros, 100);
    assert.ok(c.data.identidad_evento_real);
    assert.strictEqual(c.data.cuentas_snapshot[0].numero, "3000000001");
    assert.deepStrictEqual(c.data.grupos.map(g => g.estado), ["pendiente", "pendiente", "pendiente"]);
    // Editar la cuenta después NO altera el sorteo.
    await servicio.actualizarCuenta(A, "cuenta-a1", { numero: "999" });
    assert.strictEqual(sorteoDb(c.data.id).cuentas_snapshot[0].numero, "3000000001");
});

prueba("F2-2. validación: grupo ajeno, cuenta ajena/inactiva, precio sin tabla, 3 cifras, publicar tras el cierre", async () => {
    escenario();
    const casos = [
        [{ grupos: ["gb@g.us"] }, "grupos"],
        [{ cuentas: ["cuenta-b1"] }, "cuentas"],
        [{ cuentas: ["cuenta-a2"] }, "cuentas"],
        [{ valor: 4321 }, "valor"],
        [{ modalidad: "tres_cifras_pago" }, "modalidad"],
        [{ publicar_en: new Date("2026-10-16T03:40:00Z").toISOString() }, "publicar_en"],
        [{ premios: [] }, "premios"]
    ];
    for (const [cambio, campo] of casos) {
        const res = await servicio.crearSorteo(A, entrada(cambio));
        assert.strictEqual(res.ok, false, JSON.stringify(cambio));
        assert.ok(res.errores.some(e => e.campo === campo), `${JSON.stringify(cambio)} -> ${JSON.stringify(res.errores)}`);
    }
    assert.strictEqual((fake.tablas.sorteos_programados || []).length, 0, "nada se guarda si la validación falla");
});

prueba("F2-3. vista previa: mensaje real con premios y cuentas; confirmar EXIGE confirmación y la versión vista", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada());
    const vp = await servicio.vistaPrevia(A, c.data.id);
    assert.ok(vp.ok);
    assert.ok(/Lotería de Manizales/.test(vp.data.publicacion) && /\$300\.000/.test(vp.data.publicacion) && /3000000001/.test(vp.data.publicacion));
    assert.deepStrictEqual(vp.data.bloqueos, []);
    assert.strictEqual(vp.data.puede_confirmar, true);
    assert.strictEqual((await servicio.confirmar(A, c.data.id, { version: 1 })).motivo, "confirmacion_requerida");
    assert.strictEqual((await servicio.confirmar(A, c.data.id, { version: 7, confirmacion: true })).motivo, "version_cambiada");
    const ok = await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true });
    assert.strictEqual(ok.data.estado, "programado");
});

prueba("F2-4. no publica antes de su hora; a su hora publica en los 3 grupos: evento, grupo abierto y UN anuncio por grupo", async () => {
    escenario();
    const s = await creadoYConfirmado();
    const { sock, ajustes } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: T0, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0, "antes de la hora no publica");
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.deepStrictEqual(dep.enviados.map(e => e.jid).sort(), ["g1@g.us", "g2@g.us", "g3@g.us"]);
    assert.strictEqual(fake.tablas.eventos_bot.length, 3);
    assert.ok(fake.tablas.eventos_bot.every(e => e.activo && e.identidad_evento_real === s.identidad_evento_real && e.usuario_id === A && e.tabla === TABLA));
    assert.ok(ajustes.every(a => a.ajuste === "not_announcement") && ajustes.length === 3);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    // Ciclos siguientes: cero publicaciones nuevas.
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 3, "sin duplicados");
});

prueba("F2-5. dos ciclos SIMULTÁNEOS no duplican publicaciones", async () => {
    escenario();
    await creadoYConfirmado();
    const dep = deps();
    const sockEspia = crearSock();
    await Promise.all([1, 2, 3].map(() => publicador.tick(sockEspia.sock, { ahora: EN_PUBLICACION, deps: dep.d })));
    assert.strictEqual(dep.enviados.length, 3);
    assert.strictEqual(new Set(dep.enviados.map(e => e.jid)).size, 3);
    // Cada grupo se reclamó y procesó UNA vez: una sola apertura y un solo
    // guardado de evento por grupo (no solo un mensaje).
    assert.strictEqual(sockEspia.ajustes.length, 3, "una apertura por grupo");
    assert.strictEqual(fake.tablas.eventos_bot.length, 3);
    assert.ok(fake.tablas.sorteos_programados_grupos.every(g => g.intentos === 1), JSON.stringify(fake.tablas.sorteos_programados_grupos.map(g => g.intentos)));
});

prueba("F2-5c. sorteo YA en 'publicando' (reanudación) con ciclos simultáneos: cada grupo se procesa UNA vez", async () => {
    escenario();
    const s = await creadoYConfirmado();
    sorteoDb(s.id).estado = "publicando";
    const dep = deps();
    const espia = crearSock();
    await Promise.all([1, 2, 3].map(() => publicador.tick(espia.sock, { ahora: EN_PUBLICACION, deps: dep.d })));
    assert.strictEqual(espia.ajustes.length, 3, "una apertura por grupo");
    assert.strictEqual(dep.enviados.length, 3);
    assert.ok(fake.tablas.sorteos_programados_grupos.every(g => g.intentos === 1), JSON.stringify(fake.tablas.sorteos_programados_grupos.map(g => g.intentos)));
});

prueba("F2-5b. una fila 'programado' con versión distinta de la confirmada NUNCA se publica (carrera / edición directa)", async () => {
    escenario();
    const s = await creadoYConfirmado();
    Object.assign(sorteoDb(s.id), { version: 2 }); // confirmado_version sigue en 1
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0);
    assert.strictEqual(fake.tablas.eventos_bot.length, 0);
});

prueba("F2-6. editar una programación: vuelve a borrador, la tarea vieja NO se ejecuta, y tras reconfirmar publica UNA vez", async () => {
    escenario();
    const s = await creadoYConfirmado();
    const ed = await servicio.editar(A, s.id, { ...entrada({ valor: 10000, grupos: ["g1@g.us", "g2@g.us"] }), version: s.version });
    assert.ok(ed.ok, JSON.stringify(ed));
    assert.strictEqual(ed.data.estado, "borrador");
    assert.strictEqual(ed.data.version, 2);
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0, "sin reconfirmar no publica nada");
    await servicio.confirmar(A, s.id, { version: 2, confirmacion: true });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.deepStrictEqual(dep.enviados.map(e => e.jid).sort(), ["g1@g.us", "g2@g.us"]);
    assert.ok(/\$10\.000/.test(dep.enviados[0].text), "publica la versión editada");
    // Editar después de publicar: rechazado.
    const tarde = await servicio.editar(A, s.id, { ...entrada(), version: 2 });
    assert.strictEqual(tarde.ok, false);
});

prueba("F2-7. cancelar antes de publicar: nunca se publica", async () => {
    escenario();
    const s = await creadoYConfirmado();
    const c = await servicio.cancelar(A, s.id);
    assert.strictEqual(c.data.estado, "cancelado");
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0);
    assert.ok(c.data.grupos.every(g => g.estado === "cancelado"));
});

prueba("F2-8. grupo con OTRO sorteo activo: no se reemplaza (revisión), los demás grupos sí se publican", async () => {
    escenario();
    fake.tablas.eventos_bot.push({ id: "ev-otro", grupo_id: "g2@g.us", usuario_id: A, activo: true, identidad_evento_real: "otro", nombre_evento: "Boyacá", hora_fin: "22:40" });
    const c = await servicio.crearSorteo(A, entrada());
    const vp = await servicio.vistaPrevia(A, c.data.id);
    assert.ok(vp.data.bloqueos.some(b => /sorteo activo/.test(b)));
    assert.strictEqual(vp.data.puede_confirmar, false);
    assert.strictEqual((await servicio.confirmar(A, c.data.id, { version: 1, confirmacion: true })).motivo, "bloqueado");
});

prueba("F2-9. tabla con números de OTRO sorteo: bloqueo (nunca se reinicia sola)", async () => {
    escenario();
    fake.tablas[TABLA][5] = { ...fake.tablas[TABLA][5], estado: "pagado", identidad_evento_real: "sorteo-anterior" };
    const c = await servicio.crearSorteo(A, entrada());
    const vp = await servicio.vistaPrevia(A, c.data.id);
    assert.ok(vp.data.bloqueos.some(b => /otro sorteo/.test(b)), JSON.stringify(vp.data.bloqueos));
    assert.strictEqual(fake.tablas[TABLA][5].estado, "pagado", "la tabla no se tocó");
});

prueba("F2-10. fecha ya pasada o cierre ya pasado al publicar: no publica, queda en revisión", async () => {
    escenario();
    const s = await creadoYConfirmado();
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: new Date("2026-10-16T15:31:00Z"), deps: dep.d }); // al día siguiente
    assert.strictEqual(dep.enviados.length, 0);
    assert.ok(/fecha programada/.test(grupoDe(s.id, "g1@g.us").ultimo_error));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");
});

prueba("F2-11. envío FALLA: el grupo queda en revisión, sin reenvío automático; el reintento MANUAL envía una vez", async () => {
    escenario();
    const s = await creadoYConfirmado({ grupos: ["g1@g.us", "g2@g.us"] });
    const { sock } = crearSock();
    const fallando = deps({ fallaEnvio: (jid) => jid === "g2@g.us" });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: fallando.d });
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "requiere_revision");
    assert.strictEqual(sorteoDb(s.id).estado, "publicado_parcial");
    const sano = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: sano.d });
    assert.strictEqual(sano.enviados.length, 0, "nunca reenvía solo");
    await servicio.reintentarGrupo(A, s.id, "g2@g.us");
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: sano.d });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: sano.d });
    assert.deepStrictEqual(sano.enviados.map(e => e.jid), ["g2@g.us"]);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
});

prueba("F2-12. coexistencia: un anuncio detectado NO reemplaza un sorteo programado activo", async () => {
    escenario();
    await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: deps().d });
    const evento = fake.tablas.eventos_bot.find(e => e.grupo_id === "g1@g.us");

    // detectarEvento real, con el extractor y la apertura sustituidos por
    // espías (solo se prueba la decisión de reemplazar o no).
    const espias = { guardar: 0, abrir: 0 };
    const inyectar = (rel, exp) => { require.cache[r(rel)] = { id: r(rel), filename: r(rel), loaded: true, exports: exp }; };
    inyectar("bot/funciones/eventos/extraerEvento.js", { extraerEvento: () => ({ nombre: "Manizales hoy", hora: "22:30", horaCierre: "22:26", valor: 5000, premios: [] }) });
    inyectar("bot/funciones/eventos/guardarEvento.js", { guardarEvento: async () => { espias.guardar++; return { id: "x" }; } });
    inyectar("bot/funciones/eventos/grupos/abrirGrupo.js", { abrirGrupo: async () => { espias.abrir++; return true; } });
    delete require.cache[r("bot/funciones/eventos/detectarEvento.js")];
    const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));

    const res = await detectarEvento({ sock, chat: { remoteJid: "g1@g.us" }, textoOriginal: "anuncio" });
    assert.strictEqual(res.id, evento.id, "devuelve el sorteo programado vigente");
    assert.strictEqual(espias.guardar, 0, "no lo reemplaza");
    assert.strictEqual(espias.abrir, 0);

    // En un grupo SIN sorteo programado, la detección sigue igual que siempre.
    const otro = await detectarEvento({ sock, chat: { remoteJid: "g3@g.us" }, textoOriginal: "anuncio" });
    assert.ok(otro);
    assert.strictEqual(espias.guardar, 1, "detección normal intacta");
    for (const rel of ["extraerEvento", "guardarEvento", "grupos/abrirGrupo", "detectarEvento"]) delete require.cache[r(`bot/funciones/eventos/${rel}.js`)];
});

prueba("F2-12b. si la comprobación de sorteo programado FALLA (excepción), la detección sigue igual que siempre", async () => {
    escenario();
    fake.tablas.eventos_bot.push({ id: "ev-det", grupo_id: "g1@g.us", usuario_id: A, activo: true, identidad_evento_real: "x", nombre_evento: "Otro", hora_fin: "21:00" });
    const desde = fake.client.from;
    fake.client.from = (t) => { if (t === "sorteos_programados_grupos") throw new Error("red caída (simulado)"); return desde(t); };
    const espias = { guardar: 0 };
    const inyectar = (rel, exp) => { require.cache[r(rel)] = { id: r(rel), filename: r(rel), loaded: true, exports: exp }; };
    inyectar("bot/funciones/eventos/extraerEvento.js", { extraerEvento: () => ({ nombre: "Manizales hoy", hora: "22:30", horaCierre: "22:26", valor: 5000, premios: [] }) });
    inyectar("bot/funciones/eventos/guardarEvento.js", { guardarEvento: async () => { espias.guardar++; return { id: "x" }; } });
    inyectar("bot/funciones/eventos/grupos/abrirGrupo.js", { abrirGrupo: async () => true });
    delete require.cache[r("bot/funciones/eventos/detectarEvento.js")];
    try {
        const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));
        const res = await detectarEvento({ sock: crearSock().sock, chat: { remoteJid: "g1@g.us" }, textoOriginal: "anuncio" });
        assert.ok(res, "la detección no se anula");
        assert.strictEqual(espias.guardar, 1, "flujo de siempre");
    } finally {
        fake.client.from = desde;
        for (const rel of ["extraerEvento", "guardarEvento", "grupos/abrirGrupo", "detectarEvento"]) delete require.cache[r(`bot/funciones/eventos/${rel}.js`)];
    }
});

prueba("F2-13. integración con el cierre (Fase 1): sorteo manual en 3 grupos, 100 pagados -> cierra los 3", async () => {
    escenario();
    const s = await creadoYConfirmado();
    const { sock, ajustes } = crearSock();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: deps().d });
    fake.tablas[TABLA].filter(f => f.usuario_id === A).forEach((f, i) => Object.assign(f, {
        estado: i === 0 ? "reservado" : "pagado", identidad_evento_real: s.identidad_evento_real, evento_id: fake.tablas.eventos_bot[i % 3].id
    }));
    await workerEventos(sock);
    assert.ok(fake.tablas.eventos_bot.every(e => e.activo), "99/100: no cierra");
    fake.tablas[TABLA].find(f => f.usuario_id === A && f.numero === "00").estado = "pagado";
    await workerEventos(sock);
    assert.ok(fake.tablas.eventos_bot.every(e => !e.activo && e.estado === "cerrado"), "100/100: cierra los 3 grupos");
    assert.strictEqual(ajustes.filter(a => a.ajuste === "announcement").length, 3);
});

prueba("F3-1. recordatorio: se envía UNA vez dentro de su ventana; nunca tarde", async () => {
    escenario();
    await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    // Cierre 22:26 Colombia = 03:26Z del día siguiente; recordatorio 60 min antes.
    await publicador.tick(sock, { ahora: new Date("2026-10-16T02:20:00Z"), deps: dep.d });
    assert.strictEqual(dep.enviados.filter(e => /Falta 1 hora/.test(e.text)).length, 0, "todavía no");
    await publicador.tick(sock, { ahora: new Date("2026-10-16T02:27:00Z"), deps: dep.d });
    await publicador.tick(sock, { ahora: new Date("2026-10-16T02:30:00Z"), deps: dep.d });
    assert.strictEqual(dep.enviados.filter(e => /Falta 1 hora/.test(e.text)).length, 1);
    escenario();
    await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const tarde = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: tarde.d });
    await publicador.tick(sock, { ahora: new Date("2026-10-16T02:50:00Z"), deps: tarde.d });
    assert.strictEqual(tarde.enviados.filter(e => /Falta 1 hora/.test(e.text)).length, 0, "fuera de su ventana no se envía");
});

// ---- Recordatorios según el estado REAL del sorteo (números y grupo) ----
//
// El texto de un recordatorio programado es libre: no indica si invita a
// participar o recuerda pagar. Se omite solo cuando no corresponde NINGUNO
// (todo pagado, o grupo cerrado sin pendientes); con pagos pendientes se
// envía igual que antes, hasta que el recordatorio declare su propósito.

const EN_VENTANA_RECORDATORIO = new Date("2026-10-16T02:27:00Z");

// Primeros `pagados` números pagados, luego `reservados` pendientes; el
// resto libres — todos del sorteo publicado en g1.
async function publicadoConEstado({ pagados = 0, reservados = 0, grupoCerrado = null }) {
    escenario();
    const s = await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    const evento = fake.tablas.eventos_bot.find(e => e.grupo_id === "g1@g.us");
    fake.tablas[TABLA].filter(f => f.usuario_id === A).forEach((f, i) => Object.assign(f, {
        estado: i < pagados ? "pagado" : i < pagados + reservados ? "reservado" : "libre",
        identidad_evento_real: i < pagados + reservados ? s.identidad_evento_real : null,
        evento_id: i < pagados + reservados ? evento.id : null
    }));
    if (grupoCerrado !== null) fake.tablas.grupos = [{ jid: "g1@g.us", announce: grupoCerrado }];
    await publicador.tick(sock, { ahora: EN_VENTANA_RECORDATORIO, deps: dep.d });
    return dep.enviados.filter(e => /Falta 1 hora/.test(e.text)).length;
}

prueba("F3-1b. recordatorio con números libres: se envía", async () => {
    assert.strictEqual(await publicadoConEstado({ pagados: 30, reservados: 10 }), 1);
});

prueba("F3-1c. todo pagado (falta 1 hora): NO se envía el recordatorio", async () => {
    assert.strictEqual(await publicadoConEstado({ pagados: 100 }), 0);
});

prueba("F3-1d. grupo cerrado antes de tiempo, sin pagos pendientes: NO se envía", async () => {
    assert.strictEqual(await publicadoConEstado({ pagados: 40, grupoCerrado: true }), 0);
});

prueba("F3-1e. sin libres pero con pagos pendientes: se envía (propósito del texto desconocido)", async () => {
    assert.strictEqual(await publicadoConEstado({ pagados: 60, reservados: 40 }), 1);
});

prueba("F3-1f. grupo cerrado con pagos pendientes: se envía (propósito del texto desconocido)", async () => {
    assert.strictEqual(await publicadoConEstado({ pagados: 60, reservados: 10, grupoCerrado: true }), 1);
});

prueba("F3-1g. sorteo finalizado: ningún recordatorio, solo el aviso de cierre", async () => {
    escenario();
    await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    Object.assign(fake.tablas.eventos_bot[0], { activo: false, estado: "cerrado" });
    await publicador.tick(sock, { ahora: EN_VENTANA_RECORDATORIO, deps: dep.d });
    assert.strictEqual(dep.enviados.filter(e => /Falta 1 hora/.test(e.text)).length, 0);
    assert.strictEqual(dep.enviados.filter(e => /cerrado/.test(e.text)).length, 1);
});

prueba("F3-2. aviso de cierre: UNA vez cuando el sorteo se cierra", async () => {
    escenario();
    await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    Object.assign(fake.tablas.eventos_bot[0], { activo: false, estado: "cerrado" });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.filter(e => /cerrado/.test(e.text)).length, 1);
});

prueba("F3-3. vencimiento: desactivado por defecto; activado libera SOLO reservas vencidas, nunca pagadas", async () => {
    escenario();
    const s1 = await creadoYConfirmado({ grupos: ["g1@g.us"] });
    const { sock } = crearSock();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: deps().d });
    const filasA = fake.tablas[TABLA].filter(f => f.usuario_id === A);
    Object.assign(filasA[1], { estado: "reservado", identidad_evento_real: s1.identidad_evento_real, fecha_reserva: "2026-10-15", hora_reserva: "10:35:00" });
    await publicador.tick(sock, { ahora: new Date("2026-10-15T18:00:00Z"), deps: deps().d });
    assert.strictEqual(filasA[1].estado, "reservado", "sin activarlo, nunca libera");

    escenario();
    const s2 = await creadoYConfirmado({ grupos: ["g1@g.us"], reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 } });
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: deps().d });
    const filas = fake.tablas[TABLA].filter(f => f.usuario_id === A);
    const marcar = (i, estado, hora) => Object.assign(filas[i], { estado, identidad_evento_real: s2.identidad_evento_real, fecha_reserva: "2026-10-15", hora_reserva: hora, comprador: "Cliente" });
    marcar(1, "reservado", "10:35:00");   // vencida a las 11:05
    marcar(2, "reservado", "11:50:00");   // reciente
    marcar(3, "pagado", "10:35:00");      // pagada: nunca
    await publicador.tick(sock, { ahora: new Date("2026-10-15T17:00:00Z"), deps: deps().d }); // 12:00 Colombia
    assert.strictEqual(filas[1].estado, "libre");
    assert.strictEqual(filas[1].usuario_global_id, null);
    assert.strictEqual(filas[2].estado, "reservado");
    assert.strictEqual(filas[3].estado, "pagado");
    assert.ok(fake.tablas.reservas_actividad.some(a => a.numero === "01" && a.tipo === "liberado" && a.realizado_por === "bot:vencimiento"));
});

prueba("F3-3b. vencimiento con pago CONCURRENTE (entre leer y liberar): el número pagado no se libera", async () => {
    escenario();
    const s = await creadoYConfirmado({ grupos: ["g1@g.us"], reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 } });
    const { sock } = crearSock();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: deps().d });
    const fila = fake.tablas[TABLA].find(f => f.usuario_id === A && f.numero === "07");
    Object.assign(fila, { estado: "reservado", identidad_evento_real: s.identidad_evento_real, fecha_reserva: "2026-10-15", hora_reserva: "10:35:00" });
    // El administrador confirma el pago justo después de que el publicador
    // leyó las reservas vencidas.
    fake.control.despuesDeLeer = (tabla) => { if (tabla === TABLA && fila.estado === "reservado") fila.estado = "pagado"; };
    try {
        await publicador.tick(sock, { ahora: new Date("2026-10-15T17:00:00Z"), deps: deps().d });
    } finally {
        fake.control.despuesDeLeer = null;
    }
    assert.strictEqual(fila.estado, "pagado", "el UPDATE condicionado a 'reservado' protege el pago");
    assert.ok(!(fake.tablas.reservas_actividad || []).some(a => a.numero === "07"));
});

prueba("F3-4. plantillas y cuentas: crear, usar, editar sin alterar sorteos existentes; nombre duplicado rechazado", async () => {
    escenario();
    const p = await servicio.crearPlantilla(A, { nombre: "Manizales noche", config: entrada() });
    assert.ok(p.ok, JSON.stringify(p));
    assert.strictEqual(p.data.config.grupos, undefined, "la plantilla no guarda grupos ni fecha");
    assert.strictEqual((await servicio.crearPlantilla(A, { nombre: "Manizales noche", config: entrada() })).motivo, "nombre_duplicado");
    const s = await servicio.crearSorteo(A, { ...p.data.config, grupos: ["g1@g.us"], publicar_en: PUBLICAR.toISOString(), plantilla_id: p.data.id });
    assert.ok(s.ok);
    await servicio.actualizarPlantilla(A, p.data.id, { nombre: "Manizales noche", config: { ...entrada(), valor: 10000 } });
    assert.strictEqual(sorteoDb(s.data.id).config.valor, 5000, "cambiar la plantilla no altera el sorteo");
    const cuenta = await servicio.crearCuenta(A, { nombre: "Daviplata", tipo: "daviplata", numero: "3110000000" });
    assert.ok(cuenta.ok);
    assert.strictEqual((await servicio.crearCuenta(A, { nombre: "" })).motivo, "validacion");
});

prueba("F4-1. aislamiento en el servicio: B no ve, edita, confirma, cancela ni usa recursos de A", async () => {
    escenario();
    const s = await creadoYConfirmado();
    assert.strictEqual((await servicio.obtenerSorteo(B, s.id)).motivo, "no_encontrado");
    assert.strictEqual((await servicio.vistaPrevia(B, s.id)).motivo, "no_encontrado");
    assert.strictEqual((await servicio.cancelar(B, s.id)).motivo, "no_encontrado");
    assert.strictEqual((await servicio.editar(B, s.id, { ...entrada(), version: 1 })).motivo, "no_encontrado");
    assert.strictEqual((await servicio.actualizarCuenta(B, "cuenta-a1", { numero: "robado" })).motivo, "no_encontrado");
    assert.deepStrictEqual((await servicio.listarSorteos(B)).data, []);
    assert.strictEqual(sorteoDb(s.id).estado, "programado");
    // El publicador de B nunca publica el sorteo de A.
    const { sock } = crearSock(B);
    const dep = deps();
    await publicador.tick(sock, { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0);
});

prueba("F4-2. API HTTP: sin token de servicio o sin sesión -> 401; el usuario sale del TOKEN, no del cuerpo", async () => {
    escenario();
    const app = express();
    app.use(express.json());
    delete require.cache[r("routes/sorteos.js")];
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const base = `http://127.0.0.1:${server.address().port}/sorteos`;
    const h = (jwt, servicioOk = true) => ({ "content-type": "application/json", ...(servicioOk ? { "x-service-token": "token-servicio-pruebas" } : {}), ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });
    try {
        assert.strictEqual((await fetch(base, { headers: h("jwt-A", false) })).status, 401, "sin token de servicio");
        assert.strictEqual((await fetch(base, { headers: h(null) })).status, 401, "sin sesión");
        assert.strictEqual((await fetch(base, { headers: h("jwt-falso") })).status, 401, "sesión inválida");

        const creado = await (await fetch(base, { method: "POST", headers: h("jwt-A"), body: JSON.stringify({ ...entrada(), usuarioId: B, usuario_id: B }) })).json();
        assert.ok(creado.ok, JSON.stringify(creado));
        assert.strictEqual(sorteoDb(creado.data.id).usuario_id, A, "ignora el usuarioId del cuerpo");

        const ajeno = await fetch(`${base}/${creado.data.id}`, { headers: h("jwt-B") });
        assert.strictEqual(ajeno.status, 404, "B no ve el sorteo de A");
        const cancelarAjeno = await fetch(`${base}/${creado.data.id}/cancelar`, { method: "POST", headers: h("jwt-B") });
        assert.strictEqual(cancelarAjeno.status, 404);
        assert.strictEqual(sorteoDb(creado.data.id).estado, "borrador");

        const listaB = await (await fetch(base, { headers: h("jwt-B") })).json();
        assert.deepStrictEqual(listaB.data, []);

        const sinConfirmar = await fetch(`${base}/${creado.data.id}/confirmar`, { method: "POST", headers: h("jwt-A"), body: JSON.stringify({ version: 1 }) });
        assert.strictEqual(sinConfirmar.status, 400);
    } finally {
        server.close();
    }
});

// ---------------------------------------------------------------- runner ---

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            salida(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            salida(`❌ ${nombre}`);
            salida(String(err && err.stack || err));
        }
    }

    Object.assign(console, originales);

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
