// ==========================================================================
// PRUEBAS — regla de veracidad (30/10/2026): EFAAT dice el estado REAL de
// cada número, sea del sorteo que sea, y un error técnico nunca se vuelve un
// dato.
//
// En cada escenario se comprueba el ESTADO FINAL de las filas y el MENSAJE
// QUE SE ENVÍA de verdad (responderResultado real; plantillas de producción
// cuando aplica, mensaje fijo cuando no). Gemini nunca interpreta estados.
//
//   Reservas (detectarReserva): los 15 escenarios de la auditoría, más
//   duplicados, propios mezclados, error de escritura mezclado y una prueba
//   aleatoria de partición (cada número pedido en una y solo una lista).
//   Consultas: disponibilidad, número específico, mis números/pago, deuda en
//   otros sorteos; ninguna consulta modifica filas.
//   Cierre: «lleno» se decide aparte (sorteoSinNumerosLibres) y una tabla
//   llena por OTRO sorteo no termina el sorteo actual.
//
// Funciones REALES; Supabase en memoria (tests/sorteos/fakeSupabaseSorteos);
// sin WhatsApp ni Gemini (espías).
//
//     node backend/tests/reservas/veracidadEstados.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(ruta, exportsObj) {
    require.cache[r(ruta)] = { id: r(ruta), filename: r(ruta), loaded: true, exports: exportsObj };
}

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

const enviados = [];
let llamadasIA = 0;
inyectar("services/baileys/send.js", {
    sendMessage: async ({ text }) => { enviados.push(text); },
    sendReaction: async () => {}
});
inyectar("bot/ai/aiService.js", { suggestReply: async () => { llamadasIA++; return { respuesta: "texto inventado por la IA" }; } });

const { detectarReserva } = require(r("bot/funciones/reservas/detectarReserva.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { responderResultado } = require(r("bot/ai/responderResultado.js"));
const { estadoDelSorteo } = require(r("bot/funciones/eventos/sorteoReal.js"));
const { sorteoSinNumerosLibres } = require(r("bot/funciones/eventos/lifecycle/sorteoSinNumerosLibres.js"));

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const T = "5k_15k_reservas_2_cifras";
const ESTE = "sorteo-de-hoy";
const OTRO = "sorteo-anterior";
const KATY = { id: "c-katy", nombre: "Katy", telefono: "3001112233", lid: null };
const LUIS = { id: "c-luis", nombre: "Luis", telefono: "3004445566", lid: null };

const evento = {
    id: "ev-1", usuario_id: U, tabla: T, identidad_evento_real: ESTE, activo: true, estado: "abierto", cifras: 2, cantidad_numeros: 100,
    valor: "5000", nombre_evento: "Chontico", grupo_id: "g1@g.us", grupo_nombre: "Rifa", fecha_evento: "2999-01-01", hora_fin: "23:59", hora_cierre: "23:58"
};

// estados: { "23": { estado, identidad_evento_real, usuario_global_id } }
// sin: números sin fila; duplicar: números con dos filas.
function sembrar(estados = {}, { sin = [], duplicar = [] } = {}) {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.antesDeEscribir = null;
    fake.control.despuesDeLeer = null;
    const filas = [];
    for (let i = 0; i < 100; i++) {
        const numero = String(i).padStart(2, "0");
        if (sin.includes(numero)) continue;
        filas.push({ numero, usuario_id: U, estado: "libre", ...(estados[numero] || {}) });
        if (duplicar.includes(numero)) filas.push({ numero, usuario_id: U, estado: "libre" });
    }
    fake.tablas[T] = filas;
    fake.tablas.eventos_bot = [{ ...evento }];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];
    fake.tablas.plantillas_mensaje = [];
    fake.tablas.configuracion_seleccion_mensajes = [];
    enviados.length = 0;
    llamadasIA = 0;
}

const fila = (n) => fake.tablas[T].find(f => f.numero === n);
const foto = () => JSON.stringify(fake.tablas[T]);
const fotoDe = (numeros) => JSON.stringify(fake.tablas[T].filter(f => numeros.includes(f.numero)));

const deOtraPersona = { estado: "reservado", usuario_global_id: "c-otra", identidad_evento_real: ESTE, grupo_id: "g1@g.us" };
const pagadoOtra = { estado: "pagado", usuario_global_id: "c-otra", identidad_evento_real: ESTE };
const deOtroSorteo = { estado: "reservado", usuario_global_id: "c-otra", identidad_evento_real: OTRO };
const deOtroGrupo = { estado: "reservado", usuario_global_id: "c-otra", identidad_evento_real: ESTE, grupo_id: "otro@g.us" };
const mioEste = { estado: "reservado", usuario_global_id: KATY.id, identidad_evento_real: ESTE };
const mioOtro = { estado: "reservado", usuario_global_id: KATY.id, identidad_evento_real: OTRO };

// Plantillas reales de producción (texto tal cual).
const P_COMPLETA = "perfecto tus numeros {{numeros_reservados}} ya quedaron reservados";
const P_PARCIAL = "{{numeros_reservados}} {{reservado_reservados}} para ti. {{el_numero_los_numeros_ocupados}} {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}.";
const P_OCUPADO = "{{numeros_solicitados}} ya está ocupado.";
const P_TODOS = "{{cliente}}, {{el_numero_los_numeros}} {{numeros_solicitados}} ya {{esta_estan}} {{ocupado_ocupados}}.";

function conPlantillasDeReserva() {
    fake.tablas.plantillas_mensaje = [
        { id: "p-c", usuario_id: U, tipo_respuesta: "reserva_completa", contenido: P_COMPLETA, habilitada: true },
        { id: "p-p", usuario_id: U, tipo_respuesta: "reserva_parcial", contenido: P_PARCIAL, habilitada: true },
        { id: "p-o", usuario_id: U, tipo_respuesta: "numero_ocupado", contenido: P_OCUPADO, habilitada: true },
        { id: "p-t", usuario_id: U, tipo_respuesta: "todos_ocupados", contenido: P_TODOS, habilitada: true }
    ];
}

const ctxBase = (texto, usuario = KATY) => ({
    evento, usuario, textoOriginal: texto,
    session: { usuarioId: U, sessionId: "s1" },
    sock: {},
    chat: { remoteJid: "g1@g.us", esGrupo: true },
    message: { key: { id: `m-${Math.random()}`, fromMe: false, remoteJid: "g1@g.us" } }
});

// Mensaje del cliente -> reserva real -> mensaje enviado de verdad.
async function pedir(texto, usuario = KATY) {
    const reserva = await detectarReserva({ evento, texto, usuario, lib: null });
    const antes = enviados.length;
    if (reserva) await responderResultado({ ...ctxBase(texto, usuario), reserva });
    return { reserva, enviado: enviados.slice(antes).join("\n---\n") };
}

async function consultar(tipo, extra = {}) {
    const consulta = await resolverConsulta({ tipo, evento, usuario: KATY, ...extra });
    const antes = enviados.length;
    if (consulta) await responderResultado({ ...ctxBase("consulta"), consulta });
    return { consulta, enviado: enviados.slice(antes).join("\n---\n") };
}

// Todas las listas de una reserva: cada número pedido en una sola.
const LISTAS = ["reservados", "ocupados", "yaTuyos", "bloqueados", "enProceso", "noDisponibles", "noGuardados"];
function particion(reserva, pedidos) {
    const vistos = LISTAS.flatMap(l => (reserva[l] || []).map(n => [n, l]));
    assert.strictEqual(vistos.length, pedidos.length, `cada número en una sola lista: ${JSON.stringify(vistos)}`);
    assert.deepStrictEqual(vistos.map(([n]) => n).sort(), [...pedidos].sort(), "ningún número omitido ni inventado");
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ===================================================================== 1-4
prueba("1. ocupado por el mismo sorteo → ocupado; la fila de la otra persona intacta", async () => {
    sembrar({ "23": deOtraPersona });
    const antes = fotoDe(["23"]);
    const { reserva, enviado } = await pedir("23");
    assert.deepStrictEqual([reserva.ok, reserva.ocupados], [false, ["23"]]);
    assert.strictEqual(fotoDe(["23"]), antes);
    assert.ok(/ese número ya está ocupado/.test(enviado) && /\( 23 \)/.test(enviado), enviado);
});

prueba("2. ocupado por OTRO sorteo → ocupado (nunca desaparece); su reserva intacta", async () => {
    sembrar({ "23": deOtroSorteo });
    const antes = fotoDe(["23"]);
    const { reserva, enviado } = await pedir("23");
    assert.deepStrictEqual(reserva.ocupados, ["23"]);
    assert.strictEqual(fotoDe(["23"]), antes);
    assert.ok(/Ocupados: \( 23 \)/.test(enviado), enviado);
});

prueba("3. ocupado desde OTRO grupo del mismo sorteo → ocupado", async () => {
    sembrar({ "23": deOtroGrupo });
    const { reserva, enviado } = await pedir("23 24");
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["24"], ["23"]]);
    assert.strictEqual(fila("23").grupo_id, "otro@g.us");
    assert.ok(/ya están ocupados: \( 23 \)/.test(enviado), enviado);
});

prueba("4. pagado (este u otro sorteo) → ocupado; sigue pagado", async () => {
    sembrar({ "23": pagadoOtra, "45": { ...pagadoOtra, identidad_evento_real: OTRO } });
    const { reserva, enviado } = await pedir("23 45");
    assert.deepStrictEqual(reserva.ocupados, ["23", "45"]);
    assert.ok(fila("23").estado === "pagado" && fila("45").estado === "pagado");
    assert.ok(/Ocupados: \( 23 - 45 \)/.test(enviado), enviado);
});

// ===================================================================== 5-8
prueba("5. reservado por otro proceso antes de leer → ocupado", async () => {
    sembrar();
    Object.assign(fila("23"), deOtraPersona);
    const { reserva } = await pedir("23 45");
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["45"], ["23"]]);
    assert.strictEqual(fila("45").usuario_global_id, KATY.id);
});

prueba("6. bloqueado y en proceso → se dicen tal cual (ni «ocupado» ni silencio); filas intactas", async () => {
    sembrar({ "23": { estado: "bloqueado" }, "45": { estado: "en_proceso", bloqueado_hasta: "2000-01-01T00:00:00Z" } });
    conPlantillasDeReserva();
    const antes = fotoDe(["23", "45"]);
    const { reserva, enviado } = await pedir("12 23 45");
    assert.deepStrictEqual([reserva.reservados, reserva.bloqueados, reserva.enProceso, reserva.ocupados], [["12"], ["23"], ["45"], []]);
    assert.strictEqual(fotoDe(["23", "45"]), antes, "un en_proceso vencido tampoco se toma");
    assert.ok(/Reserva parcial/.test(enviado) && /bloqueado.*\( 23 \)/.test(enviado) && /en proceso.*\( 45 \)/.test(enviado), enviado);
    assert.ok(!/perfecto/.test(enviado), "no se usa una plantilla que no sabe decir «bloqueado»");
    assert.strictEqual(llamadasIA, 0);
});

prueba("7. libre → reservado de verdad, con identidad, y confirmación completa", async () => {
    sembrar();
    conPlantillasDeReserva();
    const { reserva, enviado } = await pedir("23");
    assert.deepStrictEqual([reserva.ok, reserva.reservados], [true, ["23"]]);
    assert.deepStrictEqual([fila("23").estado, fila("23").usuario_global_id, fila("23").identidad_evento_real], ["reservado", KATY.id, ESTE]);
    assert.strictEqual(enviado, "perfecto tus numeros ( 23 ) ya quedaron reservados");
    assert.strictEqual(reserva.reaccion, "✅");
});

prueba("8. libre que otro toma entre la lectura y el UPDATE → ocupado; no se pisa", async () => {
    sembrar();
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T) return;
        fake.control.antesDeEscribir = null;
        Object.assign(fila("45"), { ...deOtraPersona, usuario_global_id: LUIS.id });
    };
    const { reserva, enviado } = await pedir("12 45");
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["12"], ["45"]]);
    assert.strictEqual(fila("45").usuario_global_id, LUIS.id, "sigue siendo de quien lo tomó");
    assert.ok(/Reserva parcial/.test(enviado) && /ocupados: \( 45 \)/.test(enviado), enviado);
});

prueba("8b. carrera y la relectura falla → el perdido se informa como NO reservado, nunca «completa»", async () => {
    sembrar();
    fake.control.antesDeEscribir = (tabla) => {
        if (tabla !== T) return;
        fake.control.antesDeEscribir = null;
        Object.assign(fila("45"), deOtraPersona);
        // La siguiente lectura (la relectura) falla.
        fake.control.despuesDeLeer = null;
        let pendiente = true;
        const from = fake.client.from;
        fake.client.from = (t) => { if (t === T && pendiente && !fake.control.fallarTabla) { pendiente = false; fake.control.fallarTabla = T; } return from(t); };
        fake._restaurar = () => { fake.client.from = from; fake.control.fallarTabla = null; };
    };
    const { reserva, enviado } = await pedir("12 45");
    fake._restaurar();
    assert.deepStrictEqual([reserva.reservados, reserva.noGuardados, reserva.ocupados], [["12"], ["45"], []]);
    assert.ok(!/realizada correctamente/.test(enviado), enviado);
    assert.ok(/problema técnico: \( 45 \)/.test(enviado), enviado);
    assert.strictEqual(fila("12").usuario_global_id, KATY.id);
});

// ==================================================================== 9-11
prueba("9. error de lectura → mensaje técnico; nada cambia; ni plantillas ni Gemini", async () => {
    sembrar();
    conPlantillasDeReserva();
    const antes = foto();
    fake.control.fallarTabla = T;
    const { reserva, enviado } = await pedir("12 23");
    fake.control.fallarTabla = null;
    assert.strictEqual(reserva.errorTecnico, true);
    assert.strictEqual(foto(), antes);
    assert.strictEqual(enviado, "❌ No fue posible procesar tu reserva. Intenta nuevamente.");
    assert.strictEqual(llamadasIA, 0);
});

prueba("10. error de escritura (todos) → técnico; nada a medias; nunca «ocupado»", async () => {
    sembrar();
    fake.control.despuesDeLeer = (tabla) => {
        if (tabla !== T) return;
        fake.control.despuesDeLeer = null;
        fake.control.fallarTabla = T;
    };
    const { reserva, enviado } = await pedir("12 23");
    fake.control.fallarTabla = null;
    assert.strictEqual(reserva.errorTecnico, true);
    assert.ok(fake.tablas[T].every(f => f.estado === "libre"));
    assert.ok(!/ocupad/i.test(enviado), enviado);
});

prueba("10b. error de escritura con un ocupado en la misma solicitud → ocupado y «no reservado» por separado", async () => {
    sembrar({ "23": deOtraPersona });
    fake.control.despuesDeLeer = (tabla) => {
        if (tabla !== T) return;
        fake.control.despuesDeLeer = null;
        fake.control.fallarTabla = T;
    };
    const { reserva, enviado } = await pedir("12 23");
    fake.control.fallarTabla = null;
    assert.deepStrictEqual([reserva.ok, reserva.ocupados, reserva.noGuardados], [false, ["23"], ["12"]]);
    assert.strictEqual(fila("12").estado, "libre");
    assert.ok(/Ocupados: \( 23 \)/.test(enviado) && /problema técnico: \( 12 \)/.test(enviado), enviado);
});

prueba("11. número sin registro → «no está disponible» (antes desaparecía o era «libre»)", async () => {
    sembrar({}, { sin: ["23"] });
    const { reserva, enviado } = await pedir("12 23");
    assert.deepStrictEqual([reserva.reservados, reserva.noDisponibles], [["12"], ["23"]]);
    assert.ok(/Reserva parcial/.test(enviado) && /No está disponible: \( 23 \)/.test(enviado), enviado);
    assert.strictEqual(fake.tablas[T].filter(f => f.numero === "23").length, 0, "no se crea ninguna fila");
});

prueba("11b. número duplicado → no disponible; ninguna de sus filas se toca", async () => {
    sembrar({}, { duplicar: ["23"] });
    const antes = fotoDe(["23"]);
    const { reserva } = await pedir("23");
    assert.deepStrictEqual([reserva.ok, reserva.noDisponibles], [false, ["23"]]);
    assert.strictEqual(fotoDe(["23"]), antes);
});

// =================================================================== 12-14
prueba("12. mixta 87 27 09 17 01 → reservados 87 09 01; ocupados 27 17; mensaje con todos", async () => {
    sembrar({ "27": deOtraPersona, "17": { ...pagadoOtra, identidad_evento_real: OTRO } });
    conPlantillasDeReserva();
    const texto = "87 27 09 17 01";
    const { reserva, enviado } = await pedir(texto);
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["87", "09", "01"], ["27", "17"]]);
    particion(reserva, ["87", "27", "09", "17", "01"]);
    assert.ok(/\( 87 - 09 - 01 \)/.test(enviado) && /\( 27 - 17 \)/.test(enviado) && !enviado.startsWith("perfecto"), enviado);
    assert.ok(["87", "09", "01"].every(n => fila(n).usuario_global_id === KATY.id));
    assert.ok(fila("27").usuario_global_id === "c-otra" && fila("17").identidad_evento_real === OTRO);
});

prueba("12b. propio + libre → la plantilla de completa y «Ya es tuyo» añadido", async () => {
    sembrar({ "12": mioEste });
    conPlantillasDeReserva();
    const { reserva, enviado } = await pedir("12 34");
    assert.deepStrictEqual([reserva.reservados, reserva.yaTuyos], [["34"], ["12"]]);
    assert.strictEqual(enviado, "perfecto tus numeros ( 34 ) ya quedaron reservados\n\n✅ Ya es tuyo: ( 12 )");
});

prueba("12c. propio + ocupado → plantilla de ocupado con el ocupado y «Ya es tuyo»", async () => {
    sembrar({ "12": mioEste, "23": deOtraPersona });
    conPlantillasDeReserva();
    const { reserva, enviado } = await pedir("12 23");
    assert.deepStrictEqual([reserva.ok, reserva.ocupados, reserva.yaTuyos], [false, ["23"], ["12"]]);
    assert.strictEqual(enviado, "( 23 ) ya está ocupado.\n\n✅ Ya es tuyo: ( 12 )");
});

prueba("12d. suyo en OTRO sorteo → ocupado aquí (no «ya es tuyo»)", async () => {
    sembrar({ "12": mioOtro });
    const { reserva } = await pedir("12");
    assert.deepStrictEqual([reserva.ocupados, reserva.yaTuyos], [["12"], []]);
    assert.strictEqual(fila("12").identidad_evento_real, OTRO);
});

prueba("13. ceros iniciales se conservan en filas y mensaje", async () => {
    sembrar({ "00": deOtraPersona });
    const { reserva, enviado } = await pedir("00 07");
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["07"], ["00"]]);
    assert.strictEqual(fila("07").usuario_global_id, KATY.id);
    assert.ok(/\( 07 \)/.test(enviado) && /\( 00 \)/.test(enviado), enviado);
});

prueba("14. orden pedido distinto al de la base → respuesta en el orden pedido", async () => {
    sembrar({ "45": deOtraPersona, "03": deOtroSorteo });
    const { reserva, enviado } = await pedir("90 45 03 61");
    assert.deepStrictEqual([reserva.reservados, reserva.ocupados], [["90", "61"], ["45", "03"]]);
    assert.ok(/\( 90 - 61 \)/.test(enviado) && /\( 45 - 03 \)/.test(enviado), enviado);
});

// ====================================================================== 15
prueba("15. tres clientes simultáneos sobre los mismos números → un solo dueño por número; cada uno dice la verdad", async () => {
    sembrar();
    const ANA = { id: "c-ana", nombre: "Ana", telefono: "3007778899", lid: null };
    const [a, b, c] = await Promise.all([pedir("10 20 30"), pedir("20 30 40", LUIS), pedir("30 40 50", ANA)]);
    const resultados = [[a.reserva, KATY, ["10", "20", "30"]], [b.reserva, LUIS, ["20", "30", "40"]], [c.reserva, ANA, ["30", "40", "50"]]];
    for (const [res, quien, pedidos] of resultados) {
        particion(res, pedidos);
        for (const n of res.reservados) assert.strictEqual(fila(n).usuario_global_id, quien.id, `${n} confirmado a ${quien.nombre} y es suyo`);
        for (const n of res.ocupados) assert.notStrictEqual(fila(n).usuario_global_id, quien.id, `${n} dicho ocupado a ${quien.nombre}`);
    }
    for (const n of ["10", "20", "30", "40", "50"]) {
        const confirmados = resultados.filter(([res]) => res.reservados.includes(n)).length;
        assert.strictEqual(confirmados, 1, `${n} confirmado a exactamente un cliente`);
    }
});

prueba("15b. aleatoria (300 solicitudes): partición completa y reservados = filas del cliente", async () => {
    const estados = [null, deOtraPersona, pagadoOtra, deOtroSorteo, mioEste, mioOtro, { estado: "bloqueado" }, { estado: "en_proceso" }, { estado: "raro" }];
    let semilla = 7;
    const azar = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
    for (let vuelta = 0; vuelta < 300; vuelta++) {
        const est = {}; const sin = []; const duplicar = [];
        const pedidos = [...new Set(Array.from({ length: 1 + azar(6) }, () => String(azar(100)).padStart(2, "0")))];
        for (const n of pedidos) {
            const k = azar(estados.length + 2);
            if (k === estados.length) sin.push(n);
            else if (k === estados.length + 1) duplicar.push(n);
            else if (estados[k]) est[n] = estados[k];
        }
        sembrar(est, { sin, duplicar });
        const antes = new Map(fake.tablas[T].map(f => [f, JSON.stringify(f)]));
        const { reserva } = await pedir(pedidos.join(" "));
        assert.ok(reserva, `vuelta ${vuelta}: siempre hay respuesta`);
        particion(reserva, pedidos);
        for (const n of reserva.reservados) assert.strictEqual(fila(n).usuario_global_id, KATY.id);
        // Solo cambian las filas que se reservaron.
        for (const [f, json] of antes) {
            if (!reserva.reservados.includes(f.numero)) assert.strictEqual(JSON.stringify(f), json, `vuelta ${vuelta}: ${f.numero} no debía cambiar`);
        }
    }
});

prueba("Gemini nunca redacta una reserva, aunque no haya plantillas", async () => {
    sembrar({ "23": deOtraPersona });
    const { enviado } = await pedir("12 23");
    assert.strictEqual(llamadasIA, 0);
    assert.ok(/Reserva parcial/.test(enviado), enviado);
});

// ================================================================ consultas
prueba("disponibilidad: el ocupado por OTRO sorteo aparece ocupado; la consulta no cambia nada", async () => {
    sembrar({ "23": deOtroSorteo, "45": deOtraPersona });
    const antes = foto();
    const { consulta, enviado } = await consultar("disponibilidad");
    assert.ok(consulta.numerosOcupados.includes("23") && consulta.numerosOcupados.includes("45"));
    assert.ok(!consulta.numerosDisponibles.includes("23"));
    assert.strictEqual(consulta.numerosDisponibles.length, 98);
    assert.strictEqual(foto(), antes);
    assert.ok(!enviado.includes(" 23 ") && /\(98\)/.test(enviado), enviado);
    assert.strictEqual(llamadasIA, 0, "sin plantilla: mensaje fijo, nunca Gemini");
});

prueba("disponibilidad: tabla llena por OTRO sorteo → agotado (antes: «no quedan» sin ocupados)", async () => {
    const todos = {};
    for (let i = 0; i < 100; i++) todos[String(i).padStart(2, "0")] = deOtroSorteo;
    sembrar(todos);
    const { consulta, enviado } = await consultar("disponibilidad");
    assert.strictEqual(consulta.agotado, true);
    assert.strictEqual(consulta.numerosOcupados.length, 100);
    assert.ok(/AGOTADOS/.test(enviado), enviado);
});

prueba("disponibilidad: error de lectura → mensaje técnico, nunca «no quedan números»", async () => {
    sembrar();
    fake.control.fallarTabla = T;
    const { consulta, enviado } = await consultar("disponibilidad");
    fake.control.fallarTabla = null;
    assert.strictEqual(consulta.errorTecnico, true);
    assert.ok(/No pude consultar los números/.test(enviado) && !/No quedan/.test(enviado), enviado);
});

prueba("cierre separado: tabla llena por OTRO sorteo no termina el sorteo actual; llena por este sí", async () => {
    const otro = {}; const propio = {};
    for (let i = 0; i < 100; i++) { const n = String(i).padStart(2, "0"); otro[n] = deOtroSorteo; propio[n] = deOtraPersona; }
    sembrar(otro);
    assert.strictEqual(await sorteoSinNumerosLibres(evento), false, "no se reemplaza un sorteo vigente");
    sembrar(propio);
    assert.strictEqual(await sorteoSinNumerosLibres(evento), true);
    sembrar();
    fake.control.fallarTabla = T;
    assert.strictEqual(await sorteoSinNumerosLibres(evento), null, "un error no es «lleno»");
    fake.control.fallarTabla = null;
});

const numeroEspecifico = (n) => consultar("numero_especifico", { numeros: [n] });

prueba("número específico: cada estado real con su texto", async () => {
    const casos = [
        [{}, {}, "está libre"],
        [{ "23": mioEste }, {}, "ya lo tienes reservado"],
        [{ "23": deOtraPersona }, {}, "reservado por otra persona"],
        [{ "23": pagadoOtra }, {}, "pagado por otra persona"],
        [{ "23": deOtroSorteo }, {}, "reservado por otra persona"],
        [{ "23": mioOtro }, {}, "lo tienes en otro sorteo; en este no está disponible"],
        [{ "23": { estado: "bloqueado" } }, {}, "está bloqueado"],
        [{ "23": { estado: "en_proceso" } }, {}, "está en proceso"],
        [{}, { sin: ["23"] }, "no está disponible"],
        [{}, { duplicar: ["23"] }, "no está disponible"]
    ];
    for (const [est, opciones, esperado] of casos) {
        sembrar(est, opciones);
        const antes = foto();
        const { enviado } = await numeroEspecifico("23");
        assert.ok(enviado.includes(esperado) && enviado.includes("( 23 )"), `${JSON.stringify(est)} ${JSON.stringify(opciones)} → ${enviado}`);
        assert.strictEqual(foto(), antes);
    }
    assert.strictEqual(llamadasIA, 0);
});

prueba("número específico: error de lectura → mensaje técnico (antes: silencio)", async () => {
    sembrar();
    fake.control.fallarTabla = T;
    const { consulta, enviado } = await numeroEspecifico("23");
    fake.control.fallarTabla = null;
    assert.strictEqual(consulta.errorTecnico, true);
    assert.ok(/No pude consultar/.test(enviado), enviado);
});

prueba("mis números / cantidad / pago: error de lectura → técnico, nunca «no tienes números» ni «0»", async () => {
    for (const [tipo, extra] of [["mis_numeros", {}], ["cantidad_reservas", {}], ["consulta_pago", { modo: "resumen", bucket: "pendiente" }]]) {
        sembrar({ "12": mioEste });
        fake.control.fallarTabla = T;
        const { consulta, enviado } = await consultar(tipo, extra);
        fake.control.fallarTabla = null;
        assert.strictEqual(consulta.errorTecnico, true, tipo);
        assert.ok(!/No tienes números|Tienes 0|al día/.test(enviado) && /No pude consultar/.test(enviado), `${tipo}: ${enviado}`);
    }
});

prueba("pago: si no se pueden revisar los otros sorteos, se avisa y no se dice «al día»", async () => {
    sembrar({ "12": { ...mioEste, estado: "pagado" } });
    const { enviado } = await consultar("consulta_pago", { modo: "resumen", bucket: "pendiente" });
    assert.ok(/al día/.test(enviado), `con lectura correcta: ${enviado}`);
    fake.control.fallarTabla = "eventos_bot";
    const fallo = await consultar("consulta_pago", { modo: "resumen", bucket: "pendiente" });
    fake.control.fallarTabla = null;
    assert.ok(/No pude revisar en este momento si tienes pendientes en otros sorteos/.test(fallo.enviado), fallo.enviado);
    assert.ok(!/Estás al día: no tienes números pendientes/.test(fallo.enviado), fallo.enviado);
});

prueba("contadores: un número sin fila no cuenta como libre", async () => {
    sembrar({ "12": mioEste }, { sin: ["23", "24"] });
    const estado = await estadoDelSorteo(evento);
    assert.deepStrictEqual([estado.total, estado.libres, estado.sinRegistro, estado.reservados], [100, 97, 2, 1]);
    assert.strictEqual(estado.clasificacion.get("23"), "sin_registro");
});

(async () => {
    let ok = 0, falla = 0;
    const { log, warn, error } = console;
    for (const { n, fn } of pruebas) {
        console.log = console.warn = console.error = console.dir = () => {};
        try { await fn(); ok++; console.log = log; log(`✅ ${n}`); }
        catch (e) { falla++; console.log = log; log(`❌ ${n}`); log("   ", e && e.stack); }
    }
    console.warn = warn; console.error = error;
    log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
