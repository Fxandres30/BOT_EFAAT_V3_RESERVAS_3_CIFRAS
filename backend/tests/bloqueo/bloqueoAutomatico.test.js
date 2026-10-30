// ==========================================================================
// PRUEBAS DEL BLOQUEO AUTOMÁTICO AL REINGRESAR (simuladas).
//
// Desde 2026-10-30 el reingreso no expulsa por su cuenta: programa la tarea
// del grupo y la procesa con el motor único (procesarExpulsion.js), así que
// estas pruebas fijan BLOQUEO_EXPULSION_MODO=real + CONFIRMAR=SI sobre un
// socket FALSO (nada sale a WhatsApp) con la lista de participantes que
// devolvería groupMetadata. Supabase falso en memoria.
//
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

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.BLOQUEO_EXPULSION_MODO = "real";
process.env.BLOQUEO_EXPULSION_CONFIRMAR = "SI";

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const RUTA_SUPABASE = path.join(RAIZ, "lib/supabase.js");

const fake = crearFake();
require.cache[RUTA_SUPABASE] = { id: RUTA_SUPABASE, filename: RUTA_SUPABASE, loaded: true, exports: fake.client };

const bloqueadosRepo = require("../../bot/funciones/bloqueo/bloqueadosRepo");
const bloqueo = require("../../bot/funciones/bloqueo/bloqueoParticipantesGrupo");
const politicaGrupos = require("../../bot/funciones/grupos/politicaGrupos");
const { olvidarBloqueos } = require("../../bot/funciones/bloqueo/bloqueoActivo");

const GRUPOS = ["g1@g.us", "grupoA@g.us", "grupoB@g.us"];
const CUENTA = { id: "573000000000:7@s.whatsapp.net", lid: "999000:7@lid" };
const CUENTA_EN_GRUPO = { id: "999000@lid", phoneNumber: "573000000000@s.whatsapp.net", admin: "admin" };

function reiniciar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.tablas.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: "tenantA", grupo_id: g, activo: true }));
    politicaGrupos.olvidarAutorizacion();
    olvidarBloqueos();
    bloqueo._limpiarLocksParaPruebas();
}

// El participante que "entra" ya figura en la lista real del grupo.
function crearSockFake(usuarioId, participante, { fallaExpulsion = false } = {}) {

    const llamadas = [];
    const miembros = new Map(GRUPOS.map(g => [g, [CUENTA_EN_GRUPO, participante]]));

    return {

        context: { usuarioId, sessionId: "ses-prueba" },
        user: CUENTA,
        llamadas,
        miembros,

        async groupMetadata(grupoId) {
            return { id: grupoId, participants: (miembros.get(grupoId) || []).map(p => ({ ...p })) };
        },

        async groupParticipantsUpdate(grupoId, participantes, accion) {

            llamadas.push({ grupoId, participantes, accion });

            if (fallaExpulsion) {
                throw new Error("not-authorized: el bot ya no es admin del grupo");
            }

            miembros.set(grupoId, miembros.get(grupoId).filter(p => !participantes.includes(p.id)));

            return participantes.map(jid => ({ status: "200", jid }));

        },

        reingresar(grupoId) {
            miembros.set(grupoId, [CUENTA_EN_GRUPO, participante]);
        }

    };

}

const resultados = [];

async function test(nombre, fn) {

    reiniciar();

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

    await test("1. participante normal entra -> no se expulsa", async () => {

        const participante = { id: "3001234567@s.whatsapp.net", phoneNumber: "3001234567@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.bloqueado, false);
        assert.strictEqual(sock.llamadas.length, 0);

    });

    await test("2. participante bloqueado por teléfono entra -> se expulsa", async () => {

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3001234567", motivo: "spam" });
        assert.ok(creado.ok, JSON.stringify(creado));

        const participante = { id: "573001234567@s.whatsapp.net", phoneNumber: "573001234567@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.bloqueado, true);
        assert.strictEqual(r.expulsado, true, JSON.stringify(r));
        assert.strictEqual(sock.llamadas.length, 1);
        assert.strictEqual(sock.llamadas[0].accion, "remove");
        assert.strictEqual(sock.llamadas[0].grupoId, "g1@g.us");

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.expulsiones, 1);
        assert.strictEqual(fila.intentos_ingreso, 1);

    });

    await test("3. participante bloqueado por LID entra -> se expulsa", async () => {

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", lid: "999888777@lid", motivo: "acoso" });

        const participante = { id: "999888777@lid", lid: "999888777@lid" };
        const sock = crearSockFake("tenantA", participante);

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.expulsado, true, JSON.stringify(r));
        assert.strictEqual(sock.llamadas.length, 1);

    });

    await test("4. bloqueado con teléfono + LID -> se expulsa", async () => {

        // La identidad ya está resuelta en "usuarios" (p. ej. por el escáner
        // de identidades en un escaneo anterior).
        fake.tablas.usuarios = [{ id: "u1", telefono: "3009998877", lid: "111222333@lid", nombre: "Juan" }];

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3009998877", lid: "111222333@lid", nombre: "Juan", motivo: "reincidente" });

        // El evento SOLO trae el LID.
        const participante = { id: "111222333@lid", lid: "111222333@lid" };
        const sock = crearSockFake("tenantA", participante);

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.expulsado, true, JSON.stringify(r));

    });

    await test("5 y 6. bloqueado entra a grupo A y luego a grupo B -> se expulsa de ambos", async () => {

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3005556677" });

        const participante = { id: "573005556677@s.whatsapp.net", phoneNumber: "573005556677@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const rA = await bloqueo.procesarIngresoParticipante(sock, "grupoA@g.us", participante);
        assert.strictEqual(rA.expulsado, true, JSON.stringify(rA));

        const rB = await bloqueo.procesarIngresoParticipante(sock, "grupoB@g.us", participante);
        assert.strictEqual(rB.expulsado, true, JSON.stringify(rB));

        assert.strictEqual(sock.llamadas.length, 2);
        assert.strictEqual(sock.llamadas[0].grupoId, "grupoA@g.us");
        assert.strictEqual(sock.llamadas[1].grupoId, "grupoB@g.us");

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.expulsiones, 2);
        assert.strictEqual(fila.ultimo_grupo_id, "grupoB@g.us");

    });

    await test("7. bloqueado reingresa más tarde -> se vuelve a expulsar", async () => {

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3001112233" });

        const participante = { id: "573001112233@s.whatsapp.net", phoneNumber: "573001112233@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const primero = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);
        assert.strictEqual(primero.expulsado, true, JSON.stringify(primero));

        // Fuera de la ventana de deduplicación, vuelve a entrar de verdad.
        bloqueo._limpiarLocksParaPruebas();
        sock.reingresar("g1@g.us");

        const segundo = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);
        assert.strictEqual(segundo.expulsado, true, JSON.stringify(segundo));

        assert.strictEqual(sock.llamadas.length, 2);

    });

    await test("8. error de WhatsApp al expulsar -> el bloqueo continúa activo", async () => {

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3004445566" });

        const participante = { id: "573004445566@s.whatsapp.net", phoneNumber: "573004445566@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante, { fallaExpulsion: true });

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.bloqueado, true);
        assert.strictEqual(r.expulsado, false);
        assert.ok(r.error);

        const fila = fake.tablas.bloqueados.find(v => v.id === creado.bloqueado.id);
        assert.strictEqual(fila.activo, true, "el bloqueo interno NUNCA se desactiva por un fallo de expulsión");
        assert.strictEqual(fila.expulsiones, 0);
        assert.strictEqual(fila.intentos_ingreso, 1);

        const incidente = fake.tablas.bloqueo_intentos.find(i => i.bloqueado_id === creado.bloqueado.id);
        assert.ok(incidente);
        assert.strictEqual(incidente.resultado, "error_whatsapp");
        assert.ok(incidente.error);

    });

    await test("9. evento duplicado -> no ejecuta expulsiones repetidas", async () => {

        await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3007778899" });

        const participante = { id: "573007778899@s.whatsapp.net", phoneNumber: "573007778899@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const [r1, r2] = await Promise.all([
            bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante),
            bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante)
        ]);

        const expulsados = [r1, r2].filter(r => r.expulsado).length;

        assert.strictEqual(expulsados, 1, "solo una de las dos señales duplicadas debe expulsar");
        assert.strictEqual(sock.llamadas.length, 1);

    });

    await test("10. desbloquear -> puede permanecer en el grupo normalmente", async () => {

        const creado = await bloqueadosRepo.crearBloqueo({ usuarioId: "tenantA", telefono: "3002223344" });
        assert.ok(creado.ok);

        const desbloqueado = await bloqueadosRepo.desbloquear(creado.bloqueado.id, "tenantA");
        assert.ok(desbloqueado.ok, JSON.stringify(desbloqueado));
        assert.strictEqual(desbloqueado.bloqueado.activo, false);

        const participante = { id: "573002223344@s.whatsapp.net", phoneNumber: "573002223344@s.whatsapp.net" };
        const sock = crearSockFake("tenantA", participante);

        const r = await bloqueo.procesarIngresoParticipante(sock, "g1@g.us", participante);

        assert.strictEqual(r.bloqueado, false);
        assert.strictEqual(sock.llamadas.length, 0);

    });

    const fallidas = resultados.filter(r => !r.ok);

    console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas OK`);

    if (fallidas.length > 0) {
        process.exitCode = 1;
    }

}

main();
