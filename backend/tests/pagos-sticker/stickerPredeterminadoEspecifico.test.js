// ==========================================================================
// PRUEBAS — corrección arquitectónica: sticker de pago PREDETERMINADO
// (por tenant, grupo_id NULL) + ESPECÍFICO (por grupo, grupo_id = JID
// real), con prioridad específico > predeterminado.
//
// Complementa (sin repetir) confirmarPagoPorSticker.test.js y
// registrarStickerPago.test.js, que ya cubren el caso de un solo nivel
// (equivalente al "específico" de esta fase) y la protección crítica de
// registro. Aquí se prueba exclusivamente la parte NUEVA: resolución de
// dos niveles, coexistencia, y su registro.
//
//     node backend/tests/pagos-sticker/stickerPredeterminadoEspecifico.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_SEND = path.resolve(__dirname, "../../services/baileys/send.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/admins/esAdministrador.js",
    "../../bot/funciones/eventos/consultarEvento.js",
    "../../bot/funciones/reservas/actualizarEvento.js",
    "../../bot/funciones/pagos/marcarReservasPagadasPorAdmin.js",
    "../../bot/funciones/pagos/configuracionStickerPago.js",
    "../../bot/funciones/pagos/registrarStickerPago.js",
    "../../bot/funciones/pagos/confirmarPagoPorSticker.js"
].map(p => path.resolve(__dirname, p));

const RUTA_CONFIG = path.resolve(__dirname, "../../bot/funciones/pagos/configuracionStickerPago.js");
const RUTA_REGISTRAR = path.resolve(__dirname, "../../bot/funciones/pagos/registrarStickerPago.js");
const RUTA_CONFIRMAR = path.resolve(__dirname, "../../bot/funciones/pagos/confirmarPagoPorSticker.js");

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";

const GRUPO_A = "120363111111111111@g.us";
const GRUPO_B = "120363222222222222@g.us";

const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_CLIENTE = "573000000002@s.whatsapp.net";

const HASH_PREDETERMINADO = Buffer.from("sticker-predeterminado-tenant-A").toString("hex");
const HASH_ESPECIFICO_A = Buffer.from("sticker-especifico-grupo-A").toString("hex");

function cargarModulos() {

    const fake = crearFakeSupabase();
    const envios = [];

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE, filename: RUTA_SUPABASE, loaded: true, exports: fake.client
    };

    require.cache[RUTA_SEND] = {
        id: RUTA_SEND, filename: RUTA_SEND, loaded: true,
        exports: { async sendMessage({ jid, text }) { envios.push({ jid, text }); return true; } }
    };

    RUTAS_A_RECARGAR.forEach(ruta => delete require.cache[ruta]);

    const configuracionStickerPago = require(RUTA_CONFIG);
    const { registrarStickerPago } = require(RUTA_REGISTRAR);
    const { confirmarPagoPorSticker } = require(RUTA_CONFIRMAR);

    return { fake, envios, configuracionStickerPago, registrarStickerPago, confirmarPagoPorSticker };

}

function crearFakeSock() {

    return {
        user: { id: "573000000099:5@s.whatsapp.net" },
        async groupMetadata() {
            return { participants: [{ id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" }] };
        }
    };

}

function crearMensajeSticker({ remitenteJid, quotedParticipant = null, hashHex, grupoId }) {

    return {
        key: { id: "MSG-ID", remoteJid: grupoId, participant: remitenteJid, fromMe: false },
        message: {
            stickerMessage: {
                mimetype: "image/webp",
                fileSha256: Buffer.from(hashHex, "hex"),
                contextInfo: quotedParticipant ? { stanzaId: "Q", participant: quotedParticipant } : undefined
            }
        }
    };

}

function crearCtx({ sock, message, grupoId, usuarioId }) {

    return {
        sock,
        message,
        session: { telefono: "573000000099", usuarioId },
        chat: { esGrupo: true, remoteJid: grupoId, participante: message.key.participant }
    };

}

function filasDe(fake, tabla) {
    return fake.tablas[tabla] || [];
}

function sembrarEventoYReserva(fake, { usuarioId, grupoId, eventoId = "evento-1", tabla = "reservas_test" }) {

    fake.tabla("usuarios").push({ id: "cliente-1", telefono: "3000000002", lid: null, nombre: "Cliente" });

    fake.tabla("eventos_bot").push({
        id: eventoId, grupo_id: grupoId, tabla, usuario_id: usuarioId,
        activo: true, cantidad_numeros: 100, reservados: 1, pagados: 0, libres: 99
    });

    fake.tabla(tabla).push({
        numero: "10", estado: "reservado", usuario_global_id: "cliente-1",
        usuario_id: usuarioId, evento_id: eventoId, comprador: "Cliente", contacto: "3000000002"
    });

    return tabla;

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
    // Sticker predeterminado — grupo SIN específico usa el general
    // ======================================================================

    await test("Sin específico -> resolverStickerPago devuelve el predeterminado", async () => {

        const { fake, configuracionStickerPago } = cargarModulos();

        fake.tabla("configuracion_stickers_pago").push({
            usuario_id: TENANT_A, grupo_id: null, sticker_sha256: HASH_PREDETERMINADO,
            esperando_registro: false, esperando_registro_expira_en: null
        });

        const resuelto = await configuracionStickerPago.resolverStickerPago({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        assert.ok(resuelto);
        assert.strictEqual(resuelto.nivel, "predeterminado");
        assert.strictEqual(resuelto.hash, HASH_PREDETERMINADO);

    });

    // ======================================================================
    // Sticker específico — prioridad sobre el predeterminado
    // ======================================================================

    await test("Con específico -> resolverStickerPago prioriza el específico sobre el predeterminado", async () => {

        const { fake, configuracionStickerPago } = cargarModulos();

        fake.tabla("configuracion_stickers_pago").push(
            { usuario_id: TENANT_A, grupo_id: null, sticker_sha256: HASH_PREDETERMINADO, esperando_registro: false, esperando_registro_expira_en: null },
            { usuario_id: TENANT_A, grupo_id: GRUPO_A, sticker_sha256: HASH_ESPECIFICO_A, esperando_registro: false, esperando_registro_expira_en: null }
        );

        const resuelto = await configuracionStickerPago.resolverStickerPago({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        assert.strictEqual(resuelto.nivel, "especifico");
        assert.strictEqual(resuelto.hash, HASH_ESPECIFICO_A);

        // El OTRO grupo del mismo tenant, sin específico propio, sigue
        // usando el predeterminado — no se contamina con el de GRUPO_A.
        const resueltoGrupoB = await configuracionStickerPago.resolverStickerPago({ usuarioId: TENANT_A, grupoId: GRUPO_B });

        assert.strictEqual(resueltoGrupoB.nivel, "predeterminado");
        assert.strictEqual(resueltoGrupoB.hash, HASH_PREDETERMINADO);

    });

    // ======================================================================
    // Eliminar específico -> vuelve a predeterminado
    // ======================================================================

    await test("Al limpiar el específico del grupo, vuelve a resolver el predeterminado", async () => {

        const { fake, configuracionStickerPago } = cargarModulos();

        fake.tabla("configuracion_stickers_pago").push(
            { usuario_id: TENANT_A, grupo_id: null, sticker_sha256: HASH_PREDETERMINADO, esperando_registro: false, esperando_registro_expira_en: null },
            { usuario_id: TENANT_A, grupo_id: GRUPO_A, sticker_sha256: HASH_ESPECIFICO_A, esperando_registro: false, esperando_registro_expira_en: null }
        );

        await configuracionStickerPago.limpiarStickerConfigurado({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const resuelto = await configuracionStickerPago.resolverStickerPago({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        assert.strictEqual(resuelto.nivel, "predeterminado");
        assert.strictEqual(resuelto.hash, HASH_PREDETERMINADO);

        // El predeterminado en sí sigue intacto (limpiar el específico
        // NUNCA toca el otro nivel).
        const config = filasDe(fake, "configuracion_stickers_pago");
        assert.strictEqual(config.find(f => f.grupo_id === null).sticker_sha256, HASH_PREDETERMINADO);
        assert.strictEqual(config.find(f => f.grupo_id === GRUPO_A).sticker_sha256, null);

    });

    // ======================================================================
    // Sin ninguno de los dos -> NO confirmar pago (extremo a extremo)
    // ======================================================================

    await test("Sin predeterminado ni específico -> confirmarPagoPorSticker no ejecuta ninguna acción", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();

        sembrarEventoYReserva(fake, { usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE, hashHex: HASH_ESPECIFICO_A, grupoId: GRUPO_A });
        const ctx = crearCtx({ sock, message: msg, grupoId: GRUPO_A, usuarioId: TENANT_A });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(envios.length, 0);
        assert.strictEqual(filasDe(fake, "reservas_test")[0].estado, "reservado");

    });

    // ======================================================================
    // Aislamiento entre tenants
    // ======================================================================

    await test("Aislamiento: el predeterminado del tenant A no sirve para el tenant B", async () => {

        const { fake, configuracionStickerPago } = cargarModulos();

        fake.tabla("configuracion_stickers_pago").push(
            { usuario_id: TENANT_A, grupo_id: null, sticker_sha256: HASH_PREDETERMINADO, esperando_registro: false, esperando_registro_expira_en: null }
        );

        const resuelto = await configuracionStickerPago.resolverStickerPago({ usuarioId: TENANT_B, grupoId: GRUPO_A });

        assert.strictEqual(resuelto, null);

    });

    // ======================================================================
    // Registro del predeterminado — el admin lo envía en CUALQUIER grupo
    // ======================================================================

    await test("Registro del predeterminado: capturado sin importar en qué grupo real se envía el sticker", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });

        const sock = crearFakeSock();
        // El admin envía el sticker en GRUPO_B (no en el que sea, el
        // predeterminado no depende de un grupo concreto).
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, hashHex: HASH_PREDETERMINADO, grupoId: GRUPO_B });
        const ctx = crearCtx({ sock, message: msg, grupoId: GRUPO_B, usuarioId: TENANT_A });

        const resultado = await registrarStickerPago(ctx);

        assert.strictEqual(resultado.intervino, true);

        const config = filasDe(fake, "configuracion_stickers_pago").find(f => f.usuario_id === TENANT_A && f.grupo_id === null);

        assert.strictEqual(config.sticker_sha256, HASH_PREDETERMINADO);

    });

    // ======================================================================
    // Registro específico tiene prioridad sobre un registro predeterminado
    // vigente simultáneo (caso borde: dos pestañas del panel)
    // ======================================================================

    await test("Si ambos niveles están esperando a la vez, el sticker se captura en el ESPECÍFICO del grupo", async () => {

        const { fake, registrarStickerPago, configuracionStickerPago } = cargarModulos();

        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });
        await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, hashHex: HASH_ESPECIFICO_A, grupoId: GRUPO_A });
        const ctx = crearCtx({ sock, message: msg, grupoId: GRUPO_A, usuarioId: TENANT_A });

        await registrarStickerPago(ctx);

        const filas = filasDe(fake, "configuracion_stickers_pago");

        assert.strictEqual(filas.find(f => f.grupo_id === GRUPO_A).sticker_sha256, HASH_ESPECIFICO_A);
        // El predeterminado sigue esperando — no se tocó.
        assert.strictEqual(filas.find(f => f.grupo_id === null).esperando_registro, true);

    });

    // ======================================================================
    // activarModoRegistro no colisiona entre los dos niveles del mismo tenant
    // ======================================================================

    await test("activarModoRegistro: predeterminado y específico coexisten sin pisarse", async () => {

        const { fake, configuracionStickerPago } = cargarModulos();

        const r1 = await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });
        const r2 = await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        assert.strictEqual(r1.ok, true);
        assert.strictEqual(r2.ok, true);
        assert.strictEqual(filasDe(fake, "configuracion_stickers_pago").length, 2);

        // Reactivar el predeterminado (segunda vez) reutiliza la MISMA
        // fila (insert->23505->update), no crea una tercera.
        const r3 = await configuracionStickerPago.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });

        assert.strictEqual(r3.ok, true);
        assert.strictEqual(filasDe(fake, "configuracion_stickers_pago").length, 2);

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
