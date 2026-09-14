// ==========================================================================
// FASE 2 (IdentitySync) — demostración explícita de los 7 casos pedidos en
// la auditoría de identidad (sección 14). Usa las funciones REALES de
// producción (escanearGrupo, sincronizarDesdeMensaje) con un fake de
// Supabase — ningún mock del motor de escaneo/resolución en sí.
//
//     node backend/tests/identidad/identitySync.casos.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/usuarios/identityScanner/identityResolver.js",
    "../../bot/funciones/usuarios/escanerIdentidades.js",
    "../../bot/funciones/usuarios/escanerIdentidadesLifecycle.js",
    "../../bot/funciones/usuarios/identityScanner/identitySyncMensaje.js"
].map(p => path.resolve(__dirname, p));

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    RUTAS_A_RECARGAR.forEach(r => delete require.cache[r]);

    const lifecycle = require(RUTAS_A_RECARGAR[3]);
    const identitySync = require(RUTAS_A_RECARGAR[4]);

    return { fake, lifecycle, identitySync };

}

function participante(o) {
    return { id: o.id, lid: o.lid || null, phoneNumber: o.phoneNumber || null, notify: o.notify || null };
}

// Mensaje mínimo de Baileys, con la forma real (key.participant en grupo,
// message.extendedTextMessage.contextInfo para citas).
function mensaje({ remoteJid = "g1@g.us", participant, participantAlt, texto = "hola", pushName = null, contextInfo = null }) {

    return {
        key: { remoteJid, participant, participantAlt, fromMe: false, id: "MSG" + Math.random() },
        pushName,
        message: {
            extendedTextMessage: {
                text: texto,
                contextInfo: contextInfo || undefined
            }
        }
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
    // CASO A — entra usuario -> se detecta identidad -> se guarda/completa
    // (vía escaneo de grupo, el mismo camino que ahora también dispara
    // group-participants.update con action:"add", ver bot/events/groups.js)
    // ======================================================================
    await test("CASO A: nuevo participante en un grupo (solo LID) -> se crea el usuario", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                return { id: grupoId, participants: [participante({ id: "444555666777888@lid", notify: "Nuevo Cliente" })] };
            }
        };

        const r = await lifecycle.escanearGrupo("sesionCasoA", sock, "gA@g.us");

        assert.ok(r, "el escaneo debe completarse");
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "444555666777888@lid");
        assert.strictEqual(fake.tablas.usuarios[0].nombre, "Nuevo Cliente");

    });

    // ======================================================================
    // CASO B — usuario escribe -> el scanner analiza el mensaje COMPLETO ->
    // encuentra el LID (no viene en key.participant, sino en
    // key.participantAlt — el scanner recursivo lo encuentra igual)
    // ======================================================================
    await test("CASO B: mensaje real, LID en key.participantAlt (no en participant) -> el scanner lo encuentra y crea el usuario", async () => {

        const { fake, identitySync } = cargarModulos();

        const msg = mensaje({
            participant: "573001112222@s.whatsapp.net", // este mensaje SÍ trae teléfono también...
            participantAlt: "999888777666555@lid", // ...pero el LID solo viene en participantAlt
            pushName: "Cliente B"
        });

        await identitySync.sincronizarDesdeMensaje({ sock: null, message: msg });

        assert.strictEqual(fake.tablas.usuarios.length, 1, "una sola identidad (mismo remitente, 2 campos)");
        assert.strictEqual(fake.tablas.usuarios[0].lid, "999888777666555@lid", "el LID de participantAlt SÍ se encontró");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3001112222");

    });

    // ======================================================================
    // CASO C — usuario escribe -> aparece teléfono -> se completa el usuario
    // EXISTENTE (que antes solo tenía LID)
    // ======================================================================
    await test("CASO C: usuario existente (solo LID) escribe y ahora expone teléfono -> se completa, no se duplica", async () => {

        const { fake, identitySync } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-existente-C", lid: "111222333444555@lid", telefono: null, nombre: null });

        const msg = mensaje({
            participant: "111222333444555@lid", // mismo LID de siempre...
            participantAlt: "573009990000@s.whatsapp.net", // ...pero esta vez Baileys también expuso el teléfono
            pushName: "Cliente C"
        });

        await identitySync.sincronizarDesdeMensaje({ sock: null, message: msg });

        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear una fila nueva");
        assert.strictEqual(fake.tablas.usuarios[0].id, "u-existente-C");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3009990000", "el teléfono se completó en la fila existente");

    });

    // ======================================================================
    // CASO D — LID + teléfono juntos, primera vez -> una sola identidad
    // ======================================================================
    await test("CASO D: mensaje con LID + teléfono juntos (primera vez) -> una sola identidad, no duplica", async () => {

        const { fake, identitySync } = cargarModulos();

        const msg = mensaje({
            participant: "222333444555666@lid",
            participantAlt: "573005556666@s.whatsapp.net",
            pushName: "Cliente D"
        });

        await identitySync.sincronizarDesdeMensaje({ sock: null, message: msg });

        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "222333444555666@lid");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3005556666");

    });

    // ======================================================================
    // CASO E — mismo LID con ":11" y sin sufijo -> no duplica (vía el
    // camino de mensaje en vivo, no solo el resolver aislado — ver también
    // identityResolver.test.js para la cobertura exhaustiva de este caso)
    // ======================================================================
    await test("CASO E: usuario ya existe con LID sin sufijo; llega un mensaje con el mismo LID CON sufijo de dispositivo -> no duplica", async () => {

        const { fake, identitySync } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-existente-E", lid: "666777888999000@lid", telefono: null, nombre: "Con Bare" });

        const msg = mensaje({
            participant: "666777888999000:11@lid" // mismo user, con sufijo de dispositivo
        });

        await identitySync.sincronizarDesdeMensaje({ sock: null, message: msg });

        assert.strictEqual(fake.tablas.usuarios.length, 1, "NO debe crear una segunda fila por el sufijo de dispositivo");
        assert.strictEqual(fake.tablas.usuarios[0].id, "u-existente-E");

    });

    // ======================================================================
    // CASO F — el scanner falla -> el bot (esta función) sigue funcionando,
    // nunca lanza hacia arriba.
    // ======================================================================
    await test("CASO F: Supabase falla durante la resolución -> sincronizarDesdeMensaje NO lanza (se traga el error)", async () => {

        const { fake, identitySync } = cargarModulos();

        fake.forzarProximoError("usuarios", "select", { message: "simulado: Supabase caído" });

        const msg = mensaje({ participant: "333444555666777@lid" });

        let lanzo = false;

        try {
            await identitySync.sincronizarDesdeMensaje({ sock: null, message: msg });
        } catch (e) {
            lanzo = true;
        }

        assert.strictEqual(lanzo, false, "sincronizarDesdeMensaje nunca debe propagar un error hacia el llamador (dispatcher/negocio sigue intacto)");

    });

    // Caso F (complemento): un mensaje directamente MALFORMADO (sin key) —
    // tampoco debe lanzar.
    await test("CASO F (complemento): mensaje sin 'key' -> no lanza, simplemente no hace nada", async () => {

        const { identitySync } = cargarModulos();

        let lanzo = false;

        try {
            await identitySync.sincronizarDesdeMensaje({ sock: null, message: {} });
        } catch (e) {
            lanzo = true;
        }

        assert.strictEqual(lanzo, false);

    });

    // ======================================================================
    // CASO G — dos escaneos simultáneos del MISMO grupo -> no duplica la
    // ejecución (cobertura adicional a la ya existente en
    // escanerIdentidadesLifecycle.test.js prueba 4 — aquí se confirma
    // además que no se duplica el USUARIO resultante).
    // ======================================================================
    await test("CASO G: dos aperturas casi simultáneas del mismo grupo -> un solo escaneo real, un solo usuario creado", async () => {

        const { fake, lifecycle } = cargarModulos();

        let llamadasReales = 0;

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                llamadasReales++;
                await new Promise(r => setTimeout(r, 20));
                return { id: grupoId, participants: [participante({ id: "555666777888999@lid" })] };
            }
        };

        const [r1, r2] = await Promise.all([
            lifecycle.escanearGrupo("sesionCasoG", sock, "gG@g.us"),
            lifecycle.escanearGrupo("sesionCasoG", sock, "gG@g.us")
        ]);

        assert.strictEqual(llamadasReales, 1, "solo 1 IQ real a WhatsApp, la segunda señal se omitió");
        assert.ok((r1 === null) !== (r2 === null), "exactamente una de las dos llamadas ejecutó el escaneo, la otra se omitió");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "un solo usuario, no duplicado");

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidos = resultados.filter(r => !r.ok);

    console.log("\n================================");
    console.log(`✅ Pasaron: ${resultados.length - fallidos.length}/${resultados.length}`);

    if (fallidos.length) {
        console.log(`❌ Fallaron: ${fallidos.length}`);
        fallidos.forEach(f => console.log(`   - ${f.nombre}: ${f.err.message}`));
        console.log("================================");
        process.exitCode = 1;
    } else {
        console.log("================================");
    }

}

main().catch(err => {
    console.error("💥 Error inesperado ejecutando las pruebas de casos IdentitySync");
    console.error(err);
    process.exitCode = 1;
});
