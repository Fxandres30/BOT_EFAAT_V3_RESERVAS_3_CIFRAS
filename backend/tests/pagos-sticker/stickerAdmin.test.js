// ==========================================================================
// PRUEBAS — FASE 1/2 "infraestructura de pago por sticker" (ver AUDITORÍA,
// sección H/I/J). Cubre exactamente los 4 casos pedidos para la prueba
// controlada, más los módulos puros por separado.
//
// Mismo estilo que backend/tests/identidad/identidad.test.js: script plano
// de Node (sin jest/mocha), fake de Supabase inyectado vía require.cache
// ANTES de cargar los módulos bajo prueba, para no tocar la base de datos
// real ni el proceso de arranque de backend/lib/supabase.js.
//
//     node backend/tests/pagos-sticker/stickerAdmin.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

// Reutiliza el fake de Supabase ya existente para "usuarios" — mismo
// criterio de no duplicar infraestructura de pruebas.
const { crearFakeSupabase } = require("../identidad/fakeSupabase");

const RUTA_SUPABASE =
    path.resolve(__dirname, "../../lib/supabase.js");

const RUTA_OBTENER_USUARIO_GLOBAL =
    path.resolve(__dirname, "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js");

const RUTA_EXTRAER_DATOS_STICKER =
    path.resolve(__dirname, "../../bot/funciones/mensajes/extraerDatosSticker.js");

const RUTA_ES_ADMINISTRADOR =
    path.resolve(__dirname, "../../bot/funciones/admins/esAdministrador.js");

const RUTA_DEPURAR_STICKER_PAGO =
    path.resolve(__dirname, "../../bot/funciones/pagos/depurarStickerPago.js");

const GRUPO_ID = "120363000000000000@g.us";

const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_PARTICIPANTE = "573000000002@s.whatsapp.net";
const JID_OTRO_PARTICIPANTE = "573000000003@s.whatsapp.net";

// El bot guarda session.telefono CON el prefijo de país completo (ver
// services/baileys/conectado.js: sock.user.id.split(":")[0]) — se reproduce
// tal cual aquí para probar la normalización real.
const TELEFONO_SESION_BOT = "573000000099";
const JID_BOT = "573000000099:20@s.whatsapp.net";

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_OBTENER_USUARIO_GLOBAL];
    delete require.cache[RUTA_EXTRAER_DATOS_STICKER];
    delete require.cache[RUTA_ES_ADMINISTRADOR];
    delete require.cache[RUTA_DEPURAR_STICKER_PAGO];

    const { extraerDatosSticker } = require(RUTA_EXTRAER_DATOS_STICKER);
    const { esAdministrador } = require(RUTA_ES_ADMINISTRADOR);
    const { depurarStickerPago } = require(RUTA_DEPURAR_STICKER_PAGO);

    return { fake, extraerDatosSticker, esAdministrador, depurarStickerPago };

}

// Fake de sock: solo implementa lo que esAdministrador()/groupQueue.js
// necesitan (sock.groupMetadata) y lo que depurarStickerPago usa para
// enmascarar/loguear (sock.user.id, aunque hoy no se usa directamente).
function crearFakeSock() {

    return {

        user: { id: JID_BOT },

        async groupMetadata(grupoId) {

            assert.strictEqual(grupoId, GRUPO_ID);

            return {

                id: GRUPO_ID,
                subject: "Grupo de prueba",

                participants: [

                    { id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" },
                    { id: JID_PARTICIPANTE, phoneNumber: JID_PARTICIPANTE, admin: null },
                    { id: JID_OTRO_PARTICIPANTE, phoneNumber: JID_OTRO_PARTICIPANTE, admin: "superadmin" }

                ]

            };

        }

    };

}

function crearMensajeSticker({

    remitenteJid,
    quotedId = null,
    quotedParticipant = null,
    fromMe = false

}) {

    return {

        key: {
            id: "STICKER-MSG-ID",
            remoteJid: GRUPO_ID,
            participant: remitenteJid,
            fromMe
        },

        message: {

            stickerMessage: {

                mimetype: "image/webp",
                fileSha256: Buffer.from("hash-de-prueba"),

                contextInfo: quotedId
                    ? { stanzaId: quotedId, participant: quotedParticipant }
                    : undefined

            }

        }

    };

}

function crearCtx({ fake, sock, message }) {

    return {

        sock,

        message,

        session: { telefono: TELEFONO_SESION_BOT },

        chat: {

            esGrupo: true,
            remoteJid: GRUPO_ID,
            participante: message.key.participant

        }

    };

}

// Captura console.log/console.error durante fn() y los devuelve como un
// solo string, restaurando la consola real al terminar (incluso si fn()
// lanza).
async function capturarLogs(fn) {

    const original = { log: console.log, error: console.error };
    const lineas = [];

    console.log = (...args) => lineas.push(args.join(" "));
    console.error = (...args) => lineas.push(args.join(" "));

    try {

        await fn();

    } finally {

        console.log = original.log;
        console.error = original.error;

    }

    return lineas.join("\n");

}

const resultados = [];

async function test(nombre, fn) {

    try {

        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

}

async function ejecutarPruebas() {

    // ======================================================================
    // extraerDatosSticker() — módulo puro, sin Supabase
    // ======================================================================

    await test("extraerDatosSticker: mensaje sin sticker -> esSticker=false", () => {

        const { extraerDatosSticker } = cargarModulos();

        const resultado = extraerDatosSticker({ message: { conversation: "hola" } });

        assert.strictEqual(resultado.esSticker, false);

    });

    await test("extraerDatosSticker: sticker CON cita -> quotedId/quotedParticipant/hash correctos", () => {

        const { extraerDatosSticker } = cargarModulos();

        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedId: "QUOTED-1",
            quotedParticipant: JID_PARTICIPANTE
        });

        const resultado = extraerDatosSticker(msg);

        assert.strictEqual(resultado.esSticker, true);
        assert.strictEqual(resultado.tieneCita, true);
        assert.strictEqual(resultado.quotedId, "QUOTED-1");
        assert.strictEqual(resultado.quotedParticipant, JID_PARTICIPANTE);
        assert.strictEqual(resultado.mimetype, "image/webp");
        assert.strictEqual(resultado.fileSha256Hex, Buffer.from("hash-de-prueba").toString("hex"));

    });

    await test("extraerDatosSticker: sticker SIN cita -> tieneCita=false", () => {

        const { extraerDatosSticker } = cargarModulos();

        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN });

        const resultado = extraerDatosSticker(msg);

        assert.strictEqual(resultado.esSticker, true);
        assert.strictEqual(resultado.tieneCita, false);
        assert.strictEqual(resultado.quotedParticipant, null);

    });

    // ======================================================================
    // esAdministrador() — usa fake sock, sin Supabase
    // ======================================================================

    await test("esAdministrador: admin -> esAdministrador=true, rol='admin'", async () => {

        const { esAdministrador } = cargarModulos();
        const sock = crearFakeSock();

        const resultado = await esAdministrador({ sock, grupoId: GRUPO_ID, jid: JID_ADMIN });

        assert.strictEqual(resultado.esAdministrador, true);
        assert.strictEqual(resultado.rol, "admin");

    });

    await test("esAdministrador: superadmin -> esAdministrador=true, rol='superadmin'", async () => {

        const { esAdministrador } = cargarModulos();
        const sock = crearFakeSock();

        const resultado = await esAdministrador({ sock, grupoId: GRUPO_ID, jid: JID_OTRO_PARTICIPANTE });

        assert.strictEqual(resultado.esAdministrador, true);
        assert.strictEqual(resultado.rol, "superadmin");

    });

    await test("esAdministrador: participante normal (admin:null) -> esAdministrador=false", async () => {

        const { esAdministrador } = cargarModulos();
        const sock = crearFakeSock();

        const resultado = await esAdministrador({ sock, grupoId: GRUPO_ID, jid: JID_PARTICIPANTE });

        assert.strictEqual(resultado.esAdministrador, false);
        assert.strictEqual(resultado.rol, null);

    });

    await test("esAdministrador: JID que no está en el grupo -> esAdministrador=false", async () => {

        const { esAdministrador } = cargarModulos();
        const sock = crearFakeSock();

        const resultado = await esAdministrador({ sock, grupoId: GRUPO_ID, jid: "573009999999@s.whatsapp.net" });

        assert.strictEqual(resultado.esAdministrador, false);
        assert.strictEqual(resultado.rol, null);

    });

    // ======================================================================
    // depurarStickerPago() — los 4 casos pedidos en la prueba controlada
    // ======================================================================

    await test("CASO 1: admin cita a un participante -> identifica todo, resuelve usuario, NO modifica reservas", async () => {

        const { fake, depurarStickerPago } = cargarModulos();
        const sock = crearFakeSock();

        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedId: "QUOTED-CASO-1",
            quotedParticipant: JID_PARTICIPANTE
        });

        const ctx = crearCtx({ fake, sock, message: msg });

        const logs = await capturarLogs(() => depurarStickerPago(ctx));

        assert.match(logs, /Sticker recibido/);
        assert.match(logs, /Es administrador: true/);
        assert.match(logs, /Mensaje citado: sí/);
        assert.match(logs, /quoted_id: QUOTED-CASO-1/);
        assert.match(logs, /Usuario global encontrado:/);

        // Efecto esperado (y ÚNICO permitido en esta fase): identidad
        // resuelta/creada en "usuarios" — nunca una tabla de reservas/pagos.
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3000000002");

    });

    await test("CASO 2: participante normal (no admin) envía el mismo sticker -> IGNORAR, sin resolver identidad", async () => {

        const { fake, depurarStickerPago } = cargarModulos();
        const sock = crearFakeSock();

        const msg = crearMensajeSticker({
            remitenteJid: JID_PARTICIPANTE,
            quotedId: "QUOTED-CASO-2",
            quotedParticipant: JID_OTRO_PARTICIPANTE
        });

        const ctx = crearCtx({ fake, sock, message: msg });

        const logs = await capturarLogs(() => depurarStickerPago(ctx));

        assert.match(logs, /Sticker recibido/);
        assert.match(logs, /Es administrador: false/);
        assert.match(logs, /Acción: IGNORAR/);

        // No debe haber llegado siquiera a preguntar por el citado.
        assert.doesNotMatch(logs, /quoted_id:/);
        assert.strictEqual(fake.tablas.usuarios.length, 0);
        assert.strictEqual((fake.llamadas.usuarios || {}).insert || 0, 0);

    });

    await test("CASO 3: admin envía sticker SIN citar a nadie -> detecta admin, no hay cita, no resuelve usuario", async () => {

        const { fake, depurarStickerPago } = cargarModulos();
        const sock = crearFakeSock();

        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN });

        const ctx = crearCtx({ fake, sock, message: msg });

        const logs = await capturarLogs(() => depurarStickerPago(ctx));

        assert.match(logs, /Es administrador: true/);
        assert.match(logs, /Mensaje citado: no/);
        assert.match(logs, /Acción: NINGUNA — sticker de administrador sin cita/);

        assert.strictEqual(fake.tablas.usuarios.length, 0);

    });

    await test("CASO 4: admin cita un mensaje del propio BOT -> se detecta y NO se resuelve como cliente", async () => {

        const { fake, depurarStickerPago } = cargarModulos();
        const sock = crearFakeSock();

        // El citado es el propio bot: mismo teléfono que ctx.session.telefono,
        // con sufijo de dispositivo (":7") tal como lo entregaría Baileys.
        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedId: "QUOTED-CASO-4",
            quotedParticipant: `${TELEFONO_SESION_BOT}:7@s.whatsapp.net`
        });

        const ctx = crearCtx({ fake, sock, message: msg });

        const logs = await capturarLogs(() => depurarStickerPago(ctx));

        assert.match(logs, /Es administrador: true/);
        assert.match(logs, /Mensaje citado: sí/);
        assert.match(logs, /el propio BOT/);

        // Nunca debe crearse/buscarse un "usuario" cliente para el bot.
        assert.strictEqual(fake.tablas.usuarios.length, 0);

    });

    await test("Nunca lanza: un ctx incompleto no rompe el dispatcher", async () => {

        const { depurarStickerPago } = cargarModulos();

        await depurarStickerPago(null);
        await depurarStickerPago({});
        await depurarStickerPago({ chat: { esGrupo: false } });

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidas = resultados.filter(r => !r.ok);

    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas.length}  |  Fallidas: ${fallidas.length}`);
    console.log("============================================\n");

    if (fallidas.length > 0) {
        process.exitCode = 1;
    }

}

ejecutarPruebas();
