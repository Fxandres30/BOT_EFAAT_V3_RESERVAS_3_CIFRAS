// ==========================================================================
// PRUEBAS — la tabla de la VISTA PREVIA con «Reiniciar la tabla antes de
// publicar» es EXACTAMENTE la que deja la migración 030, y por tanto la
// imagen capturada en el panel (capturaProgramada.js) coincide con la tabla
// real al publicar.
//
// Causa corregida (06/11): la vista previa pintaba TODO libre tras reiniciar,
// pero la 030 conserva los números «bloqueado» (clase «conservado») salvo
// que se elija liberarlos. Con bloqueados a mano, la huella de la imagen
// guardada nunca coincidía con la tabla reiniciada: el anuncio quedaba en
// revisión DESPUÉS de reemplazar el sorteo anterior y archivar la tabla, y
// «Reintentar» repetía el desajuste. En el instantáneo, la imagen mostraba
// como libres números que seguían bloqueados.
//
//   1. Reiniciar CON bloqueados (programado, reemplazando el activo del precio).
//   2. Reiniciar SIN bloqueados.            3. Reiniciar liberando bloqueados.
//   4. Sorteo instantáneo con bloqueados.   5. Reintento tras fallo de envío.
//   6. Sin poder leer los bloqueados: no se arriesga la imagen (bloqueo).
//   7. Conservar: la vista previa es la tabla real, sin proyección.
//   En todas: huella(vista previa) === huella(tabla real tras el reinicio).
//
// Reales: servicio, publicador, capturaProgramada, reinicioTabla, envío de
// «Compartir». Simulados: Supabase (memoria), la 030 (misma clasificación
// que la SQL) y el socket de WhatsApp. No toca la base real ni WhatsApp.
//
//     node backend/tests/sorteos/reinicioVistaTabla.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const DIR_CAPTURAS = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-capturas-reinicio-"));
process.env.EFAAT_CAPTURAS_DIR = DIR_CAPTURAS;

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
const rpc = { llamadas: [] };

// reiniciar_tabla_cliente (030), misma clasificación que la SQL: todo o nada;
// los bloqueados se conservan salvo p_liberar_bloqueados.
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
        fake.tablas.reservas_archivo.push({ usuario_id: args.p_usuario, tabla: args.p_tabla, numero: f.numero, estado: f.estado, identidad: f.identidad_evento_real, sorteo_id: args.p_sorteo, fila: { ...f } });
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
const capturaProgramada = require(r("sorteos/capturaProgramada.js"));
const reinicioTabla = require(r("sorteos/reinicioTabla.js"));
const tablaEvento = require(r("automation/repo/tablaEvento.js"));
const destinos = require(r("services/destinosCompartir.js"));
const compartirTabla = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// F4-G: un programado genera su imagen a la hora con el MISMO capturarTabla
// en Chromium headless (simulado: se registran los datos que recibe). En el
// instantáneo la imagen es la que el panel acaba de capturar.
let generadas = [];
compartirTabla.capturarImagenTabla = async (precio, usuarioId, eventoId, opciones = {}) => {
    generadas.push(opciones.datos);
    return Buffer.concat([PNG1.subarray(0, 33), Buffer.from(JSON.stringify(opciones.datos.numerosOcupados))]);
};

// Hoy 15/10; se publica el 22/10 08:00 (Colombia) y se juega ese día.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const DESPUES = new Date("2026-10-22T13:05:00Z");
let reloj = T0;
servicio._reloj.ahora = () => reloj;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const ANTERIOR = "anterior-5000";

function png(ancho) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(ancho, 16);
    b.writeUInt32BE(100, 20);
    b[24] = 8; b[25] = 6;
    return b;
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const PNG1 = png(101);
const PNG2 = png(202);

let enviados = [];
let fallaEnvio = () => null;

// Tabla de $5.000 de A: sorteo ACTIVO del mismo precio (se reemplaza al
// publicar) con 3 pagados y 2 reservados; `bloqueados`: números bloqueados a mano.
function escenario({ bloqueados = [], anteriorActivo = true } = {}) {
    fake = crearFake();
    rpc.llamadas = [];
    generadas = [];
    capturaProgramada._olvidarGeneraciones();
    enviados = [];
    fallaEnvio = () => null;
    reloj = T0;
    fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.reservas_archivo = [];
    t.eventos_bot = [{
        id: "ev-anterior", grupo_id: "g1@g.us", usuario_id: A, activo: anteriorActivo, abierto: anteriorActivo, estado: anteriorActivo ? "abierto" : "cerrado",
        identidad_evento_real: ANTERIOR, nombre_evento: "Boyacá", tabla: T5K, valor: "5000", cifras: 2, cantidad_numeros: 100,
        hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-22", creado_en: new Date("2026-10-14T12:00:00Z")
    }];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    t[T5K].slice(0, 5).forEach((f, i) => Object.assign(f, {
        estado: i < 3 ? "pagado" : "reservado", identidad_evento_real: ANTERIOR, evento_id: "ev-anterior", nombre_evento: "Boyacá", comprador: `Cliente ${i}`
    }));
    for (const n of bloqueados) Object.assign(t[T5K].find(f => f.numero === n), { estado: "bloqueado" });
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras", nombre: "Lotería de Manizales", hora_fin: "22:30", valor: 5000, fecha_sorteo: "2026-10-22",
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(), mensajes: { publicacion: "{{nombre}}", aviso_cierre: "" }, recordatorios: [],
        tabla: { reiniciar: true, liberar_bloqueados: false },
        ...extra
    };
}

const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        const error = fallaEnvio(jid);
        if (error) throw new Error(error);
        enviados.push({ jid, image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

function deps() {
    return {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: publicador.dependenciasReales().capturarImagen,
        textoParaCompartir: destinos.textoParaCompartir,
        compartirEnGrupos: compartirTabla.compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
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
const tick = (ahora) => silencio(() => publicador.tick(sock(), { ahora, deps: deps() }));
const grupoDe = (id) => fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === id && x.grupo_id === "g1@g.us");
const aplicadas = () => rpc.llamadas.filter(l => l.args.p_aplicar === true).length;
const estadoDe = (n) => fake.tablas[T5K].find(f => f.numero === n).estado;
const anteriorActivo = () => fake.tablas.eventos_bot.find(e => e.id === "ev-anterior").activo;

// Tabla REAL de ahora, con la misma función que usan la imagen y la huella.
const huellaReal = async () => capturaProgramada.huellaNumeros(await tablaEvento.obtenerNumeros(T5K, A));

// «Confirmar y programar»: vista previa + captura del panel con su huella.
async function confirmarConCaptura(s, v, imagen = PNG1) {
    return silencio(() => servicio.confirmar(A, s.id, {
        version: s.version, confirmacion: true, reinicio: { confirmado: true }, imagen: dataUrl(imagen), huella: v.huella_tabla
    }));
}

function usarInstantaneo() {
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = deps();
}

const resultados = [];
async function prueba(nombre, fn) {
    try { await fn(); resultados.push(true); console.log(`✅ ${nombre}`); }
    catch (e) { resultados.push(false); console.log(`❌ ${nombre}\n   ${e.stack || e.message}`); }
}

(async () => {

await prueba("1. Reiniciar CON bloqueados a mano (programado): la vista previa los muestra ocupados; al publicar se genera la imagen de la tabla real reiniciada (= vista previa) y se publica", async () => {
    escenario({ bloqueados: ["50", "77"] });
    const s = await crear();
    const v = await vista(s);
    assert.deepStrictEqual(v.bloqueos, [], JSON.stringify(v.bloqueos));
    assert.deepStrictEqual([...v.numeros.numerosOcupados].sort(), ["50", "77"], "los bloqueados conservados se ven ocupados");
    assert.deepStrictEqual(v.numeros.numerosPagados, []);
    assert.strictEqual(v.numeros.numerosDisponibles.length, 98);
    assert.strictEqual(v.reinicio.conservados, 2);
    const conf = await confirmarConCaptura(s, v);
    assert.ok(conf.ok, JSON.stringify(conf));

    reloj = EN_PUBLICACION;
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(await huellaReal(), v.huella_tabla, "vista previa === tabla real tras el reinicio");
    assert.deepStrictEqual([estadoDe("50"), estadoDe("77")], ["bloqueado", "bloqueado"], "la 030 los conserva");
    assert.strictEqual(fake.tablas.reservas_archivo.length, 5, "pagos y reservas del anterior archivados, no borrados");
    assert.strictEqual(anteriorActivo(), false, "reemplazado");
    assert.strictEqual(aplicadas(), 1);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(generadas.length, 1, "imagen generada a la hora");
    assert.strictEqual(capturaProgramada.huellaNumeros(generadas[0]), v.huella_tabla, "pinta exactamente la tabla reiniciada que mostró la vista previa");
    assert.deepStrictEqual([...generadas[0].numerosOcupados].sort(), ["50", "77"], "con los bloqueados conservados");
});

await prueba("2. Reiniciar SIN bloqueados: todo libre en la vista previa y en la tabla real; se publica", async () => {
    escenario();
    const s = await crear();
    const v = await vista(s);
    assert.deepStrictEqual(v.numeros.numerosOcupados, []);
    assert.strictEqual(v.numeros.numerosDisponibles.length, 100);
    assert.ok((await confirmarConCaptura(s, v)).ok);
    reloj = EN_PUBLICACION;
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(await huellaReal(), v.huella_tabla);
    assert.strictEqual(enviados.length, 1);
});

await prueba("3. Reiniciar LIBERANDO los bloqueados: la vista previa los muestra libres y la 030 los libera (con respaldo)", async () => {
    escenario({ bloqueados: ["50", "77"] });
    const s = await crear({ tabla: { reiniciar: true, liberar_bloqueados: true } });
    const v = await vista(s);
    assert.deepStrictEqual(v.numeros.numerosOcupados, []);
    assert.ok((await confirmarConCaptura(s, v)).ok);
    reloj = EN_PUBLICACION;
    await tick(EN_PUBLICACION);
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(await huellaReal(), v.huella_tabla);
    assert.deepStrictEqual([estadoDe("50"), estadoDe("77")], ["libre", "libre"]);
    assert.strictEqual(fake.tablas.reservas_archivo.length, 7, "5 del anterior + 2 bloqueados, en el respaldo");
});

await prueba("4. Sorteo INSTANTÁNEO con bloqueados: la imagen de la vista previa los muestra ocupados y coincide con la tabla publicada", async () => {
    escenario({ bloqueados: ["10", "11", "12"] });
    usarInstantaneo();
    const s = await crear({ publicacion_inmediata: true });
    const v = await vista(s);
    assert.deepStrictEqual([...v.numeros.numerosOcupados].sort(), ["10", "11", "12"]);
    const p = await silencio(() => servicio.publicarAhora(A, s.id, {
        version: s.version, confirmacion: true, reinicio: { confirmado: true }, imagen: dataUrl(PNG1), huella: v.huella_tabla
    }));
    assert.ok(p.ok, JSON.stringify(p));
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(await huellaReal(), v.huella_tabla, "la imagen publicada es la tabla real");
    assert.deepStrictEqual(["10", "11", "12"].map(estadoDe), ["bloqueado", "bloqueado", "bloqueado"]);
    assert.strictEqual(aplicadas(), 1);
    assert.strictEqual(enviados.length, 1);
});

await prueba("5. REINTENTO: falla el envío tras reiniciar; la tabla cambia; la vista previa pinta la tabla REAL (no otro reinicio) y el reintento publica una vez", async () => {
    escenario({ bloqueados: ["50"] });
    const s = await crear();
    const v = await vista(s);
    assert.ok((await confirmarConCaptura(s, v)).ok);
    fallaEnvio = () => "Connection Closed (simulado)";
    reloj = EN_PUBLICACION;
    await tick(EN_PUBLICACION);
    assert.notStrictEqual(grupoDe(s.id).estado, "publicado");
    assert.strictEqual(aplicadas(), 1, "el reinicio ya se hizo");
    assert.strictEqual(enviados.length, 0);

    // Entretanto se reserva un número en la tabla ya reiniciada.
    Object.assign(fake.tablas[T5K].find(f => f.numero === "33"), { estado: "reservado" });
    fallaEnvio = () => null;
    reloj = DESPUES;
    const v2 = await vista(s);
    assert.deepStrictEqual([...v2.numeros.numerosOcupados].sort(), ["33", "50"], "tabla real: no se proyecta un segundo reinicio");
    assert.strictEqual(await huellaReal(), v2.huella_tabla);
    const re = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us", { imagen: dataUrl(PNG2), huella: v2.huella_tabla }));
    assert.ok(re.ok, JSON.stringify(re));
    await tick(new Date(DESPUES.getTime() + 60000));
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(enviados.length, 1, "un solo anuncio");
    assert.ok(Buffer.from(enviados[0].image).equals(PNG2), "con la captura nueva");
    assert.strictEqual(aplicadas(), 1, "nunca se reinicia dos veces");
    assert.strictEqual(estadoDe("33"), "reservado", "la reserva nueva se respeta");
});

// Con «liberar bloqueados», un número bloqueado DESPUÉS del reinicio ya
// hecho seguiría pintándose libre si la vista previa proyectara otro
// reinicio (que no se repetirá: reiniciado_en). Debe verse ocupado.
await prueba("5b. REINTENTO con «liberar bloqueados» y un bloqueo nuevo tras el reinicio: la vista previa no proyecta un segundo reinicio", async () => {
    escenario();
    const s = await crear({ tabla: { reiniciar: true, liberar_bloqueados: true } });
    const v = await vista(s);
    assert.ok((await confirmarConCaptura(s, v)).ok);
    fallaEnvio = () => "Connection Closed (simulado)";
    reloj = EN_PUBLICACION;
    await tick(EN_PUBLICACION);
    assert.strictEqual(aplicadas(), 1);
    Object.assign(fake.tablas[T5K].find(f => f.numero === "44"), { estado: "bloqueado" });
    fallaEnvio = () => null;
    reloj = DESPUES;
    const v2 = await vista(s);
    assert.deepStrictEqual(v2.numeros.numerosOcupados, ["44"]);
    assert.strictEqual(await huellaReal(), v2.huella_tabla);
    const re = await silencio(() => servicio.reintentarGrupo(A, s.id, "g1@g.us", { imagen: dataUrl(PNG2), huella: v2.huella_tabla }));
    assert.ok(re.ok, JSON.stringify(re));
    await tick(new Date(DESPUES.getTime() + 60000));
    assert.strictEqual(grupoDe(s.id).estado, "publicado", grupoDe(s.id).ultimo_error);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(aplicadas(), 1);
    assert.strictEqual(estadoDe("44"), "bloqueado");
});

await prueba("6. Sin poder leer los bloqueados: bloqueo (no se arriesga una imagen que no corresponda) y no se toca nada", async () => {
    escenario({ bloqueados: ["50"] });
    const original = reinicioTabla.bloqueadosDeTabla;
    reinicioTabla.bloqueadosDeTabla = async () => ({ ok: false });
    try {
        const s = await crear();
        const v = await vista(s);
        assert.ok(v.bloqueos.some(b => b.includes("números bloqueados")), JSON.stringify(v.bloqueos));
        assert.strictEqual(v.puede_confirmar, false);
        assert.strictEqual(aplicadas(), 0);
        assert.strictEqual(anteriorActivo(), true);
    } finally { reinicioTabla.bloqueadosDeTabla = original; }
});

await prueba("7. CONSERVAR: la vista previa es la tabla real tal cual (pagados, reservados y bloqueados), sin proyección ni reinicio", async () => {
    escenario({ bloqueados: ["50"], anteriorActivo: false });
    const s = await crear({ tabla: { reiniciar: false, liberar_bloqueados: false } });
    const v = await vista(s);
    assert.strictEqual(v.huella_tabla, await huellaReal());
    assert.strictEqual(v.numeros.numerosOcupados.length, 6);
    assert.strictEqual(v.numeros.numerosPagados.length, 3);
    assert.strictEqual(rpc.llamadas.length, 0);
});

await prueba("8. numerosTrasReinicio: misma forma que obtenerNumeros tras la 030 (unidad)", async () => {
    const antes = { numerosDisponibles: ["03", "04"], numerosOcupados: ["00", "01", "02"], numerosPagados: ["00"] };
    assert.deepStrictEqual(reinicioTabla.numerosTrasReinicio(antes, ["02"]),
        { numerosDisponibles: ["00", "01", "03", "04"], numerosOcupados: ["02"], numerosPagados: [] });
    assert.deepStrictEqual(reinicioTabla.numerosTrasReinicio(antes, []).numerosOcupados, []);
});

const fallidas = resultados.filter(x => !x).length;
console.log(`\n============================\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas}  ❌ FALLA: ${fallidas}\n============================`);
fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
process.exit(fallidas ? 1 : 0);

})();
