// ==========================================================================
// F4-E (06/11/2026): el camino de WhatsApp (detectarEvento) integrado con el
// núcleo central de activación (lifecycle/activarEvento.js).
//
// Comprueba, con aserciones explícitas, cada comportamiento de la entrada
// (la huella completa la fija C7) y que el detector ya NO contiene una
// segunda implementación de la secuencia de activación.
//
// Reales: arnés _arnesEventos (detectarEvento, guardarEvento, núcleo,
// motorEventos, gestionEventos, workerEventos). Simulados: Supabase (memoria)
// y el socket. Sin red ni WhatsApp real.
//
//     node backend/tests/deteccion/deteccionNucleo.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");
const h = require("../caracterizacion/_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const gestion = require(r("sorteos/gestionEventos.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const RELOJ = new Date("2026-10-22T13:01:00Z");
const t = () => h.estado.fake.tablas;
const activas = (g) => h.eventosDe(g).filter(e => e.activo === true);
const ops = (g) => h.estado.operaciones.filter(o => o.jid === g).map(o => o.ajuste);
const anuncio = (loteria, valor) => [`🎰 ${loteria} 10:30 PM`, "🍀 Dos últimas cifras → $140.000", `💰 Valor número: ${valor}`].join("\n");
const comoAdmin = (g, texto) => h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(g, texto), message: { key: { id: `m-${g}`, remoteJid: g, fromMe: true } } }));
const drenar = () => h.silencio(h.drenar);

// ------------------------------------------------------------------ 1 ---
prueba("1. anuncio nuevo: una fila activa, ciclo abierto, una apertura y un OPEN_MESSAGE", async () => {
    h.escenario();
    const ev = await h.detectar(G1);
    await drenar();
    assert.ok(ev?.id && ev.activo === true);
    assert.strictEqual(activas(G1).length, 1);
    assert.deepStrictEqual(h.sesionesDe(G1).map(s => [s.evento_id, s.estado]), [[ev.id, "abierto"]]);
    assert.deepStrictEqual(ops(G1), ["not_announcement"]);
    assert.strictEqual(h.aperturas(G1).length, 1);
    assert.strictEqual(h.anuncios(G1).length, 0, "la detección no envía anuncio con imagen");
});

// ------------------------------------------------------------------ 2 ---
prueba("2. re-anuncio: misma fila y mismo ciclo; reabre el grupo pero no repite el OPEN_MESSAGE", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const b = await h.detectar(G1); await drenar();
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(h.eventosDe(G1).length, 1);
    assert.strictEqual(h.sesionesDe(G1).length, 1);
    assert.strictEqual(h.aperturas(G1).length, 1);
    assert.deepStrictEqual(ops(G1), ["not_announcement", "not_announcement"]);
});

// ------------------------------------------------------------------ 3 ---
prueba("3. re-anuncio de un sorteo cerrado: no se reactiva, no se abre el grupo, no hay ciclo nuevo", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    await h.silencio(() => gestion.aplicar(h.A, a.id, { accion: "cerrar", alcance: "grupo", cerrar_grupo_whatsapp: false }, { ahora: new Date(RELOJ.getTime() + 60000), socketDe: () => h.sock() }));
    const antes = ops(G1).length;
    const b = await h.detectar(G1); await drenar();
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(b.activo, false);
    assert.strictEqual(ops(G1).length, antes, "sin operaciones de grupo");
    assert.strictEqual(h.sesionesDe(G1).length, 1);
});

// ------------------------------------------------------------------ 4 ---
prueba("4. el mismo sorteo en otro grupo: fila propia con la MISMA identidad", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const b = await h.detectar(G2); await drenar();
    assert.notStrictEqual(a.id, b.id);
    assert.strictEqual(a.identidad_evento_real, b.identidad_evento_real);
    assert.ok(activas(G1).length === 1 && activas(G2).length === 1, "el sorteo sigue activo en los dos grupos");
});

// ------------------------------------------------------------------ 5 ---
prueba("5. otro precio en el grupo SIN números: corrige la misma fila (sin sustitución)", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const b = await comoAdmin(G1, anuncio("LOTERÍA DE MANIZALES", "$10.000")); await drenar();
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(Number(String(b.valor).replace(/\D/g, "")), 10000);
    assert.strictEqual(h.eventosDe(G1).length, 1);
    assert.ok(!(t().eventos_bot_historial || []).some(x => x.modalidad === "sustitucion_anuncio"));
});

// ------------------------------------------------------------------ 6 ---
prueba("6. otro precio en el grupo CON números: fila nueva; la anterior sustituida conserva su reserva", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    Object.assign(t()[h.T5K][7], { estado: "reservado", identidad_evento_real: a.identidad_evento_real, comprador: "Ana", usuario_global_id: "ug-1", evento_id: a.id });
    const b = await comoAdmin(G1, anuncio("LOTERÍA DE MANIZALES", "$10.000")); await drenar();
    assert.notStrictEqual(b.id, a.id);
    const anterior = t().eventos_bot.find(e => e.id === a.id);
    assert.strictEqual(anterior.activo, false);
    assert.match(anterior.cierre_motivo, /^sustituido por el anuncio de/);
    assert.deepStrictEqual((t().eventos_bot_historial || []).map(x => [x.modalidad, x.evento_id === a.id]), [["sustitucion_anuncio", true]]);
    assert.strictEqual(t()[h.T5K][7].estado, "reservado");
    assert.strictEqual(t()[h.T5K][7].evento_id, a.id, "la reserva sigue con su sorteo");
});

// ------------------------------------------------------------------ 7 ---
prueba("7. sustitución por precio en OTRO grupo: el administrador reemplaza, el cliente no", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const cliente = await h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000")), message: { key: { id: "c", remoteJid: G2, fromMe: false, participant: "573111111111@s.whatsapp.net" } } }));
    assert.strictEqual(cliente, null, "sin evento anterior en el grupo: null");
    assert.strictEqual(t().eventos_bot.find(e => e.id === a.id).activo, true);
    const admin = await comoAdmin(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000")); await drenar();
    assert.ok(admin?.activo);
    assert.strictEqual(t().eventos_bot.find(e => e.id === a.id).activo, false);
    assert.deepStrictEqual((t().eventos_bot_historial || []).map(x => x.modalidad), ["sustitucion_precio"]);
});

// ------------------------------------------------------------------ 8 ---
prueba("8. anuncio del mismo sorteo sobre un programado publicado: re-anuncio sin cambios", async () => {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1] }));
    await h.tick(h.EN_PUBLICACION);
    const fila = h.eventosDe(G1)[0];
    const antes = JSON.stringify(t().eventos_bot);
    const opsAntes = ops(G1).length;
    const r1 = await h.detectar(G1); await drenar();
    assert.strictEqual(r1.id, fila.id);
    assert.strictEqual(JSON.stringify(t().eventos_bot), antes, "ninguna escritura en eventos_bot");
    assert.strictEqual(ops(G1).length, opsAntes, "no se toca el grupo");
});

// ------------------------------------------------------------------ 9 ---
prueba("9. aislamiento: el dueño validado no coincide con el del socket → nada", async () => {
    h.escenario();
    const res = await h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G1), session: { usuarioId: B } }));
    assert.strictEqual(res, null);
    assert.strictEqual(t().eventos_bot.length, 0);
    assert.strictEqual(h.estado.operaciones.length, 0);
});

// ------------------------------------------------------------------ 10 ---
prueba("10. error de persistencia: no se guarda el anuncio y el reemplazo por precio se DESHACE", async () => {
    h.escenario();
    const a = await h.detectar(G1); await drenar();
    const from = h.estado.fake.client.from;
    h.estado.fake.client.from = (tabla) => {
        const q = from(tabla);
        if (tabla === "eventos_bot") {
            const insert = q.insert;
            q.insert = (x) => { const b = insert(x); b.then = (ok, ko) => Promise.resolve({ data: null, error: { message: "fallo simulado" } }).then(ok, ko); return b; };
        }
        return q;
    };
    const res = await comoAdmin(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000"));
    h.estado.fake.client.from = from;
    await drenar();
    assert.strictEqual(res, null);
    assert.strictEqual(t().eventos_bot.find(e => e.id === a.id).activo, true, "el sorteo anterior vuelve a estar activo");
    assert.strictEqual(h.eventosDe(G2).length, 0);
    assert.deepStrictEqual((t().eventos_bot_historial || []).map(x => [x.modalidad, x.resultado, x.detalle.deshecha ?? null]), [["sustitucion_precio", "ok", null], ["sustitucion_precio", "error", true]]);
    assert.ok(!h.estado.operaciones.some(o => o.jid === G2), "no se abre el grupo");
});

// ------------------------------------------------------------------ 11 ---
prueba("11. apertura fallida: abierto=false y ciclo pendiente; el worker abre, reanuda y envía UN OPEN_MESSAGE", async () => {
    h.escenario();
    h.estado.fallaApertura = (g) => g === G1;
    const ev = await h.detectar(G1); await drenar();
    assert.strictEqual(ev.abierto, false);
    assert.strictEqual(h.eventosDe(G1)[0].abierto, false);
    assert.deepStrictEqual(h.sesionesDe(G1).map(s => s.estado), ["pendiente"]);
    assert.strictEqual(h.aperturas(G1).length, 0);
    h.estado.fallaApertura = () => false;
    await h.silencio(() => workerEventos(h.sock(), { ahora: new Date(RELOJ.getTime() + 60000) }));
    await drenar();
    assert.strictEqual(h.eventosDe(G1)[0].abierto, true);
    assert.deepStrictEqual(h.sesionesDe(G1).map(s => s.estado), ["abierto"]);
    assert.strictEqual(h.aperturas(G1).length, 1);
});

// ------------------------------------------------------------------ 12 ---
prueba("12. orden del ciclo: detección = registrar ciclo → abrir grupo → confirmar; panel = abrir → anuncio → ciclo", async () => {
    const orden = [];
    const motor = h.motor;
    const original = { registrarEvento: motor.registrarEvento, confirmarApertura: motor.confirmarApertura, procesarEventoPublicado: motor.procesarEventoPublicado };
    motor.registrarEvento = async (...x) => { orden.push("ciclo:registrar"); return original.registrarEvento(...x); };
    motor.confirmarApertura = async (...x) => { orden.push("ciclo:confirmar"); return original.confirmarApertura(...x); };
    motor.procesarEventoPublicado = async (...x) => { orden.push("ciclo:tras_anuncio"); return original.procesarEventoPublicado(...x); };
    const marcarOps = () => { const push = h.estado.operaciones.push.bind(h.estado.operaciones); h.estado.operaciones.push = (o) => { orden.push(`grupo:${o.ajuste}`); return push(o); }; };
    const marcarEnvios = () => { const push = h.estado.enviados.push.bind(h.estado.enviados); h.estado.enviados.push = (e) => { if (e.tipo === "imagen") orden.push("anuncio"); return push(e); }; };
    try {
        h.escenario(); marcarOps(); marcarEnvios();
        await h.detectar(G1); await drenar();
        assert.deepStrictEqual(orden.filter(x => x !== "ciclo:tras_anuncio"), ["ciclo:registrar", "grupo:not_announcement", "ciclo:confirmar"]);
        orden.length = 0;
        h.escenario(); marcarOps(); marcarEnvios();
        const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
        await h.publicarAhora(s); await drenar();
        assert.deepStrictEqual(orden.filter(x => x !== "ciclo:registrar" && x !== "ciclo:confirmar"), ["grupo:not_announcement", "anuncio", "ciclo:tras_anuncio"]);
    } finally {
        Object.assign(motor, original);
    }
});

// ------------------------------------------------------------------ 13 ---
prueba("13. el detector ya no implementa la secuencia común: la delega en el núcleo", () => {
    const src = fs.readFileSync(r("bot/funciones/eventos/detectarEvento.js"), "utf8").replace(/\/\/.*$/gm, "");
    for (const prohibido of ["reemplazarAnteriores", "sorteosActivosDelPrecio", "revertirReemplazo", "terminarFila", "marcarAperturaFallida", ".registrarEvento(", ".confirmarApertura(", "guardarEvento(", "abrirGrupo(", "from(\"eventos_bot\")"]) {
        assert.ok(!src.includes(prohibido), `detectarEvento.js no debe contener ${prohibido}`);
    }
    assert.ok(src.includes("activarEnGrupo({"), "invoca el núcleo");
    assert.ok(/entrada:\s*"anuncio_whatsapp"/.test(src), "con su perfil");
    const pub = fs.readFileSync(r("sorteos/publicador.js"), "utf8").replace(/\/\/.*$/gm, "");
    for (const prohibido of ["deps.guardarEvento(", "deps.abrirGrupo(", "deps.compartirEnGrupos(", "reemplazarAnteriores(deps.supabase, { usuarioId, filas: [...ocupan"]) {
        assert.ok(!pub.includes(prohibido), `publicador.js no debe contener ${prohibido}`);
    }
    // F4-G: la recuperación de publicaciones interrumpidas salió del
    // publicador (sorteos/recuperacionPublicacion.js); es el único otro sitio
    // que llama al motor tras un anuncio, y solo con un envío CONFIRMADO.
    assert.strictEqual((pub.match(/procesarEventoPublicado\(/g) || []).length, 0, "el publicador ya no recupera");
    const rec = fs.readFileSync(r("sorteos/recuperacionPublicacion.js"), "utf8").replace(/\/\/.*$/gm, "");
    assert.strictEqual((rec.match(/procesarEventoPublicado\(/g) || []).length, 1, "solo en la recuperación");
});

ejecutar("F4-E · detección de WhatsApp integrada en el núcleo de activación").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
