// ==========================================================================
// PRUEBAS — administración de sorteos programados (sorteos/administracion.js):
// estado operativo, detalle por grupo, cancelar, eliminar, archivar.
//
// Reales: sorteos/{administracion,servicio,repo,publicador,disponibilidad,
// validar,reservasAnticipadas}.js, guardarEvento, consultarEvento,
// abrirGrupo, executionGuard, «Compartir» (compartirSimulado), routes/sorteos.js
// y la autenticación por token.
// Simulados: Supabase (memoria), el socket de WhatsApp, el envío de
// mensajes (espía) y, en una prueba, la función de reinicio de la 030.
// Nunca se envía nada real ni se toca Supabase real.
//
//     node backend/tests/sorteos/administracionProgramados.test.js
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
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) }, rpc: async () => ({ data: null, error: { message: "sin rpc en esta prueba" } }) }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { depsCompartir } = require("./compartirSimulado");

// 15/10 10:00 Colombia. Se publica a las 10:30; se juega a las 22:30
// (cierre de reservas 22:26).
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-15T15:30:00Z");
const EN_PUBLICACION = new Date("2026-10-15T15:31:00Z");
const TRAS_CIERRE = new Date("2026-10-16T03:27:00Z");   // 22:27, antes del sorteo
const TRAS_SORTEO = new Date("2026-10-16T04:00:00Z");   // 23:00
servicio._reloj.ahora = () => T0;
// Otra programación, para el día siguiente (no choca con la de hoy).
const MANANA = { nombre: "Pendiente", publicar_en: "2026-10-16T15:30:00Z", fecha_sorteo: "2026-10-16", grupos: ["g2@g.us"] };

const A ="aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABLA = "reservas_dos_cifras";

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", activa: true }
    ];
    t.eventos_bot = [];
    t.reservas_actividad = [];
    t[TABLA] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    servicio._reloj.ahora = () => T0;
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Lotería de Manizales",
        hora_fin: "22:30",
        valor: 1000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-15",
        mensajes: { publicacion: "{{nombre}} {{fecha}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

function deps({ fallaEnvio = () => false } = {}) {
    const enviados = [];
    const d = {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        sendMessage: async ({ jid, text }) => {
            if (fallaEnvio(jid)) throw new Error("Connection Closed (simulado)");
            enviados.push({ jid, text });
        }
    };
    Object.assign(d, depsCompartir(() => d.sendMessage));
    return { enviados, d };
}

const sock = (usuarioId = A) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
    groupSettingUpdate: async () => {}
});

const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);
const grupoDe = (id, g) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === g);
const historial = (id) => (fake.tablas.sorteos_programados_historial || []).filter(h => h.sorteo_id === id);
const filasDe = (u = A) => fake.tablas[TABLA].filter(f => f.usuario_id === u);
const instantanea = () => JSON.stringify({ eventos: fake.tablas.eventos_bot, numeros: fake.tablas[TABLA], actividad: fake.tablas.reservas_actividad });

async function borrador(extra = {}, usuario = A) {
    const c = await servicio.crearSorteo(usuario, entrada(extra));
    assert.ok(c.ok, JSON.stringify(c));
    return c.data;
}

async function programado(extra = {}, usuario = A) {
    const c = await borrador(extra, usuario);
    const conf = await servicio.confirmar(usuario, c.id, { version: c.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

// Publicado en los grupos del sorteo, con reservas y pagos de su identidad.
async function publicadoConReservas(extra = {}) {
    const s = await programado(extra);
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: deps().d });
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    filasDe().slice(0, 3).forEach((f, i) => Object.assign(f, {
        estado: i === 0 ? "pagado" : "reservado", identidad_evento_real: s.identidad_evento_real, comprador: `Cliente ${i}`
    }));
    return sorteoDb(s.id);
}

const gestionDe = async (id) => {
    const r = await servicio.gestion(A);
    assert.ok(r.ok, JSON.stringify(r));
    return r.data.find(s => s.id === id);
};

async function conServidor(fn) {
    const app = express();
    app.use(express.json());
    delete require.cache[r("routes/sorteos.js")];
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    const base = `http://127.0.0.1:${server.address().port}/sorteos`;
    const pedir = async (metodo, ruta, { jwt = "jwt-A", cuerpo } = {}) => {
        const res = await fetch(`${base}${ruta}`, {
            method: metodo,
            headers: { "content-type": "application/json", "x-service-token": "token-servicio-pruebas", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    try { await fn(pedir); } finally { server.close(); }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------ cancelar ---

prueba("1. programación pendiente que se cancela: grupos cancelados, operativo «cancelado», historial con el resultado real", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    const c = await servicio.cancelar(A, s.id);
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(c.data.estado, "cancelado");
    assert.ok(c.data.grupos.every(g => g.estado === "cancelado"));
    assert.deepStrictEqual(c.resultado, { cancelados: 2, en_curso: 0, publicados: 0, en_revision: 0, eventos_abiertos: 0 });
    assert.ok(/Se cancelaron 2 grupo/.test(c.aviso), c.aviso);

    const g = await gestionDe(s.id);
    assert.strictEqual(g.gestion.operativo.estado, "cancelado");
    assert.strictEqual(g.gestion.acciones.cancelar, false);
    assert.strictEqual(g.gestion.acciones.editar, false);
    assert.strictEqual(g.gestion.acciones.eliminar, true, "sin actividad: se puede borrar");

    const h = historial(s.id);
    assert.strictEqual(h.length, 1);
    assert.deepStrictEqual([h[0].accion, h[0].resultado, h[0].detalle.estado_previo, h[0].detalle.cancelados], ["cancelar", "cancelado", "programado", 2]);
});

prueba("2. doble clic en cancelar (dos peticiones a la vez): un solo efecto y un solo registro", async () => {
    escenario();
    const s = await programado();
    const [x, y] = await Promise.all([servicio.cancelar(A, s.id), servicio.cancelar(A, s.id)]);
    assert.ok(x.ok && y.ok, JSON.stringify([x, y]));
    assert.strictEqual(sorteoDb(s.id).estado, "cancelado");
    assert.strictEqual(historial(s.id).length, 1, JSON.stringify(historial(s.id)));
    assert.ok([x.aviso, y.aviso].some(a => /ya estaba cancelada/.test(a || "")));
    const tercera = await servicio.cancelar(A, s.id);
    assert.ok(tercera.ok && /ya estaba cancelada/.test(tercera.aviso));
    assert.strictEqual(historial(s.id).length, 1);
});

prueba("3. cancelada no se publica después: ni a su hora ni con un reintento manual", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    await servicio.cancelar(A, s.id);
    const dep = deps();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: dep.d });
    await publicador.tick(sock(), { ahora: new Date(EN_PUBLICACION.getTime() + 60000), deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0);
    assert.strictEqual(fake.tablas.eventos_bot.length, 0, "ni siquiera crea el evento");
    assert.strictEqual((await servicio.reintentarGrupo(A, s.id, "g1@g.us")).motivo, "estado_invalido");
});

prueba("4. cancelada MIENTRAS el publicador tenía la programación leída: no reinicia la tabla ni publica", async () => {
    escenario();
    const s = await programado();
    // La programación pidió reiniciar la tabla al publicar (ya confirmado).
    const fila = sorteoDb(s.id);
    fila.config = { ...fila.config, tabla: { reiniciar: true, reiniciar_al_publicar: true, reiniciado_en: null } };

    const reinicio = { aplicados: 0 };
    const dep = deps();
    dep.d.reinicioTabla = {
        revisarReinicio: async () => ({ ok: true, data: { posible: true, liberables: 5, huella: "h", bloqueos: [] }, porSorteo: [] }),
        aplicarReinicio: async () => { reinicio.aplicados++; return { ok: true }; }
    };

    // El administrador cancela justo después de que el publicador lee las
    // programaciones pendientes (misma escritura que hace cancelar()).
    let disparado = false;
    fake.control.despuesDeLeer = (tabla) => {
        if (tabla !== "sorteos_programados" || disparado) return;
        disparado = true;
        Object.assign(sorteoDb(s.id), { estado: "cancelado", cancelado_en: T0.toISOString() });
        grupoDe(s.id, "g1@g.us").estado = "cancelado";
    };

    // Un minuto antes del anuncio: momento del reinicio anticipado.
    await publicador.tick(sock(), { ahora: new Date(PUBLICAR.getTime() - 30000), deps: dep.d });
    fake.control.despuesDeLeer = null;
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: dep.d });

    assert.ok(disparado);
    assert.strictEqual(reinicio.aplicados, 0, "no reinició la tabla de una programación cancelada");
    assert.strictEqual(dep.enviados.length, 0);
    assert.strictEqual(sorteoDb(s.id).config.tabla.reiniciado_en, null);
});

prueba("5. cancelar con un grupo publicándose en ese instante: ese no se toca y se informa; el pendiente sí se cancela", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    // El publicador ya tomó la programación y reclamó g1.
    sorteoDb(s.id).estado = "publicando";
    Object.assign(grupoDe(s.id, "g1@g.us"), { estado: "publicando", intentos: 1 });
    const c = await servicio.cancelar(A, s.id);
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicando", "no se pisa un envío en curso");
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "cancelado");
    assert.strictEqual(sorteoDb(s.id).estado, "publicando", "el publicador lo cierra al terminar ese envío");
    assert.ok(/se estaban publicando/.test(c.aviso), c.aviso);
    assert.strictEqual(historial(s.id)[0].resultado, "cancelado_parcial");
});

// ------------------------------------------------------------ eliminar ---

prueba("6. eliminación segura sin actividad (borrador y programada): se borra la fila y sus grupos; queda el registro", async () => {
    escenario();
    const antes = instantanea();
    for (const crear of [borrador, programado]) {
        const s = await crear({ grupos: ["g1@g.us", "g2@g.us"] });
        const g = await gestionDe(s.id);
        assert.strictEqual(g.gestion.acciones.eliminar, true, JSON.stringify(g.gestion.eliminacion));
        const e = await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true });
        assert.ok(e.ok, JSON.stringify(e));
        assert.strictEqual(sorteoDb(s.id), undefined);
        assert.strictEqual(fake.tablas.sorteos_programados_grupos.filter(x => x.sorteo_id === s.id).length, 0);
        const h = historial(s.id);
        assert.deepStrictEqual([h.length, h[0].accion, h[0].resultado], [1, "eliminar", "eliminado"]);
        assert.deepStrictEqual(h[0].detalle.grupos.map(g => g.grupo), ["Grupo 1", "Grupo 2"]);
    }
    assert.strictEqual(instantanea(), antes, "ni eventos, ni números, ni actividad");
});

prueba("7. eliminar exige confirmación y la versión vista; doble clic: el segundo no encuentra nada", async () => {
    escenario();
    const s = await programado();
    assert.strictEqual((await servicio.eliminar(A, s.id, { version: s.version })).motivo, "confirmacion_requerida");
    assert.strictEqual((await servicio.eliminar(A, s.id, { version: s.version + 1, confirmacion: true })).motivo, "version_cambiada");
    assert.ok(sorteoDb(s.id), "no se borró nada");
    const [x, y] = await Promise.all([
        servicio.eliminar(A, s.id, { version: s.version, confirmacion: true }),
        servicio.eliminar(A, s.id, { version: s.version, confirmacion: true })
    ]);
    assert.deepStrictEqual([x.ok, y.ok].sort(), [false, true], JSON.stringify([x, y]));
    assert.ok(["no_encontrado", "version_cambiada"].includes((x.ok ? y : x).motivo), JSON.stringify([x, y]));
    assert.strictEqual(sorteoDb(s.id), undefined);
    assert.strictEqual(historial(s.id).filter(h => h.resultado === "eliminado").length, 1);
});

prueba("8. una reserva anticipada que entra durante la eliminación: sin la segunda confirmación no se borra y la programación vuelve a 'programado'", async () => {
    escenario();
    const s = await programado();
    // La reserva entra justo antes de que la eliminación saque la
    // programación del alcance del publicador.
    let disparado = false;
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== "sorteos_programados" || disparado) return;
        disparado = true;
        Object.assign(filasDe()[7], { estado: "reservado", identidad_evento_real: s.identidad_evento_real, comprador: "Anticipado" });
    };
    const e = await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true });
    fake.control.antesDeEscribir = null;
    assert.strictEqual(e.motivo, "confirmacion_actividad_requerida", JSON.stringify(e));
    assert.ok(e.avisos.some(a => /1 número\(s\) tomados/.test(a)), JSON.stringify(e.avisos));
    assert.strictEqual(sorteoDb(s.id).estado, "programado", "se deja como estaba");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "pendiente", "el grupo también");
    assert.strictEqual(sorteoDb(s.id).cancelado_en, null);
    assert.strictEqual(filasDe()[7].estado, "reservado", "la reserva no se toca");
    assert.strictEqual(historial(s.id)[0].resultado, "rechazado");
    // Sigue publicándose con normalidad.
    const dep = deps();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 1);
});

// ------------------------------------------------- publicación parcial ---

prueba("9. publicación parcial: detalle por grupo, intervención manual, abierta: hay que cerrarla antes de eliminar; cancelar no toca el grupo en revisión", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: deps({ fallaEnvio: (jid) => jid === "g2@g.us" }).d });
    assert.strictEqual(sorteoDb(s.id).estado, "publicado_parcial");

    const g = await gestionDe(s.id);
    assert.strictEqual(g.gestion.operativo.estado, "en_curso");
    assert.strictEqual(g.gestion.operativo.reservas, "abiertas");
    const [g1, g2] = g.gestion.grupos;
    assert.strictEqual(g1.estado, "publicado");
    assert.ok(/^Publicado el /.test(g1.explicacion), g1.explicacion);
    assert.strictEqual(g1.intervencion, null);
    assert.strictEqual(g2.estado, "requiere_revision");
    assert.ok(/pudo haber llegado/.test(g2.intervencion), g2.intervencion);
    assert.strictEqual(g2.puede_reintentar, true);
    assert.strictEqual(g.gestion.necesita_intervencion, true);
    assert.strictEqual(g.gestion.acciones.eliminar, false);
    assert.ok(g.gestion.eliminacion.bloqueos.some(b => /Sigue abierto/.test(b)), JSON.stringify(g.gestion.eliminacion));
    assert.strictEqual(g.gestion.acciones.archivar, false, "en curso: no se archiva");

    // El grupo en revisión ya tiene evento: cancelar no lo toca, y no queda nada más pendiente.
    const c = await servicio.cancelar(A, s.id);
    assert.strictEqual(c.motivo, "nada_que_cancelar", JSON.stringify(c));
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "requiere_revision");
});

prueba("10. parcial con un grupo EN ESPERA: cancelar cancela ese grupo, el publicado sigue y el estado final es 'publicado'", async () => {
    escenario();
    // g2 tiene otro sorteo abierto: el publicador lo deja en espera.
    fake.tablas.eventos_bot.push({ id: "ev-otro", grupo_id: "g2@g.us", usuario_id: A, activo: true, estado: "abierto", identidad_evento_real: "otro", nombre_evento: "Boyacá", fecha_evento: "2026-10-15", hora_fin: "23:00", hora_cierre: "22:55", tabla: "otra_tabla" });
    const c0 = await servicio.crearSorteo(A, entrada({ grupos: ["g1@g.us", "g2@g.us"] }));
    // El conflicto aparece después de programar (la vista previa lo bloquearía).
    fake.tablas.eventos_bot[0].activo = false;
    const conf = await servicio.confirmar(A, c0.data.id, { version: 1, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    fake.tablas.eventos_bot[0].activo = true;
    const s = conf.data;

    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: deps().d });
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "pendiente");
    const g = await gestionDe(s.id);
    assert.strictEqual(g.gestion.grupos[1].en_espera, true);
    assert.strictEqual(g.gestion.acciones.cancelar, true);

    const antes = instantanea();
    const c = await servicio.cancelar(A, s.id);
    assert.ok(c.ok, JSON.stringify(c));
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "cancelado");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "publicado");
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.ok(/Ya estaba publicado en 1 grupo/.test(c.aviso) && /Se cancelaron 1 grupo/.test(c.aviso), c.aviso);
    assert.strictEqual(instantanea(), antes, "eventos y números intactos");

    // Aunque el otro sorteo cierre, g2 ya no se publica.
    fake.tablas.eventos_bot[0].activo = false;
    const dep = deps();
    await publicador.tick(sock(), { ahora: new Date(EN_PUBLICACION.getTime() + 120000), deps: dep.d });
    assert.strictEqual(dep.enviados.filter(e => e.jid === "g2@g.us" && e.image).length, 0);
});

// ------------------------------------------- publicado con reservas ---

prueba("11. publicado con reservas: el impacto se muestra, abierto no se elimina, nada se borra; se archiva solo al terminar", async () => {
    escenario();
    const s = await publicadoConReservas({ grupos: ["g1@g.us", "g2@g.us"] });
    const antes = instantanea();

    const g = await gestionDe(s.id);
    assert.deepStrictEqual(g.gestion.impacto.reservas, { reservados: 2, pagados: 1, otros: 0, total: 3 });
    assert.strictEqual(g.gestion.impacto.anticipadas, 0);
    assert.strictEqual(g.gestion.acciones.eliminar, false);
    assert.strictEqual(g.gestion.acciones.cancelar, false, "no queda nada pendiente");

    const e = await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true });
    assert.strictEqual(e.motivo, "no_eliminable");
    assert.ok(/Sigue abierto en 2 grupo/.test(e.mensaje), e.mensaje);
    assert.strictEqual((await servicio.archivar(A, s.id, { archivar: true })).motivo, "estado_invalido", "en curso: no se archiva");
    assert.ok(sorteoDb(s.id));
    assert.strictEqual(instantanea(), antes, "ni reservas, ni pagos, ni eventos cambian");

    // Las reservas cierran (como cerrarEvento) y pasa la hora del sorteo.
    fake.tablas.eventos_bot.forEach(ev => Object.assign(ev, { activo: false, abierto: false, estado: "cerrado" }));
    servicio._reloj.ahora = () => TRAS_SORTEO;
    const terminado = await gestionDe(s.id);
    assert.strictEqual(terminado.gestion.operativo.estado, "terminado");
    assert.strictEqual(terminado.gestion.acciones.archivar, true);
    assert.strictEqual(terminado.gestion.acciones.eliminar, true, "ya cerrado, decide el administrador");

    const despuesCierre = instantanea();
    const a = await servicio.archivar(A, s.id, { archivar: true });
    assert.ok(a.ok, JSON.stringify(a));
    assert.ok(sorteoDb(s.id).archivado_en);
    assert.strictEqual(sorteoDb(s.id).estado, "publicado", "archivar no cambia el estado");
    assert.strictEqual(instantanea(), despuesCierre, "archivar no toca nada más");
    assert.ok((await servicio.archivar(A, s.id, { archivar: true })).aviso, "segunda vez: ya estaba");
    const archivado = await gestionDe(s.id);
    assert.deepStrictEqual([archivado.gestion.acciones.restaurar, archivado.gestion.acciones.eliminar, archivado.gestion.acciones.cancelar], [true, false, false]);

    const rest = await servicio.archivar(A, s.id, { archivar: false });
    assert.ok(rest.ok && !sorteoDb(s.id).archivado_en);
    // El rechazo previo a tocar nada no deja registro; la segunda vez «ya estaba», tampoco.
    assert.deepStrictEqual(historial(s.id).map(h => h.accion), ["archivar", "restaurar"]);
});

// --------------------------------------------- estados del sorteo ---

prueba("12. estados operativos: «Publicado» no es «terminado»; cierre de reservas, hora del sorteo, fila reutilizada", async () => {
    escenario();
    const s = await publicadoConReservas();
    const estado = async () => (await gestionDe(s.id)).gestion.operativo;

    assert.strictEqual((await estado()).estado, "en_curso");
    assert.strictEqual((await estado()).reservas, "abiertas");

    // Reservas cerradas pero el sorteo todavía no se juega: sigue en curso.
    fake.tablas.eventos_bot.forEach(ev => Object.assign(ev, { activo: false, estado: "cerrado" }));
    servicio._reloj.ahora = () => TRAS_CIERRE;
    assert.deepStrictEqual([(await estado()).estado, (await estado()).reservas], ["en_curso", "cerradas"]);

    servicio._reloj.ahora = () => TRAS_SORTEO;
    assert.strictEqual((await estado()).estado, "terminado");

    // La fila del grupo pasó a otro sorteo (se reutiliza): sigue «terminado».
    fake.tablas.eventos_bot.forEach(ev => Object.assign(ev, { identidad_evento_real: "otro-sorteo", activo: true, estado: "abierto" }));
    const reutilizado = await gestionDe(s.id);
    assert.strictEqual(reutilizado.gestion.operativo.estado, "terminado");
    assert.ok(/otro sorteo/.test(reutilizado.gestion.operativo.detalle));
    assert.strictEqual(reutilizado.gestion.grupos[0].evento, "reutilizado");
});

prueba("13. estados sin publicar: pendiente, cancelado y «sin publicar» si su cierre pasó", async () => {
    escenario();
    const pendiente = await programado();
    assert.strictEqual((await gestionDe(pendiente.id)).gestion.operativo.estado, "pendiente");
    const b = await borrador({ nombre: "Otro sorteo", hora_fin: "21:00" });
    assert.ok(/Sin confirmar/.test((await gestionDe(b.id)).gestion.operativo.detalle));

    await servicio.cancelar(A, b.id);
    assert.strictEqual((await gestionDe(b.id)).gestion.operativo.estado, "cancelado");

    // El bot estuvo apagado: el cierre pasó sin publicarse.
    servicio._reloj.ahora = () => TRAS_CIERRE;
    const vencido = await gestionDe(pendiente.id);
    assert.strictEqual(vencido.gestion.operativo.estado, "sin_publicar");
    assert.strictEqual(vencido.gestion.acciones.archivar, false, "primero hay que cancelarla");
    assert.strictEqual(vencido.gestion.acciones.cancelar, true);
});

// ------------------------------------------------------- permisos ---

prueba("14. permisos: otro cliente no ve, cancela, elimina, archiva ni lee el detalle (404); sin sesión 401", async () => {
    escenario();
    const s = await programado();
    for (const intento of [
        () => servicio.cancelar(B, s.id),
        () => servicio.eliminar(B, s.id, { version: s.version, confirmacion: true }),
        () => servicio.archivar(B, s.id, { archivar: true }),
        () => servicio.detalle(B, s.id)
    ]) assert.strictEqual((await intento()).motivo, "no_encontrado");
    assert.deepStrictEqual((await servicio.gestion(B)).data, []);

    await conServidor(async (pedir) => {
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { jwt: null, cuerpo: { version: 1, confirmacion: true } })).status, 401);
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { jwt: "jwt-B", cuerpo: { version: 1, confirmacion: true } })).status, 404);
        assert.strictEqual((await pedir("POST", `/${s.id}/cancelar`, { jwt: "jwt-B" })).status, 404);
        assert.strictEqual((await pedir("POST", `/${s.id}/archivar`, { jwt: "jwt-B", cuerpo: { archivar: true } })).status, 404);
        assert.strictEqual((await pedir("GET", `/${s.id}/detalle`, { jwt: "jwt-B" })).status, 404);
        const listaB = await pedir("GET", "/gestion", { jwt: "jwt-B" });
        assert.deepStrictEqual(listaB.json.data, []);
        assert.strictEqual(sorteoDb(s.id).estado, "programado", "nada cambió");

        // El dueño: sin confirmación 400; con ella, 200; repetirla, 404.
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { cuerpo: { version: s.version } })).status, 400);
        const ok = await pedir("POST", `/${s.id}/eliminar`, { cuerpo: { version: s.version, confirmacion: true } });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { cuerpo: { version: s.version, confirmacion: true } })).status, 404);
    });
});

prueba("15. la API rechaza en el backend lo que el panel no mostraría: eliminar publicado (409) y archivar pendiente (409)", async () => {
    escenario();
    const pend = await programado(MANANA);
    const pub = await publicadoConReservas();
    await conServidor(async (pedir) => {
        const e = await pedir("POST", `/${pub.id}/eliminar`, { cuerpo: { version: pub.version, confirmacion: true } });
        assert.strictEqual(e.status, 409);
        assert.strictEqual(e.json.motivo, "no_eliminable");
        assert.ok(Array.isArray(e.json.bloqueos) && e.json.bloqueos.length >= 1, JSON.stringify(e.json));
        const a = await pedir("POST", `/${pend.id}/archivar`, { cuerpo: { archivar: true } });
        assert.strictEqual(a.status, 409);
        const c = await pedir("POST", `/${pub.id}/cancelar`);
        assert.strictEqual(c.status, 409);
        assert.strictEqual(c.json.motivo, "nada_que_cancelar");
    });
    assert.ok(sorteoDb(pub.id) && sorteoDb(pend.id));
});

// ---------------------------------- conservación, historial y detalle ---

prueba("16. detalle: grupos explicados, intentos y línea de tiempo con publicación y operaciones", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: deps({ fallaEnvio: (jid) => jid === "g2@g.us" }).d });
    // Doble clic en reintentar: un solo reintento y un solo registro.
    const [r1, r2] = await Promise.all([servicio.reintentarGrupo(A, s.id, "g2@g.us"), servicio.reintentarGrupo(A, s.id, "g2@g.us")]);
    assert.ok(r1.ok || r2.ok, JSON.stringify([r1, r2]));
    const r3 = await servicio.reintentarGrupo(A, s.id, "g2@g.us");
    assert.ok(r3.ok && /ya estaba pedido/.test(r3.aviso), JSON.stringify(r3));
    assert.strictEqual(grupoDe(s.id, "g2@g.us").reintentos_manuales, 1);
    assert.strictEqual(historial(s.id).filter(h => h.accion === "reintentar").length, 1);
    await publicador.tick(sock(), { ahora: new Date(EN_PUBLICACION.getTime() + 30000), deps: deps().d });

    const d = await servicio.detalle(A, s.id);
    assert.ok(d.ok, JSON.stringify(d));
    const g2 = d.data.gestion.grupos.find(g => g.grupo_id === "g2@g.us");
    assert.strictEqual(g2.estado, "publicado");
    assert.ok(/tras 1 reintento\(s\) manual/.test(g2.explicacion), g2.explicacion);
    const tipos = d.data.historial.map(h => h.tipo);
    for (const t of ["creado", "confirmado", "publicado", "reintentar"]) assert.ok(tipos.includes(t), `${t} en ${tipos}`);
    assert.strictEqual(d.data.historial.filter(h => h.tipo === "publicado").length, 2);
    assert.strictEqual(d.data.historial_completo, true);
    assert.ok(d.data.gestion.ultima_actualizacion);
});

prueba("17. sin la migración 038: cancelar y eliminar funcionan (registro al log), el detalle avisa y archivar responde 'migracion_pendiente'", async () => {
    escenario();
    fake.control.tablasInexistentes.add("sorteos_programados_historial");
    const log = console.log; const lineas = []; console.log = (...a) => lineas.push(a.join(" "));
    try {
        const s = await programado();
        assert.ok((await servicio.cancelar(A, s.id)).ok);
        const d = await servicio.detalle(A, s.id);
        assert.strictEqual(d.data.historial_completo, false);
        assert.ok(d.data.historial.some(h => h.tipo === "cancelar"), "se deduce de cancelado_en");
        assert.ok((await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true })).ok);
    } finally { console.log = log; }
    assert.strictEqual(lineas.filter(l => /SORTEOS HISTORIAL/.test(l)).length, 2, lineas.join("\n"));

    // Columna archivado_en inexistente.
    escenario();
    const pub = await publicadoConReservas();
    fake.tablas.eventos_bot.forEach(ev => Object.assign(ev, { activo: false, estado: "cerrado" }));
    servicio._reloj.ahora = () => TRAS_SORTEO;
    const original = fake.client.from;
    fake.client.from = (t) => {
        const q = original(t);
        if (t !== "sorteos_programados") return q;
        const update = q.update;
        q.update = (x) => ("archivado_en" in x ? { eq() { return this; }, is() { return this; }, not() { return this; }, select: async () => ({ data: null, error: { code: "PGRST204", message: "column archivado_en" } }) } : update(x));
        return q;
    };
    try {
        const a = await servicio.archivar(A, pub.id, { archivar: true });
        assert.strictEqual(a.motivo, "migracion_pendiente", JSON.stringify(a));
    } finally { fake.client.from = original; }
});

prueba("18. conservación: después de cancelar, rechazar eliminaciones y archivar, las reservas, pagos, eventos y la actividad son idénticos; el otro cliente no cambia", async () => {
    escenario();
    const deB = await programado({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"] }, B);
    const pend = await programado(MANANA);
    const s = await publicadoConReservas({ grupos: ["g1@g.us", "g2@g.us"] });
    const antesB = JSON.stringify({ s: sorteoDb(deB.id), g: grupoDe(deB.id, "gb@g.us"), n: filasDe(B) });
    const antes = instantanea();

    await servicio.cancelar(A, s.id);                                   // nada que cancelar
    await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true });  // rechazado
    await servicio.cancelar(A, pend.id);
    await servicio.eliminar(A, pend.id, { version: pend.version, confirmacion: true });
    assert.strictEqual(sorteoDb(pend.id), undefined);
    assert.strictEqual(instantanea(), antes);
    assert.strictEqual(JSON.stringify({ s: sorteoDb(deB.id), g: grupoDe(deB.id, "gb@g.us"), n: filasDe(B) }), antesB);
    assert.strictEqual(filasDe().filter(f => f.estado !== "libre").length, 3);
});

// ---------------------------------- eliminar con actividad (UX-06) ---

const CONFIRMADO = { confirmacion: true, confirmacion_actividad: true };

// Como la programación real de producción: confirmada, su fecha pasó, 5
// intentos por grupo fallidos, en revisión, con evento_bot_id que apuntan a
// filas que hoy son de OTRO sorteo (la fila de eventos_bot se reutiliza).
async function fallidaConEnlacesViejos() {
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    const ajeno = (id, grupo) => ({ id, usuario_id: A, grupo_id: grupo, activo: true, abierto: true, estado: "abierto", nombre_evento: "Antioqueñita Día", identidad_evento_real: "otra-identidad", valor: 1000, tabla: TABLA });
    fake.tablas.eventos_bot.push(ajeno("ev-ajeno-1", "g1@g.us"), ajeno("ev-ajeno-2", "g2@g.us"));
    Object.assign(sorteoDb(s.id), { estado: "fallido" });
    ["g1@g.us", "g2@g.us"].forEach((g, i) => Object.assign(grupoDe(s.id, g), {
        estado: "requiere_revision", intentos: 5, evento_bot_id: `ev-ajeno-${i + 1}`,
        ultimo_error: "No se pudo generar la imagen de la tabla (Falta FRONTEND_URL); no se envió nada."
    }));
    return sorteoDb(s.id);
}

prueba("19. fallida con fecha pasada y 10 intentos: pide doble confirmación, se elimina y NO toca los eventos a los que apuntaban sus enlaces viejos", async () => {
    escenario();
    const s = await fallidaConEnlacesViejos();
    servicio._reloj.ahora = () => TRAS_SORTEO;
    const antes = instantanea();

    const g = await gestionDe(s.id);
    assert.strictEqual(g.gestion.acciones.eliminar, true, JSON.stringify(g.gestion.eliminacion));
    assert.deepStrictEqual(g.gestion.eliminacion.bloqueos, []);
    assert.strictEqual(g.gestion.eliminacion.con_actividad, true);
    assert.ok(g.gestion.eliminacion.avisos.some(a => /10 intento/.test(a)), JSON.stringify(g.gestion.eliminacion.avisos));
    assert.ok(!g.gestion.eliminacion.avisos.some(a => /llegó a/.test(a)), "no se envió nada");

    const sinDoble = await servicio.eliminar(A, s.id, { version: s.version, confirmacion: true });
    assert.strictEqual(sinDoble.motivo, "confirmacion_actividad_requerida", JSON.stringify(sinDoble));
    assert.strictEqual(sorteoDb(s.id).estado, "fallido", "sin la segunda confirmación no cambia nada");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "requiere_revision");

    const e = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual(sorteoDb(s.id), undefined);
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.filter(x => x.sorteo_id === s.id).length, 0);
    assert.strictEqual(instantanea(), antes, "eventos, números y actividad idénticos");
    const h = historial(s.id).at(-1);
    assert.deepStrictEqual([h.accion, h.resultado, h.detalle.estado_previo, h.detalle.impacto.intentos], ["eliminar", "eliminado", "fallido", 10]);
});

prueba("20. con publicaciones reales y sorteo ya cerrado: avisa que WhatsApp no se deshace, se puede eliminar; reservas, pagos, eventos y envíos intactos", async () => {
    escenario();
    const s = await publicadoConReservas({ grupos: ["g1@g.us", "g2@g.us"] });
    fake.tablas.eventos_bot.forEach(ev => Object.assign(ev, { activo: false, abierto: false, estado: "cerrado" }));
    servicio._reloj.ahora = () => TRAS_SORTEO;
    const antes = instantanea();
    const envios = JSON.stringify(fake.tablas.automation_actions);

    const g = await gestionDe(s.id);
    assert.strictEqual(g.gestion.acciones.eliminar, true, JSON.stringify(g.gestion.eliminacion));
    assert.ok(g.gestion.eliminacion.avisos.some(a => /llegó a 2 grupo/.test(a) && /no lo borra de WhatsApp/.test(a)), JSON.stringify(g.gestion.eliminacion.avisos));
    assert.ok(g.gestion.eliminacion.avisos.some(a => /2 reservado\(s\), 1 pagado\(s\)/.test(a) && /no se liberan ni se borran/.test(a)));

    const e = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    assert.ok(e.ok, JSON.stringify(e));
    assert.strictEqual(instantanea(), antes);
    assert.strictEqual(JSON.stringify(fake.tablas.automation_actions), envios, "el registro de envíos se conserva");
    assert.ok(historial(s.id).length >= 1, "la auditoría sobrevive a la programación");
});

prueba("21. no vuelve a ejecutarse: un ciclo que ya leyó la lista no puede reclamar sus grupos, el publicador no la toma y un reintento no la revive", async () => {
    escenario();
    const repo = require(r("sorteos/repo.js"));
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    Object.assign(sorteoDb(s.id), { estado: "publicando" });
    ["g1@g.us", "g2@g.us"].forEach(g => Object.assign(grupoDe(s.id, g), { estado: "fallido", intentos: 2 }));
    servicio._reloj.ahora = () => EN_PUBLICACION;
    // Lo que un ciclo en marcha ya tiene en memoria.
    const leidos = fake.tablas.sorteos_programados_grupos.filter(x => x.sorteo_id === s.id).map(x => ({ ...x }));

    // Mientras se elimina (grupos ya detenidos), el publicador tampoco puede reclamarlos.
    let reclamoDurante = null;
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla === "sorteos_programados" && sorteoDb(s.id)?.estado === "cancelado" && reclamoDurante === null) {
            reclamoDurante = fake.tablas.sorteos_programados_grupos.filter(x => x.sorteo_id === s.id).map(x => x.estado);
        }
    };
    const e = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    fake.control.antesDeEscribir = null;
    assert.ok(e.ok, JSON.stringify(e));

    for (const g of leidos) assert.strictEqual((await repo.reclamarGrupo(A, g.id, g.intentos)).ok, false, "la lista vieja no reclama nada");

    const dep = deps();
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: dep.d });
    assert.strictEqual(dep.enviados.length, 0, "nada publicado");
    assert.strictEqual(sorteoDb(s.id), undefined, "no reaparece");
    assert.strictEqual((await servicio.reintentarGrupo(A, s.id, "g1@g.us")).motivo, "no_encontrado");
});

prueba("22. publicando AHORA: espera y deja todo como estaba; un «publicando» huérfano (proceso muerto) no bloquea para siempre", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    Object.assign(sorteoDb(s.id), { estado: "publicando" });
    Object.assign(grupoDe(s.id, "g1@g.us"), { estado: "publicando", intentos: 1, actualizado_en: EN_PUBLICACION.toISOString() });
    Object.assign(grupoDe(s.id, "g2@g.us"), { estado: "pendiente" });
    servicio._reloj.ahora = () => new Date(EN_PUBLICACION.getTime() + 60 * 1000);

    const e = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    assert.strictEqual(e.motivo, "no_eliminable", JSON.stringify(e));
    assert.ok(/publicando ahora/.test(e.mensaje), e.mensaje);
    assert.deepStrictEqual([sorteoDb(s.id).estado, grupoDe(s.id, "g2@g.us").estado], ["publicando", "pendiente"]);

    servicio._reloj.ahora = () => new Date(EN_PUBLICACION.getTime() + 11 * 60 * 1000);
    const f = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    assert.ok(f.ok, JSON.stringify(f));
});

prueba("23. un grupo reclamado DURANTE la eliminación: se aborta y se restaura la programación y los grupos detenidos", async () => {
    escenario();
    const s = await programado({ grupos: ["g1@g.us", "g2@g.us"] });
    Object.assign(sorteoDb(s.id), { estado: "publicando" });
    let disparado = false;
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== "sorteos_programados_grupos" || disparado) return;
        disparado = true;
        Object.assign(grupoDe(s.id, "g2@g.us"), { estado: "publicando", intentos: 1, actualizado_en: T0.toISOString() });
    };
    const e = await servicio.eliminar(A, s.id, { version: s.version, ...CONFIRMADO });
    fake.control.antesDeEscribir = null;
    assert.strictEqual(e.motivo, "no_eliminable", JSON.stringify(e));
    assert.strictEqual(sorteoDb(s.id).estado, "publicando");
    assert.strictEqual(grupoDe(s.id, "g1@g.us").estado, "pendiente");
    assert.strictEqual(grupoDe(s.id, "g2@g.us").estado, "publicando", "el del publicador no se toca");
});

prueba("24. autorización: otro cliente no puede eliminar una fallida ajena ni por servicio ni por API, aunque confirme; nada cambia", async () => {
    escenario();
    const s = await fallidaConEnlacesViejos();
    const antes = JSON.stringify({ s: sorteoDb(s.id), g: fake.tablas.sorteos_programados_grupos, i: instantanea() });
    assert.strictEqual((await servicio.eliminar(B, s.id, { version: s.version, ...CONFIRMADO })).motivo, "no_encontrado");
    await conServidor(async (pedir) => {
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { jwt: "jwt-B", cuerpo: { version: s.version, ...CONFIRMADO } })).status, 404);
        assert.strictEqual((await pedir("POST", `/${s.id}/eliminar`, { jwt: null, cuerpo: { version: s.version, ...CONFIRMADO } })).status, 401);
        const propio = await pedir("POST", `/${s.id}/eliminar`, { cuerpo: { version: s.version, confirmacion: true } });
        assert.deepStrictEqual([propio.status, propio.json.motivo], [409, "confirmacion_actividad_requerida"]);
    });
    assert.strictEqual(JSON.stringify({ s: sorteoDb(s.id), g: fake.tablas.sorteos_programados_grupos, i: instantanea() }), antes);
});

prueba("25. misma identidad en otra programación vigente: eliminar la cancelada no toca a la otra ni a sus grupos", async () => {
    escenario();
    const vieja = await programado();
    await servicio.cancelar(A, vieja.id);
    const nueva = await programado();
    assert.strictEqual(nueva.identidad_evento_real, vieja.identidad_evento_real);
    const e = await servicio.eliminar(A, vieja.id, { version: sorteoDb(vieja.id).version, ...CONFIRMADO });
    assert.ok(e.ok, JSON.stringify(e));
    assert.ok(sorteoDb(nueva.id));
    assert.strictEqual(grupoDe(nueva.id, "g1@g.us").estado, "pendiente");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const err = console.error; console.error = () => {};
        try { await fn(); ok++; console.error = err; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.error = err; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
        finally { fake.control.despuesDeLeer = null; fake.control.antesDeEscribir = null; }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
