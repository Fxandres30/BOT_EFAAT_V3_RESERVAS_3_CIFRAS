// ==========================================================================
// PRUEBAS — UN SORTEO POR PRECIO con anuncios de WhatsApp (decisión 01/11):
// el anuncio de OTRO sorteo del MISMO precio lo reemplaza en TODOS sus
// grupos; uno de OTRO precio solo reemplaza en su grupo (un sorteo por
// grupo) y en otros grupos conviven; reservas y pagos intactos.
//
//   - Administrador (cuenta del bot): el anterior se cierra en los dos
//     grupos; el nuevo queda activo solo donde se anunció.
//   - Cliente (no administrador) con el anterior activo en otros grupos: no
//     se apodera de la tabla; nada cambia.
//   - Cliente con el anterior solo en este grupo: comportamiento de siempre.
//   - Re-anuncio del mismo sorteo en otro grupo: continúa, no cierra nada.
//   - Otra tabla u otro cliente: no se tocan.
//   - El anuncio nuevo no se guarda: el anterior vuelve a estar activo.
//
// Reales: detectarEvento.js, guardarEvento.js, consultarEvento.js,
// identidadEventoReal.js, shared/eventos/unSorteoPorPrecio.js (entornoFake).
//
//     node backend/tests/deteccion/unSorteoPorPrecioAnuncio.test.js
// ==========================================================================

const assert = require("assert");
require("../utils/politicaGruposPermisiva");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const RUTA_SIN_LIBRES = path.join(RAIZ, "bot/funciones/eventos/lifecycle/sorteoSinNumerosLibres.js");
require.cache[RUTA_SIN_LIBRES] = { id: RUTA_SIN_LIBRES, filename: RUTA_SIN_LIBRES, loaded: true, exports: { sorteoSinNumerosLibres: async () => false } };

const { crearEntorno } = require("./entornoFake");

const USUARIO = "tenant-1";
const OTRO = "tenant-2";
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const G3 = "120363000000000003@g.us";

function anuncio({ loteria = "LOTERÍA DE MANIZALES", hora = "10:30 PM", valor = "$3.000" } = {}) {
    return [`🎰 ${loteria} ${hora}`, "🍀 Dos últimas cifras → $140.000", `💰 Valor número: ${valor}`].join("\n");
}

function ctx(sock, grupo, textoOriginal, { fromMe = true, participant = "573001112233@s.whatsapp.net" } = {}) {
    return {
        sock,
        grupo: { remoteJid: grupo },
        chat: { remoteJid: grupo, esGrupo: true },
        message: { key: { id: `m-${Math.random()}`, remoteJid: grupo, fromMe, participant } },
        textoOriginal
    };
}

const RECARGAR = ["sorteos/repo.js", "bot/funciones/admins/esAdministrador.js"].map(p => path.join(RAIZ, p));

async function entorno() {
    for (const ruta of RECARGAR) delete require.cache[ruta];
    const e = crearEntorno();
    for (const g of [G1, G2, G3]) e.fakeSupabase._agregar("grupos_autorizados", { usuario_id: USUARIO, grupo_id: g, activo: true });
    const { sock } = e.crearFakeSock({ usuarioId: USUARIO });
    const eventos = () => e.fakeSupabase._filas("eventos_bot");
    const activosDe = (grupo) => eventos().filter(f => f.grupo_id === grupo && f.activo === true);
    // Sorteos activos (identidades distintas) por cliente y PRECIO.
    const identidadesActivas = (usuario, valor) => new Set(eventos().filter(f => f.usuario_id === usuario && Number(f.valor) === Number(valor) && f.activo === true).map(f => f.identidad_evento_real));
    return { ...e, sock, eventos, activosDe, identidadesActivas };
}

// Manizales activo en G1 y G2 (mismo sorteo, misma tabla).
async function manizalesEnDosGrupos(e) {
    await e.detectarEvento(ctx(e.sock, G1, anuncio()));
    await e.detectarEvento(ctx(e.sock, G2, anuncio()));
    const [a, b] = [e.activosDe(G1)[0], e.activosDe(G2)[0]];
    assert.ok(a && b, "Manizales activo en los dos grupos");
    assert.strictEqual(a.identidad_evento_real, b.identidad_evento_real, "mismo sorteo en los dos grupos");
    return a;
}

const silenciar = async (fn) => {
    const c = { ...console };
    for (const m of ["log", "warn", "error", "table", "dir"]) console[m] = () => {};
    try { return await fn(); } finally { Object.assign(console, c); }
};

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn: () => silenciar(fn) });

prueba("administrador: el anuncio de OTRO sorteo en G1 reemplaza el anterior en G1 Y en G2; reservas intactas", async () => {
    const e = await entorno();
    const manizales = await manizalesEnDosGrupos(e);
    e.fakeSupabase._agregar(manizales.tabla, { usuario_id: USUARIO, numero: "10", estado: "pagado", identidad_evento_real: manizales.identidad_evento_real });
    const reservas = JSON.stringify(e.fakeSupabase._filas(manizales.tabla));

    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: true }));

    assert.match(e.activosDe(G1)[0].nombre_evento, /cauca/i, "Cauca activo en G1");
    assert.strictEqual(e.activosDe(G2).length, 0, "Manizales ya no está activo en G2");
    const cerradas = e.eventos().filter(f => f.identidad_evento_real === manizales.identidad_evento_real);
    assert.strictEqual(cerradas.length, 2);
    for (const f of cerradas) {
        assert.strictEqual(f.activo, false);
        assert.match(f.cierre_motivo, /^sustituido por el anuncio de /);
    }
    assert.deepStrictEqual([...e.identidadesActivas(USUARIO, manizales.valor)].length, 1, "un solo sorteo activo en la tabla");
    assert.strictEqual(JSON.stringify(e.fakeSupabase._filas(manizales.tabla)), reservas, "reservas y pagos intactos");
});

prueba("cliente (no administrador) con el anterior activo en otro grupo: no se apodera del precio, nada cambia", async () => {
    const e = await entorno();
    const manizales = await manizalesEnDosGrupos(e);
    const antes = JSON.stringify(e.eventos());
    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: false }));
    assert.strictEqual(JSON.stringify(e.eventos()), antes, "ninguna fila cambia");
    assert.strictEqual(e.activosDe(G1)[0].identidad_evento_real, manizales.identidad_evento_real);
});

prueba("cliente con el anterior SOLO en este grupo: comportamiento de siempre (se sustituye en el grupo)", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, G1, anuncio()));
    const manizales = e.activosDe(G1)[0];
    e.fakeSupabase._agregar(manizales.tabla, { usuario_id: USUARIO, numero: "11", estado: "reservado", identidad_evento_real: manizales.identidad_evento_real });
    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: false }));
    assert.match(e.activosDe(G1)[0].nombre_evento, /cauca/i);
    assert.strictEqual(e.activosDe(G1).length, 1);
    assert.strictEqual(e.identidadesActivas(USUARIO, manizales.valor).size, 1);
});

prueba("re-anuncio del MISMO sorteo en otro grupo: continúa, no cierra nada", async () => {
    const e = await entorno();
    const manizales = await manizalesEnDosGrupos(e);
    await e.detectarEvento(ctx(e.sock, G2, anuncio()));
    assert.strictEqual(e.eventos().filter(f => f.activo && f.identidad_evento_real === manizales.identidad_evento_real).length, 2);
    assert.ok(!e.eventos().some(f => /sustituido/.test(f.cierre_motivo || "")));
});

prueba("OTRA tabla del mismo cliente y el mismo sorteo de OTRO cliente: no se tocan", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, G2, anuncio({ loteria: "LOTERÍA DE BOYACÁ", valor: "$2.000" })));
    const otraTabla = e.activosDe(G2)[0];
    await e.detectarEvento(ctx(e.sock, G1, anuncio()));
    const manizales = e.activosDe(G1)[0];
    assert.notStrictEqual(otraTabla.tabla, manizales.tabla, "precondición: tablas distintas");
    const ajeno = e.fakeSupabase._agregar("eventos_bot", { usuario_id: OTRO, grupo_id: G1, tabla: manizales.tabla, identidad_evento_real: "ajeno", nombre_evento: "Ajeno", activo: true, estado: "abierto" });

    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: true }));

    assert.strictEqual(e.eventos().find(f => f.id === otraTabla.id).activo, true, "el sorteo de $2.000 sigue activo");
    assert.strictEqual(e.eventos().find(f => f.usuario_id === OTRO).activo, true, "el de otro cliente no se toca");
    assert.ok(ajeno !== undefined || true);
});

prueba("$3.000 y $10.000 a la vez: el anuncio de $10.000 en OTRO grupo no toca el de $3.000 (misma tabla física)", async () => {
    const e = await entorno();
    const tresMil = await manizalesEnDosGrupos(e);
    e.fakeSupabase._agregar(tresMil.tabla, { usuario_id: USUARIO, numero: "13", estado: "pagado", identidad_evento_real: tresMil.identidad_evento_real });
    const reservas = JSON.stringify(e.fakeSupabase._filas(tresMil.tabla));
    await e.detectarEvento(ctx(e.sock, G3, anuncio({ loteria: "LOTERÍA DE MEDELLÍN", valor: "$10.000" }), { fromMe: true }));
    const nuevo = e.activosDe(G3)[0];
    assert.strictEqual(Number(nuevo.valor), 10000);
    assert.strictEqual(nuevo.tabla, tresMil.tabla, "misma tabla física");
    assert.strictEqual(e.eventos().filter(f => f.identidad_evento_real === tresMil.identidad_evento_real && f.activo).length, 2, "el de $3.000 sigue activo en G1 y G2");
    assert.strictEqual(JSON.stringify(e.fakeSupabase._filas(tresMil.tabla)), reservas, "sus reservas y pagos intactos");
});

prueba("$10.000 anunciado en el MISMO grupo que el $3.000: lo reemplaza solo en ese grupo (un sorteo por grupo)", async () => {
    const e = await entorno();
    const tresMil = await manizalesEnDosGrupos(e);
    e.fakeSupabase._agregar(tresMil.tabla, { usuario_id: USUARIO, numero: "14", estado: "pagado", identidad_evento_real: tresMil.identidad_evento_real });
    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DE MEDELLÍN", valor: "$10.000" }), { fromMe: true }));
    assert.strictEqual(Number(e.activosDe(G1)[0].valor), 10000);
    assert.strictEqual(e.activosDe(G1).length, 1);
    assert.strictEqual(e.activosDe(G2)[0].identidad_evento_real, tresMil.identidad_evento_real, "en G2 el de $3.000 sigue");
});

prueba("dos anuncios de $10.000 distintos (G1 y G3): el nuevo reemplaza al anterior en todos sus grupos", async () => {
    const e = await entorno();
    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DE MEDELLÍN", valor: "$10.000" })));
    await e.detectarEvento(ctx(e.sock, G2, anuncio({ loteria: "LOTERÍA DE MEDELLÍN", valor: "$10.000" })));
    const viejo = e.activosDe(G1)[0];
    e.fakeSupabase._agregar(viejo.tabla, { usuario_id: USUARIO, numero: "15", estado: "pagado", identidad_evento_real: viejo.identidad_evento_real });
    await e.detectarEvento(ctx(e.sock, G3, anuncio({ loteria: "LOTERÍA DEL TOLIMA", valor: "$10.000" }), { fromMe: true }));
    assert.match(e.activosDe(G3)[0].nombre_evento, /tolima/i);
    assert.strictEqual(e.eventos().filter(f => f.identidad_evento_real === viejo.identidad_evento_real && f.activo).length, 0, "el $10.000 anterior se cerró en G1 y G2");
    assert.strictEqual(e.identidadesActivas(USUARIO, 10000).size, 1);
});

prueba("corrección de una detección equivocada (sin números): se corrige la fila de G1 y el sorteo equivocado se cierra en G2", async () => {
    const e = await entorno();
    const manizales = await manizalesEnDosGrupos(e);
    await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: true }));
    const g1 = e.eventos().find(f => f.id === manizales.id);
    assert.strictEqual(g1.activo, true, "misma fila de G1, corregida");
    assert.match(g1.nombre_evento, /cauca/i);
    assert.strictEqual(e.activosDe(G2).length, 0, "Manizales cerrado en G2");
    assert.strictEqual(e.identidadesActivas(USUARIO, manizales.valor).size, 1);
});

prueba("el anuncio nuevo no se puede guardar: el anterior vuelve a estar activo en TODOS sus grupos", async () => {
    const e = await entorno();
    const manizales = await manizalesEnDosGrupos(e);
    // Con números: el sorteo nuevo necesita fila propia (insert).
    e.fakeSupabase._agregar(manizales.tabla, { usuario_id: USUARIO, numero: "12", estado: "pagado", identidad_evento_real: manizales.identidad_evento_real });
    e.fakeSupabase._forzarErrorInsert("eventos_bot", { code: "23P01", message: 'conflicting key value violates exclusion constraint "eventos_bot_un_sorteo_activo_por_tabla"' });
    const r = await e.detectarEvento(ctx(e.sock, G1, anuncio({ loteria: "LOTERÍA DEL CAUCA" }), { fromMe: true }));
    assert.strictEqual(r, null, "no se guarda el anuncio");
    const filas = e.eventos().filter(f => f.identidad_evento_real === manizales.identidad_evento_real);
    assert.strictEqual(filas.length, 2);
    for (const f of filas) {
        assert.strictEqual(f.activo, true, `${f.grupo_id} restaurado`);
        assert.strictEqual(f.cierre_motivo ?? null, null);
    }
    assert.ok(!e.eventos().some(f => /cauca/i.test(f.nombre_evento || "")), "ninguna fila de Cauca");
});

(async () => {
    let ok = 0;
    let fallos = 0;
    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            fallos++;
            console.log(`❌ ${nombre}\n   ${err.message}`);
        }
    }
    console.log(`\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${fallos}`);
    process.exit(fallos ? 1 : 0);
})();
