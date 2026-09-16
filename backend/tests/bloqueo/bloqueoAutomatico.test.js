// ==========================================================================
// PRUEBAS DEL BLOQUEO AUTOMÁTICO DE WHATSAPP.
//
// Cubre los 10 casos pedidos en el requisito:
//   1. participante normal entra -> no se expulsa
//   2. bloqueado por teléfono entra -> se expulsa
//   3. bloqueado por LID entra -> se expulsa
//   4. bloqueado con teléfono + LID -> se expulsa
//   5. bloqueado entra a grupo A -> se expulsa
//   6. bloqueado entra a grupo B -> se expulsa
//   7. bloqueado reingresa -> se vuelve a expulsar
//   8. error de WhatsApp al expulsar -> el bloqueo sigue activo
//   9. evento duplicado -> no se ejecutan expulsiones repetidas
//   10. desbloquear -> puede permanecer en el grupo con normalidad
//
//     node backend/tests/bloqueo/bloqueoAutomatico.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("../identidad/fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/bloqueo/bloqueadosRepo.js",
    "../../bot/funciones/bloqueo/bloqueoParticipantesGrupo.js"
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

    const bloqueadosRepo = require("../../bot/funciones/bloqueo/bloqueadosRepo");
    const bloqueo = require("../../bot/funciones/bloqueo/bloqueoParticipantesGrupo");

    return { fake, bloqueadosRepo, bloqueo };

}

function crearSockFake(usuarioId, { fallaExpulsion = false } = {}) {

    const llamadas = [];

    return {

        context: { usuarioId },

        llamadas,

        async groupParticipantsUpdate(grupoId, participantes, accion) {

            llamadas.push({ grupoId, participantes, accion });

            if (fallaExpulsion) {
                throw new Error("not-authorized: el bot ya no es admin del grupo");
            }

            return { status: 200 };

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
        console.log(`   ${err.message}`);

    }

}

async function main() {

    // ======================================================================
    // 1. Participante normal entra -> no se expulsa.
    // ======================================================================
    await test("1. participante normal entra -> no se expulsa", async () => {

        const { bloqueo } = cargarModulos();
        const sock = crearSockFake("tenantA");

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "3001234567@s.whatsapp.net",
            phoneNumber: "3001234567@s.whatsapp.net"
        });

        assert.strictEqual(r.bloqueado, false);
        assert.strictEqual(sock.llamadas.length, 0);

    });

    // ======================================================================
    // 2. Bloqueado por teléfono entra -> se expulsa.
    // ======================================================================
    await test("2. participante bloqueado por teléfono entra -> se expulsa", async () => {

        const { fake, bloqueadosRepo, bloqueo } = cargarModulos();

        const creado = await bloqueadosRepo.crearBloqueo({
            usuarioId: "tenantA",
            telefono: "3001234567",
            motivo: "spam"
        });

        assert.ok(creado.ok, JSON.stringify(creado));

        const sock = crearSockFake("tenantA");

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "573001234567@s.whatsapp.net",
            phoneNumber: "573001234567@s.whatsapp.net"
        });

        assert.strictEqual(r.bloqueado, true);
        assert.strictEqual(r.expulsado, true);
        assert.strictEqual(sock.llamadas.length, 1);
        assert.strictEqual(sock.llamadas[0].accion, "remove");
        assert.strictEqual(sock.llamadas[0].grupoId, "g1@g.us");

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.expulsiones, 1);
        assert.strictEqual(fila.intentos_ingreso, 1);

    });

    // ======================================================================
    // 3. Bloqueado por LID entra -> se expulsa.
    // ======================================================================
    await test("3. participante bloqueado por LID entra -> se expulsa", async () => {

        const { bloqueo, bloqueadosRepo } = cargarModulos();

        const creado = await bloqueadosRepo.crearBloqueo({
            usuarioId: "tenantA",
            lid: "999888777@lid",
            motivo: "acoso"
        });

        assert.ok(creado.ok);

        const sock = crearSockFake("tenantA");

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "999888777@lid",
            lid: "999888777@lid"
        });

        assert.strictEqual(r.expulsado, true);
        assert.strictEqual(sock.llamadas.length, 1);

    });

    // ======================================================================
    // 4. Bloqueado con teléfono + LID -> se expulsa (evento solo trae uno
    //    de los dos, pero "usuarios" ya conoce el otro -- cruce de
    //    identidad).
    // ======================================================================
    await test("4. bloqueado con teléfono + LID -> se expulsa", async () => {

        const { fake, bloqueo, bloqueadosRepo } = cargarModulos();

        // La identidad ya está resuelta en "usuarios" (p. ej. por el
        // escáner de identidades en un escaneo anterior).
        fake.tablas.usuarios.push({ id: "u1", telefono: "3009998877", lid: "111222333@lid", nombre: "Juan" });

        const creado = await bloqueadosRepo.crearBloqueo({
            usuarioId: "tenantA",
            telefono: "3009998877",
            lid: "111222333@lid",
            nombre: "Juan",
            motivo: "reincidente"
        });

        assert.ok(creado.ok);

        const sock = crearSockFake("tenantA");

        // El evento SOLO trae el LID -- el cruce contra "usuarios" debe
        // completar el teléfono, pero ya alcanza con el LID solo para
        // encontrar el bloqueo.
        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "111222333@lid",
            lid: "111222333@lid"
        });

        assert.strictEqual(r.expulsado, true);

    });

    // ======================================================================
    // 5 y 6. El mismo bloqueado entra a DOS grupos distintos -> se expulsa
    //    de ambos, cada uno registrado por separado.
    // ======================================================================
    await test("5 y 6. bloqueado entra a grupo A y luego a grupo B -> se expulsa de ambos", async () => {

        const { fake, bloqueo, bloqueadosRepo } = cargarModulos();

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3005556677" });
        assert.ok(creado.ok);

        const sock = crearSockFake("tenantA");
        const participante = { id: "573005556677@s.whatsapp.net", phoneNumber: "573005556677@s.whatsapp.net" };

        const rA = await bloqueo.procesarIngresoParticipante(sock, "grupoA@g.us", participante);
        assert.strictEqual(rA.expulsado, true);

        const rB = await bloqueo.procesarIngresoParticipante(sock, "grupoB@g.us", participante);
        assert.strictEqual(rB.expulsado, true);

        assert.strictEqual(sock.llamadas.length, 2);
        assert.strictEqual(sock.llamadas[0].grupoId, "grupoA@g.us");
        assert.strictEqual(sock.llamadas[1].grupoId, "grupoB@g.us");

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.expulsiones, 2);
        assert.strictEqual(fila.ultimo_grupo_id, "grupoB@g.us");

    });

    // ======================================================================
    // 7. El bloqueado vuelve a intentar entrar (más tarde, fuera de la
    //    ventana de deduplicación) -> se vuelve a expulsar.
    // ======================================================================
    await test("7. bloqueado reingresa más tarde -> se vuelve a expulsar", async () => {

        const { bloqueo, bloqueadosRepo } = cargarModulos();

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3001112233" });

        const sock = crearSockFake("tenantA");
        const participante = { id: "573001112233@s.whatsapp.net", phoneNumber: "573001112233@s.whatsapp.net" };

        const primero = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);
        assert.strictEqual(primero.expulsado, true);

        // Simula que pasó suficiente tiempo (ventana de deduplicación
        // vencida) -- un reingreso real, no el mismo evento repetido.
        bloqueo._limpiarLocksParaPruebas();

        const segundo = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);
        assert.strictEqual(segundo.expulsado, true);

        assert.strictEqual(sock.llamadas.length, 2);

    });

    // ======================================================================
    // 8. La expulsión falla (error de WhatsApp) -> el bloqueo sigue activo
    //    y el incidente queda registrado con resultado "error".
    // ======================================================================
    await test("8. error de WhatsApp al expulsar -> el bloqueo continúa activo", async () => {

        const { fake, bloqueo, bloqueadosRepo } = cargarModulos();

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3004445566" });

        const sock = crearSockFake("tenantA", { fallaExpulsion: true });

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "573004445566@s.whatsapp.net",
            phoneNumber: "573004445566@s.whatsapp.net"
        });

        assert.strictEqual(r.bloqueado, true);
        assert.strictEqual(r.expulsado, false);
        assert.ok(r.error);

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.activo, true, "el bloqueo interno NUNCA se desactiva por un fallo de expulsión");
        assert.strictEqual(fila.expulsiones, 0);
        assert.strictEqual(fila.intentos_ingreso, 1);

        const incidente = fake.tablas.bloqueo_intentos.find(i => i.bloqueado_id === creado.bloqueado.id);
        assert.ok(incidente);
        assert.strictEqual(incidente.resultado, "error");
        assert.ok(incidente.error);

    });

    // ======================================================================
    // 9. Evento duplicado (el mismo participante llega dos veces casi
    //    simultáneamente) -> no se ejecutan expulsiones repetidas.
    // ======================================================================
    await test("9. evento duplicado -> no ejecuta expulsiones repetidas", async () => {

        const { bloqueo, bloqueadosRepo } = cargarModulos();

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3007778899" });

        const sock = crearSockFake("tenantA");
        const participante = { id: "573007778899@s.whatsapp.net", phoneNumber: "573007778899@s.whatsapp.net" };

        const [r1, r2] = await Promise.all([
            bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante),
            bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante)
        ]);

        const expulsados = [r1, r2].filter(r => r.expulsado).length;

        assert.strictEqual(expulsados, 1, "solo una de las dos señales duplicadas debe expulsar");
        assert.strictEqual(sock.llamadas.length, 1);

    });

    // ======================================================================
    // 10. Se desbloquea el contacto -> puede permanecer en el grupo con
    //     normalidad (ya no se expulsa).
    // ======================================================================
    await test("10. desbloquear -> puede permanecer en el grupo normalmente", async () => {

        const { bloqueo, bloqueadosRepo } = cargarModulos();

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3002223344" });
        assert.ok(creado.ok);

        const desbloqueado = await bloqueadosRepo.desbloquear(creado.bloqueado.id, "tenantA");
        assert.ok(desbloqueado.ok, JSON.stringify(desbloqueado));
        assert.strictEqual(desbloqueado.bloqueado.activo, false);

        const sock = crearSockFake("tenantA");

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", {
            id: "573002223344@s.whatsapp.net",
            phoneNumber: "573002223344@s.whatsapp.net"
        });

        assert.strictEqual(r.bloqueado, false);
        assert.strictEqual(sock.llamadas.length, 0);

    });

    // ---- resumen ----
    const fallidas = resultados.filter(r => !r.ok);

    console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas OK`);

    if (fallidas.length > 0) {
        process.exitCode = 1;
    }

}

main();
