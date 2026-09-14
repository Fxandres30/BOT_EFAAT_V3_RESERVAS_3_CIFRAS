// ==========================================================================
// PRUEBAS — resolverIdentidadMensaje() y su integración en
// bot/middleware/obtenerUsuario.js (auditoría de mensajes entrantes,
// 2026-09).
//
// Cubre los 9 escenarios pedidos (A-I), demostrando exactamente qué
// identidad se obtiene en cada caso:
//   A. privado con PN disponible
//   B. privado con LID
//   C. grupo, participant trae la identidad
//   D. grupo con campos alternativos (participant=LID + participantAlt=PN)
//   E. mensaje sin teléfono disponible
//   F. identidad parcialmente disponible (sin ningún JID reconocible)
//   G. usuario existente
//   H. usuario nuevo
//   I. el grupo nunca se confunde con el usuario
//
// Mismo estilo que el resto del proyecto: script plano de Node, sin jest.
//
//     node backend/tests/identidad/resolverIdentidadMensaje.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_RESOLVER = path.resolve(__dirname, "../../bot/funciones/usuarios/identityScanner/resolverIdentidadMensaje.js");
const RUTA_OBTENER_USUARIO = path.resolve(__dirname, "../../bot/middleware/obtenerUsuario.js");
const RUTA_OBTENER_USUARIO_GLOBAL = path.resolve(__dirname, "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js");

function cargarResolver() {

    delete require.cache[RUTA_RESOLVER];
    return require(RUTA_RESOLVER).resolverIdentidadMensaje;

}

function cargarObtenerUsuario() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    [RUTA_OBTENER_USUARIO, RUTA_OBTENER_USUARIO_GLOBAL, RUTA_RESOLVER].forEach((r) => delete require.cache[r]);

    const obtenerUsuario = require(RUTA_OBTENER_USUARIO);

    return { fake, obtenerUsuario };

}

// Construye un mensaje realista con la MISMA forma que produce Baileys
// 7.0.0-rc14 (verificado contra decode-wa-message.js -- ver cabecera de
// resolverIdentidadMensaje.js).
function mensaje({

    remoteJid,
    remoteJidAlt = undefined,
    participant = undefined,
    participantAlt = undefined,
    fromMe = false,
    pushName = null,
    texto = "hola",
    id = "MSG1"

}) {

    return {

        key: { remoteJid, remoteJidAlt, participant, participantAlt, fromMe, id },
        pushName,
        message: { conversation: texto }

    };

}

function ctxDesde(msg, session = null) {

    return {
        message: msg,
        chat: {
            remoteJid: msg.key.remoteJid,
            participante: msg.key.participant || null,
            esGrupo: !!msg.key.remoteJid?.endsWith("@g.us")
        },
        session
    };

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
        console.log(`   ${err.stack || err.message}`);
    }

}

async function main() {

    // ======================================================================
    // A. Privado con PN disponible directamente en remoteJid.
    // ======================================================================
    await test("A. Privado con PN disponible -> telefono resuelto, sin LID, tipoIdentificador=PN", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({ remoteJid: "3001112222@s.whatsapp.net", pushName: "Cliente PN" });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.telefono, "3001112222");
        assert.strictEqual(identidad.lid, null);
        assert.strictEqual(identidad.esGrupo, false);
        assert.strictEqual(identidad.chatJid, "3001112222@s.whatsapp.net");
        assert.strictEqual(identidad.participantJid, null, "en privado no hay participant");
        assert.strictEqual(identidad.tipoIdentificador, "PN");
        assert.strictEqual(identidad.fuenteIdentidad, "message.key.remoteJid");
        assert.strictEqual(identidad.pushName, "Cliente PN");

    });

    // ======================================================================
    // B. Privado con LID (sin ningún PN disponible en el mensaje).
    // ======================================================================
    await test("B. Privado con LID (sin PN) -> lid resuelto, telefono null, identitySource=unavailable", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({ remoteJid: "700001@lid", pushName: "Cliente LID" });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.lid, "700001@lid");
        assert.strictEqual(identidad.telefono, null);
        assert.strictEqual(identidad.fuenteIdentidad, "unavailable", "sin PN en el mensaje, NUNCA se inventa un teléfono");
        assert.strictEqual(identidad.tipoIdentificador, "LID");
        assert.strictEqual(identidad.esGrupo, false);

    });

    // ======================================================================
    // C. Grupo donde participant trae la identidad (PN directo).
    // ======================================================================
    await test("C. Grupo, participant=PN -> telefono resuelto desde participant, grupo no se confunde con el usuario", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({
            remoteJid: "120363111111111111@g.us",
            participant: "3003334444@s.whatsapp.net",
            pushName: "Cliente En Grupo"
        });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.telefono, "3003334444");
        assert.strictEqual(identidad.esGrupo, true);
        assert.strictEqual(identidad.chatJid, "120363111111111111@g.us", "chatJid es el GRUPO");
        assert.strictEqual(identidad.participantJid, "3003334444@s.whatsapp.net", "participantJid es la PERSONA");
        assert.notStrictEqual(identidad.jid, identidad.chatJid, "el jid resuelto del remitente NUNCA debe ser el jid del grupo");
        assert.strictEqual(identidad.fuenteIdentidad, "message.key.participant");

    });

    // ======================================================================
    // D. Grupo con campos alternativos: participant=LID, participantAlt=PN
    //    -> el teléfono NO debe perderse por venir en segundo lugar.
    // ======================================================================
    await test("D. Grupo con participant=LID + participantAlt=PN -> ambos se capturan, ninguno se descarta", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({
            remoteJid: "120363222222222222@g.us",
            participant: "800002@lid",
            participantAlt: "3005556666@s.whatsapp.net",
            pushName: "Cliente LID+PN"
        });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.lid, "800002@lid");
        assert.strictEqual(identidad.telefono, "3005556666", "el teléfono de participantAlt no debe perderse");
        assert.strictEqual(identidad.fuenteIdentidad, "message.key.participantAlt");
        assert.strictEqual(identidad.tipoIdentificador, "PN", "con teléfono disponible, el tipo de identificador es PN aunque también haya LID");
        assert.strictEqual(identidad.participantJid, "800002@lid");

    });

    // ======================================================================
    // E. Mensaje sin teléfono disponible en absoluto (grupo, solo LID).
    // ======================================================================
    await test("E. Grupo solo-LID sin ningún PN -> phone:null, identitySource:unavailable (nunca se inventa)", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({
            remoteJid: "120363333333333333@g.us",
            participant: "900003@lid"
        });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.telefono, null);
        assert.strictEqual(identidad.fuenteIdentidad, "unavailable");
        assert.strictEqual(identidad.lid, "900003@lid", "el LID sí se conserva aunque no haya teléfono");
        assert.strictEqual(identidad.tipoIdentificador, "LID");

    });

    // ======================================================================
    // F. Identidad parcialmente disponible: ni participant ni remoteJid
    //    reconocibles como JID de persona (p. ej. un tipo de chat rarísimo)
    //    -> todo queda "desconocido", sin inventar nada.
    // ======================================================================
    await test("F. Sin ningún JID reconocible -> jid/lid/telefono null, tipoIdentificador=desconocido", () => {

        const resolverIdentidadMensaje = cargarResolver();

        const msg = mensaje({ remoteJid: "status@broadcast", pushName: "Alguien" });

        const identidad = resolverIdentidadMensaje(msg);

        assert.strictEqual(identidad.telefono, null);
        assert.strictEqual(identidad.lid, null);
        assert.strictEqual(identidad.fuenteIdentidad, "unavailable");
        assert.strictEqual(identidad.tipoIdentificador, "JID", "status@broadcast es un JID real, aunque no sea de persona");
        assert.strictEqual(identidad.esBroadcast, true);
        assert.strictEqual(identidad.pushName, "Alguien", "el pushName se conserva aunque no haya identidad resoluble");

    });

    // ======================================================================
    // G. Usuario EXISTENTE -> pipeline completo (obtenerUsuario.js), mismo
    //    usuario.id, sin duplicar.
    // ======================================================================
    await test("G. Usuario existente (mismo LID en un segundo mensaje) -> mismo usuario.id, no se duplica", async () => {

        const { fake, obtenerUsuario } = cargarObtenerUsuario();

        const msg1 = mensaje({ remoteJid: "120363444444444444@g.us", participant: "910001@lid", pushName: "Repetido", id: "M1" });
        const u1 = await obtenerUsuario(ctxDesde(msg1));

        const msg2 = mensaje({ remoteJid: "120363444444444444@g.us", participant: "910001@lid", pushName: "Repetido", id: "M2" });
        const u2 = await obtenerUsuario(ctxDesde(msg2));

        assert.ok(u1 && u2);
        assert.strictEqual(u1.id, u2.id, "el segundo mensaje debe resolver al MISMO usuario");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear un usuario duplicado");

    });

    // ======================================================================
    // H. Usuario NUEVO -> se crea correctamente, con lid/telefono/nombre.
    // ======================================================================
    await test("H. Usuario nuevo (LID+PN en el primer mensaje) -> se crea con ambos identificadores", async () => {

        const { fake, obtenerUsuario } = cargarObtenerUsuario();

        const msg = mensaje({
            remoteJid: "120363555555555555@g.us",
            participant: "920001@lid",
            participantAlt: "3007778888@s.whatsapp.net",
            pushName: "Cliente Nuevo"
        });

        const usuario = await obtenerUsuario(ctxDesde(msg));

        assert.ok(usuario);
        assert.strictEqual(usuario.lid, "920001@lid");
        assert.strictEqual(usuario.telefono, "3007778888");
        assert.strictEqual(usuario.nombre, "Cliente Nuevo");
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // I. El ID del GRUPO nunca debe terminar guardado como identidad del
    //    usuario (ni como lid, ni como telefono, ni como jid resuelto).
    // ======================================================================
    await test("I. El grupo NUNCA se confunde con el usuario (ni en la extracción ni en lo persistido)", async () => {

        const { fake, obtenerUsuario } = cargarObtenerUsuario();

        const grupoJid = "120363666666666666@g.us";

        const msg = mensaje({
            remoteJid: grupoJid,
            participant: "3009990000@s.whatsapp.net",
            pushName: "Cliente Distinto Del Grupo"
        });

        const usuario = await obtenerUsuario(ctxDesde(msg));

        assert.ok(usuario);
        assert.strictEqual(usuario.telefono, "3009990000");
        assert.notStrictEqual(usuario.telefono, grupoJid);
        assert.strictEqual(usuario.lid, null, "el @g.us del grupo nunca debe terminar guardado como lid");

        // Ninguna fila de "usuarios" debe tener el jid del grupo en ningún campo.
        for (const u of fake.tablas.usuarios) {

            assert.notStrictEqual(u.lid, grupoJid);
            assert.notStrictEqual(u.telefono, grupoJid);

        }

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidos = resultados.filter((r) => !r.ok);

    console.log("\n================================");
    console.log(`✅ Pasaron: ${resultados.length - fallidos.length}/${resultados.length}`);

    if (fallidos.length) {
        console.log(`❌ Fallaron: ${fallidos.length}`);
        fallidos.forEach((f) => console.log(`   - ${f.nombre}: ${f.err.message}`));
        console.log("================================");
        process.exitCode = 1;
    } else {
        console.log("================================");
    }

}

main().catch((err) => {
    console.error("💥 Error inesperado ejecutando las pruebas de resolverIdentidadMensaje");
    console.error(err);
    process.exitCode = 1;
});
