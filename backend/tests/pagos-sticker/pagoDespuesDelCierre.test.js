// ==========================================================================
// PRUEBAS — sticker de pago DESPUÉS del cierre de un sorteo (31/10/2026).
//
// Auditoría de consultarEvento.js + marcarReservasPagadasPorAdmin.js:
//   - El pago marca SOLO las reservas pendientes del cliente citado en la
//     tabla del sorteo VIGENTE del grupo (UNA TABLA = UN SORTEO).
//   - Conserva el origen de cada fila (identidad_evento_real, evento_id,
//     grupo_id): solo cambian estado, fecha y hora de pago.
//   - Nunca reactiva ni reescribe un sorteo histórico (ni activo, ni estado,
//     ni sus contadores finales).
//   - Un sorteo terminado no recibe pagos por sticker, aunque un reintento
//     antiguo lo dejara con activo=true.
//
// Reales: confirmarPagoPorSticker.js, consultarEvento.js,
// marcarReservasPagadasPorAdmin.js, actualizarEvento.js, obtenerUsuarioGlobal.js.
// Simulados: Supabase (en memoria, ./fakeSupabase.js) y WhatsApp.
//
//     node backend/tests/pagos-sticker/pagoDespuesDelCierre.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_SEND = path.resolve(__dirname, "../../services/baileys/send.js");
const RUTA_CONFIRMAR = path.resolve(__dirname, "../../bot/funciones/pagos/confirmarPagoPorSticker.js");

const RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/admins/esAdministrador.js",
    "../../bot/funciones/eventos/consultarEvento.js",
    "../../bot/funciones/reservas/actualizarEvento.js",
    "../../bot/funciones/pagos/marcarReservasPagadasPorAdmin.js",
    "../../bot/funciones/pagos/configuracionStickerPago.js",
    "../../bot/funciones/pagos/confirmarPagoPorSticker.js"
].map(p => path.resolve(__dirname, p));

const TENANT = "tenant-1";
const OTRO_TENANT = "tenant-2";
const G1 = "120363111111111111@g.us";
const G2 = "120363222222222222@g.us";
const T5 = "reservas_test_precio5";
const T10 = "reservas_test_precio10";

const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_CLIENTE = "573000000002@s.whatsapp.net";
const JID_OTRO = "573000000003@s.whatsapp.net";
const TELEFONO_BOT = "573000000099";
const HASH = Buffer.from("STICKER-DE-PAGO-OFICIAL").toString("hex");

function cargar() {
    const fake = crearFakeSupabase();
    const envios = [];
    require.cache[RUTA_SUPABASE] = { id: RUTA_SUPABASE, filename: RUTA_SUPABASE, loaded: true, exports: fake.client };
    require.cache[RUTA_SEND] = { id: RUTA_SEND, filename: RUTA_SEND, loaded: true, exports: { sendMessage: async (m) => { envios.push(m); return true; } } };
    // Todo módulo del bot que ya capturó el Supabase falso anterior (p. ej.
    // sorteoReal.js, que leería las tablas de otra prueba) se recarga.
    const BOT = path.resolve(__dirname, "../../bot") + path.sep;
    Object.keys(require.cache).filter(k => k.startsWith(BOT)).forEach(k => delete require.cache[k]);
    RECARGAR.forEach(r => delete require.cache[r]);
    const { confirmarPagoPorSticker } = require(RUTA_CONFIRMAR);
    return { fake, envios, confirmarPagoPorSticker };
}

const sock = {
    user: { id: `${TELEFONO_BOT}:5@s.whatsapp.net` },
    async groupMetadata(id) {
        return { id, participants: [
            { id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" },
            { id: JID_CLIENTE, phoneNumber: JID_CLIENTE, admin: null },
            { id: JID_OTRO, phoneNumber: JID_OTRO, admin: null }
        ] };
    }
};

function sticker(grupo = G1, citado = JID_CLIENTE) {
    const message = {
        key: { id: `S-${Math.random()}`, remoteJid: grupo, participant: JID_ADMIN, fromMe: false },
        message: { stickerMessage: { mimetype: "image/webp", fileSha256: Buffer.from(HASH, "hex"), contextInfo: { stanzaId: "Q", participant: citado } } }
    };
    return { sock, message, session: { telefono: TELEFONO_BOT, usuarioId: TENANT }, chat: { esGrupo: true, remoteJid: grupo, participante: JID_ADMIN } };
}

const CERRADO = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" };

function evento(id, grupo, tabla, extra = {}) {
    return {
        id, grupo_id: grupo, tabla, usuario_id: TENANT, activo: true, estado: "abierto",
        identidad_evento_real: `id-${id}`, cantidad_numeros: 100, reservados: 7, pagados: 7, pendientes: 7, libres: 7,
        creado_en: `2026-10-${extra.dia || "31"}T10:00:00.000Z`, actualizado_en: "2026-10-30T23:00:00.000Z", ...extra
    };
}

function reserva(numero, estado, cliente, origen, extra = {}) {
    return { numero, estado, usuario_global_id: cliente, usuario_id: TENANT, identidad_evento_real: `id-${origen}`, evento_id: origen, grupo_id: G1, comprador: cliente, contacto: cliente === "cliente-1" ? "3000000002" : "3000000003", ...extra };
}

function base(fake) {
    for (const g of [G1, G2]) fake.tabla("configuracion_stickers_pago").push({ usuario_id: TENANT, grupo_id: g, sticker_sha256: HASH, esperando_registro: false });
    fake.tabla("usuarios").push(
        { id: "cliente-1", telefono: "3000000002", lid: null, nombre: "Cliente Uno" },
        { id: "cliente-2", telefono: "3000000003", lid: null, nombre: "Cliente Dos" }
    );
}

const congelar = (x) => JSON.stringify(x);

const resultados = [];
async function test(nombre, fn) {
    const log = console.log, err = console.error, dir = console.dir;
    console.log = () => {}; console.error = () => {}; console.dir = () => {};
    try {
        await fn();
        Object.assign(console, { log, error: err, dir });
        resultados.push(true);
        console.log(`✅ ${nombre}`);
    } catch (e) {
        Object.assign(console, { log, error: err, dir });
        resultados.push(false);
        console.log(`❌ ${nombre}`);
        console.log(`   ${e.message}`);
    }
}

(async () => {

    await test("1. sorteo del grupo CERRADO y sin sorteo nuevo: el sticker no modifica nada ni reactiva el sorteo", async () => {
        const { fake, envios, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("viejo", G1, T5, CERRADO));
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "viejo"));
        const antes = congelar([fake.tablas.eventos_bot, fake.tablas[T5]]);
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(congelar([fake.tablas.eventos_bot, fake.tablas[T5]]), antes);
        assert.strictEqual((fake.tablas.reservas_actividad || []).length, 0);
        assert.strictEqual(envios.length, 0);
    });

    await test("2. tabla CONSERVADA con sorteo nuevo activo: paga solo lo pendiente del cliente, conserva el origen, no toca el histórico", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(
            evento("viejo", G1, T5, { ...CERRADO, dia: "30" }),
            evento("nuevo", G1, T5)
        );
        fake.tabla(T5).push(
            reserva("27", "reservado", "cliente-1", "viejo"),                 // del ciclo anterior
            reserva("45", "reservado", "cliente-1", "nuevo", { grupo_id: G2 }), // reservado por otro grupo
            reserva("50", "pagado", "cliente-1", "viejo", { fecha_pago: "2026-10-30", hora_pago: "20:00:00" }),
            reserva("60", "reservado", "cliente-2", "nuevo"),                  // otro cliente
            { ...reserva("27", "reservado", "cliente-1", "ajeno"), usuario_id: OTRO_TENANT } // otro tenant
        );
        const viejoAntes = congelar(fake.tablas.eventos_bot.find(e => e.id === "viejo"));

        await confirmarPagoPorSticker(sticker());

        const t = fake.tablas[T5];
        const r27 = t.find(f => f.numero === "27" && f.usuario_id === TENANT);
        const r45 = t.find(f => f.numero === "45");
        assert.strictEqual(r27.estado, "pagado");
        assert.strictEqual(r45.estado, "pagado");
        // Origen intacto.
        assert.deepStrictEqual([r27.identidad_evento_real, r27.evento_id, r27.grupo_id], ["id-viejo", "viejo", G1]);
        assert.deepStrictEqual([r45.identidad_evento_real, r45.evento_id, r45.grupo_id], ["id-nuevo", "nuevo", G2]);
        // Ni lo ya pagado, ni otro cliente, ni otro tenant.
        assert.deepStrictEqual([t.find(f => f.numero === "50").fecha_pago, t.find(f => f.numero === "50").hora_pago], ["2026-10-30", "20:00:00"]);
        assert.strictEqual(t.find(f => f.numero === "60").estado, "reservado");
        assert.strictEqual(t.find(f => f.usuario_id === OTRO_TENANT).estado, "reservado");
        // El histórico no se reactiva ni se reescribe.
        assert.strictEqual(congelar(fake.tablas.eventos_bot.find(e => e.id === "viejo")), viejoAntes);
        // Auditoría: con el sorteo vigente y la tabla, solo las filas que cambiaron.
        const act = fake.tablas.reservas_actividad;
        assert.deepStrictEqual(act.map(a => a.numero).sort(), ["27", "45"]);
        assert.ok(act.every(a => a.evento_id === "nuevo" && a.tabla === T5 && a.tipo === "pagado" && a.realizado_por === JID_ADMIN));
    });

    await test("3. sorteo nuevo en OTRA tabla: paga en la tabla vigente; la tabla del sorteo cerrado queda intacta", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(
            evento("viejo", G1, T5, { ...CERRADO, dia: "30" }),
            evento("nuevo", G1, T10)
        );
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "viejo"));
        fake.tabla(T10).push(reserva("08", "reservado", "cliente-1", "nuevo"));
        const historica = congelar(fake.tablas[T5]);
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(fake.tablas[T10][0].estado, "pagado");
        assert.strictEqual(congelar(fake.tablas[T5]), historica);
    });

    await test("4. fila ya cerrada que un reintento dejó con activo=true: no recibe pagos ni se toca", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("zombi", G1, T5, { cierre_estado: "cerrado", estado: "cerrado" }));
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "zombi"));
        const antes = congelar([fake.tablas.eventos_bot, fake.tablas[T5]]);
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(congelar([fake.tablas.eventos_bot, fake.tablas[T5]]), antes);
    });

    await test("5. fila zombi MÁS NUEVA que el sorteo en curso: el pago va al sorteo en curso (consultarEvento elige el activo real)", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(
            evento("curso", G1, T10, { dia: "30" }),
            evento("zombi", G1, T5, { cierre_estado: "cerrado", estado: "cerrado", dia: "31" })
        );
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "zombi"));
        fake.tabla(T10).push(reserva("08", "reservado", "cliente-1", "curso"));
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(fake.tablas[T10][0].estado, "pagado");
        assert.strictEqual(fake.tablas[T5][0].estado, "reservado");
        assert.strictEqual(fake.tablas.eventos_bot.find(e => e.id === "zombi").activo, true, "no se modifica la fila zombi");
    });

    await test("6. contadores: se actualizan los grupos ACTIVOS del sorteo; un grupo ya cerrado del mismo sorteo conserva los suyos", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(
            evento("nuevo", G1, T5),
            // Mismo sorteo (misma identidad), ya cerrado en el grupo 2.
            evento("nuevo-g2", G2, T5, { ...CERRADO, identidad_evento_real: "id-nuevo" })
        );
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "nuevo"));
        const cerradoAntes = congelar(fake.tablas.eventos_bot.find(e => e.id === "nuevo-g2"));
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(fake.tablas[T5][0].estado, "pagado", "se pagó");
        const activo = fake.tablas.eventos_bot.find(e => e.id === "nuevo");
        assert.strictEqual(activo.pagados, 1);
        assert.strictEqual(congelar(fake.tablas.eventos_bot.find(e => e.id === "nuevo-g2")), cerradoAntes, "ni activo, ni estado, ni contadores, ni actualizado_en");
    });

    await test("7. segundo sticker igual: idempotente (nada cambia, ninguna auditoría nueva)", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("viejo", G1, T5, { ...CERRADO, dia: "30" }), evento("nuevo", G1, T5));
        fake.tabla(T5).push(reserva("27", "reservado", "cliente-1", "viejo"));
        await confirmarPagoPorSticker(sticker());
        const despues = congelar([fake.tablas[T5], fake.tablas.reservas_actividad]);
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(congelar([fake.tablas[T5], fake.tablas.reservas_actividad]), despues);
    });

    // ----------------------------------- identificación del cliente (B) ---
    // Decisión del usuario (31/10): una reserva antigua sin identificador
    // inequívoco (usuario_global_id) NO se paga por sticker, aunque su
    // teléfono o LID coincidan: se registra a mano desde el panel.

    await test("8. reserva antigua SIN usuario_global_id con el mismo teléfono: el sticker no la paga", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("nuevo", G1, T5));
        fake.tabla(T5).push(
            reserva("11", "reservado", null, "viejo", { telefono: "3000000002", contacto: "3000000002" }),
            reserva("12", "reservado", null, "viejo", { lid: "999@lid", contacto: null })
        );
        const antes = congelar(fake.tablas[T5]);
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(congelar(fake.tablas[T5]), antes);
        assert.strictEqual((fake.tablas.reservas_actividad || []).length, 0);
    });

    await test("9. fila de OTRA persona con el teléfono del cliente citado: nunca se paga (decide usuario_global_id)", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("nuevo", G1, T5));
        fake.tabla(T5).push(
            reserva("13", "reservado", "cliente-2", "nuevo", { telefono: "3000000002", contacto: "3000000002" }),
            reserva("14", "reservado", "cliente-1", "nuevo")
        );
        await confirmarPagoPorSticker(sticker());
        assert.strictEqual(fake.tablas[T5].find(f => f.numero === "13").estado, "reservado");
        assert.strictEqual(fake.tablas[T5].find(f => f.numero === "14").estado, "pagado");
    });

    await test("10. el pago solo cambia estado/fecha/hora y COMPLETA datos de contacto vacíos; origen y datos existentes intactos", async () => {
        const { fake, confirmarPagoPorSticker } = cargar();
        base(fake);
        fake.tabla("eventos_bot").push(evento("nuevo", G1, T5));
        fake.tabla(T5).push(reserva("15", "reservado", "cliente-1", "viejo", { grupo_id: G2, grupo_nombre: "Grupo 2", contacto: "3000000002", nombre: null, lid: null }));
        const antes = { ...fake.tablas[T5][0] };
        await confirmarPagoPorSticker(sticker());
        const despues = fake.tablas[T5][0];
        const cambiados = Object.keys({ ...antes, ...despues }).filter(k => antes[k] !== despues[k]).sort();
        const PERMITIDOS = ["estado", "fecha_pago", "hora_pago", "contacto", "telefono", "comprador", "nombre", "lid"];
        assert.ok(cambiados.every(k => PERMITIDOS.includes(k)), `columnas cambiadas: ${cambiados}`);
        for (const k of cambiados.filter(k => !["estado", "fecha_pago", "hora_pago"].includes(k))) {
            assert.ok(antes[k] == null, `${k} solo se completa si estaba vacío`);
        }
        assert.deepStrictEqual(
            [despues.identidad_evento_real, despues.evento_id, despues.grupo_id, despues.grupo_nombre, despues.usuario_id, despues.usuario_global_id],
            ["id-viejo", "viejo", G2, "Grupo 2", TENANT, "cliente-1"]
        );
    });

    const fallidas = resultados.filter(x => !x).length;
    console.log(`\nPruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas}  |  Fallidas: ${fallidas}`);
    process.exit(fallidas ? 1 : 0);

})();
