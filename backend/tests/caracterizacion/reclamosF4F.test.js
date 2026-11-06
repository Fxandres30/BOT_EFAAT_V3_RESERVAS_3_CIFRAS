// ==========================================================================
// F4-F (06/11/2026): CONCURRENCIA E IDEMPOTENCIA — C2, K3 y K4.
//
//   C2  ACTIVAR_EVENTO:<usuario>:<grupo>:<identidad>   una sola fila
//   K3  PUBLICAR_SORTEO:<usuario>:<grupo>:<identidad>  una sola publicación
//   K4  CREAR_SORTEO:<usuario>:<solicitud_id>           un solo borrador
//   +   executionGuard: un dueño antiguo no pisa a quien lo retomó
//
// Supabase simulado CON LATENCIA donde hace falta (control.latencia). Las
// garantías de la base real (UNIQUE e UPDATE condicionado) se validan aparte
// en PGlite (ver F4_CREACION_PUBLICACION.md, F4-F).
//
//     node backend/tests/caracterizacion/reclamosF4F.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const reclamoActivacion = require(r("bot/funciones/eventos/lifecycle/activacion/reclamoActivacion.js"));
const publicacionPorGrupo = require(r("sorteos/publicacionPorGrupo.js"));
const creacion = require(r("sorteos/creacionIdempotente.js"));
const guard = require(r("automation/executionGuard.js"));
const compartida = require(r("sorteos/publicacionCompartida.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const t = () => h.estado.fake.tablas;
const db = { from: (q) => h.estado.fake.client.from(q) };
const activas = (g) => h.eventosDe(g).filter(e => e.activo === true);
const reclamos = (tipo) => (t().automation_actions || []).filter(a => a.tipo_accion === tipo);
const drenar = () => h.silencio(h.drenar);
const VIEJO = "2026-10-22T12:00:00.000Z"; // más de 10 min antes del reloj del arnés

function barreraInserts(n, maxTicks = 400) {
    const pendientes = [];
    let liberado = false;
    const liberar = () => { liberado = true; pendientes.splice(0).forEach(x => x()); };
    return (tabla, op) => {
        if (liberado || tabla !== "eventos_bot" || op !== "insert") return null;
        return new Promise(res => {
            pendientes.push(res);
            if (pendientes.length >= n) return liberar();
            let i = 0;
            const paso = () => { if (liberado) return; if (++i >= maxTicks) return liberar(); setImmediate(paso); };
            setImmediate(paso);
        });
    };
}

const unico = (g) => {
    assert.strictEqual(activas(g).length, 1, `una fila activa en ${g} (hay ${activas(g).length})`);
    assert.strictEqual(h.sesionesDe(g).length, 1, `un ciclo en ${g}`);
    assert.strictEqual(h.aperturas(g).length, 1, `un mensaje de apertura en ${g}`);
};

// Rompe el INSERT de eventos_bot mientras falle() sea true.
function insertQueFalla(falle) {
    const from = h.estado.fake.client.from;
    h.estado.fake.client.from = (tabla) => {
        const q = from(tabla);
        if (tabla === "eventos_bot") {
            const insert = q.insert;
            q.insert = (x) => { const b = insert(x); if (falle()) b.then = (ok, ko) => Promise.resolve({ data: null, error: { message: "fallo simulado" } }).then(ok, ko); return b; };
        }
        return q;
    };
    return () => { h.estado.fake.client.from = from; };
}

const claveC2 = () => reclamoActivacion.claveActivacion({ usuarioId: h.A, grupoId: G1, identidad: h.eventosDe(G1)[0]?.identidad_evento_real });

// ================================================================== C2 ===

prueba("C2-1. WhatsApp y panel a la vez (latencia): una fila, un ciclo, una apertura, un anuncio", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fake.control.latencia = barreraInserts(2);
    const [ev, pub] = await Promise.all([h.detectar(G1), h.publicarAhora(s)]);
    h.estado.fake.control.latencia = null;
    await drenar();
    assert.ok(pub.ok && ev?.id);
    unico(G1);
    assert.strictEqual(h.anuncios(G1).length, 1);
    assert.strictEqual(ev.id, activas(G1)[0].id, "la detección devuelve la fila adoptada");
    assert.deepStrictEqual(reclamos("ACTIVAR_EVENTO").map(a => a.estado), ["ok"]);
});

prueba("C2-2/3. dos y TRES anuncios iguales a la vez: una fila, un ciclo, una apertura; todos devuelven la misma fila", async () => {
    for (const n of [2, 3, 5]) {
        h.escenario();
        h.estado.fake.control.latencia = barreraInserts(n);
        const res = await Promise.all(Array.from({ length: n }, () => h.detectar(G1)));
        h.estado.fake.control.latencia = null;
        await drenar();
        unico(G1);
        assert.deepStrictEqual([...new Set(res.map(x => x?.id))], [activas(G1)[0].id], `${n} procesos: misma fila`);
        assert.deepStrictEqual(h.estado.operaciones.map(o => o.ajuste), ["not_announcement"], `${n} procesos: una sola apertura del grupo`);
    }
});

prueba("C2-4. fallo DESPUÉS de adquirir el reclamo (no se guarda): queda «error» y el siguiente lo retoma y crea UNA fila", async () => {
    h.escenario();
    let falla = true;
    const restaurar = insertQueFalla(() => falla);
    const a = await h.detectar(G1);
    assert.strictEqual(a, null);
    assert.strictEqual(t().eventos_bot.length, 0);
    assert.deepStrictEqual(reclamos("ACTIVAR_EVENTO").map(x => x.estado), ["error"]);
    falla = false;
    const b = await h.detectar(G1);
    restaurar();
    await drenar();
    assert.ok(b?.id);
    unico(G1);
    assert.deepStrictEqual(reclamos("ACTIVAR_EVENTO").map(x => [x.estado, x.detalle.intentos]), [["ok", 2]]);
});

prueba("C2-5. caída ANTES de persistir: reclamo «en_progreso» reciente bloquea; vencido (> 2 min) se retoma", async () => {
    h.escenario();
    // Identidad del sorteo del anuncio: la que guarda la detección.
    await h.detectar(G2); await drenar();
    const identidad = h.eventosDe(G2)[0].identidad_evento_real;
    const clave = reclamoActivacion.claveActivacion({ usuarioId: h.A, grupoId: G1, identidad });
    const ahora = new Date().toISOString();
    t().automation_actions.push({ id: "c2-colgado", clave_idempotencia: clave, tipo_accion: "ACTIVAR_EVENTO", grupo_id: G1, usuario_id: h.A, estado: "en_progreso", ejecutado_en: ahora, actualizado_en: ahora, detalle: { entrada: "programado" } });
    const a = await h.detectar(G1);
    assert.strictEqual(a, null, "otro proceso la está creando: no se crea otra");
    assert.strictEqual(h.eventosDe(G1).length, 0);
    Object.assign(t().automation_actions.find(x => x.id === "c2-colgado"), { ejecutado_en: VIEJO, actualizado_en: VIEJO });
    const b = await h.detectar(G1); await drenar();
    assert.ok(b?.id);
    unico(G1);
    assert.strictEqual(t().automation_actions.find(x => x.id === "c2-colgado").estado, "ok");
});

prueba("C2-6. caída DESPUÉS de persistir (fila creada, reclamo colgado): quien lo retoma ADOPTA la fila, no crea otra", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const accion = reclamos("ACTIVAR_EVENTO")[0];
    Object.assign(accion, { estado: "en_progreso", ejecutado_en: VIEJO, actualizado_en: VIEJO });
    const llamadas = [];
    const res = await h.silencio(() => reclamoActivacion.crearOAdoptar({
        db, usuarioId: h.A, grupoId: G1, identidad: a.identidad_evento_real, entrada: "programado",
        consultarEventoDelSorteo: require(r("bot/funciones/eventos/consultarEvento.js")).consultarEventoDelSorteo,
        crear: async () => { llamadas.push("crear"); return { fallo: { resultado: "no_debia" } }; }
    }));
    assert.strictEqual(res.adoptado?.id, a.id);
    assert.deepStrictEqual(llamadas, []);
    assert.strictEqual(t().eventos_bot.length, 1);
    assert.strictEqual(accion.estado, "ok");
});

prueba("C2-7. reintento DESPUÉS de completar: adopta la fila (crear no se llama)", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const llamadas = [];
    const res = await h.silencio(() => reclamoActivacion.crearOAdoptar({
        db, usuarioId: h.A, grupoId: G1, identidad: a.identidad_evento_real, entrada: "anuncio_whatsapp",
        consultarEventoDelSorteo: require(r("bot/funciones/eventos/consultarEvento.js")).consultarEventoDelSorteo,
        crear: async () => { llamadas.push("crear"); return {}; }
    }));
    assert.strictEqual(res.adoptado?.id, a.id);
    assert.deepStrictEqual(llamadas, []);
});

prueba("C2-8. completado pero su fila ELIMINADA desde el panel: se libera la clave y se crea de nuevo (como siempre)", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    Object.assign(t().eventos_bot.find(e => e.id === a.id), { activo: false, estado: "eliminado" });
    const b = await h.detectar(G1); await drenar();
    assert.ok(b?.id && b.id !== a.id, "fila nueva, como antes de F4-F");
    assert.ok(reclamos("ACTIVAR_EVENTO").some(x => /:retirada:/.test(x.clave_idempotencia)), "la anterior se conserva renombrada");
});

prueba("C2-9. sorteos, grupos y clientes distintos: claves distintas, nunca se bloquean", async () => {
    const k = (u, g, i) => reclamoActivacion.claveActivacion({ usuarioId: u, grupoId: g, identidad: i });
    assert.strictEqual(new Set([k(h.A, G1, "x"), k(h.A, G2, "x"), k(h.A, G1, "y"), k(B, G1, "x")]).size, 4);
    h.escenario();
    // Mismo sorteo en dos grupos a la vez: dos filas (una por grupo).
    h.estado.fake.control.latencia = barreraInserts(2);
    await Promise.all([h.detectar(G1), h.detectar(G2)]);
    h.estado.fake.control.latencia = null;
    await drenar();
    unico(G1); unico(G2);
    assert.strictEqual(reclamos("ACTIVAR_EVENTO").length, 2);
    // Dos clientes, misma identidad y grupo: cada uno crea lo suyo.
    h.escenario();
    const creados = [];
    const consultar = async () => ({ ok: true, data: null });
    await Promise.all([h.A, B].map(u => h.silencio(() => reclamoActivacion.crearOAdoptar({
        db, usuarioId: u, grupoId: G1, identidad: "misma", entrada: "programado", consultarEventoDelSorteo: consultar,
        crear: async () => { creados.push(u); return { evento: { id: `ev-${u}` } }; }
    }))));
    assert.deepStrictEqual(creados.sort(), [h.A, B].sort());
});

prueba("C2-10. un dueño ANTIGUO no pisa el resultado de quien retomó su reclamo", async () => {
    h.escenario();
    let soltar;
    const puerta = new Promise(x => { soltar = x; });
    const clave = "PRUEBA:u:g:i";
    const base = { db, claveIdempotencia: clave, grupoId: G1, usuarioId: h.A, tipoAccion: "PRUEBA" };
    // El proceso viejo adquirió el reclamo hace más de 10 min (su reloj de
    // entonces) y sigue colgado: su toma lleva esa marca.
    const Reloj = global.Date;
    global.Date = class extends Reloj {
        constructor(...a) { super(...(a.length ? a : [Reloj.parse(VIEJO)])); }
        static now() { return Reloj.parse(VIEJO); }
    };
    let viejo;
    try {
        viejo = h.silencio(() => guard.ejecutarUnaVez({ ...base, ejecutar: async () => { await puerta; return "viejo"; } }));
        for (let i = 0; i < 5 && !t().automation_actions?.some(a => a.clave_idempotencia === clave); i++) await new Promise(x => setImmediate(x));
    } finally {
        global.Date = Reloj;
    }
    assert.strictEqual(t().automation_actions.find(a => a.clave_idempotencia === clave).ejecutado_en, VIEJO);
    const nuevo = await h.silencio(() => guard.ejecutarUnaVez({ ...base, retomar: { enProgresoVencidoMs: 1000 }, ejecutar: async () => "nuevo" }));
    assert.ok(nuevo.ejecutada);
    soltar();
    await viejo;
    const fila = t().automation_actions.find(a => a.clave_idempotencia === clave);
    assert.strictEqual(fila.estado, "ok");
    assert.strictEqual(fila.detalle.resultado, "nuevo", "el resultado vigente es el del dueño actual");
});

// ================================================================== K3 ===

async function programaciones(n, grupos = [G1]) {
    const creadas = [];
    for (let i = 0; i < n; i++) creadas.push(await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos }))));
    const conf = await Promise.all(creadas.map(x => h.silencio(() => h.servicio.confirmar(h.A, x.data.id, { version: x.data.version, confirmacion: true }))));
    return { creadas: creadas.map(x => x.data), conf };
}
const destinosDe = (g) => t().sorteos_programados_grupos.filter(x => x.grupo_id === g);

prueba("K3-1/2. dos y TRES confirmaciones simultáneas del mismo sorteo y grupo: UN anuncio; las demás adoptan", async () => {
    for (const n of [2, 3]) {
        h.escenario();
        const { conf } = await programaciones(n);
        assert.ok(conf.every(c => c.ok));
        await h.tick(h.EN_PUBLICACION);
        unico(G1);
        assert.strictEqual(h.anuncios(G1).length, 1, `${n}: un anuncio con imagen`);
        // F4-F.1: todas «publicado» (publicación COMPARTIDA, misma fila); ninguna cancelada.
        assert.deepStrictEqual(destinosDe(G1).map(d => d.estado), Array(n).fill("publicado"));
        assert.ok(destinosDe(G1).every(d => d.evento_bot_id === activas(G1)[0].id && d.ultimo_error == null));
        assert.deepStrictEqual(t().sorteos_programados.map(p => p.estado), Array(n).fill("publicado"), "ninguna programación se cancela");
        const propietaria = reclamos("PUBLICAR_SORTEO")[0].detalle.sorteo_id;
        for (const p of t().sorteos_programados) {
            const adoptados = await compartida.gruposAdoptados(db, p, destinosDe(G1).filter(d => d.sorteo_id === p.id));
            assert.strictEqual(adoptados.has(G1), p.id !== propietaria, "la relación con la propietaria es trazable");
        }
        assert.deepStrictEqual(reclamos("PUBLICAR_SORTEO").map(a => a.estado), ["ok"]);
        // Un ciclo más del publicador no cambia nada.
        await h.tick(new Date(h.EN_PUBLICACION.getTime() + 60000));
        assert.strictEqual(h.anuncios(G1).length, 1);
    }
});

prueba("K3-3. reintento de la MISMA confirmación: devuelve su estado, no un error, y no programa otra vez", async () => {
    h.escenario();
    const c = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    const a = await h.silencio(() => h.servicio.confirmar(h.A, c.data.id, { version: c.data.version, confirmacion: true }));
    const b = await h.silencio(() => h.servicio.confirmar(h.A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(a.ok && b.ok, JSON.stringify(b));
    assert.match(b.aviso, /ya estaba confirmada/);
    assert.strictEqual(b.data.estado, "programado");
    assert.strictEqual(b.data.confirmado_en, a.data.confirmado_en, "no se confirmó otra vez");
    // Una versión distinta sigue rechazándose como siempre.
    const c2 = await h.silencio(() => h.servicio.confirmar(h.A, c.data.id, { version: c.data.version + 1, confirmacion: true }));
    assert.strictEqual(c2.ok, false);
});

prueba("K3-4. error al ENVIAR el anuncio de la primera: la segunda espera (no envía); al reintentar la primera, una sola publicación", async () => {
    h.escenario();
    const { creadas } = await programaciones(2);
    let falla = true;
    const deps = h.deps({ compartirEnGrupos: async (args) => (falla ? { ok: false, motivo: "sin_sesion" } : require(r("services/compartirTabla.js")).compartirEnGrupos(args)) });
    await h.tick(h.EN_PUBLICACION, deps);
    assert.strictEqual(h.anuncios(G1).length, 0);
    const [d1, d2] = creadas.map(c => destinosDe(G1).find(d => d.sorteo_id === c.id));
    assert.strictEqual(d1.estado, "fallido", "la dueña reintentará");
    assert.strictEqual(d2.estado, "pendiente");
    assert.match(d2.ultimo_error, /Otra programación de este mismo sorteo/);
    assert.deepStrictEqual(reclamos("PUBLICAR_SORTEO").map(a => [a.estado, a.detalle.sorteo_id]), [["error", creadas[0].id]]);
    falla = false;
    await h.tick(new Date(h.EN_PUBLICACION.getTime() + 60000), deps);
    await h.tick(new Date(h.EN_PUBLICACION.getTime() + 120000), deps);
    assert.strictEqual(h.anuncios(G1).length, 1);
    assert.deepStrictEqual([d1.estado, d2.estado], ["publicado", "publicado"]);
});

prueba("K3-5a. recuperación tras interrupción: la DUEÑA retoma su propio reclamo colgado sin esperar; la otra adopta", async () => {
    h.escenario();
    const { creadas } = await programaciones(2);
    const clave = publicacionPorGrupo.clavePublicacion({ usuarioId: h.A, grupoId: G1, identidad: creadas[0].identidad_evento_real });
    const ahora = new Date().toISOString();
    t().automation_actions.push({ id: "k3-propio", clave_idempotencia: clave, tipo_accion: "PUBLICAR_SORTEO", grupo_id: G1, usuario_id: h.A, estado: "en_progreso", ejecutado_en: ahora, actualizado_en: ahora, detalle: { sorteo_id: creadas[0].id } });
    await h.tick(h.EN_PUBLICACION);
    assert.strictEqual(h.anuncios(G1).length, 1, "un destino solo lo toma un proceso: si la dueña vuelve, el intento anterior murió");
    assert.deepStrictEqual(destinosDe(G1).map(d => d.estado), ["publicado", "publicado"]);
});

prueba("K3-5b. reclamo colgado de OTRA programación: reciente, todas esperan; vencido (> 10 min), una lo retoma y la otra adopta", async () => {
    h.escenario();
    const { creadas } = await programaciones(2);
    const identidad = creadas[0].identidad_evento_real;
    const clave = publicacionPorGrupo.clavePublicacion({ usuarioId: h.A, grupoId: G1, identidad });
    const ahora = new Date().toISOString();
    t().automation_actions.push({ id: "k3-colgado", clave_idempotencia: clave, tipo_accion: "PUBLICAR_SORTEO", grupo_id: G1, usuario_id: h.A, estado: "en_progreso", ejecutado_en: ahora, actualizado_en: ahora, detalle: { sorteo_id: "otra-programacion-que-cayo" } });
    await h.tick(h.EN_PUBLICACION);
    assert.strictEqual(h.anuncios(G1).length, 0, "en curso (reciente) por otra: nadie publica");
    assert.deepStrictEqual(destinosDe(G1).map(d => d.estado), ["pendiente", "pendiente"]);
    Object.assign(t().automation_actions.find(a => a.id === "k3-colgado"), { ejecutado_en: VIEJO, actualizado_en: VIEJO });
    await h.tick(new Date(h.EN_PUBLICACION.getTime() + 60000));
    await h.tick(new Date(h.EN_PUBLICACION.getTime() + 120000));
    assert.strictEqual(h.anuncios(G1).length, 1);
    assert.deepStrictEqual(destinosDe(G1).map(d => d.estado), ["publicado", "publicado"]);
});

prueba("K3-6. programaciones realmente distintas (mismo sorteo en OTRO grupo): cada una publica en el suyo", async () => {
    h.escenario();
    const a = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    const b = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G2] })));
    await Promise.all([a, b].map(x => h.silencio(() => h.servicio.confirmar(h.A, x.data.id, { version: x.data.version, confirmacion: true }))));
    await h.tick(h.EN_PUBLICACION);
    assert.strictEqual(h.anuncios(G1).length, 1);
    assert.strictEqual(h.anuncios(G2).length, 1);
    assert.deepStrictEqual(t().sorteos_programados_grupos.map(d => d.estado), ["publicado", "publicado"]);
    assert.strictEqual(reclamos("PUBLICAR_SORTEO").length, 2);
});

// ================================================================== K4 ===

const solicitud = (s) => `sol-${s}-0123456789`;
const borradores = () => (t().sorteos_programados || []).filter(p => p.estado === "borrador");

prueba("K4-1/2. doble clic y TRES solicitudes concurrentes con el mismo solicitud_id: UN borrador, la misma respuesta", async () => {
    h.escenario();
    const datos = h.entrada({ grupos: [G1], solicitud_id: solicitud("a") });
    const res = await Promise.all([1, 2, 3].map(() => h.silencio(() => h.servicio.crearSorteo(h.A, datos))));
    assert.ok(res.every(x => x.ok));
    assert.strictEqual(new Set(res.map(x => x.data.id)).size, 1);
    assert.strictEqual(borradores().length, 1);
    assert.deepStrictEqual(reclamos("CREAR_SORTEO").map(a => a.estado), ["ok"]);
});

prueba("K4-3/7. reintento tras perder la respuesta: devuelve el borrador ORIGINAL", async () => {
    h.escenario();
    const datos = h.entrada({ grupos: [G1], solicitud_id: solicitud("b") });
    const a = await h.silencio(() => h.servicio.crearSorteo(h.A, datos));
    const b = await h.silencio(() => h.servicio.crearSorteo(h.A, { ...datos, nombre: "OTRO NOMBRE" }));
    assert.strictEqual(b.data.id, a.data.id);
    assert.deepStrictEqual(b.data, a.data, "misma respuesta, aunque el reintento traiga otros datos");
    assert.strictEqual(borradores().length, 1);
});

prueba("K4-4/5. identificadores distintos = borradores distintos; sin solicitud_id = como siempre", async () => {
    h.escenario();
    await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], solicitud_id: solicitud("c") })));
    await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], solicitud_id: solicitud("d") })));
    await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    assert.strictEqual(borradores().length, 4);
    assert.strictEqual(reclamos("CREAR_SORTEO").length, 2, "solo las que traen solicitud_id");
});

prueba("K4-6. aislamiento: el mismo solicitud_id de OTRO cliente es otra operación y nunca devuelve el sorteo de A", async () => {
    h.escenario();
    const id = solicitud("e");
    const a = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], solicitud_id: id })));
    assert.ok(a.ok);
    const deB = await h.silencio(() => creacion.crearUnaVez({
        db, usuarioId: B, solicitudId: id,
        crear: async () => ({ ok: true, data: { id: "sorteo-de-B" } }),
        obtener: async () => { throw new Error("no debe leer nada de A"); }
    }));
    assert.strictEqual(deB.data.id, "sorteo-de-B");
    assert.notStrictEqual(creacion.claveCreacion({ usuarioId: h.A, solicitudId: id }), creacion.claveCreacion({ usuarioId: B, solicitudId: id }));
});

prueba("K4-8. formato: un solicitud_id inválido se rechaza (400) sin crear nada; validación fallida se puede repetir", async () => {
    h.escenario();
    for (const malo of ["corto", "con espacios 123", "x".repeat(101), 12345678, { a: 1 }]) {
        const res = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], solicitud_id: malo })));
        assert.deepStrictEqual([res.ok, res.motivo, res.errores?.[0]?.campo], [false, "validacion", "solicitud_id"]);
    }
    assert.strictEqual((t().sorteos_programados || []).length, 0);
    const id = solicitud("f");
    const malo = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], valor: 7, solicitud_id: id })));
    assert.strictEqual(malo.ok, false);
    const bueno = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], solicitud_id: id })));
    assert.ok(bueno.ok, "la misma solicitud corregida se crea");
    assert.strictEqual(borradores().length, 1);
});

ejecutar("F4-F · concurrencia e idempotencia (C2, K3, K4)").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
