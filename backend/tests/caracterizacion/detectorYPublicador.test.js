// ==========================================================================
// CARACTERIZACIÓN C2: el detector de WhatsApp y el publicador del panel
// sobre el MISMO sorteo (misma identidad) y el MISMO grupo.
//
// Hoy son dos orquestadores distintos (detectarEvento.js y
// publicador.publicarEnGrupo) que se coordinan por la identidad del sorteo
// (consultarEventoDelSorteo) y por el ExecutionGuard. Comportamiento actual
// fijado, en los tres órdenes (simultáneo, detector primero, panel primero):
//   1 fila activa · 1 anuncio · 1 apertura · 1 ciclo · el destino «publicado».
//
// Límite de esta prueba: Supabase está en memoria, así que la ventana de
// carrera es mucho más corta que en producción, y la base real no tiene un
// índice único (usuario_id, grupo_id, identidad_evento_real). Ese riesgo
// residual queda escrito; F4 propone cerrarlo con el índice.
//
//     node backend/tests/caracterizacion/detectorYPublicador.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { prueba, riesgo, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const G = "g1@g.us";
const datos = () => h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G] });

function comprobarUnico(orden) {
    const filas = h.eventosDe(G);
    assert.strictEqual(filas.length, 1, `${orden}: una sola fila del sorteo en el grupo (hay ${filas.length})`);
    assert.strictEqual(filas[0].activo, true, `${orden}: activa`);
    assert.strictEqual(h.anuncios(G).length, 1, `${orden}: un anuncio (hay ${h.anuncios(G).length})`);
    assert.strictEqual(h.aperturas(G).length, 1, `${orden}: una apertura (hay ${h.aperturas(G).length})`);
    const ciclos = h.sesionesDe(G);
    assert.strictEqual(ciclos.length, 1, `${orden}: un ciclo (hay ${ciclos.length})`);
    assert.strictEqual(ciclos[0].estado, "abierto");
    assert.strictEqual(ciclos[0].evento_id, filas[0].id, `${orden}: el ciclo es de esa fila`);
    const destinos = h.estado.fake.tablas.sorteos_programados_grupos.filter(g => g.grupo_id === G);
    assert.deepStrictEqual(destinos.map(g => g.estado), ["publicado"], `${orden}: destino publicado`);
}

prueba("simultáneo: detector y «Publicar ahora» a la vez → un solo evento, anuncio, apertura y ciclo", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(datos());
    const [, pub] = await Promise.all([h.detectar(G), h.publicarAhora(s)]);
    assert.ok(pub.ok, JSON.stringify(pub));
    await h.silencio(h.drenar);
    comprobarUnico("simultáneo");
    riesgo("detector y publicador solo se coordinan por lectura previa (consultarEventoDelSorteo) y el ExecutionGuard; eventos_bot no tiene índice único por (usuario_id, grupo_id, identidad_evento_real): con latencia real podría crearse una segunda fila (C2).");
});

prueba("detector primero, luego el panel publica el mismo sorteo → reutiliza la fila, no repite la apertura", async () => {
    h.escenario();
    await h.detectar(G);
    await h.silencio(h.drenar);
    const idDetectado = h.eventosDe(G)[0].id;
    const s = await h.crearInstantaneo(datos());
    const pub = await h.publicarAhora(s);
    assert.ok(pub.ok, JSON.stringify(pub));
    await h.silencio(h.drenar);
    comprobarUnico("detector primero");
    assert.strictEqual(h.eventosDe(G)[0].id, idDetectado, "la fila detectada es la que queda");
});

prueba("panel primero, luego llega el mismo anuncio por WhatsApp → nada se duplica", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(datos());
    const pub = await h.publicarAhora(s);
    assert.ok(pub.ok, JSON.stringify(pub));
    await h.silencio(h.drenar);
    const idPanel = h.eventosDe(G)[0].id;
    await h.detectar(G);
    await h.silencio(h.drenar);
    comprobarUnico("panel primero");
    assert.strictEqual(h.eventosDe(G)[0].id, idPanel, "la fila del panel es la que queda");
});

ejecutar("CARACTERIZACIÓN C2 · detector y publicador sobre el mismo sorteo").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
