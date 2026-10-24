// ==========================================================================
// PRUEBAS — «Compartir sorteo manual»: el administrador pega el texto del
// sorteo, EFAAT detecta el evento (mismo detector del bot), elige la tabla
// por el precio y comparte con el envío de siempre de «Compartir».
//
//   - análisis (POST /tablas/compartir-manual/analizar): lotería, hora,
//     fecha, premios y valor; tabla por precio; texto incompleto, sin
//     reconocer, precio sin tabla o tabla elegida a mano -> confirmación;
//     sorteo activo distinto del texto -> confirmación; sin sorteo activo
//     -> bloqueado. Analizar nunca envía ni escribe;
//   - envío: POST /tablas/compartir con solicitudId (compartirEnGrupos):
//     el texto pegado es el pie de la captura, a los grupos elegidos, sin
//     guardar la selección; evento_id distinto -> 409; dobles clics y
//     reintentos no duplican;
//   - nunca se crea un sorteo programado ni un evento, ni se tocan números,
//     reservas o pagos; el «Compartir» de siempre (sin evento_id) no cambia.
//
// Ruta HTTP REAL (routes/tablas.js + exigirUsuario), servicios reales;
// Supabase en memoria y WhatsApp SIMULADOS: ningún envío real.
//
//     node backend/tests/tablas/compartirManual.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

process.env.SESSIONS_API_TOKEN = "token-servicio-manual";

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const T10K = "10k_reservas_2_cifras";
const EV_A = "e0000000-0000-4000-8000-0000000000a1";
const EV_A2 = "e0000000-0000-4000-8000-0000000000a2";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";

let fake = crearFake();
inyectar("lib/supabase.js", { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } });

// Dos tablas configuradas: $5.000 y $10.000 (sin tablas_cliente: la base).
const CONFIG = { 5000: { tabla: T5K, cifras: 2, cantidad: 100 }, 10000: { tabla: T10K, cifras: 2, cantidad: 100 } };
inyectar("bot/funciones/eventos/configEvento.js", {
    obtenerConfiguracion: (v) => CONFIG[Number(String(v ?? "").replace(/[^\d]/g, ""))] || null,
    configuracionesBase: () => Object.entries(CONFIG).map(([precio, c]) => ({ precio: Number(precio), ...c }))
});

const envios = [];
const sim = { retardoMs: 0 };
inyectar("services/baileys/send.js", {
    sendImage: async ({ sock, jid, image, caption }) => {
        if (sim.retardoMs) await new Promise(r => setTimeout(r, sim.retardoMs));
        envios.push({ usuario: sock.usuario, jid, image: image.toString("base64"), caption });
    },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => sockets.get(u) || null });

// Puppeteer no debe usarse: la imagen es la captura del panel.
let lanzamientos = 0;
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = { id: PUPPETEER, filename: PUPPETEER, loaded: true, exports: { launch: async () => { lanzamientos++; throw new Error("sin Puppeteer en esta prueba"); } } };

const { fechaSorteoAnunciado } = require("../../bot/funciones/eventos/identidadEventoReal");
const compartirManual = require("../../services/compartirManual");

const app = express();
app.use("/tablas/compartir", express.json({ limit: "6mb" }));
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

// La fecha que el bot daría hoy a un sorteo de las 10:30 PM.
const FECHA = fechaSorteoAnunciado("22:30", "22:26");

const ANUNCIO = "🎰 Chontico Noche - 10:30 PM\n💰 Valor número: $5.000\n🥇 Dos últimas cifras $100.000";

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    envios.length = 0;
    sim.retardoMs = 0;
    sockets.clear();
    sockets.set(A, { usuario: A });
    sockets.set(B, { usuario: B });
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }, { jid: "g2@g.us", nombre: "Rifa dos" }, { jid: "gb@g.us", nombre: "Grupo de B" }];
    const ev = (id, u, grupo, nombre, identidad, creado) => ({
        id, usuario_id: u, grupo_id: grupo, activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
        nombre_evento: nombre, hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: FECHA, valor: 5000,
        premios: [], tabla: T5K, cifras: 2, cantidad_numeros: 100, creado_en: creado
    });
    t.eventos_bot = [
        ev(EV_A, A, "g1@g.us", "Chontico Noche", "ident-a", "2026-10-22T12:00:00Z"),
        // El mismo sorteo real también activo en g2 (otra fila, misma identidad).
        ev(EV_A2, A, "g2@g.us", "Chontico Noche", "ident-a", "2026-10-22T11:00:00Z"),
        ev(EV_B, B, "gb@g.us", "Secreto de B", "ident-b", "2026-10-22T12:00:00Z")
    ];
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < 3 ? "pagado" : i < 5 ? "reservado" : "libre", usuario_id: u })));
    t[T10K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-manual", authorization: `Bearer ${jwt}` });
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const llamar = async (metodo, camino, cuerpo, jwt = "jwt-A") => {
    const res = await fetch(base + camino, { method: metodo, headers: h(jwt), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: res.status, json: await res.json() };
};
const analizar = (cuerpo, jwt) => llamar("POST", "/tablas/compartir-manual/analizar", cuerpo, jwt);
let n = 0;
const sol = () => `00000000-0000-4000-9100-${String(++n).padStart(12, "0")}`;
const compartir = (cuerpo, jwt) => llamar("POST", "/tablas/compartir", { imagen: PNG_DATA_URL, ...cuerpo }, jwt);

// Lo que ni analizar ni compartir pueden tocar.
const intocable = () => JSON.stringify({
    [T5K]: fake.tablas[T5K], [T10K]: fake.tablas[T10K], eventos_bot: fake.tablas.eventos_bot,
    sorteos_programados: fake.tablas.sorteos_programados || [], sorteo_grupos: fake.tablas.sorteo_grupos || [],
    destinos_compartir_tabla: fake.tablas.destinos_compartir_tabla || [], grupos_autorizados: fake.tablas.grupos_autorizados
});

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. Texto completo: detecta lotería, hora, fecha, premios y valor; tabla $5.000 y su sorteo activo coinciden", async () => {
    escenario();
    const antes = intocable();
    const r = await analizar({ texto: ANUNCIO });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const d = r.json.data;
    assert.deepStrictEqual(
        [d.detectado.reconocido, d.detectado.nombre, d.detectado.hora_texto, d.detectado.fecha, d.detectado.valor, d.detectado.faltantes],
        [true, "Chontico Noche", "10:30 PM", FECHA, 5000, []]
    );
    assert.deepStrictEqual(d.detectado.premios.map(p => [p.tipo, p.premio]), [["dos_ultimas_cifras", 100000]]);
    assert.deepStrictEqual(d.tabla, { precio: 5000, estado: "detectado" });
    assert.deepStrictEqual(d.precios, [5000, 10000]);
    assert.strictEqual(d.sorteo.id, EV_A, "el sorteo activo de la tabla (el más reciente)");
    assert.deepStrictEqual(d.coincidencia, { estado: "coincide", diferencias: [] });
    assert.deepStrictEqual(d.confirmaciones, []);
    assert.strictEqual(d.bloqueo, null);
    assert.deepStrictEqual(d.grupos_con_sorteo.sort(), ["g1@g.us", "g2@g.us"]);
    assert.strictEqual(intocable(), antes, "analizar no escribe nada");
    assert.strictEqual(envios.length, 0, "analizar no envía");
});

prueba("2. Precio de otra tabla configurada sin sorteo activo: bloqueado (sin_evento_activo), sin crear evento", async () => {
    escenario();
    const antes = intocable();
    const d = (await analizar({ texto: ANUNCIO.replace("$5.000", "$10.000") })).json.data;
    assert.deepStrictEqual(d.tabla, { precio: 10000, estado: "detectado" });
    assert.strictEqual(d.sorteo, null);
    assert.strictEqual(d.bloqueo, "sin_evento_activo");
    assert.strictEqual(intocable(), antes);
});

prueba("3. Precio que no tiene tabla: no se elige ninguna en silencio (sin_tabla) y se ofrecen las disponibles", async () => {
    escenario();
    const d = (await analizar({ texto: ANUNCIO.replace("$5.000", "$7.000") })).json.data;
    assert.strictEqual(d.detectado.valor, 7000);
    assert.deepStrictEqual(d.tabla, { precio: null, estado: "sin_tabla" });
    assert.strictEqual(d.bloqueo, "sin_tabla");
    assert.deepStrictEqual(d.precios, [5000, 10000]);
    // Elegirla a mano exige confirmar que no es la del texto.
    const e = (await analizar({ texto: ANUNCIO.replace("$5.000", "$7.000"), precio: 5000 })).json.data;
    assert.deepStrictEqual(e.tabla, { precio: 5000, estado: "distinto_del_texto" });
    assert.ok(e.confirmaciones.includes("tabla_distinto_del_texto"), e.confirmaciones);
    assert.ok(e.confirmaciones.includes("sorteo_distinto"), "el valor del texto no es el del sorteo");
});

prueba("4. Texto incompleto (sin hora, sin valor): faltantes; la tabla se elige a mano y se confirma", async () => {
    escenario();
    const d = (await analizar({ texto: "Chontico Noche\nPara hoy\nDos últimas cifras $100.000" })).json.data;
    assert.ok(d.detectado.reconocido, JSON.stringify(d.detectado));
    assert.deepStrictEqual(d.detectado.faltantes.sort(), ["hora", "valor"]);
    assert.deepStrictEqual(d.tabla, { precio: null, estado: "sin_valor" });
    const e = (await analizar({ texto: "Chontico Noche\nPara hoy\nDos últimas cifras $100.000", precio: 5000 })).json.data;
    assert.deepStrictEqual(e.tabla, { precio: 5000, estado: "elegido" });
    assert.strictEqual(e.coincidencia.estado, "coincide", "lo que sí trae (la lotería) coincide");
    assert.deepStrictEqual(e.confirmaciones.sort(), ["tabla_elegido", "texto_incompleto"]);
});

prueba("5. Texto que no es un anuncio: no reconocido, sin tabla; elegida a mano exige confirmación", async () => {
    escenario();
    const d = (await analizar({ texto: "Buenas noches familia, ya casi empezamos" })).json.data;
    assert.strictEqual(d.detectado.reconocido, false);
    assert.strictEqual(d.tabla.estado, "sin_valor");
    const e = (await analizar({ texto: "Buenas noches familia, ya casi empezamos", precio: 5000 })).json.data;
    assert.strictEqual(e.coincidencia.estado, "sin_datos");
    assert.deepStrictEqual(e.confirmaciones.sort(), ["tabla_elegido", "texto_no_reconocido"]);
});

prueba("6. Sorteo activo distinto del texto (otra lotería y hora): diferencias y confirmación obligatoria", async () => {
    escenario();
    const d = (await analizar({ texto: "*LOTERÍA DE BOGOTÁ* 🍀\n⌛ HORA ESTIMADA: 9:00 PM\n💵 Valor del número $5.000\n🥇 Dos últimas cifras $300.000" })).json.data;
    assert.strictEqual(d.tabla.precio, 5000);
    assert.strictEqual(d.coincidencia.estado, "distinto");
    const campos = Object.fromEntries(d.coincidencia.diferencias.map(x => [x.campo, [x.texto, x.sorteo]]));
    assert.deepStrictEqual(campos.loteria, ["Lotería de Bogotá", "Chontico Noche"]);
    assert.deepStrictEqual(campos.hora, ["9:00 PM", "10:30 PM"]);
    assert.ok(d.confirmaciones.includes("sorteo_distinto"));
});

prueba("7. Validación: texto vacío, demasiado largo, precio inválido o elegido que no existe", async () => {
    escenario();
    assert.strictEqual((await analizar({ texto: "   " })).json.motivo, "texto_vacio");
    assert.strictEqual((await analizar({ texto: "x".repeat(4001) })).json.motivo, "texto_largo");
    assert.strictEqual((await analizar({ texto: ANUNCIO, precio: "abc" })).status, 400);
    const d = (await analizar({ texto: ANUNCIO, precio: 2000 })).json.data;
    assert.deepStrictEqual([d.tabla.estado, d.bloqueo], ["elegido_invalido", "elegido_invalido"]);
    assert.strictEqual((await llamar("POST", "/tablas/compartir-manual/analizar", { texto: ANUNCIO }, "jwt-desconocido")).status, 401);
});

prueba("8. Aislamiento: B solo ve su propio sorteo y sus grupos", async () => {
    escenario();
    const d = (await analizar({ texto: ANUNCIO }, "jwt-B")).json.data;
    assert.strictEqual(d.sorteo.id, EV_B);
    assert.strictEqual(d.coincidencia.estado, "distinto", "«Chontico Noche» no es el sorteo de B");
    assert.deepStrictEqual(d.grupos_con_sorteo, ["gb@g.us"]);
});

prueba("9. Compartir ahora: envío de siempre — captura como foto, texto pegado como pie, a los grupos elegidos", async () => {
    escenario();
    const antes = intocable();
    const texto = ANUNCIO + "\n¡Aparta el tuyo!";
    const r = await compartir({ precio: 5000, solicitudId: sol(), grupos: ["g1@g.us", "g2@g.us"], texto, evento_id: EV_A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.enviados, r.json.fallidos], [2, 0]);
    assert.deepStrictEqual(envios.map(e => [e.usuario, e.jid, e.caption]), [[A, "g1@g.us", texto], [A, "g2@g.us", texto]]);
    assert.ok(envios.every(e => e.image === PNG_DATA_URL.split(",")[1]), "la misma captura del panel, sin regenerar");
    assert.strictEqual(lanzamientos, 0, "sin Puppeteer");
    assert.strictEqual(intocable(), antes, "ni eventos, ni sorteos programados, ni números, ni destinos guardados");
    const acciones = (fake.tablas.automation_actions || []).filter(a => a.tipo_accion === "TABLA_COMPARTIR");
    assert.strictEqual(acciones.length, 2, "el registro de envíos es el de «Compartir» (ExecutionGuard)");
});

prueba("10. El sorteo cambió entre la revisión y el envío (evento_id distinto): 409 sorteo_cambio, nada enviado", async () => {
    escenario();
    const r = await compartir({ precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], texto: ANUNCIO, evento_id: "e0000000-0000-4000-8000-0000000000ff" });
    assert.deepStrictEqual([r.status, r.json.motivo], [409, "sorteo_cambio"]);
    fake.tablas.eventos_bot.forEach(e => { if (e.usuario_id === A) e.activo = false; });
    const s = await compartir({ precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], texto: ANUNCIO, evento_id: EV_A });
    assert.deepStrictEqual([s.status, s.json.motivo], [404, "sin_evento_activo"]);
    assert.strictEqual(envios.length, 0);
});

prueba("11. Duplicados: reintentar la misma solicitud no reenvía; dos clics a la vez -> uno solo", async () => {
    escenario();
    const id = sol();
    const cuerpo = { precio: 5000, solicitudId: id, grupos: ["g1@g.us"], texto: ANUNCIO, evento_id: EV_A };
    await compartir(cuerpo);
    const otra = await compartir(cuerpo);
    assert.strictEqual(otra.json.resultados[0].estado, "ya_enviado");
    assert.strictEqual(envios.length, 1);
    sim.retardoMs = 150;
    const [x, y] = await Promise.all([compartir({ ...cuerpo, solicitudId: sol() }), compartir({ ...cuerpo, solicitudId: sol() })]);
    assert.deepStrictEqual([x.status, y.status].sort(), [200, 409]);
    assert.strictEqual([x, y].find(v => v.status === 409).json.motivo, "envio_en_curso");
    assert.strictEqual(envios.length, 2);
});

prueba("12. Grupos ajenos o sin sesión de WhatsApp: no se envía", async () => {
    escenario();
    const r = await compartir({ precio: 5000, solicitudId: sol(), grupos: ["gb@g.us"], texto: ANUNCIO, evento_id: EV_A });
    assert.deepStrictEqual([r.status, r.json.motivo], [409, "destinos_no_disponibles"]);
    sockets.delete(A);
    const s = await compartir({ precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], texto: ANUNCIO, evento_id: EV_A });
    assert.deepStrictEqual([s.status, s.json.motivo], [409, "sin_sesion_activa"]);
    assert.strictEqual(envios.length, 0);
});

prueba("13. «Compartir» de siempre (sin evento_id ni texto) no cambia: texto del sorteo y grupos guardados", async () => {
    escenario();
    fake.tablas.destinos_compartir_tabla = [{ usuario_id: A, precio: 5000, grupos: ["g2@g.us"] }];
    const r = await compartir({ precio: 5000, solicitudId: sol() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(envios.map(e => e.jid), ["g2@g.us"]);
    assert.ok(envios[0].caption.includes("Chontico Noche"), envios[0].caption);
});

prueba("14. Funciones puras: elegirTabla y compararConSorteo", async () => {
    const det = compartirManual.detectar(ANUNCIO);
    assert.deepStrictEqual(compartirManual.elegirTabla(det, [5000]), { precio: 5000, estado: "detectado" });
    assert.deepStrictEqual(compartirManual.elegirTabla(det, [5000], 5000), { precio: 5000, estado: "detectado" });
    assert.deepStrictEqual(compartirManual.elegirTabla({ ...det, valor: null }, [5000]), { precio: null, estado: "sin_valor" });
    const sorteo = { nombre_evento: "CHONTICO NOCHE", hora_fin: "22:30", valor: "$5.000", fecha_evento: null };
    assert.strictEqual(compartirManual.compararConSorteo(det, sorteo).estado, "coincide", "mayúsculas, formato del valor y sin fecha");
    assert.strictEqual(compartirManual.compararConSorteo({ ...det, fecha: "2099-01-01" }, { ...sorteo, fecha_evento: FECHA }).estado, "distinto");
});

(async () => {

    const servidor = http.createServer(app);
    await new Promise(ok => servidor.listen(0, ok));
    base = `http://127.0.0.1:${servidor.address().port}`;

    let pasa = 0;
    let falla = 0;

    for (const p of pruebas) {
        try {
            await p.fn();
            pasa++;
            console.log(`✅ ${p.nombre}`);
        } catch (err) {
            falla++;
            console.log(`❌ ${p.nombre}\n   ${err.message}`);
        }
    }

    servidor.close();

    console.log("\n============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${pasa}  ❌ FALLA: ${falla}`);
    console.log("============================");

    process.exit(falla ? 1 : 0);

})();
