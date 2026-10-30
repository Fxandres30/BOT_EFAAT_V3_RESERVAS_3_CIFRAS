// ==========================================================================
// PRUEBAS — detección automática: un anuncio que identifica claramente OTRO
// sorteo corrige o sustituye el sorteo del grupo sin esperar a su cierre,
// y nunca reescribe el historial (reservas/pagos) del sorteo anterior.
//
//   - Lotería detectada por error y todavía sin números: el anuncio nuevo
//     corrige la MISMA fila (una sola fila en el grupo).
//   - Sorteo con reservas/pagos: el anuncio nuevo crea su propia fila; la
//     anterior se cierra en ese grupo y conserva identidad, reservas y pagos.
//   - Sorteo programado desde el panel: un re-anuncio o un mensaje de un
//     cliente no lo reemplaza; un anuncio de OTRO sorteo publicado por la
//     cuenta del bot (decisión explícita del administrador) sí.
//
// Reales: detectarEvento.js, extraerEvento.js, consultarEvento.js,
// guardarEvento.js, identidadEventoReal.js, abrirGrupo.js, automation/*
// (tests/deteccion/entornoFake.js). Simulado: sorteoSinNumerosLibres
// (el sorteo siempre tiene números libres).
//
//     node backend/tests/deteccion/correccionSorteoPorAnuncio.test.js
// ==========================================================================

const assert = require("assert");
require("../utils/politicaGruposPermisiva");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const RUTA_SIN_LIBRES = path.join(RAIZ, "bot/funciones/eventos/lifecycle/sorteoSinNumerosLibres.js");

require.cache[RUTA_SIN_LIBRES] = {
    id: RUTA_SIN_LIBRES, filename: RUTA_SIN_LIBRES, loaded: true,
    exports: { sorteoSinNumerosLibres: async () => false }
};

const { crearEntorno } = require("./entornoFake");

const USUARIO = "tenant-1";
const GRUPO = "120363000000000001@g.us";

function anuncio({ loteria = "LOTERÍA DE MANIZALES", hora = "10:30 PM", valor = "$3.000" } = {}) {
    return [
        `🎰 ${loteria} ${hora}`,
        "🍀 Dos últimas cifras → $140.000",
        `💰 Valor número: ${valor}`
    ].join("\n");
}

function ctx(sock, textoOriginal, { fromMe = false, participant = "573001112233@s.whatsapp.net" } = {}) {
    return {
        sock,
        grupo: { remoteJid: GRUPO },
        chat: { remoteJid: GRUPO, esGrupo: true },
        message: { key: { id: `m-${Math.random()}`, remoteJid: GRUPO, fromMe, participant } },
        textoOriginal
    };
}

// Módulos que guardan el cliente de Supabase al cargarse y que entornoFake
// no recarga: se recargan para que cada prueba use SU base en memoria.
const RECARGAR = ["sorteos/repo.js", "bot/funciones/admins/esAdministrador.js"].map(p => path.join(RAIZ, p));

async function entorno() {
    for (const ruta of RECARGAR) delete require.cache[ruta];
    const e = crearEntorno();
    e.fakeSupabase._agregar("grupos_autorizados", { usuario_id: USUARIO, grupo_id: GRUPO, activo: true });
    const { sock } = e.crearFakeSock({ usuarioId: USUARIO });
    const filas = () => e.fakeSupabase._filas("eventos_bot").filter(f => f.grupo_id === GRUPO);
    const vigente = () => filas().find(f => f.activo === true);
    return { ...e, sock, filas, vigente };
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("lotería detectada por error (sin números): el anuncio corregido actualiza la MISMA fila", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "LOTERÍA DE MANIZALES" })));
    const original = e.vigente();
    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "LOTERÍA DEL CAUCA" })));
    assert.strictEqual(e.filas().length, 1, "no se crea otra fila: es una corrección");
    assert.strictEqual(e.vigente().id, original.id);
    assert.match(e.vigente().nombre_evento, /cauca/i);
    assert.notStrictEqual(e.vigente().identidad_evento_real, undefined);
});

prueba("sorteo con reservas y pagos: el anuncio de otro sorteo crea su fila y conserva el historial del anterior", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    const anterior = { ...e.vigente() };
    e.fakeSupabase._agregar(anterior.tabla, { usuario_id: USUARIO, numero: "10", estado: "pagado", identidad_evento_real: anterior.identidad_evento_real, usuario_global_id: "u1" });
    e.fakeSupabase._agregar(anterior.tabla, { usuario_id: USUARIO, numero: "11", estado: "reservado", identidad_evento_real: anterior.identidad_evento_real, usuario_global_id: "u1" });
    const reservasAntes = JSON.stringify(e.fakeSupabase._filas(anterior.tabla));

    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "LOTERÍA DEL CAUCA" })));

    assert.strictEqual(e.filas().length, 2, "fila nueva para el sorteo nuevo");
    assert.match(e.vigente().nombre_evento, /cauca/i);
    assert.notStrictEqual(e.vigente().id, anterior.id);

    const filaAnterior = e.filas().find(f => f.id === anterior.id);
    assert.strictEqual(filaAnterior.activo, false, "el anterior deja de estar vigente en el grupo");
    assert.strictEqual(filaAnterior.identidad_evento_real, anterior.identidad_evento_real, "su identidad no cambia");
    assert.match(filaAnterior.nombre_evento, /manizales/i);
    assert.strictEqual(JSON.stringify(e.fakeSupabase._filas(anterior.tabla)), reservasAntes, "reservas y pagos intactos (nunca se reasignan)");
});

prueba("re-anuncio del MISMO sorteo: misma fila, sin filas nuevas", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    await e.detectarEvento(ctx(e.sock, anuncio()));
    assert.strictEqual(e.filas().length, 1);
});

prueba("sorteo programado desde el panel: un CLIENTE que reenvía otro anuncio no lo reemplaza", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    const programado = e.vigente();
    e.fakeSupabase._agregar("sorteos_programados", { id: "sp-1", usuario_id: USUARIO, identidad_evento_real: programado.identidad_evento_real, estado: "publicado" });
    e.fakeSupabase._agregar("sorteos_programados_grupos", { id: "spg-1", sorteo_id: "sp-1", grupo_id: GRUPO, evento_bot_id: programado.id, estado: "publicado" });

    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: false }));

    assert.strictEqual(e.vigente().id, programado.id);
    assert.match(e.vigente().nombre_evento, /manizales/i);
});

prueba("sorteo programado desde el panel: el anuncio de OTRO sorteo publicado por la cuenta del bot lo sustituye (decisión manual)", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    const programado = e.vigente();
    e.fakeSupabase._agregar("sorteos_programados", { id: "sp-1", usuario_id: USUARIO, identidad_evento_real: programado.identidad_evento_real, estado: "publicado" });
    e.fakeSupabase._agregar("sorteos_programados_grupos", { id: "spg-1", sorteo_id: "sp-1", grupo_id: GRUPO, evento_bot_id: programado.id, estado: "publicado" });

    await e.detectarEvento(ctx(e.sock, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: true }));

    assert.match(e.vigente().nombre_evento, /cauca/i);
});

prueba("sorteo programado: re-anuncio del MISMO sorteo por la cuenta del bot no lo reemplaza ni duplica", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    const programado = e.vigente();
    e.fakeSupabase._agregar("sorteos_programados", { id: "sp-1", usuario_id: USUARIO, identidad_evento_real: programado.identidad_evento_real, estado: "publicado" });
    await e.detectarEvento(ctx(e.sock, anuncio(), { fromMe: true }));
    assert.strictEqual(e.filas().length, 1);
    assert.strictEqual(e.vigente().id, programado.id);
});

prueba("anuncio de otro sorteo tras uno CERRADO: fila nueva y la cerrada se conserva", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, anuncio()));
    const cerrado = e.vigente();
    Object.assign(cerrado, { activo: false, estado: "cerrado" });
    await e.detectarEvento(ctx(e.sock, anuncio({ hora: "11:00 PM" })));
    assert.strictEqual(e.filas().length, 2);
    assert.strictEqual(e.filas().find(f => f.id === cerrado.id).hora_fin, cerrado.hora_fin);
});

(async () => {

    const salida = console.log.bind(console);
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) { originales[m] = console[m]; console[m] = () => {}; }

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
