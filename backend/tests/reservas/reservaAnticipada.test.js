// ==========================================================================
// PRUEBAS — reservas manuales ANTICIPADAS (antes de publicar un sorteo
// programado) y la protección de todos los caminos de reinicio.
//
// La reserva se guarda en la tabla del sorteo con SU identidad y sin
// evento_id (no existe su fila en eventos_bot y nunca se crea una ficticia).
// Al publicar, el evento nace con esa identidad: disponibilidad, pagos,
// contadores y cierre la reconocen. Ningún reinicio (030 desde el backend ni
// el botón de Tablas en el navegador) puede liberarla.
//
// Rutas HTTP REALES (routes/tablas.js, routes/sorteos.js), servicios REALES
// (reservaManual, servicio, publicador, reinicioTabla, reservarNumeros,
// marcarReservasPagadasPorAdmin, consultarDisponibilidad, sorteoReal) y el
// reinicio del panel REAL (frontend/services/tablas/reiniciarTabla.ts,
// transpilado). Supabase y la 030 son dobles en memoria.
//
//     node backend/tests/reservas/reservaAnticipada.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const FRONT = path.resolve(RAIZ, "../frontend");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { require.cache[r(rel)] = { id: r(rel), filename: r(rel), loaded: true, exports: exp }; };

const fake = crearFake();
const rpc = { llamadas: [] };

// Simulación de reiniciar_tabla_cliente (030): misma clasificación que la SQL.
function reinicio030(args) {
    const filas = (fake.tablas[args.p_tabla] || []).filter(f => f.usuario_id === args.p_usuario);
    const eventos = (fake.tablas.eventos_bot || []).filter(e => e.usuario_id === args.p_usuario && (e.tabla === args.p_tabla || e.tabla == null));
    const activas = new Set(eventos.filter(e => e.activo !== false && e.identidad_evento_real).map(e => e.identidad_evento_real));
    const clase = (f) => {
        if (f.estado === "libre") return "libre";
        if (["reservado", "pagado"].includes(f.estado)) return f.identidad_evento_real && activas.has(f.identidad_evento_real) ? "protegido_activo" : f.identidad_evento_real ? "liberable" : "protegido_sin_sorteo";
        return f.estado === "en_proceso" ? "protegido_en_proceso" : "conservado";
    };
    const huella = filas.filter(f => f.estado !== "libre").map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`).sort().join(",");
    const ocupadas = filas.filter(f => clase(f) !== "libre");
    const resumen = { liberables: ocupadas.filter(f => clase(f) === "liberable").length, protegidos: ocupadas.filter(f => clase(f).startsWith("protegido")).length, conservados: 0, por_sorteo: [] };
    if (resumen.protegidos > 0) return { data: { ok: false, motivo: "protegido", huella, ...resumen }, error: null };
    if (!args.p_aplicar) return { data: { ok: true, huella, ...resumen }, error: null };
    if (args.p_huella !== huella) return { data: { ok: false, motivo: "tabla_cambio", huella, ...resumen }, error: null };
    for (const f of ocupadas.filter(x => clase(x) === "liberable")) Object.assign(f, { estado: "libre", identidad_evento_real: null, evento_id: null });
    return { data: { ok: true, aplicado: true, huella, ...resumen }, error: null };
}

const cliente = {
    from: (t) => fake.client.from(t),
    auth: fake.client.auth,
    rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args }); return { ...reinicio030(args) }; }
};
inyectar("lib/supabase.js", cliente);
let envios = 0;
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { envios++; } }));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000
const T1K = "reservas_dos_cifras";        // $2.000 (los 90 históricos)
const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";
const EV_ACTIVO = "e0000000-0000-4000-8000-0000000000a9";

fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };
fake.tokens["jwt-B"] = { id: B, email: "dueno@b.co" };

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const reinicioTabla = require(r("sorteos/reinicioTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento, consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { depsCompartir } = require("../sorteos/compartirSimulado");
const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const { marcarReservasPagadasPorAdmin } = require(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"));
const { consultarDisponibilidad } = require(r("bot/funciones/consultas/consultarDisponibilidad.js"));
const { consultarMisNumerosPorEstado } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));
const { estadoDelSorteo } = require(r("bot/funciones/eventos/sorteoReal.js"));

// Reinicio del panel (navegador), transpilado con el TypeScript del frontend.
// Su módulo puro (impactoReinicio.ts) se carga real; lo demás, simulado.
function transpilar(archivo, requerir) {
    const ts = require(path.join(FRONT, "node_modules/typescript"));
    const fuente = fs.readFileSync(path.join(FRONT, archivo), "utf8");
    const { outputText } = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const modulo = { exports: {} };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}
function cargarReinicioPanel() {
    const impacto = transpilar("services/tablas/impactoReinicio.ts", (spec) => { throw new Error("módulo no previsto: " + spec); });
    const requerir = (spec) => ({
        "@/lib/supabase": { supabase: fake.client },
        "./tablasCliente": {
            obtenerTablaConfigCliente: async () => ({ tabla: T5K, cifras: 2, cantidad: 100 }),
            obtenerTablasCliente: async () => [{ precio: 3000, tabla: T5K }, { precio: 5000, tabla: T5K }]
        },
        "./registrarActividad": { registrarActividad: async () => {} },
        "./prepararCuadricula": { prepararCuadricula: async () => ({}), diagnosticar: () => ({ tipo: "lista" }) },
        "./impactoReinicio": impacto
    })[spec] || (() => { throw new Error("módulo no previsto: " + spec); })();
    return transpilar("services/tablas/reiniciarTabla.ts", requerir);
}
const { reiniciarTabla: reiniciarTablaPanel, revisarReinicio: revisarReinicioPanel } = cargarReinicioPanel();
// La confirmación que da el diálogo tras revisar (texto, anticipadas, huella).
async function confirmacionPanel(aceptaAnticipadas = true) {
    const r = await revisarReinicioPanel(3000, A);
    return { texto: "REINICIAR", aceptaAnticipadas, huella: r.impacto.huella };
}

// Sorteo programado del 20/12 (siempre en el futuro respecto al reloj real
// que usa la reserva manual); se publica a las 08:00 de Colombia.
const PUBLICAR = new Date("2026-12-20T13:00:00Z");
const EN_PUBLICACION = new Date("2026-12-20T13:01:00Z");
const mas = (min) => new Date(EN_PUBLICACION.getTime() + min * 60000);

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.despuesDeLeer = null;
    rpc.llamadas = [];
    envios = 0;

    const t = fake.tablas;
    for (const tabla of [T5K, T1K]) {
        t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    }
    // Los 90 históricos (incidente): 65 pagados + 25 reservados, sin evento.
    t[T1K].filter(f => f.usuario_id === A).slice(0, 90).forEach((f, i) => Object.assign(f, {
        estado: i < 65 ? "pagado" : "reservado", identidad_evento_real: "bogota-historico", evento_id: "ev-bogota", usuario_global_id: C2, comprador: "Histórico"
    }));

    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: A, grupo_id: "g3@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "g2@g.us", nombre: "Grupo 2" }, { jid: "g3@g.us", nombre: "Grupo 3" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", titular: "B", activa: true }
    ];
    t.eventos_bot = [];
    t.usuarios = [
        { id: C1, nombre: "María Pérez", telefono: "3001112233", lid: null },
        { id: C2, nombre: "Juan Gómez", telefono: "3104445566", lid: null }
    ];
    t.contactos_tenant = [
        { usuario_id: A, usuario_global_id: C1, ultimo_visto_en: "2026-10-22T09:00:00Z" },
        { usuario_id: A, usuario_global_id: C2, ultimo_visto_en: "2026-10-20T09:00:00Z" },
        { usuario_id: B, usuario_global_id: C1, ultimo_visto_en: "2026-10-21T09:00:00Z" }
    ];
    t.reservas_actividad = [];
    t.reservas_auditoria = [];

    require(r("services/reservaManual.js")).olvidarDirectorio();
    require(r("bot/funciones/grupos/politicaGrupos.js")).olvidarAutorizacion();

}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us", "g2@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-12-20",
        mensajes: { publicacion: "{{nombre}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

async function programar(datos = entrada(), { usuario = A, reinicio } = {}) {
    const c = await servicio.crearSorteo(usuario, datos);
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(usuario, c.data.id, { version: c.data.version, confirmacion: true, ...(reinicio ? { reinicio } : {}) });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const deps = () => {
    const d = {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        sendMessage: async () => { envios++; }
    };
    // El anuncio sale por «Compartir» (imagen + pie) hacia el mismo contador.
    return Object.assign(d, depsCompartir(() => d.sendMessage));
};

const sock = (u = A) => ({
    context: { usuarioId: u, sessionId: `ses-${u.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
    groupSettingUpdate: async () => {}
});

async function silencio(fn) {
    const guardados = ["log", "table", "dir", "warn", "error"].map(k => [k, console[k]]);
    for (const [k] of guardados) console[k] = () => {};
    try { return await fn(); } finally { for (const [k, f] of guardados) console[k] = f; }
}

const tick = (ahora) => silencio(() => publicador.tick(sock(A), { ahora, deps: deps() }));

const app = express();
app.use(express.json());
app.use("/tablas", require(r("routes/tablas.js")));
app.use("/sorteos", require(r("routes/sorteos.js")));
let base;

function pedir(metodo, camino, { token = "jwt-A", cuerpo } = {}) {
    return new Promise((resolve, reject) => {
        const datos = cuerpo !== undefined ? JSON.stringify(cuerpo) : null;
        const headers = { "x-service-token": process.env.SESSIONS_API_TOKEN, Authorization: `Bearer ${token}` };
        if (datos) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(datos); }
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        if (datos) req.write(datos);
        req.end();
    });
}

const reservar = (numero, cuerpo, token) => silencio(() => pedir("POST", `/tablas/3000/numeros/${numero}/reservar`, {
    token, cuerpo: { contactoId: C1, motivo: "Reserva antes de publicar el sorteo", solicitudId: `s-${numero}-${Math.random()}`, ...cuerpo }
}));

const fila = (numero, tabla = T5K, u = A) => fake.tablas[tabla].find(f => f.usuario_id === u && f.numero === numero);
const historicos = () => JSON.stringify(fake.tablas[T1K]);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- pruebas ---

prueba("1. sin sorteo activo, el contexto ofrece el sorteo programado y sus grupos autorizados", async () => {
    sembrar();
    const s = await programar();
    const c = await pedir("GET", "/tablas/3000/numeros/10");
    assert.strictEqual(c.status, 200);
    assert.strictEqual(c.json.sorteo, null, "no hay sorteo activo");
    assert.strictEqual(c.json.programados.length, 1);
    const p = c.json.programados[0];
    assert.strictEqual(p.sorteoId, s.id);
    assert.strictEqual(p.aceptaReservas, true);
    assert.deepStrictEqual(p.grupos.map(g => [g.grupoId, g.autorizado]), [["g1@g.us", true], ["g2@g.us", true]]);
});

prueba("2. reserva anticipada: tabla e identidad del sorteo, sin evento_id, sin evento ficticio", async () => {
    sembrar();
    const antes = historicos();
    const s = await programar();
    const res = await reservar("10", { sorteoProgramadoId: s.id, grupoId: "g2@g.us" });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.strictEqual(res.json.anticipada, true);

    const f = fila("10");
    assert.strictEqual(s.tabla, T5K);
    assert.strictEqual(f.estado, "reservado");
    assert.strictEqual(f.identidad_evento_real, s.identidad_evento_real);
    assert.strictEqual(f.evento_id, null);
    assert.strictEqual(f.grupo_id, "g2@g.us");
    assert.strictEqual(f.usuario_global_id, C1);
    assert.strictEqual(fake.tablas.eventos_bot.length, 0, "no se crea ninguna fila en eventos_bot");
    assert.strictEqual(historicos(), antes, "la tabla de $2.000 (con los 90 históricos) no cambia");
    assert.ok(fake.tablas.reservas_auditoria.some(a => a.accion === "reservar" && a.resultado === "ok" && a.identidad_evento_real === s.identidad_evento_real));

    // El detalle del número lo muestra como reserva anticipada de su sorteo.
    const det = await pedir("GET", "/tablas/3000/numeros/10");
    assert.strictEqual(det.json.fila.sorteoAnticipado, "Antioqueñita Día");
});

prueba("3. rechazos: borrador, versión sin confirmar, cierre pasado, otro precio, reinicio pendiente, grupo ajeno, ambos destinos, sorteo de otro cliente", async () => {
    sembrar();
    const s = await programar();
    const motivo = async (numero, cuerpo, token) => (await reservar(numero, cuerpo, token)).json.motivo;

    assert.strictEqual(await motivo("11", { sorteoProgramadoId: s.id, grupoId: "g3@g.us" }), "grupo_no_del_sorteo");
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: s.id }), "falta_grupo");
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: s.id, grupoId: "g1@g.us", eventoId: EV_ACTIVO }), "destino_ambiguo");
    assert.strictEqual((await silencio(() => pedir("POST", `/tablas/2000/numeros/95/reservar`, { cuerpo: { contactoId: C1, motivo: "Prueba", sorteoProgramadoId: s.id, grupoId: "g1@g.us" } }))).json.motivo, "sorteo_no_disponible", "otro precio/tabla");

    const borrador = await servicio.crearSorteo(A, entrada({ nombre: "Borrador" }));
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: borrador.data.id, grupoId: "g1@g.us" }), "sorteo_no_disponible");

    // En otro grupo y otro día: dos sorteos del mismo grupo no pueden solaparse.
    const otroDia = (dia, extra) => entrada({ grupos: ["g3@g.us"], publicar_en: `2026-12-${dia}T13:00:00Z`, fecha_sorteo: `2026-12-${dia}`, ...extra });
    const conReinicio = await programar(otroDia(21, { nombre: "Con reinicio", tabla: { reiniciar: true } }), { reinicio: { confirmado: true } });
    const r1 = await reservar("11", { sorteoProgramadoId: conReinicio.id, grupoId: "g3@g.us" });
    assert.strictEqual(r1.json.motivo, "sorteo_no_disponible");
    assert.ok(/reiniciará la tabla/.test(r1.json.mensaje), r1.json.mensaje);

    const sinConfirmar = fake.tablas.sorteos_programados.find(x => x.id === s.id);
    sinConfirmar.confirmado_version = sinConfirmar.version - 1;
    assert.ok(/no está confirmada/.test((await reservar("11", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" })).json.mensaje));
    sinConfirmar.confirmado_version = sinConfirmar.version;

    const cerrado = await programar(otroDia(22, { nombre: "Ya cerró" }));
    Object.assign(fake.tablas.sorteos_programados.find(x => x.id === cerrado.id).config, { fecha_sorteo: "2026-01-01" });
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: cerrado.id, grupoId: "g3@g.us" }), "sorteo_no_disponible");

    const deB = await programar(entrada({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"] }), { usuario: B });
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: deB.id, grupoId: "gb@g.us" }), "sorteo_no_disponible", "A no reserva en el sorteo de B");
    assert.strictEqual(await motivo("11", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" }, "jwt-B"), "sorteo_no_disponible", "B no reserva en el de A");

    assert.strictEqual(fila("11").estado, "libre");
    assert.strictEqual(fila("11", T5K, B).estado, "libre");
});

prueba("4. el número anticipado no queda disponible para nadie más (panel, bot ni otro sorteo activo)", async () => {
    sembrar();
    const s = await programar();
    // Sorteo activo detectado de $3.000 en otro grupo, misma tabla física.
    fake.tablas.eventos_bot.push({ id: EV_ACTIVO, usuario_id: A, grupo_id: "g3@g.us", grupo_nombre: "Grupo 3", tabla: T5K, activo: true, estado: "abierto", valor: "3000", cifras: 2, cantidad_numeros: 100, identidad_evento_real: "otro-activo", nombre_evento: "Chontico", fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", creado_en: new Date() });

    assert.strictEqual((await reservar("20", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" })).status, 200);

    // El contexto ofrece las dos opciones: el activo y el programado.
    const c = await pedir("GET", "/tablas/3000/numeros/21");
    assert.ok(c.json.sorteo && c.json.programados.length === 1);

    assert.strictEqual((await reservar("20", { eventoId: EV_ACTIVO, contactoId: C2 })).json.motivo, "no_disponible", "panel, sorteo activo");
    assert.strictEqual((await reservar("20", { sorteoProgramadoId: s.id, grupoId: "g2@g.us", contactoId: C2 })).json.motivo, "no_disponible", "panel, mismo sorteo, otro contacto");
    const bot = await silencio(() => reservarNumeros({ evento: fake.tablas.eventos_bot[0], numeros: ["20"], usuario: { id: C2 }, comprador: "Juan", contacto: "3104445566" }));
    assert.strictEqual(bot.length, 0, "el bot tampoco la toma");
    const { numerosDisponibles } = await consultarDisponibilidad({ evento: fake.tablas.eventos_bot[0] });
    assert.ok(!numerosDisponibles.includes("20"), "nunca aparece libre");
    assert.strictEqual(fila("20").usuario_global_id, C1);
});

prueba("5. al publicar: sigue vinculada por identidad, contadores, disponibilidad y «mis números»; sin duplicados", async () => {
    sembrar();
    const antes = historicos();
    const s = await programar();
    await reservar("30", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    await reservar("31", { sorteoProgramadoId: s.id, grupoId: "g2@g.us", contactoId: C2 });
    await tick(EN_PUBLICACION);

    assert.strictEqual(fake.tablas.sorteos_programados.find(x => x.id === s.id).estado, "publicado");
    const evento = await consultarEvento("g1@g.us", A);
    assert.strictEqual(evento.identidad_evento_real, s.identidad_evento_real);
    assert.strictEqual(Number(evento.reservados), 2, "contadores con las anticipadas");
    assert.ok(fake.tablas.eventos_bot.every(e => Number(e.reservados) === 2 && Number(e.libres) === 98));

    const { numerosDisponibles, numerosOcupados } = await consultarDisponibilidad({ evento });
    assert.ok(!numerosDisponibles.includes("30") && numerosOcupados.includes("30") && numerosOcupados.includes("31"));
    assert.deepStrictEqual((await consultarMisNumerosPorEstado({ evento, usuario: { id: C1 } })).reservados, ["30"]);

    const delSorteo = fake.tablas[T5K].filter(f => f.identidad_evento_real === s.identidad_evento_real);
    assert.deepStrictEqual(delSorteo.map(f => f.numero).sort(), ["30", "31"], "ni duplicadas ni perdidas");
    assert.ok(delSorteo.every(f => f.evento_id === null), "D4: evento_id sin rellenar");
    assert.strictEqual(historicos(), antes);
});

prueba("6. pago posterior: pago manual del panel y confirmación del administrador; el cierre por pagos las cuenta", async () => {
    sembrar();
    const s = await programar();
    await reservar("40", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    await reservar("41", { sorteoProgramadoId: s.id, grupoId: "g1@g.us", contactoId: C2 });

    // Pago manual ANTES de publicar (por número, sin sorteo activo).
    const pago = await silencio(() => pedir("POST", "/tablas/3000/numeros/40/pagar", { cuerpo: { metodoPago: "Nequi", solicitudId: "p-40" } }));
    assert.strictEqual(pago.status, 200, JSON.stringify(pago.json));
    assert.strictEqual(fila("40").estado, "pagado");

    await tick(EN_PUBLICACION);
    const evento = await consultarEvento("g1@g.us", A);

    // Confirmación del administrador (sticker) DESPUÉS de publicar: la encuentra por identidad.
    await silencio(() => marcarReservasPagadasPorAdmin({ evento, usuario: { id: C2 }, realizadoPor: "admin" }));
    assert.strictEqual(fila("41").estado, "pagado");
    assert.strictEqual(fila("41").identidad_evento_real, s.identidad_evento_real);

    const estado = await estadoDelSorteo(evento);
    assert.strictEqual(estado.pagados, 2, "el cierre por pagos cuenta las dos");
    assert.strictEqual(fake.tablas[T1K].filter(f => f.estado === "reservado").length, 25, "los 25 históricos de Juan siguen reservados");
});

prueba("7a. reinicio 030 (backend): con anticipadas, ni la revisión ni la aplicación llegan a la 030", async () => {
    sembrar();
    const s = await programar();
    await reservar("50", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    const antes = JSON.stringify(fake.tablas[T5K]);

    const rev = await reinicioTabla.revisarReinicio(A, { id: "otro", tabla: T5K });
    assert.strictEqual(rev.ok, true);
    assert.strictEqual(rev.data.posible, false);
    assert.ok(rev.data.bloqueos.some(b => /reservados antes de publicar/.test(b) && /Antioqueñita/.test(b)), JSON.stringify(rev.data.bloqueos));
    const ap = await reinicioTabla.aplicarReinicio(A, { id: "otro", tabla: T5K }, "huella-cualquiera");
    assert.strictEqual(ap.ok, false);
    assert.strictEqual(rpc.llamadas.length, 0, "la 030 nunca se llamó");
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), antes);

    // Otro cliente (B) sí puede reiniciar su tabla: las anticipadas de A no le afectan.
    const revB = await reinicioTabla.revisarReinicio(B, { id: "de-b", tabla: T5K });
    assert.strictEqual(revB.data.posible, true);
});

prueba("7b. otro sorteo con «Reiniciar»: no se confirma con anticipadas; si ya estaba confirmado, al publicar no reinicia ni publica", async () => {
    sembrar();
    const s = await programar();
    // G se confirmó ANTES de la reserva anticipada.
    const PUB_G = new Date("2026-12-19T13:00:00Z");
    const g = await programar(entrada({ nombre: "Sorteo G", grupos: ["g3@g.us"], publicar_en: PUB_G.toISOString(), fecha_sorteo: "2026-12-19", tabla: { reiniciar: true } }), { reinicio: { confirmado: true } });
    await reservar("51", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    const antes = JSON.stringify(fake.tablas[T5K]);

    // Una edición nueva de G ya no se podría confirmar.
    const vp = await servicio.vistaPrevia(A, g.id);
    assert.ok(vp.data.bloqueos.some(b => /reservados antes de publicar/.test(b)), JSON.stringify(vp.data.bloqueos));

    await tick(new Date(PUB_G.getTime() + 60000));
    const grupoG = fake.tablas.sorteos_programados_grupos.find(x => x.sorteo_id === g.id);
    assert.strictEqual(grupoG.estado, "requiere_revision", grupoG.ultimo_error);
    assert.ok(/reservados antes de publicar/.test(grupoG.ultimo_error), grupoG.ultimo_error);
    assert.strictEqual(rpc.llamadas.filter(l => l.args.p_aplicar).length, 0);
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), antes, "la anticipada sigue intacta");
    assert.strictEqual(envios, 0, "G no publicó");
});

prueba("7c. reinicio del panel (Tablas): con anticipadas solo con confirmación expresa; con ella se reinicia y el sorteo programado sigue", async () => {
    sembrar();
    const s = await programar();
    await reservar("52", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    fila("53").estado = "reservado";   // reserva normal de otro sorteo ya terminado
    fila("53", T5K, B).estado = "reservado";   // el MISMO número en la cuadrícula de B
    const antes = JSON.stringify(fake.tablas[T5K]);
    const deB = JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === B));

    // El diálogo muestra el impacto: 1 anticipada de su sorteo programado.
    const r = await revisarReinicioPanel(3000, A);
    assert.strictEqual(r.impacto.totalAnticipadas, 1);
    assert.deepStrictEqual(r.impacto.anticipadas.map(a => [a.sorteoId, a.cantidad]), [[s.id, 1]]);
    assert.strictEqual(r.impacto.porEstado.reservado, 2);
    assert.deepStrictEqual(r.impacto.preciosCompartidos, [5000], "avisa de los otros precios que usan la tabla");

    // Sin confirmación, sin el texto o sin aceptar las anticipadas: nada cambia.
    await assert.rejects(() => reiniciarTablaPanel(3000, A), /Confirma el reinicio/);
    await assert.rejects(() => reiniciarTablaPanel(3000, A, { texto: "reinicio", aceptaAnticipadas: true, huella: r.impacto.huella }), /Falta la confirmación/);
    const sinAceptar = await confirmacionPanel(false);
    await assert.rejects(() => reiniciarTablaPanel(3000, A, sinAceptar), /1 reserva\(s\) anticipada\(s\): confirma expresamente/);
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), antes, "no se tocó ninguna fila");

    // Con la confirmación completa: se reinicia, anticipada incluida.
    const hecho = await reiniciarTablaPanel(3000, A, await confirmacionPanel(true));
    assert.deepStrictEqual([hecho.accion, hecho.filas, hecho.noTocadas, hecho.anticipadasEliminadas], ["reiniciada", 100, 0, 1]);
    assert.ok(fake.tablas[T5K].filter(f => f.usuario_id === A).every(f => f.estado === "libre"), "las 100 de A, libres");
    assert.strictEqual(JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === B)), deB, "las de B no se tocan (su 53 sigue reservado)");
    const sorteo = fake.tablas.sorteos_programados.find(x => x.id === s.id);
    assert.strictEqual(sorteo.estado, "programado", "el sorteo programado no se cancela ni se borra");
});

prueba("7d. reinicio del panel: lo que cambia después de revisar no se borra (huella y UPDATE condicionado al estado)", async () => {
    sembrar();
    const s = await programar();
    fila("54").estado = "reservado";

    // a) Entra una anticipada DESPUÉS de revisar y ANTES de confirmar: la huella cambia, nada se toca.
    const confirmacion = await confirmacionPanel(true);
    Object.assign(fila("55"), { estado: "reservado", identidad_evento_real: s.identidad_evento_real, usuario_global_id: C1 });
    const antes = JSON.stringify(fake.tablas[T5K]);
    await assert.rejects(() => reiniciarTablaPanel(3000, A, confirmacion), /La tabla cambió desde que revisaste/);
    assert.strictEqual(JSON.stringify(fake.tablas[T5K]), antes, "nada se modificó");

    // b) Entra DURANTE la escritura (antes del primer UPDATE): esa fila no coincide con su estado revisado y no se toca.
    const otra = await confirmacionPanel(true);
    let escrituras = 0;
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T5K || ++escrituras !== 1) return;
        Object.assign(fila("56"), { estado: "reservado", identidad_evento_real: s.identidad_evento_real, usuario_global_id: C1 });
    };
    const hecho = await reiniciarTablaPanel(3000, A, otra);
    fake.control.antesDeEscribir = null;
    assert.strictEqual(fila("54").estado, "libre", "el resto sí se reinicia");
    assert.strictEqual(fila("55").estado, "libre", "la anticipada revisada y aceptada se elimina");
    assert.strictEqual(fila("56").estado, "reservado", "la que entró durante la escritura no se toca");
    assert.strictEqual(fila("56").identidad_evento_real, s.identidad_evento_real);
    assert.strictEqual(hecho.noTocadas, 1, "y se informa");
    assert.strictEqual(fila("54", T5K, B).estado, "libre");
});

prueba("7f. un sorteo programado 'fallido' que SÍ llegó a publicarse (tiene evento) no tiene reservas anticipadas", async () => {
    sembrar();
    const anticipadas = require(r("sorteos/reservasAnticipadas.js"));
    const s = await programar();
    await reservar("57", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    assert.strictEqual((await anticipadas.anticipadasEnTabla(A, T5K)).total, 1, "sin evento: anticipada");

    // Caso de producción (Medellín, 23/10): la publicación automática falló,
    // pero el sorteo se publicó igual (evento con su identidad) y ya cerró.
    fake.tablas.sorteos_programados.find(x => x.id === s.id).estado = "fallido";
    fake.tablas.eventos_bot.push({ id: "ev-publicado-a-mano", usuario_id: A, grupo_id: "g1@g.us", activo: false, estado: "cerrado", identidad_evento_real: s.identidad_evento_real, tabla: T5K, creado_en: new Date() });

    assert.strictEqual((await anticipadas.anticipadasEnTabla(A, T5K)).total, 0, "con evento: ya no es anticipada");
    assert.strictEqual((await anticipadas.anticipadasDelSorteo(A, fake.tablas.sorteos_programados.find(x => x.id === s.id))).total, 0);
    assert.ok(!(await anticipadas.sorteosSinPublicar(A)).data.some(x => x.id === s.id), "no figura como sin publicar");
    const revision = await revisarReinicioPanel(3000, A);
    assert.strictEqual(revision.impacto.totalAnticipadas, 0, "el reinicio del panel tampoco la cuenta");

    // Si no se puede comprobar el evento, falla cerrado.
    fake.control.fallarTabla = "eventos_bot";
    assert.strictEqual((await anticipadas.anticipadasEnTabla(A, T5K)).ok, false);
    fake.control.fallarTabla = null;
});

prueba("7e. liberación por vencimiento: una anticipada empieza a vencer al publicarse, no cuando se tomó", async () => {
    sembrar();
    const s = await programar(entrada({ reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 } }));
    await reservar("56", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });   // hoy, días antes
    await tick(EN_PUBLICACION);
    await tick(mas(10));
    assert.strictEqual(fila("56").estado, "reservado", "10 min tras publicar: sigue reservada");
    await tick(mas(40));
    assert.strictEqual(fila("56").estado, "libre", "40 min tras publicar: vence con la regla normal");
});

prueba("8. D3: con anticipadas no se cambia identidad, tabla, fecha, precio, grupos ni reinicio, ni se cancela; premios sí", async () => {
    sembrar();
    const s = await programar();
    await reservar("60", { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    await reservar("61", { sorteoProgramadoId: s.id, grupoId: "g2@g.us", contactoId: C2 });
    const version = () => fake.tablas.sorteos_programados.find(x => x.id === s.id).version;
    const editar = (cambios) => servicio.editar(A, s.id, { ...entrada(), ...cambios, version: version() });

    for (const cambios of [{ hora_fin: "21:00" }, { nombre: "Otro" }, { fecha_sorteo: "2026-12-21", publicar_en: "2026-12-21T13:00:00Z" }, { valor: 5000 }, { valor: 2000 }, { grupos: ["g1@g.us"] }, { tabla: { reiniciar: true } }]) {
        const res = await editar(cambios);
        assert.strictEqual(res.motivo, "reservas_anticipadas", `${JSON.stringify(cambios)} -> ${JSON.stringify(res)}`);
        assert.ok(/2 reserva\(s\) anticipada\(s\)/.test(res.mensaje), res.mensaje);
    }

    const http409 = await pedir("POST", `/sorteos/${s.id}/cancelar`);
    assert.strictEqual(http409.status, 409);
    assert.strictEqual(http409.json.motivo, "reservas_anticipadas");
    assert.ok(/No se puede cancelar: el sorteo tiene 2 reserva/.test(http409.json.mensaje));
    assert.strictEqual(fake.tablas.sorteos_programados.find(x => x.id === s.id).estado, "programado");

    const premios = await editar({ premios: [{ nombre: "Premio mayor", premio: 500000 }] });
    assert.ok(premios.ok, JSON.stringify(premios));
    assert.strictEqual(fila("60").identidad_evento_real, s.identidad_evento_real, "nada se reasigna");

    // Resueltas una a una, ya se puede cancelar.
    for (const n of ["60", "61"]) {
        const lib = await silencio(() => pedir("POST", `/tablas/3000/numeros/${n}/liberar`, { cuerpo: { confirmar: true, motivo: "Cliente desistió", solicitudId: `l-${n}` } }));
        assert.strictEqual(lib.status, 200, JSON.stringify(lib.json));
    }
    const cancelado = await servicio.cancelar(A, s.id);
    assert.ok(cancelado.ok, JSON.stringify(cancelado));
});

// Lo que envía el formulario de edición (FormularioSorteo: desdeConfig ->
// aConfig) a partir del sorteo guardado, con «Conservar la tabla actual».
function comoFormulario(config, cambios = {}) {
    return {
        modalidad: config.modalidad, nombre: config.nombre, loteria_id: config.loteria_id || null,
        hora_fin: config.hora_fin, hora_cierre: config.hora_cierre || null, valor: Number(config.valor),
        premios: config.premios, grupos: config.grupos, cuentas: config.cuentas,
        publicar_en: config.publicar_en, fecha_sorteo: config.fecha_sorteo,
        tabla: { reiniciar: false, liberar_bloqueados: false },
        diseno: config.diseno || { origen: "actual", diseno_id: null, nombre: null, config: null },
        mensajes: config.mensajes, recordatorios: config.recordatorios || [],
        reservas: { liberar_no_pagados: false, vencimiento_minutos: null },
        ...cambios
    };
}

prueba("8b. caso de producción: «Conservar» y solo cambia la hora de publicación -> se guarda; las anticipadas siguen igual", async () => {
    sembrar();
    const s = await programar(entrada({ hora_cierre: "22:26" }));
    for (const n of ["03", "09", "24", "27", "36"]) await reservar(n, { sorteoProgramadoId: s.id, grupoId: "g1@g.us" });
    const antes = JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === A && f.estado !== "libre"));
    const actual = () => fake.tablas.sorteos_programados.find(x => x.id === s.id);

    // Mismo día, otra hora de publicación (lo que hizo el usuario).
    const nuevaHora = new Date(PUBLICAR.getTime() + 41 * 60000).toISOString();
    const res = await servicio.editar(A, s.id, { ...comoFormulario(actual().config, { publicar_en: nuevaHora }), version: actual().version });
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(actual().identidad_evento_real, s.identidad_evento_real, "misma identidad");

    // Reenviar el formulario sin cambiar nada también se guarda.
    const igual = await servicio.editar(A, s.id, { ...comoFormulario(actual().config), version: actual().version });
    assert.ok(igual.ok, JSON.stringify(igual));
    assert.strictEqual(JSON.stringify(fake.tablas[T5K].filter(f => f.usuario_id === A && f.estado !== "libre")), antes, "las 5 reservas no se tocan");
});

prueba("9. aislamiento: B no ve ni usa el sorteo de A; sorteos distintos no se mezclan; históricos intactos", async () => {
    sembrar();
    const antes = historicos();
    const s1 = await programar();
    const s2 = await programar(entrada({ nombre: "Lotería de Boyacá", grupos: ["g3@g.us"] }));
    await reservar("70", { sorteoProgramadoId: s1.id, grupoId: "g1@g.us" });
    await reservar("71", { sorteoProgramadoId: s2.id, grupoId: "g3@g.us" });

    assert.strictEqual(fila("70").identidad_evento_real, s1.identidad_evento_real);
    assert.strictEqual(fila("71").identidad_evento_real, s2.identidad_evento_real);
    assert.notStrictEqual(s1.identidad_evento_real, s2.identidad_evento_real);
    assert.strictEqual((await reservar("72", { sorteoProgramadoId: s2.id, grupoId: "g1@g.us" })).json.motivo, "grupo_no_del_sorteo", "grupo de otro sorteo");

    const deB = await pedir("GET", "/tablas/3000/numeros/70", { token: "jwt-B" });
    assert.deepStrictEqual(deB.json.programados, [], "B no ve los sorteos de A");
    assert.strictEqual(deB.json.estado, "libre", "en la cuadrícula de B el 70 sigue libre");
    assert.ok(fake.tablas[T5K].filter(f => f.usuario_id === B).every(f => f.estado === "libre"));
    assert.strictEqual(historicos(), antes);
});

// ---------------------------------------------------------------- runner ---

(async () => {
    const servidor = http.createServer(app);
    await new Promise(res => servidor.listen(0, res));
    base = `http://127.0.0.1:${servidor.address().port}`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    servidor.close();
    console.log(`\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    process.exit(falla ? 1 : 0);
})();
