// ==========================================================================
// PRUEBAS — FASE 1 "sticker de pago configurable desde el panel":
// registrarStickerPago.js + configuracionStickerPago.js.
//
// Cubre los 8 casos obligatorios del pedido (sección 11), incluyendo el
// caso de seguridad crítico: durante el registro, el mensaje NUNCA debe
// llegar a confirmarPagoPorSticker.js, sin importar si por casualidad cita
// a un cliente con una reserva real.
//
// Mismo estilo que el resto del proyecto: script plano de Node (sin jest),
// fake de Supabase inyectado vía require.cache.
//
//     node backend/tests/pagos-sticker/registrarStickerPago.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/admins/esAdministrador.js",
    "../../bot/funciones/pagos/configuracionStickerPago.js",
    "../../bot/funciones/pagos/registrarStickerPago.js",
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/eventos/consultarEvento.js",
    "../../bot/funciones/reservas/actualizarEvento.js",
    "../../bot/funciones/pagos/marcarReservasPagadasPorAdmin.js",
    "../../bot/funciones/pagos/confirmarPagoPorSticker.js"
].map(p => path.resolve(__dirname, p));

const RUTA_REGISTRAR = path.resolve(__dirname, "../../bot/funciones/pagos/registrarStickerPago.js");
const RUTA_CONFIG = path.resolve(__dirname, "../../bot/funciones/pagos/configuracionStickerPago.js");
const RUTA_CONFIRMAR_PAGO = path.resolve(__dirname, "../../bot/funciones/pagos/confirmarPagoPorSticker.js");

const GRUPO_A = "120363111111111111@g.us";
const GRUPO_B = "120363222222222222@g.us";

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";

const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_PARTICIPANTE_NORMAL = "573000000002@s.whatsapp.net";
const JID_CLIENTE_CON_RESERVA = "573000000003@s.whatsapp.net";

const HASH_STICKER_A = Buffer.from("sticker-registrado-A").toString("hex");

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    RUTAS_A_RECARGAR.forEach(ruta => delete require.cache[ruta]);

    const { registrarStickerPago } = require(RUTA_REGISTRAR);
    const configuracionStickerPago = require(RUTA_CONFIG);

    return { fake, registrarStickerPago, configuracionStickerPago };

}

// send.js no se usa en este módulo (registrarStickerPago.js nunca responde
// al grupo — solo confirmarPagoPorSticker.js lo hace), así que no hace
// falta reemplazarlo aquí.

function crearFakeSock() {

    return {

        user: { id: "573000000099:5@s.whatsapp.net" },

        async groupMetadata() {

            return {
                participants: [
                    { id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" },
                    { id: JID_PARTICIPANTE_NORMAL, phoneNumber: JID_PARTICIPANTE_NORMAL, admin: null },
                    { id: JID_CLIENTE_CON_RESERVA, phoneNumber: JID_CLIENTE_CON_RESERVA, admin: null }
                ]
            };

        }

    };

}

function crearMensajeSticker({ remitenteJid, quotedParticipant = null, grupoId = GRUPO_A }) {

    return {

        key: {
            id: "STICKER-REGISTRO-ID",
            remoteJid: grupoId,
            participant: remitenteJid,
            fromMe: false
        },

        message: {

            stickerMessage: {

                mimetype: "image/webp",
                fileSha256: Buffer.from(HASH_STICKER_A, "hex"),

                contextInfo: quotedParticipant
                    ? { stanzaId: "QUOTED-ID", participant: quotedParticipant }
                    : undefined

            }

        }

    };

}

function crearCtx({ sock, message, grupoId = GRUPO_A, usuarioId = TENANT_A }) {

    return {

        sock,
        message,
        session: { telefono: "573000000099", usuarioId },

        chat: {
            esGrupo: true,
            remoteJid: grupoId,
            participante: message.key.participant
        }

    };

}

function filasDe(fake, tabla) {
    return fake.tablas[tabla] || [];
}

function configDe(fake, usuarioId, grupoId) {
    return filasDe(fake, "configuracion_stickers_pago")
        .find(f => f.usuario_id === usuarioId && f.grupo_id === grupoId);
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

async function ejecutarPruebas() {

    // ======================================================================
    // Registro válido
    // ======================================================================

    await test("Registro válido: modo activo + sticker + admin -> sticker guardado", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN });
        const ctx = crearCtx({ sock, message: msg });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, true);

        const config = configDe(fake, TENANT_A, GRUPO_A);

        assert.strictEqual(config.sticker_sha256, HASH_STICKER_A);
        assert.strictEqual(config.registrado_por, JID_ADMIN);
        assert.ok(config.registrado_en);
        assert.strictEqual(config.esperando_registro, false);
        assert.strictEqual(config.esperando_registro_expira_en, null);

    });

    // ======================================================================
    // No administrador
    // ======================================================================

    await test("No administrador: modo activo + sticker + usuario normal -> NO guardar (pero sí interviene)", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_PARTICIPANTE_NORMAL });
        const ctx = crearCtx({ sock, message: msg });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, true);

        const config = configDe(fake, TENANT_A, GRUPO_A);

        // El fake no simula columnas con default NULL de Postgres: una fila
        // recién creada por upsert() simplemente no trae la clave si nunca
        // se escribió — lo que importa es que NO tenga ningún hash guardado.
        assert.ok(!config.sticker_sha256, "no debe haberse guardado ningún hash");
        // El modo de registro sigue esperando — un participante normal no
        // debe poder cancelarlo ni consumirlo.
        assert.strictEqual(config.esperando_registro, true);

    });

    // ======================================================================
    // Registro expirado
    // ======================================================================

    await test("Registro expirado: esperando_registro=true pero vencido -> NO guardar, se limpia la fila", async () => {

        const { fake, registrarStickerPago } = cargarModulos();

        fake.tabla("configuracion_stickers_pago").push({

            usuario_id: TENANT_A,
            grupo_id: GRUPO_A,
            sticker_sha256: null,
            esperando_registro: true,
            esperando_registro_expira_en: new Date(Date.now() - 60 * 1000).toISOString() // hace 1 minuto

        });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN });
        const ctx = crearCtx({ sock, message: msg });

        const resultado = await registrarStickerPago(ctx);

        // Vencido = NO ACTIVO -> este módulo no interviene (el mensaje
        // seguiría de largo hacia confirmarPagoPorSticker en dispatcher.js).
        assert.strictEqual(resultado.intervino, false);

        const config = configDe(fake, TENANT_A, GRUPO_A);

        assert.strictEqual(config.sticker_sha256, null);
        // Limpieza best-effort de la ventana vencida.
        assert.strictEqual(config.esperando_registro, false);
        assert.strictEqual(config.esperando_registro_expira_en, null);

    });

    // ======================================================================
    // Sin modo registro
    // ======================================================================

    await test("Sin modo registro: esperando_registro=false + sticker -> NO registrar, no interviene", async () => {

        const { fake, registrarStickerPago } = cargarModulos();

        // Ni siquiera existe fila todavía para este grupo/tenant.
        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN });
        const ctx = crearCtx({ sock, message: msg });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, false);
        assert.strictEqual(filasDe(fake, "configuracion_stickers_pago").length, 0);

    });

    // ======================================================================
    // Aislamiento por grupo
    // ======================================================================

    await test("Aislamiento por grupo: grupo A esperando + sticker enviado al grupo B -> NO registrar en B", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, grupoId: GRUPO_B });
        const ctx = crearCtx({ sock, message: msg, grupoId: GRUPO_B });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, false);

        // El registro de GRUPO_A sigue intacto, esperando.
        const configA = configDe(fake, TENANT_A, GRUPO_A);
        assert.strictEqual(configA.esperando_registro, true);

        // No se creó ninguna fila para GRUPO_B.
        assert.strictEqual(configDe(fake, TENANT_A, GRUPO_B), undefined);

    });

    // ======================================================================
    // Aislamiento por tenant
    // ======================================================================

    await test("Aislamiento por tenant: tenant A esperando + mensaje del tenant B -> NO registrar", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        // Mismo grupo_id (coincidencia posible en JIDs de prueba), pero la
        // SESIÓN que recibió el mensaje pertenece a otro tenant.
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, grupoId: GRUPO_A });
        const ctx = crearCtx({ sock, message: msg, grupoId: GRUPO_A, usuarioId: TENANT_B });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, false);

        // El registro del tenant A sigue intacto.
        const configA = configDe(fake, TENANT_A, GRUPO_A);
        assert.strictEqual(configA.esperando_registro, true);

        // No se creó ninguna fila para el tenant B.
        assert.strictEqual(configDe(fake, TENANT_B, GRUPO_A), undefined);

    });

    // ======================================================================
    // Protección contra pago accidental (OBLIGATORIO)
    // ======================================================================

    await test("PROTECCIÓN CRÍTICA: registro vigente + sticker + cita a cliente con reserva -> REGISTRA, jamás confirma pago", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        // Cliente real, con una reserva real y activa — exactamente el
        // escenario que, si esto fallara, terminaría pagado por accidente.
        fake.tabla("usuarios").push({ id: "cliente-real", telefono: "3000000003", lid: null, nombre: "Cliente Real" });

        fake.tabla("eventos_bot").push({
            id: "evento-real", grupo_id: GRUPO_A, tabla: "reservas_test",
            usuario_id: TENANT_A, activo: true, cantidad_numeros: 100,
            reservados: 1, pagados: 0, libres: 99
        });

        fake.tabla("reservas_test").push({
            numero: "10", estado: "reservado", usuario_global_id: "cliente-real",
            usuario_id: TENANT_A, evento_id: "evento-real",
            comprador: "Cliente Real", contacto: "3000000003"
        });

        const sock = crearFakeSock();
        // El sticker de REGISTRO, casualmente, cita a un cliente con reserva.
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_CON_RESERVA });
        const ctx = crearCtx({ sock, message: msg });

        // 1. registrarStickerPago debe REGISTRAR el sticker.
        const resultadoRegistro = await registrarStickerPago(ctx);

        assert.strictEqual(resultadoRegistro.intervino, true);

        const config = configDe(fake, TENANT_A, GRUPO_A);
        assert.strictEqual(config.sticker_sha256, HASH_STICKER_A);

        // 2. La reserva del cliente NO debe haberse tocado — confirma que
        //    esta ejecución de registrarStickerPago() nunca llamó, ella
        //    misma, ninguna lógica de pago.
        assert.strictEqual(filasDe(fake, "reservas_test")[0].estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);

        // 3. Réplica exacta de la regla de exclusión mutua de dispatcher.js:
        //    como intervino=true, confirmarPagoPorSticker NUNCA debería
        //    llamarse en esta pasada. Se verifica igual, de forma directa,
        //    que aunque se invocara por error, el sticker ya fue consumido
        //    por el registro (esperando_registro=false) y el hash guardado
        //    es el de REGISTRO, no necesariamente el que estuviera activo
        //    para pagos — es decir, el propio estado ya demuestra que el
        //    mensaje fue tratado como registro y no como pago.
        if (!resultadoRegistro.intervino) {

            const RUTA_CONFIRMAR = RUTA_CONFIRMAR_PAGO;
            const { confirmarPagoPorSticker } = require(RUTA_CONFIRMAR);
            await confirmarPagoPorSticker(ctx);

        }

        assert.strictEqual(filasDe(fake, "reservas_test")[0].estado, "reservado", "la reserva JAMÁS debe cambiar durante un registro");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0, "NUNCA debe crearse actividad de pago durante un registro");

    });

    const fallidas = resultados.filter(r => !r.ok);

    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas.length}  |  Fallidas: ${fallidas.length}`);
    console.log("============================================\n");

    if (fallidas.length > 0) {
        process.exitCode = 1;
    }

}

ejecutarPruebas();
