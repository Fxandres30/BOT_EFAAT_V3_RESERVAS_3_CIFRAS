// ==========================================================================
// PRUEBAS — FASE 3 "confirmación de pago por sticker de administrador".
// Cubre los 11 casos obligatorios del pedido, extremo a extremo:
//
//     STICKER + ADMIN + CITA -> reservado -> pagado (atómico, idempotente)
//
// Actualizado en FASE 1 (sticker configurable desde el panel): el hash
// autorizado ya NO se fija por STICKER_PAGO_SHA256 (variable de entorno) —
// se siembra como fila de "configuracion_stickers_pago" en el fake de
// Supabase, exactamente como lo haría registrarStickerPago.js en
// producción.
//
// Actualizado en la fase "silencio del sticker": confirmarPagoPorSticker.js
// YA NO envía ningún mensaje de WhatsApp (ni al confirmar, ni "ya estaba
// pagado", ni "sin reservas") — procesa la base de datos y nada más. El
// módulo ya NO importa services/baileys/send.js en absoluto. Aun así, este
// archivo SIGUE inyectando un fake de esa ruta (RUTA_SEND) a propósito:
// no porque el código bajo prueba lo necesite, sino como guardia de
// regresión — si alguna vez alguien reintrodujera la importación/llamada,
// `envios.length` dejaría de ser 0 y estas pruebas fallarían de inmediato.
//
// Mismo estilo que el resto del proyecto: script plano de Node (sin jest),
// fake de Supabase inyectado vía require.cache.
//
//     node backend/tests/pagos-sticker/confirmarPagoPorSticker.test.js
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
    "../../bot/funciones/pagos/confirmarPagoPorSticker.js"
].map(p => path.resolve(__dirname, p));

const RUTA_CONFIRMAR_PAGO = path.resolve(__dirname, "../../bot/funciones/pagos/confirmarPagoPorSticker.js");

const GRUPO_ID = "120363111111111111@g.us";
const OTRO_GRUPO_ID = "120363222222222222@g.us";

const USUARIO_ID_TENANT = "tenant-1";

const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_CLIENTE_1 = "573000000002@s.whatsapp.net";
const JID_CLIENTE_2 = "573000000003@s.whatsapp.net";
const JID_SUPERADMIN = "573000000004@s.whatsapp.net";

const TELEFONO_SESION_BOT = "573000000099";
const JID_BOT_CON_DISPOSITIVO = `${TELEFONO_SESION_BOT}:5@s.whatsapp.net`;

const HASH_STICKER_PAGO = Buffer.from("STICKER-DE-PAGO-OFICIAL").toString("hex");
const HASH_STICKER_OTRO = Buffer.from("sticker-cualquiera").toString("hex");

function cargarModulos() {

    const fake = crearFakeSupabase();
    const envios = [];

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    require.cache[RUTA_SEND] = {
        id: RUTA_SEND,
        filename: RUTA_SEND,
        loaded: true,
        exports: {
            async sendMessage({ jid, text }) {
                envios.push({ jid, text });
                return true;
            }
        }
    };

    RUTAS_A_RECARGAR.forEach(ruta => delete require.cache[ruta]);

    const { confirmarPagoPorSticker } = require(RUTA_CONFIRMAR_PAGO);

    return { fake, envios, confirmarPagoPorSticker };

}

function crearFakeSock(participants) {

    return {

        user: { id: JID_BOT_CON_DISPOSITIVO },

        async groupMetadata(grupoId) {

            return {
                id: grupoId,
                participants: participants || [
                    { id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" },
                    { id: JID_CLIENTE_1, phoneNumber: JID_CLIENTE_1, admin: null },
                    { id: JID_CLIENTE_2, phoneNumber: JID_CLIENTE_2, admin: null },
                    { id: JID_SUPERADMIN, phoneNumber: JID_SUPERADMIN, admin: "superadmin" }
                ]
            };

        }

    };

}

function crearMensajeSticker({

    remitenteJid,
    quotedParticipant = null,
    hashHex = HASH_STICKER_PAGO,
    grupoId = GRUPO_ID

}) {

    return {

        key: {
            id: "STICKER-MSG-ID",
            remoteJid: grupoId,
            participant: remitenteJid,
            fromMe: false
        },

        message: {

            stickerMessage: {

                mimetype: "image/webp",
                fileSha256: Buffer.from(hashHex, "hex"),

                contextInfo: quotedParticipant
                    ? { stanzaId: "QUOTED-ID", participant: quotedParticipant }
                    : undefined

            }

        }

    };

}

function crearCtx({ sock, message, grupoId = GRUPO_ID, usuarioId = USUARIO_ID_TENANT }) {

    return {

        sock,
        message,
        session: { telefono: TELEFONO_SESION_BOT, usuarioId },

        chat: {
            esGrupo: true,
            remoteJid: grupoId,
            participante: message.key.participant
        }

    };

}

// FASE 1: siembra la fila de configuracion_stickers_pago con el hash ya
// registrado — exactamente el estado en el que registrarStickerPago.js
// dejaría la fila tras una captura exitosa (esperando_registro=false,
// sticker_sha256 con valor).
function sembrarStickerConfigurado(fake, {

    usuarioId = USUARIO_ID_TENANT,
    grupoId = GRUPO_ID,
    sha256 = HASH_STICKER_PAGO

} = {}) {

    fake.tabla("configuracion_stickers_pago").push({

        usuario_id: usuarioId,
        grupo_id: grupoId,
        sticker_sha256: sha256,
        registrado_en: new Date().toISOString(),
        registrado_por: JID_ADMIN,
        esperando_registro: false,
        esperando_registro_expira_en: null

    });

}

// Escenario base: un evento activo, con la tabla dinámica del evento, la
// identidad de los dos clientes ya conocidas, y el sticker de pago YA
// registrado en Supabase para (tenant-1, GRUPO_ID) — salvo que se pida lo
// contrario explícitamente.
function sembrarEscenario(fake, { conVariasReservasCliente1 = false, conStickerConfigurado = true } = {}) {

    if (conStickerConfigurado) {
        sembrarStickerConfigurado(fake);
    }

    fake.tabla("usuarios").push(
        { id: "cliente-1", telefono: "3000000002", lid: null, nombre: "Cliente Uno" },
        { id: "cliente-2", telefono: "3000000003", lid: null, nombre: "Cliente Dos" }
    );

    fake.tabla("eventos_bot").push({

        id: "evento-1",
        grupo_id: GRUPO_ID,
        tabla: "reservas_test_precio5",
        usuario_id: USUARIO_ID_TENANT,
        activo: true,
        cantidad_numeros: 100,
        reservados: 0,
        pagados: 0,
        libres: 100

    });

    const filasReserva = [{

        numero: "27",
        estado: "reservado",
        usuario_global_id: "cliente-1",
        usuario_id: USUARIO_ID_TENANT,
        evento_id: "evento-1",
        comprador: "Cliente Uno",
        contacto: "3000000002"

    }];

    if (conVariasReservasCliente1) {

        filasReserva.push({

            numero: "45",
            estado: "reservado",
            usuario_global_id: "cliente-1",
            usuario_id: USUARIO_ID_TENANT,
            evento_id: "evento-1",
            comprador: "Cliente Uno",
            contacto: "3000000002"

        });

    }

    fake.tabla("reservas_test_precio5").push(...filasReserva);

    return { eventoId: "evento-1", tabla: "reservas_test_precio5" };

}

function filasDe(fake, tabla) {
    return fake.tablas[tabla] || [];
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
    // CASO 1 — admin + sticker correcto + cita a cliente con 1 reserva
    // ======================================================================

    await test("CASO 1: admin cita a cliente con reserva pendiente -> reservado pasa a pagado", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        const filas = filasDe(fake, "reservas_test_precio5");

        assert.strictEqual(filas.find(f => f.numero === "27").estado, "pagado");
        assert.ok(filas.find(f => f.numero === "27").fecha_pago);

        // Auditoría con el ADMIN real, nunca 'bot'.
        const actividad = filasDe(fake, "reservas_actividad");
        assert.strictEqual(actividad.length, 1);
        assert.strictEqual(actividad[0].tipo, "pagado");
        assert.strictEqual(actividad[0].realizado_por, JID_ADMIN);
        assert.notStrictEqual(actividad[0].realizado_por, "bot");

        // Regla de silencio: la BD se actualizó (arriba), pero JAMÁS se
        // envía nada a WhatsApp como consecuencia del sticker.
        assert.strictEqual(envios.length, 0);

        // eventos_bot recalculado vía actualizarEvento.js (no duplicado).
        const evento = filasDe(fake, "eventos_bot")[0];
        assert.strictEqual(evento.pagados, 1);
        assert.strictEqual(evento.reservados, 0);

    });

    // ======================================================================
    // CASO 2 — varias reservas pendientes del mismo cliente
    // ======================================================================

    await test("CASO 2: cliente con varias reservas -> TODAS pasan a pagado", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake, { conVariasReservasCliente1: true });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        const filas = filasDe(fake, "reservas_test_precio5");

        assert.strictEqual(filas.filter(f => f.usuario_global_id === "cliente-1" && f.estado === "pagado").length, 2);

        const actividad = filasDe(fake, "reservas_actividad");
        assert.strictEqual(actividad.length, 2);

        // Silencio: 4 filas hubieran calzado, 0 mensajes de todos modos.
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // CASO 3 — sticker incorrecto
    // ======================================================================

    await test("CASO 3: sticker incorrecto -> IGNORAR, nada cambia", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedParticipant: JID_CLIENTE_1,
            hashHex: HASH_STICKER_OTRO
        });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // CASO 4 — usuario normal envía el sticker correcto
    // ======================================================================

    await test("CASO 4: participante normal (no admin) envía el sticker correcto -> IGNORAR", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_CLIENTE_2, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // CASO 5 — admin manda el sticker sin citar
    // ======================================================================

    await test("CASO 5: admin envía sticker correcto SIN citar -> NO HACER NADA", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN }); // sin quotedParticipant
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);

        // Nunca se resuelve/crea identidad para el REMITENTE del sticker.
        assert.strictEqual(filasDe(fake, "usuarios").length, 2); // solo los 2 sembrados

    });

    // ======================================================================
    // CASO 6 — admin cita a otro administrador
    // ======================================================================

    await test("CASO 6: admin cita a otro administrador SIN reservas -> no marca nada de forma incorrecta", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        // El superadmin citado no tiene ninguna fila en la tabla del evento.
        fake.tabla("usuarios").push({ id: "superadmin-1", telefono: "3000000004", lid: null, nombre: "Otro Admin" });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_SUPERADMIN });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        // Nada de "cliente-1" se tocó; "sin_reservas" tampoco envía nada.
        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // CASO 7 — admin cita al propio bot
    // ======================================================================

    await test("CASO 7: admin cita un mensaje del propio BOT -> no se resuelve como cliente, nada cambia", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedParticipant: JID_BOT_CON_DISPOSITIVO
        });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);

        // No se crea un "usuario" fantasma para el bot.
        assert.strictEqual(filasDe(fake, "usuarios").length, 2);

    });

    // ======================================================================
    // CASO 8 — cliente ya pagado
    // ======================================================================

    await test("CASO 8: cliente ya estaba pagado -> no se vuelve a modificar, mensaje distinto", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        // Ya pagado de antemano (p. ej. confirmado por el panel).
        filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado = "pagado";
        filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").fecha_pago = "2026-01-01";

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        // "ya_pagado" tampoco envía nada — silencio total del flujo.
        assert.strictEqual(envios.length, 0);
        // La fecha de pago original no se toca de nuevo.
        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").fecha_pago, "2026-01-01");

    });

    // ======================================================================
    // CASO 9 — cliente sin reservas
    // ======================================================================

    await test("CASO 9: cliente sin ninguna reserva -> no modifica nada", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        // Se cita a cliente-2, que no tiene ninguna fila en la tabla.
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_2 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0);
        // La reserva del OTRO cliente (cliente-1) sigue intacta.
        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");

    });

    // ======================================================================
    // CASO 10 — cliente con reservas en OTRO evento
    // ======================================================================

    await test("CASO 10: cliente tiene reservas en otro evento -> no se tocan", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        // Reserva del MISMO cliente pero en un evento_id distinto (misma
        // tabla física, reutilizada entre ciclos — mismo criterio que
        // reservarNumeros.js: evento_id es lo que distingue el ciclo).
        fake.tabla("reservas_test_precio5").push({

            numero: "88",
            estado: "reservado",
            usuario_global_id: "cliente-1",
            usuario_id: USUARIO_ID_TENANT,
            evento_id: "evento-VIEJO",
            comprador: "Cliente Uno",
            contacto: "3000000002"

        });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        const filas = filasDe(fake, "reservas_test_precio5");

        // La del evento ACTIVO sí se paga...
        assert.strictEqual(filas.find(f => f.numero === "27").estado, "pagado");

        // ...la del evento VIEJO se queda exactamente como estaba.
        assert.strictEqual(filas.find(f => f.numero === "88").estado, "reservado");

        const actividad = filasDe(fake, "reservas_actividad");
        assert.strictEqual(actividad.length, 1);
        assert.strictEqual(actividad[0].numero, "27");

    });

    // ======================================================================
    // CASO 11 — dos stickers seguidos (idempotencia real, no solo el estado)
    // ======================================================================

    await test("CASO 11: dos stickers seguidos -> la 2a vez no duplica cambios ni actividad", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });

        await confirmarPagoPorSticker(crearCtx({ sock, message: { ...msg, key: { ...msg.key, id: "STICKER-1" } } }));
        await confirmarPagoPorSticker(crearCtx({ sock, message: { ...msg, key: { ...msg.key, id: "STICKER-2" } } }));

        const actividad = filasDe(fake, "reservas_actividad");

        assert.strictEqual(actividad.length, 1, "la actividad NO debe duplicarse en el segundo sticker");
        // Silencio en las DOS pasadas — la primera confirma, la segunda
        // detecta "ya_pagado"; ninguna de las dos envía nada.
        assert.strictEqual(envios.length, 0);

        // El contador de eventos_bot tampoco se desajusta con el segundo envío.
        const evento = filasDe(fake, "eventos_bot")[0];
        assert.strictEqual(evento.pagados, 1);

    });

    // ======================================================================
    // Extra — sin evento activo en el grupo -> no se modifica nada
    // ======================================================================

    await test("EXTRA: sin evento activo para el grupo -> no se modifica nada", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        // Sin sembrarEscenario(): no hay eventos_bot ni tabla de reservas,
        // pero el sticker SÍ está configurado (para aislar exactamente lo
        // que se prueba: la ausencia de evento, no la ausencia de sticker).
        sembrarStickerConfigurado(fake);
        fake.tabla("usuarios").push({ id: "cliente-1", telefono: "3000000002", lid: null, nombre: "Cliente Uno" });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(envios.length, 0);
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);

    });

    // ======================================================================
    // Extra — sin configuración de sticker en Supabase -> nunca ejecuta nada
    // ======================================================================

    await test("EXTRA: sin sticker configurado en Supabase para este grupo/tenant -> nunca ejecuta ninguna acción (falla cerrado)", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        // conStickerConfigurado:false -> ninguna fila en configuracion_stickers_pago.
        sembrarEscenario(fake, { conStickerConfigurado: false });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(envios.length, 0);
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);

    });

    // ======================================================================
    // Extra — sticker configurado para OTRO tenant no sirve para este
    // ======================================================================

    await test("EXTRA: sticker configurado para OTRO tenant -> no se usa como fallback (falla cerrado)", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake, { conStickerConfigurado: false });
        // El hash SÍ existe, pero para un tenant distinto.
        sembrarStickerConfigurado(fake, { usuarioId: "otro-tenant" });

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });
        const ctx = crearCtx({ sock, message: msg });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // Extra — grupo distinto no interfiere (defensa adicional de aislamiento)
    // ======================================================================

    await test("EXTRA: un sticker en OTRO grupo nunca toca el evento de este grupo", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({
            remitenteJid: JID_ADMIN,
            quotedParticipant: JID_CLIENTE_1,
            grupoId: OTRO_GRUPO_ID
        });
        const ctx = crearCtx({ sock, message: msg, grupoId: OTRO_GRUPO_ID });

        await confirmarPagoPorSticker(ctx);

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "reservado");
        assert.strictEqual(envios.length, 0);

    });

    // ======================================================================
    // REGLA DE SILENCIO — pedida explícitamente: el sticker válido debe
    // actualizar la BD pero JAMÁS llamar a ninguna función de envío de
    // mensaje, sin importar si actualizó 0, 1 o varios números.
    // ======================================================================

    await test("SILENCIO: sticker válido actualiza 1 número -> BD cambia, CERO llamadas de envío", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake); // 1 reserva de cliente-1 ("27")

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });

        await confirmarPagoPorSticker(crearCtx({ sock, message: msg }));

        assert.strictEqual(filasDe(fake, "reservas_test_precio5").find(f => f.numero === "27").estado, "pagado", "la BD SÍ debe actualizarse");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 1, "la auditoría SÍ debe registrarse");
        assert.strictEqual(envios.length, 0, "no debe llamarse ninguna función de envío de mensaje");

    });

    await test("SILENCIO: sticker válido actualiza 4 números -> BD cambia, CERO llamadas de envío", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake, { conVariasReservasCliente1: true }); // 2 reservas...

        // ...se agregan 2 más para llegar a 4 en total, mismo cliente.
        fake.tabla("reservas_test_precio5").push(
            { numero: "60", estado: "reservado", usuario_global_id: "cliente-1", usuario_id: USUARIO_ID_TENANT, evento_id: "evento-1", comprador: "Cliente Uno", contacto: "3000000002" },
            { numero: "61", estado: "reservado", usuario_global_id: "cliente-1", usuario_id: USUARIO_ID_TENANT, evento_id: "evento-1", comprador: "Cliente Uno", contacto: "3000000002" }
        );

        const sock = crearFakeSock();
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_1 });

        await confirmarPagoPorSticker(crearCtx({ sock, message: msg }));

        const pagados = filasDe(fake, "reservas_test_precio5").filter(f => f.usuario_global_id === "cliente-1" && f.estado === "pagado");

        assert.strictEqual(pagados.length, 4, "las 4 reservas del cliente deben quedar pagadas");
        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 4, "la auditoría debe registrar las 4");
        assert.strictEqual(envios.length, 0, "no debe llamarse ninguna función de envío de mensaje, ni una vez por cada número");

    });

    await test("SILENCIO: sticker válido actualiza 0 números (sin_reservas) -> CERO llamadas de envío", async () => {

        const { fake, envios, confirmarPagoPorSticker } = cargarModulos();
        sembrarEscenario(fake);

        const sock = crearFakeSock();
        // Cita a cliente-2, que no tiene ninguna fila -> 0 números afectados.
        const msg = crearMensajeSticker({ remitenteJid: JID_ADMIN, quotedParticipant: JID_CLIENTE_2 });

        await confirmarPagoPorSticker(crearCtx({ sock, message: msg }));

        assert.strictEqual(filasDe(fake, "reservas_actividad").length, 0);
        assert.strictEqual(envios.length, 0, "tampoco debe enviarse nada cuando no hay nada que confirmar");

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
