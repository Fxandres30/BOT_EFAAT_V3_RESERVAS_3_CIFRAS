// ==========================================================================
// PRUEBAS — GRUPOS DE UN SORTEO (04/11/2026): «Cambiar grupos» (Tablas) y
// «Editar» (sorteo activo) cambian la MISMA asociación (la programación del
// sorteo), y un grupo nuevo recibe y ACTIVA el MISMO sorteo con el publicador
// (evento del grupo con su identidad y su tabla), sin sorteos ni tablas
// duplicados y sin repetir nada a los grupos que ya lo tenían.
//
// Reales: routes/tablas.js (HTTP + exigirUsuario), sorteos/{servicio,
// gruposSorteo, publicador, sorteosActivos, gestionEventos, repo}.js,
// guardarEvento, consultarEvento, abrirGrupo, compartirEnGrupos,
// ExecutionGuard, reservarNumeros. Simulados: Supabase (memoria), WhatsApp
// (socket + send.js) y la captura de la imagen. Ningún envío real.
//
// I (persistencia): los datos se vuelcan a disco y un PROCESO NUEVO de Node
// (módulos cargados desde cero, como tras reiniciar) los vuelve a leer.
//
//     node backend/tests/sorteos/gruposDelSorteo.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.SESSIONS_API_TOKEN = "token-servicio-grupos";
process.env.FRONTEND_URL = "http://127.0.0.1:3999";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(rutaRel, exportsObj) {
    const abs = r(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const MODO_REINICIO = process.argv[2] === "--reinicio";
const VOLCADO = process.argv[3] || path.join(os.tmpdir(), `efaat-grupos-sorteo-${process.pid}.json`);

let fake = crearFake();
inyectar("lib/supabase.js", {
    from: (t) => fake.client.from(t),
    auth: { getUser: (t) => fake.client.auth.getUser(t) },
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
});

// WhatsApp simulado: TODO lo que saldría hacia un grupo.
const salidas = [];
inyectar("services/baileys/send.js", {
    sendImage: async ({ jid, caption }) => { salidas.push({ jid, tipo: "imagen", texto: caption }); return { key: { id: `m${salidas.length}` } }; },
    sendMessage: async ({ jid, text }) => { salidas.push({ jid, tipo: "texto", texto: text }); return { key: { id: `m${salidas.length}` } }; }
});

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000
const operaciones = [];
const sock = {
    context: { usuarioId: A, sessionId: "ses-grupos", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => { operaciones.push({ jid, ajuste }); },
    sendMessage: async () => ({ key: { id: "x" } })
};
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? sock : null) });

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const sorteosActivos = require(r("sorteos/sorteosActivos.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { reservarNumerosDetallado } = require(r("bot/funciones/reservas/reservarNumeros.js"));

const PNG = Buffer.from("png-simulado-del-sorteo");
const deps = { ...publicador.dependenciasReales(), puedeActuar: () => true, capturarImagen: async () => PNG };
gruposSorteo.deps.puedeActuar = () => true;
gruposSorteo.deps.publicadorDeps = deps;
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = deps;

const AHORA = new Date("2026-10-22T15:00:00Z");        // 10:00 en Colombia
const PUBLICAR = new Date("2026-10-22T15:05:00Z");
const DESPUES = new Date("2026-10-22T15:20:00Z");
servicio._reloj.ahora = () => AHORA;
gruposSorteo.reloj.ahora = () => DESPUES;

const tablas = () => fake.tablas;
const silencio = async (fn) => {
    const { log, table, dir, warn, error, info } = console;
    console.log = console.table = console.dir = console.warn = console.error = console.info = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error, info }); }
};

// --------------------------------------------------------- HTTP de Tablas ---
let base = null;
async function arrancarApi() {
    const express = require("express");
    const app = express();
    app.use("/tablas/compartir", express.json({ limit: "6mb" }));
    app.use(express.json());
    app.use("/tablas", require(r("routes/tablas.js")));
    await new Promise(ok => { const s = app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${s.address().port}`; ok(); }); s.unref(); });
}
const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
async function api(metodo, camino, cuerpo) {
    const res = await fetch(base + camino, {
        method: metodo,
        headers: { "content-type": "application/json", "x-service-token": "token-servicio-grupos", authorization: "Bearer jwt-A" },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
    });
    return { status: res.status, json: await res.json() };
}
let nSol = 0;
const sol = () => `00000000-0000-4000-9000-${String(++nSol).padStart(12, "0")}`;

// --------------------------------------------------------------- datos ---
function escenario() {
    fake = crearFake();
    salidas.length = 0;
    operaciones.length = 0;
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    t.grupos_autorizados = ["g1", "g2", "g3", "g4"].map(g => ({ usuario_id: A, grupo_id: `${g}@g.us`, activo: true }));
    t.grupos = ["g1", "g2", "g3", "g4"].map((g, i) => ({ jid: `${g}@g.us`, nombre: `Grupo ${i + 1}` }));
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const ENTRADA = {
    modalidad: "dos_cifras", nombre: "Sorteo A", hora_fin: "22:30", valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us", "g2@g.us"], cuentas: ["cuenta-a1"],
    publicacion_inmediata: false, publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
    mensajes: { publicacion: "", aviso_cierre: "" },
    recordatorios: [{ minutos_antes_cierre: 60, texto: "Recordatorio: quedan pocos números" }],
    diseno: { origen: "preset", nombre: "Morado", config: {
        theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
        cells: { available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" }, reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" }, pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" } },
        numbers: { size: 18, weight: 700 }, grid: { radius: 10, spacing: 6, borderWidth: 1 }
    } }
};

const programacion = () => tablas().sorteos_programados[0];
const filaGrupo = (g) => tablas().sorteos_programados_grupos.find(x => x.grupo_id === g);
const eventosDe = (s) => tablas().eventos_bot.filter(e => e.identidad_evento_real === s.identidad_evento_real);
const eventoEn = (s, g) => eventosDe(s).find(e => e.grupo_id === g);
const salidasA = (g) => salidas.filter(x => x.jid === g);
const imagenesA = (g) => salidasA(g).filter(x => x.tipo === "imagen").length;
const numerosTomados = () => JSON.stringify(tablas()[T5K].filter(f => f.estado !== "libre").map(f => [f.numero, f.estado, f.identidad_evento_real, f.grupo_id]));

async function reservar(grupo, numero) {
    const evento = await consultarEvento(grupo, A);
    const res = await silencio(() => reservarNumerosDetallado({ evento, numeros: [numero], usuario: { telefono: "573111111111", nombre: "Ana" }, comprador: "Ana", contacto: "573111111111", lib: null }));
    return { evento, filas: res.filas, error: res.error };
}

// Crea el sorteo y lo publica en g1 y g2 (ciclo del publicador a su hora).
async function publicadoEnDos() {
    escenario();
    const c = await silencio(() => servicio.crearSorteo(A, ENTRADA));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    await silencio(() => publicador.tick(sock, { ahora: new Date("2026-10-22T15:05:30Z"), deps }));
    return programacion();
}

// ------------------------------------------------------------- pruebas ---
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });
const estado = {};

prueba("A. Crear el sorteo y publicarlo en dos grupos: un sorteo, dos eventos activos con la MISMA identidad y tabla", async () => {
    const s = await publicadoEnDos();
    assert.strictEqual(s.estado, "publicado");
    assert.deepStrictEqual(["g1@g.us", "g2@g.us"].map(imagenesA), [1, 1]);
    const ev = eventosDe(s);
    assert.strictEqual(ev.length, 2);
    assert.ok(ev.every(e => e.activo && e.abierto && e.tabla === T5K && e.identidad_evento_real === s.identidad_evento_real), JSON.stringify(ev));
    // Reservas y un pago del sorteo en los grupos anteriores.
    assert.strictEqual((await reservar("g1@g.us", "05")).filas.length, 1);
    assert.strictEqual((await reservar("g2@g.us", "06")).filas.length, 1);
    const f07 = tablas()[T5K].find(f => f.numero === "07");
    Object.assign(f07, { estado: "pagado", identidad_evento_real: s.identidad_evento_real, grupo_id: "g1@g.us", comprador: "Luis" });
    estado.tomados = numerosTomados();
    assert.ok(/"05","reservado"/.test(estado.tomados) && /"07","pagado"/.test(estado.tomados), estado.tomados);
});

prueba("B. «Cambiar grupos» (Tablas → Guardar grupos) agrega el Grupo 3: queda asociado y PERSISTIDO, sin publicar nada", async () => {
    const s = await publicadoEnDos();
    await reservar("g1@g.us", "05");
    const antes = salidas.length;
    const r1 = await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.deepStrictEqual(r1.json.data.agregados.map(g => g.grupo_id), ["g3@g.us"]);
    assert.strictEqual(r1.json.data.por_publicar, 1);
    assert.strictEqual(filaGrupo("g3@g.us").estado, "pendiente", "asociación guardada en la base");
    assert.strictEqual(salidas.length, antes, "guardar no envía nada");
    assert.strictEqual(eventoEn(s, "g3@g.us"), undefined, "todavía no está activo en el Grupo 3");
    assert.strictEqual(programacion().estado, "publicado", "guardar no vuelve a poner el sorteo a publicar");
    // El ciclo automático tampoco lo publica solo.
    await silencio(() => publicador.tick(sock, { ahora: DESPUES, deps }));
    assert.strictEqual(salidas.length, antes, "el ciclo automático no publica por haber guardado");
    // Vista previa de Tablas: la selección ES la del sorteo.
    const v = await silencio(() => api("GET", "/tablas/compartir/vista-previa?precio=3000&sin_imagen=1"));
    assert.deepStrictEqual(v.json.data.seleccion, ["g1@g.us", "g2@g.us", "g3@g.us"]);
    assert.deepStrictEqual([v.json.data.estado_grupos["g1@g.us"], v.json.data.estado_grupos["g3@g.us"], v.json.data.estado_grupos["g4@g.us"]], ["activo", "pendiente", "sin_sorteo"]);
    // Destinos de «Compartir» copiados (misma selección).
    assert.deepStrictEqual(tablas().destinos_compartir_tabla?.[0]?.grupos, ["g1@g.us", "g2@g.us", "g3@g.us"]);
});

prueba("C+D. Publicar en el Grupo 3 desde Tablas: recibe y ACTIVA el MISMO sorteo (misma identidad y tabla, operativo para reservas); Grupos 1 y 2 no reciben nada", async () => {
    const s = await publicadoEnDos();
    await reservar("g1@g.us", "05");
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    const antesG12 = [salidasA("g1@g.us").length, salidasA("g2@g.us").length];
    const r1 = await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol(), imagen: PNG_URL, grupos: ["g3@g.us"] }));
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
    assert.deepStrictEqual(r1.json.resultados.map(x => [x.grupo_id, x.estado, x.activado]), [["g3@g.us", "enviado", true]]);
    // El MISMO sorteo en el Grupo 3.
    const e3 = eventoEn(s, "g3@g.us");
    assert.ok(e3 && e3.activo && e3.abierto, JSON.stringify(e3));
    assert.deepStrictEqual([e3.tabla, e3.identidad_evento_real, e3.valor && Number(e3.valor)], [T5K, s.identidad_evento_real, 3000]);
    assert.strictEqual(filaGrupo("g3@g.us").estado, "publicado");
    assert.strictEqual(filaGrupo("g3@g.us").evento_bot_id, e3.id);
    assert.ok(operaciones.some(o => o.jid === "g3@g.us" && o.ajuste === "not_announcement"), "el Grupo 3 se abrió");
    assert.strictEqual(imagenesA("g3@g.us"), 1, "un anuncio con la imagen");
    // OPERATIVO: el bot del Grupo 3 encuentra este sorteo y reserva en SU tabla.
    const r10 = await reservar("g3@g.us", "10");
    assert.strictEqual(r10.evento.id, e3.id);
    assert.strictEqual(r10.filas.length, 1, "reserva aceptada en el Grupo 3");
    const fila10 = tablas()[T5K].find(f => f.numero === "10");
    assert.deepStrictEqual([fila10.estado, fila10.identidad_evento_real], ["reservado", s.identidad_evento_real]);
    // Misma tabla: el 05 reservado en el Grupo 1 está ocupado para el Grupo 3.
    assert.strictEqual((await reservar("g3@g.us", "05")).filas.length, 0, "una tabla = un sorteo: el 05 ya es de otro comprador");
    // D: nada nuevo a los grupos que ya lo tenían; reintentar no duplica.
    assert.deepStrictEqual([salidasA("g1@g.us").length, salidasA("g2@g.us").length], antesG12);
    const otra = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    assert.ok(otra.ok && otra.data.nada_que_publicar, JSON.stringify(otra));
    await silencio(() => publicador.tick(sock, { ahora: new Date("2026-10-22T15:40:00Z"), deps }));
    assert.strictEqual(imagenesA("g3@g.us"), 1);
    assert.deepStrictEqual([salidasA("g1@g.us").length, salidasA("g2@g.us").length], antesG12);
    // H: sin sorteos ni filas duplicadas; los otros grupos intactos.
    assert.strictEqual(tablas().sorteos_programados.length, 1);
    assert.strictEqual(eventosDe(s).length, 3);
    assert.ok(eventoEn(s, "g1@g.us").activo && eventoEn(s, "g2@g.us").activo, "publicar en el Grupo 3 no cierra los otros");
});

prueba("E. «Editar» el sorteo activo: agrega el Grupo 4 (misma operación); guardar no publica; «Publicar en los grupos nuevos» lo activa solo ahí", async () => {
    const s = await publicadoEnDos();
    const e1 = eventoEn(s, "g1@g.us");
    const vista = await silencio(() => sorteosActivos.obtener(A, e1.id));
    assert.ok(vista.ok && vista.data.campos.grupos.editable, JSON.stringify(vista.data?.campos?.grupos));
    const antes = salidas.length;
    const ed = await silencio(() => sorteosActivos.editar(A, e1.id, {
        grupos: ["g1@g.us", "g2@g.us", "g4@g.us"],
        premios: [{ nombre: "Premio mayor", premio: 350000 }],
        base: { premios: vista.data.premios, hora_cierre: vista.data.hora_cierre }
    }));
    assert.ok(ed.ok, JSON.stringify(ed));
    assert.deepStrictEqual(ed.data.cambios_grupos.agregados.map(g => g.grupo_id), ["g4@g.us"]);
    assert.strictEqual(salidas.length, antes, "guardar la edición no envía nada");
    assert.strictEqual(Number(eventoEn(s, "g1@g.us").premios[0].premio), 350000, "el resto de la edición se guardó");
    assert.deepStrictEqual(ed.data.destinos.map(g => [g.grupo_id, g.estado]), [["g1@g.us", "publicado"], ["g2@g.us", "publicado"], ["g4@g.us", "pendiente"]]);
    const pub = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    assert.ok(pub.ok, JSON.stringify(pub));
    assert.deepStrictEqual(pub.data.publicados_ahora, ["g4@g.us"]);
    assert.ok(eventoEn(s, "g4@g.us")?.activo && eventoEn(s, "g4@g.us").tabla === T5K);
    assert.deepStrictEqual(["g1@g.us", "g2@g.us", "g4@g.us"].map(imagenesA), [1, 1, 1]);
    // Misma fuente de verdad: Tablas ve lo que guardó «Editar».
    const v = await silencio(() => api("GET", "/tablas/compartir/vista-previa?precio=3000&sin_imagen=1"));
    assert.deepStrictEqual(v.json.data.seleccion, ["g1@g.us", "g2@g.us", "g4@g.us"]);
});

prueba("F+G. Quitar el Grupo 2: se desactiva SOLO ahí, deja de recibir recordatorios y «Compartir»; reservas, pagos e historia intactos; los demás siguen", async () => {
    const s = await publicadoEnDos();
    await reservar("g1@g.us", "05");
    await reservar("g2@g.us", "06");
    const f07 = tablas()[T5K].find(f => f.numero === "07");
    Object.assign(f07, { estado: "pagado", identidad_evento_real: s.identidad_evento_real, grupo_id: "g2@g.us", comprador: "Luis" });
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    const tomados = numerosTomados();
    const filasEventos = tablas().eventos_bot.length;

    const q = await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g3@g.us"] }));
    assert.strictEqual(q.status, 200, JSON.stringify(q.json));
    assert.deepStrictEqual(q.json.data.desactivados.map(g => g.grupo_id), ["g2@g.us"]);
    const e2 = eventoEn(s, "g2@g.us");
    assert.strictEqual(e2.activo, false, "desactivado en el Grupo 2");
    assert.ok(eventoEn(s, "g1@g.us").activo && eventoEn(s, "g3@g.us").activo, "los demás grupos siguen activos");
    assert.strictEqual(filaGrupo("g2@g.us").estado, "cancelado");
    assert.ok(filaGrupo("g2@g.us").publicado_en, "la historia de su publicación se conserva");
    assert.strictEqual(numerosTomados(), tomados, "reservas y pagos intactos (también los del Grupo 2)");
    assert.strictEqual(tablas().eventos_bot.length, filasEventos, "no se borra ninguna fila");
    // No recibe nuevas publicaciones: recordatorio (60 min antes del cierre 22:26).
    const antesG2 = salidasA("g2@g.us").length;
    await silencio(() => publicador.tick(sock, { ahora: new Date("2026-10-23T02:27:00Z"), deps }));
    assert.ok(salidasA("g1@g.us").some(x => /Recordatorio/.test(x.texto)) && salidasA("g3@g.us").some(x => /Recordatorio/.test(x.texto)), "los activos reciben el recordatorio");
    assert.strictEqual(salidasA("g2@g.us").length, antesG2, "el Grupo 2 ya no recibe el recordatorio");
    // «Compartir» de un clic: solo los grupos del sorteo.
    const c = await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol(), imagen: PNG_URL }));
    assert.strictEqual(c.status, 200, JSON.stringify(c.json));
    assert.deepStrictEqual(c.json.resultados.map(x => x.grupo_id).sort(), ["g1@g.us", "g3@g.us"]);
    assert.strictEqual(salidasA("g2@g.us").length, antesG2);
    // Y no se vuelve a publicar en el Grupo 2 al publicar grupos nuevos.
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    assert.strictEqual(salidasA("g2@g.us").length, antesG2);
    // El bot del Grupo 2 ya no tiene un sorteo activo.
    assert.strictEqual((await consultarEvento("g2@g.us", A)).activo, false);
});

prueba("H. Sin duplicados: un sorteo, una fila por grupo, una tabla de 100 números (ninguna regenerada)", async () => {
    const s = await publicadoEnDos();
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    // Guardar la MISMA selección dos veces más y volver a publicar: nada nuevo.
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g2@g.us", "g3@g.us"] }));
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    assert.strictEqual(tablas().sorteos_programados.length, 1);
    assert.strictEqual(tablas().sorteos_programados_grupos.length, 3);
    const porGrupo = eventosDe(s).map(e => e.grupo_id).sort();
    assert.deepStrictEqual(porGrupo, ["g1@g.us", "g2@g.us", "g3@g.us"]);
    assert.ok(eventosDe(s).every(e => e.tabla === T5K));
    assert.strictEqual(tablas()[T5K].length, 100);
    assert.deepStrictEqual(["g1@g.us", "g2@g.us", "g3@g.us"].map(imagenesA), [1, 1, 1]);
});

prueba("Re-agregar un grupo quitado no lo reactiva en silencio; un sorteo detectado no cambia de grupos desde «Editar»", async () => {
    const s = await publicadoEnDos();
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us"] }));
    assert.strictEqual(eventoEn(s, "g2@g.us").activo, false);
    const de = await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us"]));
    assert.ok(de.ok, JSON.stringify(de));
    assert.ok(de.data.avisos.some(a => /reábrelo en Eventos/.test(a)), JSON.stringify(de.data.avisos));
    assert.strictEqual(eventoEn(s, "g2@g.us").activo, false);
    // Sorteo detectado (sin programación): grupos bloqueados en «Editar».
    tablas().eventos_bot.push({ id: "ev-detectado", usuario_id: A, grupo_id: "g4@g.us", activo: true, abierto: true, estado: "abierto", identidad_evento_real: "ident-detectado", nombre_evento: "Detectado", hora_fin: "21:00", hora_cierre: "20:56", fecha_evento: "2026-10-22", valor: 5000, premios: [{ nombre: "x", premio: 1 }], tabla: "otra_tabla", cifras: 2, cantidad_numeros: 100, creado_en: "2026-10-22T13:00:00Z" });
    const v = await silencio(() => sorteosActivos.obtener(A, "ev-detectado"));
    assert.strictEqual(v.data.campos.grupos.editable, false);
    const ed = await silencio(() => sorteosActivos.editar(A, "ev-detectado", { grupos: ["g4@g.us", "g3@g.us"], base: { premios: v.data.premios, hora_cierre: v.data.hora_cierre } }));
    assert.strictEqual(ed.ok, false);
    assert.ok(ed.errores.some(e => e.campo === "grupos"));
});

prueba("Compartir la tabla NO desactiva, duplica ni modifica el sorteo asociado a sus grupos (un clic, misma selección guardada, repetido, y solo un grupo)", async () => {
    const s = await publicadoEnDos();
    await reservar("g1@g.us", "05");
    await reservar("g2@g.us", "06");
    Object.assign(tablas()[T5K].find(f => f.numero === "07"), { estado: "pagado", identidad_evento_real: s.identidad_evento_real, grupo_id: "g1@g.us", comprador: "Luis" });
    // Lo que define al sorteo en sus grupos (sin marcas de tiempo de lectura).
    const foto = () => JSON.stringify({
        sorteo: tablas().sorteos_programados.map(x => [x.id, x.estado, x.version, x.identidad_evento_real, x.tabla, JSON.stringify(x.config)]),
        grupos: tablas().sorteos_programados_grupos.map(g => [g.grupo_id, g.estado, g.evento_bot_id, g.publicado_en, g.intentos, g.reintentos_manuales]),
        eventos: tablas().eventos_bot.map(e => [e.id, e.grupo_id, e.activo, e.abierto, e.estado, e.identidad_evento_real, e.tabla, e.hora_cierre, JSON.stringify(e.premios)]),
        numeros: tablas()[T5K].filter(f => f.estado !== "libre").map(f => [f.numero, f.estado, f.identidad_evento_real, f.grupo_id])
    });
    const antes = foto();
    const imgs = () => ["g1@g.us", "g2@g.us", "g3@g.us"].map(imagenesA);

    // 1. Un clic (grupos del sorteo).
    const sol1 = sol();
    const c1 = await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol1, imagen: PNG_URL }));
    assert.strictEqual(c1.status, 200, JSON.stringify(c1.json));
    assert.deepStrictEqual(c1.json.resultados.map(x => x.grupo_id).sort(), ["g1@g.us", "g2@g.us"]);
    assert.deepStrictEqual(imgs(), [2, 2, 0], "anuncio inicial + la tabla compartida");
    assert.strictEqual(foto(), antes, "compartir (un clic) no cambia el sorteo, sus grupos, eventos ni números");

    // 2. La MISMA solicitud otra vez (reintento del panel): no duplica.
    await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol1, imagen: PNG_URL }));
    assert.deepStrictEqual(imgs(), [2, 2, 0], "reintento de la misma solicitud: sin duplicados");

    // 3. Confirmar la misma selección con «guardar»: nada que cambiar.
    const c3 = await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol(), imagen: PNG_URL, grupos: ["g1@g.us", "g2@g.us"], guardar_destinos: true }));
    assert.strictEqual(c3.status, 200, JSON.stringify(c3.json));
    assert.strictEqual(foto(), antes, "guardar la misma selección no modifica nada");

    // 4. Compartir SOLO en un grupo (sin guardar): el otro NO se desactiva.
    const c4 = await silencio(() => api("POST", "/tablas/compartir", { precio: 3000, solicitudId: sol(), imagen: PNG_URL, grupos: ["g1@g.us"] }));
    assert.strictEqual(c4.status, 200, JSON.stringify(c4.json));
    assert.deepStrictEqual(imgs(), [4, 3, 0]);
    assert.strictEqual(foto(), antes, "compartir en un solo grupo no quita ni desactiva el otro");
    assert.ok(eventoEn(s, "g2@g.us").activo, "el Grupo 2 sigue con su sorteo");
    assert.strictEqual(tablas().sorteos_programados.length, 1);
    assert.strictEqual(eventosDe(s).length, 2, "sin eventos nuevos");
    // Solo la publicación inicial abrió grupos; compartir no.
    assert.strictEqual(operaciones.filter(o => o.ajuste === "not_announcement").length, 2);
});

prueba("I. Persistencia tras reiniciar: un proceso NUEVO lee la misma asociación y el sorteo sigue operativo en el grupo nuevo, sin reenviar nada", async () => {
    const s = await publicadoEnDos();
    await silencio(() => api("PUT", "/tablas/compartir/destinos", { precio: 3000, grupos: ["g1@g.us", "g3@g.us"] }));
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    fs.writeFileSync(VOLCADO, JSON.stringify({ tablas: tablas(), sorteo: s.id, identidad: s.identidad_evento_real }));
    const hijo = spawnSync(process.execPath, [__filename, "--reinicio", VOLCADO], { encoding: "utf8", env: { ...process.env, SUPABASE_URL: "http://127.0.0.1:9" } });
    fs.rmSync(VOLCADO, { force: true });
    assert.strictEqual(hijo.status, 0, `${hijo.stdout}\n${hijo.stderr}`);
    const informe = JSON.parse(hijo.stdout.trim().split("\n").pop());
    assert.deepStrictEqual(informe.grupos, [["g1@g.us", "publicado"], ["g2@g.us", "cancelado"], ["g3@g.us", "publicado"]]);
    assert.deepStrictEqual(informe.activos, ["g1@g.us", "g3@g.us"]);
    assert.strictEqual(informe.evento_g3.tabla, T5K);
    assert.strictEqual(informe.evento_g3.identidad, s.identidad_evento_real);
    assert.strictEqual(informe.reserva_g3, 1, "tras el reinicio el Grupo 3 sigue aceptando reservas del sorteo");
    assert.strictEqual(informe.salidas_tras_ciclo, 0, "el primer ciclo tras reiniciar no reenvía nada");
    assert.deepStrictEqual(informe.seleccion_tablas, ["g1@g.us", "g3@g.us"]);
});

// Proceso hijo de la prueba I: arranca de cero con los datos volcados.
async function comprobarTrasReinicio() {
    const volcado = JSON.parse(fs.readFileSync(VOLCADO, "utf8"));
    fake = crearFake();
    Object.assign(fake.tablas, volcado.tablas);
    fake.tokens["jwt-A"] = A;
    const g = (await require(r("sorteos/repo.js")).gruposDelSorteo(A, volcado.sorteo)).data.map(x => [x.grupo_id, x.estado]).sort();
    const activos = fake.tablas.eventos_bot.filter(e => e.identidad_evento_real === volcado.identidad && e.activo).map(e => e.grupo_id).sort();
    const e3 = await consultarEvento("g3@g.us", A);
    const reserva = await reservar("g3@g.us", "44");
    salidas.length = 0;
    await silencio(() => publicador.tick(sock, { ahora: new Date("2026-10-22T16:00:00Z"), deps }));
    await arrancarApi();
    const v = await silencio(() => api("GET", "/tablas/compartir/vista-previa?precio=3000&sin_imagen=1"));
    process.stdout.write(`${JSON.stringify({
        grupos: g, activos, evento_g3: { tabla: e3.tabla, identidad: e3.identidad_evento_real },
        reserva_g3: reserva.filas.length, salidas_tras_ciclo: salidas.length, seleccion_tablas: v.json.data.seleccion
    })}\n`);
    process.exit(0);
}

// ------------------------------------------------------------ ejecución ---
(async () => {
    if (MODO_REINICIO) return comprobarTrasReinicio();
    await arrancarApi();
    let ok = 0;
    for (const p of pruebas) {
        try { await p.fn(); ok++; console.log(`✅ ${p.n}`); }
        catch (e) { console.log(`❌ ${p.n}\n   ${e.stack?.split("\n").slice(0, 4).join("\n   ")}`); }
    }
    console.log("============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    console.log("============================");
    process.exit(ok === pruebas.length ? 0 : 1);
})();
