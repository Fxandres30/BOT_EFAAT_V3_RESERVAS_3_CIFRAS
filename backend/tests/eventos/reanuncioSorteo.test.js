// ==========================================================================
// PRUEBAS — re-anuncio de un sorteo ya lleno/cerrado ("TABLA LLENA FAMILIA"
// + anuncio completo) NO reactiva el evento ni abre el grupo; un sorteo
// distinto sigue abriendo como siempre.
//
// Reales: detectarEvento.js, extraerEvento.js (+extractor), configEvento.js,
// consultarEvento.js, guardarEvento.js, identidadEventoReal.js,
// abrirGrupo.js, groupQueue.js, automation/engine.js + eventRules.js +
// repos — vía tests/deteccion/entornoFake.js (Supabase fake, socket fake).
// También eventHandler.js + mensajeConCruz/dispatcher para los casos de
// imagen y ❌ (vía detectarEvento real).
// Simulado: consultarDisponibilidad (para fijar "lleno" / "con libres").
//
//     node backend/tests/eventos/reanuncioSorteo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const RUTA_DISPONIBILIDAD = path.join(RAIZ, "bot/funciones/consultas/consultarDisponibilidad.js");

// Estado controlable de la tabla del sorteo (lo que vería el bot al
// responder "¿qué números quedan?").
const tabla = { disponibles: [], ocupados: [], error: null };

require.cache[RUTA_DISPONIBILIDAD] = {
    id: RUTA_DISPONIBILIDAD, filename: RUTA_DISPONIBILIDAD, loaded: true,
    exports: {
        consultarDisponibilidad: async () => {
            if (tabla.error) throw tabla.error;
            return { numerosDisponibles: [...tabla.disponibles], numerosOcupados: [...tabla.ocupados] };
        }
    }
};

const { crearEntorno } = require("../deteccion/entornoFake");
const eventRules = require("../../automation/eventRules");
const { fechaEventoHoy } = require("../../bot/funciones/eventos/identidadEventoReal");

const USUARIO = "tenant-1";
const GRUPO = "120363000000000001@g.us";

const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

function anuncio({ loteria = "LOTERÍA DE MANIZALES", hora = "10:30 PM", valor = "$3.000" } = {}) {
    return [
        `🎰 ${loteria} ${hora}`,
        "🍀 Dos últimas cifras → $140.000",
        "🍀 Dos primeras cifras → $20.000",
        `💰 Valor número: ${valor}`
    ].join("\n");
}

const TABLA_LLENA = (a = anuncio()) => `TABLA LLENA FAMILIA\n${a}`;

function ctx(sock, textoOriginal) {
    return { sock, grupo: { remoteJid: GRUPO }, chat: { remoteJid: GRUPO, esGrupo: true }, textoOriginal };
}

const HOY = eventRules.obtenerClaveDia(new Date());

// Un sorteo publicado, abierto y con su ciclo de automatización creado.
async function sorteoPublicado({ conLibres = true } = {}) {

    tabla.error = null;
    tabla.disponibles = conLibres ? NUMEROS.slice(50) : [];
    tabla.ocupados = conLibres ? NUMEROS.slice(0, 50) : NUMEROS;

    const entorno = crearEntorno();
    const { fakeSupabase, detectarEvento, crearFakeSock } = entorno;

    fakeSupabase._agregar("grupos_autorizados", { usuario_id: USUARIO, grupo_id: GRUPO, activo: true });
    fakeSupabase._agregar("automation_configs", {
        usuario_id: USUARIO, grupo_id: GRUPO, activo: true,
        dias_permitidos: { [HOY]: { activo: true, desde: "00:00", hasta: "23:59" } }
    });

    const { sock, llamadas } = crearFakeSock({ usuarioId: USUARIO });

    // primer anuncio: con libres, abre y crea el ciclo
    tabla.disponibles = NUMEROS.slice(50);
    tabla.ocupados = NUMEROS.slice(0, 50);
    const evento = await detectarEvento(ctx(sock, anuncio()));
    assert.ok(evento, "el primer anuncio crea el evento");

    if (!conLibres) {
        tabla.disponibles = [];
        tabla.ocupados = NUMEROS;
    }

    const fila = () => fakeSupabase._filas("eventos_bot").find(f => f.grupo_id === GRUPO);
    const aperturas = () => llamadas.groupSettingUpdate.filter(x => x.ajuste === "not_announcement").length;
    const ciclos = () => fakeSupabase._filas("event_sessions").length;

    assert.strictEqual(aperturas(), 1);

    return { ...entorno, sock, llamadas, fila, aperturas, ciclos };

}

// Simula cerrarEvento(): el grupo y el evento quedan cerrados.
function cerrar(fila) {
    Object.assign(fila, { activo: false, abierto: false, estado: "cerrado" });
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. TABLA LLENA + anuncio completo, sorteo lleno y cerrado -> no reactiva, no abre, no crea ciclo", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());
    const antes = { ...e.fila() };
    const ciclosAntes = e.ciclos();

    const r = await e.detectarEvento(ctx(e.sock, TABLA_LLENA()));

    assert.strictEqual(e.aperturas(), 1, "abrirGrupo() no se vuelve a llamar");
    assert.deepStrictEqual(e.fila(), antes, "la fila de eventos_bot queda intacta (cerrada)");
    assert.strictEqual(e.ciclos(), ciclosAntes, "no se crea otro ciclo de automatización");
    assert.strictEqual(e.fakeSupabase._filas("eventos_bot").length, 1, "no se crea otro evento");
    assert.strictEqual(r.id, antes.id);

});

prueba("2. el mismo re-anuncio como TEXTO -> mismo resultado", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());
    const antes = { ...e.fila() };

    await e.detectarEvento(ctx(e.sock, "tabla llena familia\n" + anuncio()));

    assert.strictEqual(e.aperturas(), 1);
    assert.deepStrictEqual(e.fila(), antes);

});

prueba("3. mismo sorteo, evento CERRADO (aunque queden libres) -> no abre", async () => {

    const e = await sorteoPublicado({ conLibres: true });
    cerrar(e.fila());

    await e.detectarEvento(ctx(e.sock, anuncio()));

    assert.strictEqual(e.aperturas(), 1);
    assert.strictEqual(e.fila().activo, false);
    assert.strictEqual(e.fila().estado, "cerrado");

});

prueba("4. mismo sorteo, LLENO (sigue activo, 0 libres) -> no reactiva ni abre", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    const antes = { ...e.fila() };

    await e.detectarEvento(ctx(e.sock, TABLA_LLENA()));

    assert.strictEqual(e.aperturas(), 1);
    assert.deepStrictEqual(e.fila(), antes, "no se sobrescribe nada");

});

prueba("5. NUEVO sorteo (otra lotería) tras uno lleno y cerrado -> abre normalmente", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());

    tabla.disponibles = NUMEROS; tabla.ocupados = [];
    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "SINUANO NOCHE" })));

    assert.strictEqual(e.aperturas(), 2, "abre el grupo");
    assert.strictEqual(e.fila().activo, true);
    assert.strictEqual(e.fila().abierto, true);
    assert.match(e.fila().nombre_evento, /sinuano noche/i);
    assert.strictEqual(e.ciclos(), 2, "nuevo ciclo de automatización");

});

prueba("5b. otra lotería aunque la tabla física siga llena -> abre igual (no es el mismo sorteo)", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());

    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "SINUANO NOCHE" })));

    assert.strictEqual(e.aperturas(), 2);

});

prueba("6. NUEVA hora -> abre normalmente", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());

    await e.detectarEvento(ctx(e.sock, anuncio({ hora: "11:00 PM" })));

    assert.strictEqual(e.aperturas(), 2);
    assert.strictEqual(e.fila().hora_fin, "23:00");
    assert.strictEqual(e.fila().activo, true);

});

prueba("7. NUEVO valor -> abre normalmente", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());

    await e.detectarEvento(ctx(e.sock, anuncio({ valor: "$5.000" })));

    assert.strictEqual(e.aperturas(), 2);
    assert.strictEqual(Number(e.fila().valor), 5000);

});

prueba("8. FECHA diferente (el sorteo anterior era de ayer) -> abre normalmente", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    const ayer = new Date(Date.now() - 24 * 3600 * 1000);
    cerrar(e.fila());
    e.fila().fecha_evento = fechaEventoHoy(ayer);
    e.fila().identidad_evento_real = null; // se recalcula desde los campos de la fila

    await e.detectarEvento(ctx(e.sock, anuncio()));

    assert.strictEqual(e.aperturas(), 2);
    assert.strictEqual(e.fila().fecha_evento, fechaEventoHoy());
    assert.strictEqual(e.fila().activo, true);

});

prueba("9. aviso simple 'TABLA LLENA FAMILIA' -> no hace nada (como antes)", async () => {

    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());
    const antes = { ...e.fila() };

    const r = await e.detectarEvento(ctx(e.sock, "TABLA LLENA FAMILIA"));

    assert.strictEqual(r, null);
    assert.strictEqual(e.aperturas(), 1);
    assert.deepStrictEqual(e.fila(), antes);

});

prueba("10. anuncio NUEVO legítimo con imagen (pie de foto) -> sigue abriendo", async () => {

    // detectarEvento recibe el pie de foto como textoOriginal (normalizarMensaje).
    const e = await sorteoPublicado({ conLibres: false });
    cerrar(e.fila());

    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "CHONTICO NOCHE", hora: "7:00 PM" })));

    assert.strictEqual(e.aperturas(), 2);

});

prueba("10b. mismo sorteo ACTIVO y con libres (republicado durante la venta) -> comportamiento de siempre", async () => {

    const e = await sorteoPublicado({ conLibres: true });

    await e.detectarEvento(ctx(e.sock, anuncio()));

    assert.strictEqual(e.aperturas(), 2, "abrirGrupo() idempotente, igual que antes");
    assert.strictEqual(e.ciclos(), 1, "el ciclo no se duplica (dedupe existente)");

});

prueba("10c. si no se puede verificar la tabla (error) -> comportamiento de siempre, no bloquea", async () => {

    const e = await sorteoPublicado({ conLibres: true });
    tabla.error = new Error("Supabase caído (simulado)");

    await e.detectarEvento(ctx(e.sock, anuncio()));

    assert.strictEqual(e.aperturas(), 2);
    tabla.error = null;

});

prueba("11. re-anuncio con ❌ -> la regla ❌ lo corta antes de detectarEvento", async () => {

    const { contieneCruz } = require("../../bot/funciones/mensajes/mensajeConCruz");

    const mensaje = { key: { id: "X", remoteJid: GRUPO }, message: { imageMessage: { caption: "❌ TABLA LLENA FAMILIA\n" + anuncio() } } };

    // dispatcher.js corta todo mensaje con conCruz antes de eventHandler/detectarEvento
    assert.strictEqual(contieneCruz(mensaje), true);

});

prueba("Fecha operativa — Colombia, no UTC: 21:00 del día D en Bogotá sigue siendo D", async () => {

    // 2026-09-30 21:00 Bogotá = 2026-10-01 02:00 UTC
    const nocheColombia = new Date("2026-10-01T02:00:00Z");
    assert.strictEqual(nocheColombia.toISOString().split("T")[0], "2026-10-01", "(lo que hacía antes: día siguiente)");
    assert.strictEqual(fechaEventoHoy(nocheColombia), "2026-09-30");
    assert.strictEqual(fechaEventoHoy(new Date("2026-10-01T05:00:00Z")), "2026-10-01", "medianoche de Colombia cambia el día");

});

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
