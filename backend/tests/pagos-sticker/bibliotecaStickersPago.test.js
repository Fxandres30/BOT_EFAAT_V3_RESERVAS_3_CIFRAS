// ==========================================================================
// PRUEBAS — biblioteca de stickers de pago (migración 046):
// bibliotecaStickersPago.js + su conexión en registrarStickerPago.js.
//
// Sin red ni Supabase real: fake de Supabase (con Storage falso) inyectado
// vía require.cache, y descarga de la imagen inyectada.
//
//     EFAAT_PRUEBAS=1 node backend/tests/pagos-sticker/bibliotecaStickersPago.test.js
// ==========================================================================

process.env.EFAAT_PRUEBAS = "1";

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/admins/esAdministrador.js",
    "../../bot/funciones/pagos/configuracionStickerPago.js",
    "../../bot/funciones/pagos/bibliotecaStickersPago.js",
    "../../bot/funciones/pagos/registrarStickerPago.js",
    "../../bot/funciones/pagos/confirmarPagoPorSticker.js"
].map(p => path.resolve(__dirname, p));

const GRUPO_A = "120363111111111111@g.us";
const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";
const JID_ADMIN = "573000000001@s.whatsapp.net";
const JID_NORMAL = "573000000002@s.whatsapp.net";

const HASH_1 = Buffer.from("sticker-uno").toString("hex");
const HASH_2 = Buffer.from("sticker-dos").toString("hex");

const WEBP = Buffer.from("RIFF....WEBPVP8 imagen-falsa");

function crearStorageFalso({ errorSubida = null } = {}) {

    const objetos = new Map();
    const llamadas = { upload: [], remove: [] };

    return {
        objetos,
        llamadas,
        cliente: {
            from(bucket) {
                return {
                    async upload(ruta, contenido, opciones) {
                        llamadas.upload.push({ bucket, ruta, opciones });
                        if (errorSubida) return { data: null, error: { message: errorSubida } };
                        objetos.set(`${bucket}/${ruta}`, contenido);
                        return { data: { path: ruta }, error: null };
                    },
                    async remove(rutas) {
                        llamadas.remove.push({ bucket, rutas });
                        rutas.forEach(r => objetos.delete(`${bucket}/${r}`));
                        return { data: [], error: null };
                    }
                };
            }
        }
    };

}

function cargarModulos(opcionesStorage) {

    const fake = crearFakeSupabase();
    const storage = crearStorageFalso(opcionesStorage);
    fake.client.storage = storage.cliente;

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    RUTAS_A_RECARGAR.forEach(ruta => delete require.cache[ruta]);

    return {
        fake,
        storage,
        biblioteca: require(RUTAS_A_RECARGAR[2]),
        configuracion: require(RUTAS_A_RECARGAR[1]),
        registrarStickerPago: require(RUTAS_A_RECARGAR[3]).registrarStickerPago
    };

}

function mensajeSticker({ hash = HASH_1, remitente = JID_ADMIN, animado = false, mimetype = "image/webp" } = {}) {
    return {
        key: { id: "STK-1", remoteJid: GRUPO_A, participant: remitente, fromMe: false },
        message: {
            stickerMessage: {
                mimetype,
                isAnimated: animado,
                fileSha256: Buffer.from(hash, "hex")
            }
        }
    };
}

function sockFalso() {
    return {
        user: { id: "573000000099:5@s.whatsapp.net" },
        async groupMetadata() {
            return {
                participants: [
                    { id: JID_ADMIN, phoneNumber: JID_ADMIN, admin: "admin" },
                    { id: JID_NORMAL, phoneNumber: JID_NORMAL, admin: null }
                ]
            };
        }
    };
}

function ctxDe(message, usuarioId = TENANT_A) {
    return {
        sock: sockFalso(),
        message,
        session: { telefono: "573000000099", usuarioId },
        chat: { esGrupo: true, remoteJid: GRUPO_A, participante: message.key.participant }
    };
}

const filas = (fake, t) => fake.tablas[t] || [];
const bibliotecaDe = (fake, u) => filas(fake, "stickers_pago_biblioteca").filter(f => f.usuario_id === u);
const predeterminadoDe = (fake, u) => filas(fake, "configuracion_stickers_pago").find(f => f.usuario_id === u && (f.grupo_id ?? null) === null);

const descargaOk = async () => WEBP;
const descargaFalla = async () => { throw new Error("sin media key"); };

const resultados = [];

async function test(nombre, fn) {
    const logOriginal = console.log;
    try {
        console.log = () => {};
        await fn();
        console.log = logOriginal;
        resultados.push({ ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        console.log = logOriginal;
        resultados.push({ ok: false });
        console.log(`❌ ${nombre}\n   ${err.stack || err.message}`);
    }
}

async function ejecutar() {

    await test("Registro PREDETERMINADO: guarda el predeterminado igual que antes y además entra a la biblioteca", async () => {

        const { fake, configuracion, registrarStickerPago } = cargarModulos();
        await configuracion.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });

        const res = await registrarStickerPago(ctxDe(mensajeSticker()));
        assert.strictEqual(res.intervino, true);
        assert.ok(res.biblioteca, "debe lanzar el guardado en biblioteca");
        await res.biblioteca;

        assert.strictEqual(predeterminadoDe(fake, TENANT_A).sticker_sha256, HASH_1);
        const lib = bibliotecaDe(fake, TENANT_A);
        assert.strictEqual(lib.length, 1);
        assert.strictEqual(lib[0].sticker_sha256, HASH_1);
        assert.strictEqual(lib[0].registrado_por, JID_ADMIN);
        // Baileys real no puede descargar un mensaje sin media key: se
        // guarda sin vista previa, sin romper nada.
        assert.strictEqual(lib[0].imagen_ruta, undefined);

    });

    await test("Registro ESPECÍFICO de grupo: no toca la biblioteca", async () => {

        const { fake, configuracion, registrarStickerPago } = cargarModulos();
        await configuracion.activarModoRegistro({ usuarioId: TENANT_A, grupoId: GRUPO_A });

        const res = await registrarStickerPago(ctxDe(mensajeSticker()));
        assert.strictEqual(res.intervino, true);
        assert.strictEqual(res.biblioteca, undefined);
        assert.strictEqual(bibliotecaDe(fake, TENANT_A).length, 0);

    });

    await test("Remitente no administrador: nada en la biblioteca", async () => {

        const { fake, configuracion, registrarStickerPago } = cargarModulos();
        await configuracion.activarModoRegistro({ usuarioId: TENANT_A, grupoId: null });

        const res = await registrarStickerPago(ctxDe(mensajeSticker({ remitente: JID_NORMAL })));
        assert.strictEqual(res.intervino, true);
        assert.strictEqual(bibliotecaDe(fake, TENANT_A).length, 0);

    });

    await test("Sin modo de registro: no interviene y no guarda nada", async () => {

        const { fake, registrarStickerPago } = cargarModulos();
        const res = await registrarStickerPago(ctxDe(mensajeSticker()));
        assert.strictEqual(res.intervino, false);
        assert.strictEqual(bibliotecaDe(fake, TENANT_A).length, 0);

    });

    await test("Descarga correcta: sube la imagen a <usuario>/<hash>.webp y marca animado", async () => {

        const { fake, storage, biblioteca } = cargarModulos();

        const r = await biblioteca.guardarEnBiblioteca({
            usuarioId: TENANT_A, msg: mensajeSticker({ animado: true }), stickerSha256: HASH_1,
            registradoPor: JID_ADMIN, descargar: descargaOk
        });

        assert.deepStrictEqual(r, { ok: true, imagen: true });
        assert.strictEqual(storage.llamadas.upload[0].bucket, "stickers-pago");
        assert.strictEqual(storage.llamadas.upload[0].ruta, `${TENANT_A}/${HASH_1}.webp`);
        assert.strictEqual(storage.llamadas.upload[0].opciones.contentType, "image/webp");
        const fila = bibliotecaDe(fake, TENANT_A)[0];
        assert.strictEqual(fila.imagen_ruta, `${TENANT_A}/${HASH_1}.webp`);
        assert.strictEqual(fila.es_animado, true);

    });

    await test("Nuevo predeterminado: el anterior y su imagen se conservan", async () => {

        const { fake, storage, biblioteca } = cargarModulos();

        await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker({ hash: HASH_2 }), stickerSha256: HASH_2, descargar: descargaOk });

        assert.strictEqual(bibliotecaDe(fake, TENANT_A).length, 2);
        assert.strictEqual(storage.objetos.size, 2);
        assert.strictEqual(storage.llamadas.remove.length, 0, "nunca borra imágenes");

    });

    await test("Mismo sticker otra vez con descarga fallida: no duplica y conserva su imagen", async () => {

        const { fake, biblioteca } = cargarModulos();

        await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        const r = await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1.toUpperCase(), descargar: descargaFalla });

        assert.deepStrictEqual(r, { ok: true, imagen: false });
        const lib = bibliotecaDe(fake, TENANT_A);
        assert.strictEqual(lib.length, 1);
        assert.strictEqual(lib[0].imagen_ruta, `${TENANT_A}/${HASH_1}.webp`);

    });

    await test("Aislamiento: el mismo sticker en otro cliente va a su propia carpeta y fila", async () => {

        const { fake, storage, biblioteca } = cargarModulos();

        await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_B, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });

        assert.strictEqual(bibliotecaDe(fake, TENANT_A).length, 1);
        assert.strictEqual(bibliotecaDe(fake, TENANT_B).length, 1);
        assert.ok(bibliotecaDe(fake, TENANT_B)[0].imagen_ruta.startsWith(`${TENANT_B}/`));
        assert.ok(storage.objetos.has(`stickers-pago/${TENANT_A}/${HASH_1}.webp`));
        assert.ok(storage.objetos.has(`stickers-pago/${TENANT_B}/${HASH_1}.webp`));

    });

    await test("Ruta segura: usuario o hash con '../' se rechazan sin subir nada", async () => {

        const { fake, storage, biblioteca } = cargarModulos();

        const r1 = await biblioteca.guardarEnBiblioteca({ usuarioId: "../otro", msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        const r2 = await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: "../abc", descargar: descargaOk });

        assert.strictEqual(r1.ok, false);
        assert.strictEqual(r2.ok, false);
        assert.strictEqual(storage.llamadas.upload.length, 0);
        assert.strictEqual(filas(fake, "stickers_pago_biblioteca").length, 0);

    });

    await test("Imagen demasiado grande o subida fallida: fila sin vista previa, sin errores", async () => {

        const grande = cargarModulos();
        const r1 = await grande.biblioteca.guardarEnBiblioteca({
            usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1,
            descargar: async () => Buffer.alloc(grande.biblioteca.LIMITE_BYTES + 1)
        });
        assert.deepStrictEqual(r1, { ok: true, imagen: false });
        assert.strictEqual(grande.storage.llamadas.upload.length, 0);

        const falla = cargarModulos({ errorSubida: "bucket no existe" });
        const r2 = await falla.biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        assert.deepStrictEqual(r2, { ok: true, imagen: false });
        assert.strictEqual(bibliotecaDe(falla.fake, TENANT_A)[0].imagen_ruta, undefined);

    });

    await test("Sticker animado Lottie (application/was): se guarda con extensión .was", async () => {

        const { biblioteca } = cargarModulos();
        assert.strictEqual(biblioteca.rutaImagen("u1", "ab", "application/was"), "u1/ab.was");
        assert.strictEqual(biblioteca.rutaImagen("u1", "ab", null), "u1/ab.bin");

    });

    await test("Error inesperado de Supabase: nunca lanza", async () => {

        const { fake, biblioteca } = cargarModulos();
        fake.client.from = () => { throw new Error("caída"); };

        const r = await biblioteca.guardarEnBiblioteca({ usuarioId: TENANT_A, msg: mensajeSticker(), stickerSha256: HASH_1, descargar: descargaOk });
        assert.strictEqual(r.ok, false);

    });

    const fallidas = resultados.filter(r => !r.ok).length;
    console.log(`\nPruebas: ${resultados.length}  |  OK: ${resultados.length - fallidas}  |  Fallidas: ${fallidas}\n`);
    if (fallidas) process.exitCode = 1;

}

ejecutar();
