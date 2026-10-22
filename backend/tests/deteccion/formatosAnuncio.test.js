// ==========================================================================
// PRUEBAS — anuncios de sorteo con formatos distintos.
//
//   Formato A (lotería en una línea, "HORA ESTIMADA" en otra, monto antes
//   de la etiqueta, "Participación") y formato B (lotería y hora en la misma
//   línea, "BONO ADICIONAL"), con variantes de emojis, acentos, mayúsculas,
//   saltos de línea, horas y montos. Campos que faltan: no se inventan.
//
//   1. extractor puro (extraerEvento / pareceAnuncioDeSorteo);
//   2. detectarEvento REAL (Supabase y WhatsApp falsos): dueño, sesión,
//      duplicados, dos clientes, propietario nulo, anuncio incompleto;
//   3. dispatcher + eventHandler REALES: caption de imagen, imagen sin texto,
//      grupo no autorizado, mensaje entrante y fromMe=true (manual y eco del
//      programa).
//
// Nunca toca Supabase ni WhatsApp reales (lib/supabase.js se sustituye
// antes de cargar cualquier módulo del bot).
//
//     node backend/tests/deteccion/formatosAnuncio.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearEntorno } = require("./entornoFake");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (rel, exp) => { const abs = r(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

// El primer crearEntorno() inyecta el Supabase falso antes de cargar nada más.
crearEntorno();

const { extraerEvento, pareceAnuncioDeSorteo } = require(r("bot/funciones/eventos/extraerEvento.js"));
const { crearIdentidadEventoReal } = require(r("bot/funciones/eventos/identidadEventoReal.js"));
const normalizarMensaje = require(r("bot/middleware/normalizarMensaje.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const GRUPO = "120363111111111111@g.us";
const GRUPO_NO_AUTORIZADO = "120363999999999999@g.us";

const FORMATO_A = `*LOTERÍA DE BOGOTÁ* 🍀
⌛ HORA ESTIMADA: *10:30 PM*
🏆 *PREMIOS* 🏆
✧ $95.000 ➜ *Cifras finales*
✧ $20.000 ➜ *Cifras iniciales*
✧ $20.000 ➜ *Cifras centrales*
🎟️ Participación: *$2.000*
💎 ACUMULADO $300.000
🏦 *MEDIO HABILITADO*
3246303190 -NEQUI`;

const FORMATO_B = `⚡ Para Hoy 22 De Octubre ⚡

🎰 Lotería de Bogotá - 10:30 PM

🍀 Dos últimas cifras → $95.000
🍀 Dos primeras cifras → $20.000
🍀 Dos cifras del centro → $20.000

🎁 BONO ADICIONAL
🎫 Primera + última cifra → $20.000

🎯 Valor número: $2.000

🏦 Nequi
📲 3246303190`;

const PRINCIPALES = [
    { tipo: "dos_ultimas_cifras", premio: 95000 },
    { tipo: "dos_primeras_cifras", premio: 20000 },
    { tipo: "dos_centro", premio: 20000 }
];

const resultados = [];

async function prueba(nombre, fn) {
    try {
        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        resultados.push({ nombre, ok: false });
        console.log(`❌ ${nombre}\n   ${err.stack || err.message}`);
    }
}

// Lotería, hora, valor y los tres premios principales.
function verificarNucleo(ev, etiqueta) {
    assert.ok(ev, `${etiqueta}: no se detectó`);
    assert.deepStrictEqual(ev.faltantes, [], `${etiqueta}: faltantes ${ev.faltantes}`);
    assert.strictEqual(ev.nombre, "Lotería de Bogotá", etiqueta);
    assert.strictEqual(ev.hora, "22:30", etiqueta);
    assert.strictEqual(ev.horaCierre, "22:26", etiqueta);
    assert.strictEqual(ev.valor, 2000, etiqueta);
    const principales = ev.premios.filter(p => p.tipo !== "bono" && p.tipo !== "otro").map(({ tipo, premio }) => ({ tipo, premio }));
    assert.deepStrictEqual(principales, PRINCIPALES, `${etiqueta}: ${JSON.stringify(ev.premios)}`);
}

// Variantes de escritura de un mismo anuncio.
const sinEmojis = (t) => t.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/[✧➜→]/g, "-");
const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const VARIANTES = {
    "sin emojis": sinEmojis,
    "sin tildes": sinTildes,
    "MAYÚSCULAS": (t) => t.toUpperCase(),
    "minúsculas": (t) => t.toLowerCase(),
    "CRLF": (t) => t.replace(/\n/g, "\r\n"),
    "líneas en blanco y espacios extra": (t) => t.split("\n").map(l => `   ${l.replace(/ /g, "  ")}  `).join("\n\n\n"),
    "sin asteriscos": (t) => t.replace(/\*/g, "")
};

// --------------------------------------------------------------------------
// dispatcher + eventHandler reales sobre el Supabase/WhatsApp falsos de
// crearEntorno(). Solo se sustituyen el contexto (con el normalizarMensaje
// real), el historial y los extremos de negocio (espías).
// --------------------------------------------------------------------------
function montarDispatcher({ fakeSupabase }) {

    const negocio = { reservas: 0, consultas: 0, respuestas: 0 };

    inyectar("bot/funciones/grupos/politicaGrupos.js", {
        AUTORIZACION_TTL_MS: 0,
        evaluarGrupo: async (usuarioId, grupoId) => {
            if (!usuarioId) return { permitido: false, motivo: "sin_propietario" };
            return grupoId === GRUPO_NO_AUTORIZADO ? { permitido: false, motivo: "no_autorizado" } : { permitido: true, motivo: "autorizado" };
        },
        gruposAutorizadosDe: async () => ({ has: (g) => g !== GRUPO_NO_AUTORIZADO }),
        olvidarAutorizacion: () => {}
    });
    inyectar("bot/middleware/obtenerContexto.js", async (sock, message) => {
        const { textoOriginal, texto } = normalizarMensaje(message);
        return {
            sock, message,
            chat: { esGrupo: true, remoteJid: message.key.remoteJid },
            usuario: { id: "participante-1" },
            grupo: null,
            textoOriginal: textoOriginal || null,
            texto: texto || null,
            numeros: []
        };
    });
    inyectar("bot/funciones/mensajes/guardarMensajeGrupo.js", { guardarMensajeGrupo: async () => ({ id: "fila-historial" }), MENSAJE_DUPLICADO: Symbol("dup") });
    inyectar("bot/funciones/mensajes/clasificarMensaje.js", { clasificarMensaje: async () => {} });
    inyectar("bot/funciones/pagos/registrarStickerPago.js", { registrarStickerPago: async () => ({ intervino: false }) });
    inyectar("bot/funciones/pagos/confirmarPagoPorSticker.js", { confirmarPagoPorSticker: async () => {} });
    inyectar("bot/handlers/commandHandler.js", async () => {});
    inyectar("bot/funciones/reservas/detectarReserva.js", { detectarReserva: async () => { negocio.reservas++; return { ok: true }; } });
    inyectar("bot/funciones/consultas/resolverConsulta.js", { resolverConsulta: async () => { negocio.consultas++; return { ok: true }; } });
    inyectar("bot/ai/responderResultado.js", { responderResultado: async () => { negocio.respuestas++; } });
    inyectar("bot/ai/configMensajes.js", { estaRespuestaHabilitada: async () => true });

    for (const rel of ["bot/handlers/dispatcher.js", "bot/handlers/eventHandler.js"]) delete require.cache[r(rel)];

    const dispatcher = require(r("bot/handlers/dispatcher.js"));
    const mensajesEnviados = require(r("bot/utils/mensajesEnviados.js"));

    const eventos = () => fakeSupabase._filas("eventos_bot");

    return { dispatcher, negocio, eventos, mensajesEnviados };

}

let secuencia = 0;

function mensaje({ texto, caption, imagenSinTexto = false, fromMe = false, grupo = GRUPO, id } = {}) {
    let message;
    if (imagenSinTexto) message = { imageMessage: { mimetype: "image/jpeg" } };
    else if (caption !== undefined) message = { imageMessage: { caption, mimetype: "image/jpeg" } };
    else message = { conversation: texto };
    return { key: { id: id || `MSG-${++secuencia}`, remoteJid: grupo, participant: fromMe ? undefined : "111111111111111@lid", fromMe }, message, messageTimestamp: Math.floor(Date.now() / 1000) };
}

async function main() {

    // ================================================== 1. EXTRACTOR ===

    await prueba("formato A: lotería, hora, premios (los 3 principales + acumulado) y valor", () => {
        const ev = extraerEvento(FORMATO_A);
        verificarNucleo(ev, "A");
        assert.deepStrictEqual(ev.premios.find(p => p.nombre === "Acumulado"), { tipo: "otro", nombre: "Acumulado", premio: 300000 });
        assert.deepStrictEqual(ev.premios.map(p => p.nombre).slice(0, 3), ["Cifras finales", "Cifras iniciales", "Cifras centrales"]);
        assert.strictEqual(pareceAnuncioDeSorteo(FORMATO_A), true);
    });

    await prueba("formato B: los mismos campos y el premio adicional (bono), sin confundirlo con los principales", () => {
        const ev = extraerEvento(FORMATO_B);
        verificarNucleo(ev, "B");
        const bonos = ev.premios.filter(p => p.tipo === "bono");
        assert.deepStrictEqual(bonos, [{ tipo: "bono", nombre: "Primera + última cifra", premio: 20000 }]);
        assert.strictEqual(ev.premios.filter(p => p.tipo === "dos_ultimas_cifras").length, 1, "«Primera + última» no es «dos últimas»");
        assert.strictEqual(pareceAnuncioDeSorteo(FORMATO_B), true);
    });

    await prueba("A y B del mismo sorteo producen la misma identidad (mismo nombre, hora y valor)", () => {
        const id = (ev) => crearIdentidadEventoReal({ usuario_id: A, nombre_evento: ev.nombre, hora_fin: ev.hora, valor: ev.valor, fecha_evento: "2026-10-22" });
        assert.strictEqual(id(extraerEvento(FORMATO_A)), id(extraerEvento(FORMATO_B)));
    });

    await prueba("variantes de emojis, acentos, mayúsculas, saltos de línea y espacios (A y B)", () => {
        for (const [nombre, f] of Object.entries(VARIANTES)) {
            verificarNucleo(extraerEvento(f(FORMATO_A)), `A ${nombre}`);
            const evB = extraerEvento(f(FORMATO_B));
            verificarNucleo(evB, `B ${nombre}`);
            assert.strictEqual(evB.premios.filter(p => p.tipo === "bono").length, 1, `B ${nombre}: bono`);
        }
    });

    await prueba("formatos de hora: 10:30 PM / p. m. / p.m. / pm pegado / 22:30 / de la noche / 10 PM / 7:05 am", () => {
        const casos = {
            "10:30 PM": "22:30", "10:30 p. m.": "22:30", "10:30 p. m.": "22:30", "10:30 p.m.": "22:30",
            "10:30pm": "22:30", "10:30 P.M.": "22:30", "22:30": "22:30", "22:30 h": "22:30",
            "10:30 de la noche": "22:30", "10 PM": "22:00", "7:05 am": "07:05", "12:15 am": "00:15", "12:00 pm": "12:00"
        };
        for (const [escrita, esperada] of Object.entries(casos)) {
            assert.strictEqual(extraerEvento(FORMATO_A.replace("10:30 PM", escrita)).hora, esperada, `A «${escrita}»`);
            assert.strictEqual(extraerEvento(FORMATO_B.replace("10:30 PM", escrita)).hora, esperada, `B «${escrita}»`);
        }
    });

    await prueba("montos: $95000, 95000 pesos, 95.000, $ 2,000, 2 mil", () => {
        const a = extraerEvento(FORMATO_A.replace("$95.000", "$95000").replace("$20.000 ➜ *Cifras iniciales*", "20000 pesos ➜ *Cifras iniciales*").replace("$20.000 ➜ *Cifras centrales*", "20.000 ➜ *Cifras centrales*"));
        verificarNucleo(a, "A montos");
        assert.strictEqual(extraerEvento(FORMATO_A.replace("*$2.000*", "$ 2,000")).valor, 2000);
        assert.strictEqual(extraerEvento(FORMATO_A.replace("*$2.000*", "2 mil")).valor, 2000);
        assert.strictEqual(extraerEvento(FORMATO_B.replace("$2.000", "2000 pesos")).valor, 2000);
        verificarNucleo(extraerEvento(FORMATO_B.replace("→ $95.000", "→ 95000 pesos")), "B 95000 pesos");
    });

    await prueba("etiquetas equivalentes: «valor por número», «valor número», «participación»; «últimas/finales», «primeras/iniciales», «centro/centrales»", () => {
        for (const etiqueta of ["Valor por número", "Valor x número", "valor numero", "VALOR DEL NÚMERO", "Participación", "participacion"]) {
            assert.strictEqual(extraerEvento(FORMATO_B.replace("Valor número", etiqueta)).valor, 2000, etiqueta);
        }
        const cruzado = FORMATO_B
            .replace("Dos últimas cifras", "Cifras finales")
            .replace("Dos primeras cifras", "Cifras iniciales")
            .replace("Dos cifras del centro", "Cifras centrales");
        verificarNucleo(extraerEvento(cruzado), "B con etiquetas de A");
        const cruzadoA = FORMATO_A
            .replace("Cifras finales", "Dos últimas cifras")
            .replace("Cifras iniciales", "Dos primeras cifras")
            .replace("Cifras centrales", "Dos cifras del centro");
        verificarNucleo(extraerEvento(cruzadoA), "A con etiquetas de B");
    });

    await prueba("variantes del nombre de la lotería: LOTERIA BOGOTA, Lot. de Bogotá, lotería de bogota -> «Lotería de Bogotá»", () => {
        for (const escrito of ["LOTERIA BOGOTA", "Lot. de Bogotá", "lotería de bogota", "Loteria  de   Bogotá"]) {
            assert.strictEqual(extraerEvento(FORMATO_A.replace("LOTERÍA DE BOGOTÁ", escrito)).nombre, "Lotería de Bogotá", `A ${escrito}`);
            assert.strictEqual(extraerEvento(FORMATO_B.replace("Lotería de Bogotá", escrito)).nombre, "Lotería de Bogotá", `B ${escrito}`);
        }
        assert.strictEqual(extraerEvento(FORMATO_B.replace("Lotería de Bogotá", "Lotería de Medellín")).nombre, "Lotería de Medellín");
    });

    await prueba("campo obligatorio ausente: no se inventa, se marca como faltante", () => {
        const sinValorA = extraerEvento(FORMATO_A.replace("🎟️ Participación: *$2.000*\n", ""));
        assert.ok(sinValorA, "sigue siendo un anuncio (lotería + hora + premios)");
        assert.deepStrictEqual(sinValorA.faltantes, ["valor"]);
        assert.strictEqual(sinValorA.valor, null);

        const sinHoraA = extraerEvento(FORMATO_A.replace("⌛ HORA ESTIMADA: *10:30 PM*\n", "⌛ Para hoy\n"));
        assert.deepStrictEqual(sinHoraA.faltantes, ["hora"]);
        assert.strictEqual(sinHoraA.hora, null);
        assert.strictEqual(sinHoraA.horaCierre, null);

        // "10:30" sin am/pm puede ser de mañana o de noche: no se adivina.
        const ambigua = extraerEvento(FORMATO_B.replace("10:30 PM", "10:30"));
        assert.deepStrictEqual(ambigua.faltantes, ["hora"]);

        assert.strictEqual(pareceAnuncioDeSorteo(FORMATO_A.replace("🎟️ Participación: *$2.000*\n", "")), false);
    });

    await prueba("mencionar una lotería no basta: preguntas, recordatorios y pedidos no son anuncios", () => {
        const noAnuncios = [
            "¿A qué hora juega la Lotería de Bogotá?",
            "Hoy juega la lotería de Bogotá, suerte a todos 🍀",
            "me llevo el 23 para la lotería de bogotá",
            "recordatorio familia a las 9:30 p. m. se liberan los numeritos no pago",
            "Ya pagué $2.000 de la lotería de Bogotá",
            "🏆 PREMIOS 🏆\n✧ $95.000 ➜ Cifras finales",
            "Lotería de Bogotá",
            ""
        ];
        for (const t of noAnuncios) {
            assert.strictEqual(extraerEvento(t), null, t);
            assert.strictEqual(pareceAnuncioDeSorteo(t), false, t);
        }
    });

    await prueba("la hora de liberación o de cierre no se toma como hora del sorteo", () => {
        const t = FORMATO_A.replace("⌛ HORA ESTIMADA: *10:30 PM*\n", "Para hoy\nLiberados a las 9:30 PM\nCierre de reservas 10:20 PM\n");
        const ev = extraerEvento(t);
        assert.deepStrictEqual(ev.faltantes, ["hora"]);
        assert.strictEqual(ev.horaLiberacion, "21:30");
    });

    // ================================================ 2. detectarEvento ===

    await prueba("detectarEvento (formato A): guarda el evento del dueño y la sesión que recibieron el mensaje", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const ev = await detectarEvento({ sock, session: sock.context, chat: { remoteJid: GRUPO }, textoOriginal: FORMATO_A });
        assert.ok(ev, "evento guardado");
        const filas = fakeSupabase._filas("eventos_bot");
        assert.strictEqual(filas.length, 1);
        const f = filas[0];
        assert.strictEqual(f.usuario_id, A);
        assert.strictEqual(f.session_id, "sesion-A");
        assert.strictEqual(f.grupo_id, GRUPO);
        assert.strictEqual(f.nombre_evento, "Lotería de Bogotá");
        assert.strictEqual(f.hora_fin, "22:30");
        assert.strictEqual(f.valor, 2000);
        assert.strictEqual(f.tabla, "reservas_dos_cifras");
        assert.strictEqual(f.premios.length, 4);
    });

    await prueba("detectarEvento (formato B, caption de imagen): mismo evento con el bono", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const { textoOriginal } = normalizarMensaje(mensaje({ caption: FORMATO_B }));
        assert.strictEqual(textoOriginal, FORMATO_B, "el texto sale del caption");
        await detectarEvento({ sock, session: sock.context, chat: { remoteJid: GRUPO }, textoOriginal });
        const [f] = fakeSupabase._filas("eventos_bot");
        assert.strictEqual(f.nombre_evento, "Lotería de Bogotá");
        assert.ok(f.premios.some(p => p.tipo === "bono" && p.premio === 20000));
    });

    await prueba("mensaje repetido (WhatsApp lo reenvía) y re-anuncio en el otro formato: un solo evento", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const ctx = (t) => ({ sock, session: sock.context, chat: { remoteJid: GRUPO }, textoOriginal: t });
        await detectarEvento(ctx(FORMATO_A));
        await detectarEvento(ctx(FORMATO_A));
        await detectarEvento(ctx(FORMATO_B));
        const filas = fakeSupabase._filas("eventos_bot");
        assert.strictEqual(filas.length, 1, `filas: ${filas.length}`);
        assert.strictEqual(filas[0].usuario_id, A);
    });

    await prueba("dos clientes en el mismo grupo: cada evento queda con su dueño y su sesión", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock: sockA } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const { sock: sockB } = crearFakeSock({ sessionId: "sesion-B", usuarioId: B });
        await detectarEvento({ sock: sockA, session: sockA.context, chat: { remoteJid: GRUPO }, textoOriginal: FORMATO_A });
        await detectarEvento({ sock: sockB, session: sockB.context, chat: { remoteJid: GRUPO }, textoOriginal: FORMATO_B.replace("$2.000", "$5.000") });
        const filas = fakeSupabase._filas("eventos_bot");
        assert.strictEqual(filas.length, 2);
        const deA = filas.find(f => f.usuario_id === A);
        const deB = filas.find(f => f.usuario_id === B);
        assert.strictEqual(deA.session_id, "sesion-A");
        assert.strictEqual(deA.valor, 2000);
        assert.strictEqual(deB.session_id, "sesion-B");
        assert.strictEqual(deB.valor, 5000);
        assert.strictEqual(deB.tabla, "5k_15k_reservas_2_cifras");
        assert.notStrictEqual(deA.identidad_evento_real, deB.identidad_evento_real);
    });

    await prueba("propietario nulo: no guarda ningún evento ni abre el grupo", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock, llamadas } = crearFakeSock({ sessionId: "sesion-huerfana", usuarioId: null });
        const ev = await detectarEvento({ sock, session: sock.context, chat: { remoteJid: GRUPO }, textoOriginal: FORMATO_A });
        assert.strictEqual(ev, null);
        assert.strictEqual(fakeSupabase._filas("eventos_bot").length, 0);
        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);
    });

    await prueba("dueño validado distinto del dueño del socket: no se guarda bajo ningún cliente", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const ev = await detectarEvento({ sock, session: { usuarioId: B }, chat: { remoteJid: GRUPO }, textoOriginal: FORMATO_A });
        assert.strictEqual(ev, null);
        assert.strictEqual(fakeSupabase._filas("eventos_bot").length, 0);
    });

    await prueba("anuncio incompleto (sin valor / hora ambigua): no se guarda ni se abre el grupo", async () => {
        const { detectarEvento, fakeSupabase, crearFakeSock } = crearEntorno();
        const { sock, llamadas } = crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        for (const t of [FORMATO_A.replace("🎟️ Participación: *$2.000*\n", ""), FORMATO_B.replace("10:30 PM", "10:30")]) {
            assert.strictEqual(await detectarEvento({ sock, session: sock.context, chat: { remoteJid: GRUPO }, textoOriginal: t }), null);
        }
        assert.strictEqual(fakeSupabase._filas("eventos_bot").length, 0);
        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);
    });

    // ============================================ 3. dispatcher real ===

    await prueba("mensaje ENTRANTE con el anuncio: crea el evento y no se procesa como reserva ni consulta", async () => {
        const entorno = crearEntorno();
        const { dispatcher, negocio, eventos } = montarDispatcher(entorno);
        const { sock } = entorno.crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: FORMATO_B }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 1);
        assert.strictEqual(eventos()[0].usuario_id, A);
        assert.deepStrictEqual(negocio, { reservas: 0, consultas: 0, respuestas: 0 });
    });

    await prueba("fromMe=true escrito a mano desde el teléfono del bot: crea el evento; nunca se trata como reserva", async () => {
        const entorno = crearEntorno();
        const { dispatcher, negocio, eventos } = montarDispatcher(entorno);
        const { sock } = entorno.crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: FORMATO_A, fromMe: true }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 1);
        assert.strictEqual(eventos()[0].session_id, "sesion-A");
        // Un pedido escrito desde el teléfono del bot tampoco es una reserva.
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: "me llevo el 23", fromMe: true }), tipo: "GRUPO" });
        assert.deepStrictEqual(negocio, { reservas: 0, consultas: 0, respuestas: 0 });
    });

    await prueba("fromMe=true eco de un mensaje que envió el propio programa: no se vuelve a detectar", async () => {
        const entorno = crearEntorno();
        const { dispatcher, eventos, mensajesEnviados } = montarDispatcher(entorno);
        const { sock } = entorno.crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        const m = mensaje({ texto: FORMATO_A, fromMe: true });
        mensajesEnviados.registrarEnviado(m.key.id);
        await dispatcher({ sock, session: sock.context, message: m, tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 0);
    });

    await prueba("caption de imagen: se detecta; imagen SIN texto: no se inventa ningún anuncio (no hay OCR)", async () => {
        const entorno = crearEntorno();
        const { dispatcher, eventos } = montarDispatcher(entorno);
        const { sock } = entorno.crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        await dispatcher({ sock, session: sock.context, message: mensaje({ imagenSinTexto: true }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 0, "imagen sin texto");
        await dispatcher({ sock, session: sock.context, message: mensaje({ caption: FORMATO_A }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 1, "caption");
    });

    await prueba("grupo NO autorizado: ni evento, ni reserva, ni consulta, ni apertura", async () => {
        const entorno = crearEntorno();
        const { dispatcher, negocio, eventos } = montarDispatcher(entorno);
        const { sock, llamadas } = entorno.crearFakeSock({ sessionId: "sesion-A", usuarioId: A });
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: FORMATO_A, grupo: GRUPO_NO_AUTORIZADO }), tipo: "GRUPO" });
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: "me llevo el 23", grupo: GRUPO_NO_AUTORIZADO }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 0);
        assert.strictEqual(llamadas.groupSettingUpdate.length, 0);
        assert.deepStrictEqual(negocio, { reservas: 0, consultas: 0, respuestas: 0 });
    });

    await prueba("sesión sin dueño en el dispatcher: el mensaje se descarta sin guardar nada", async () => {
        const entorno = crearEntorno();
        const { dispatcher, eventos } = montarDispatcher(entorno);
        const { sock } = entorno.crearFakeSock({ sessionId: "sesion-huerfana", usuarioId: null });
        await dispatcher({ sock, session: sock.context, message: mensaje({ texto: FORMATO_A }), tipo: "GRUPO" });
        assert.strictEqual(eventos().length, 0);
    });

    const fallos = resultados.filter(x => !x.ok).length;
    console.log(`\n============================\nTOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallos}  ❌ FALLA: ${fallos}\n============================`);
    process.exitCode = fallos ? 1 : 0;

}

main();
