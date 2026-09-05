// ==========================================================================
// PRUEBAS DEL CICLO DE VIDA DEL ESCÁNER DE IDENTIDADES.
//
// Cubre los disparadores pedidos:
//   - iniciarEscanerIdentidades / detenerEscanerIdentidades
//   - escanearTodosLosGrupos (arranque/reinicio)
//   - escanearGrupo (apertura de un grupo) — vía la cola central
//     groupMetadata(), NUNCA groupFetchAllParticipating()
//   - "no duplicar escaneos" si dos señales llegan casi simultáneas
//
//     node backend/tests/identidad/escanerIdentidadesLifecycle.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE =
    path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/usuarios/escanerIdentidades.js",
    "../../bot/funciones/usuarios/escanerIdentidadesLifecycle.js"
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

    const lifecycle = require(RUTAS_A_RECARGAR[2]);

    return { fake, lifecycle };

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

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function promesaControlable() {

    let resolve;
    const promesa = new Promise(r => { resolve = r; });
    return { promesa, resolve };

}

function participante(o) {
    return { id: o.id, lid: o.lid || null, phoneNumber: o.phoneNumber || null, notify: o.notify || null };
}

async function main() {

    // ======================================================================
    // 1. escanearTodosLosGrupos importa identidades del escaneo completo.
    // ======================================================================
    await test("1. escanearTodosLosGrupos escanea todos los grupos e importa las identidades", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupFetchAllParticipating() {
                return {
                    "g1@g.us": { id: "g1@g.us", participants: [participante({ id: "111@lid" })] },
                    "g2@g.us": { id: "g2@g.us", participants: [participante({ id: "222@lid" })] }
                };
            }
        };

        const r = await lifecycle.escanearTodosLosGrupos("sesionA", sock);

        assert.ok(r);
        assert.strictEqual(r.resultado.estadisticas.gruposEncontrados, 2);
        assert.strictEqual(r.resultadoImport.importados, 2);
        assert.strictEqual(fake.tablas.usuarios.length, 2);

    });

    // ======================================================================
    // 2. Dos escaneos completos simultáneos para la misma sesión -> uno solo.
    // ======================================================================
    await test("2. escanearTodosLosGrupos: dos llamadas simultáneas -> solo un escaneo en curso", async () => {

        const { fake, lifecycle } = cargarModulos();

        const control = promesaControlable();
        let llamadas = 0;

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupFetchAllParticipating() {
                llamadas++;
                await control.promesa;
                return { "g1@g.us": { id: "g1@g.us", participants: [participante({ id: "333@lid" })] } };
            }
        };

        const p1 = lifecycle.escanearTodosLosGrupos("sesionB", sock);
        const p2 = lifecycle.escanearTodosLosGrupos("sesionB", sock); // casi simultánea

        const r2 = await p2; // la segunda no debe esperar nada, se omite de inmediato

        assert.strictEqual(r2, null, "la segunda llamada debe omitirse mientras la primera está en curso");
        assert.strictEqual(llamadas, 1, "solo debe haber una llamada real a groupFetchAllParticipating");

        control.resolve();
        const r1 = await p1;

        assert.ok(r1);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 3. escanearGrupo usa la cola central (groupMetadata), NUNCA
    //    groupFetchAllParticipating (que traería todos los grupos).
    // ======================================================================
    await test("3. escanearGrupo usa groupMetadata (cola central), no groupFetchAllParticipating", async () => {

        const { fake, lifecycle } = cargarModulos();

        let llamadasGroupMetadata = 0;
        let llamadasFetchAll = 0;

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                llamadasGroupMetadata++;
                return { id: grupoId, participants: [participante({ id: "444@lid" })] };
            },
            async groupFetchAllParticipating() {
                llamadasFetchAll++;
                return {};
            }
        };

        const r = await lifecycle.escanearGrupo("sesionC", sock, "gX@g.us");

        assert.ok(r);
        assert.strictEqual(llamadasGroupMetadata, 1);
        assert.strictEqual(llamadasFetchAll, 0, "un escaneo incremental de un grupo NUNCA debe traer todos los grupos");
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "444@lid");

    });

    // ======================================================================
    // 4. Dos aperturas casi simultáneas del MISMO grupo -> un solo escaneo.
    // ======================================================================
    await test("4. escanearGrupo: dos señales casi simultáneas del mismo grupo -> no duplica el escaneo", async () => {

        const { fake, lifecycle } = cargarModulos();

        const control = promesaControlable();
        let llamadas = 0;

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                llamadas++;
                await control.promesa;
                return { id: grupoId, participants: [participante({ id: "555@lid" })] };
            }
        };

        const p1 = lifecycle.escanearGrupo("sesionD", sock, "gY@g.us");
        const p2 = lifecycle.escanearGrupo("sesionD", sock, "gY@g.us"); // mismo grupo, casi simultánea

        const r2 = await p2;

        assert.strictEqual(r2, null, "la segunda señal para el mismo grupo debe omitirse");
        assert.strictEqual(llamadas, 1, "solo una IQ real para el mismo grupo");

        control.resolve();
        await p1;

        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 5. Grupos DISTINTOS sí pueden escanearse en paralelo (el bloqueo es
    //    por grupo, no global).
    // ======================================================================
    await test("5. escanearGrupo: grupos distintos no se bloquean entre sí", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                return { id: grupoId, participants: [participante({ id: `${grupoId}-666@lid` })] };
            }
        };

        const [r1, r2] = await Promise.all([
            lifecycle.escanearGrupo("sesionE", sock, "gA@g.us"),
            lifecycle.escanearGrupo("sesionE", sock, "gB@g.us")
        ]);

        assert.ok(r1);
        assert.ok(r2);
        assert.strictEqual(fake.tablas.usuarios.length, 2);

    });

    // ======================================================================
    // 6. escanearGrupo COMPLETA una identidad existente (no reconstruye
    //    toda la tabla, solo ese grupo).
    // ======================================================================
    await test("6. escanearGrupo completa el teléfono de una identidad ya existente (solo ese grupo)", async () => {

        const { fake, lifecycle } = cargarModulos();

        fake.tablas.usuarios.push({ id: "existente-1", lid: "777@lid", telefono: null, nombre: null });

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupMetadata(grupoId) {
                return {
                    id: grupoId,
                    participants: [participante({ id: "777@lid", lid: "777@lid", phoneNumber: "573007778899@s.whatsapp.net" })]
                };
            }
        };

        const r = await lifecycle.escanearGrupo("sesionF", sock, "gZ@g.us");

        assert.ok(r);
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear una fila nueva para la misma identidad");
        assert.strictEqual(fake.tablas.usuarios[0].id, "existente-1");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3007778899", "debe completar el teléfono");

    });

    // ======================================================================
    // 7. El propio BOT se excluye también en el escaneo incremental.
    // ======================================================================
    await test("7. escanearGrupo excluye al propio BOT", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net", lid: "999bot@lid" },
            async groupMetadata(grupoId) {
                return {
                    id: grupoId,
                    participants: [
                        participante({ id: "573106814436@s.whatsapp.net", lid: "999bot@lid" }),
                        participante({ id: "888@lid" })
                    ]
                };
            }
        };

        const r = await lifecycle.escanearGrupo("sesionG", sock, "gW@g.us");

        assert.ok(r);
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "888@lid");

    });

    // ======================================================================
    // 8. iniciarEscanerIdentidades dispara el escaneo inicial (no
    //    bloqueante) — se espera un tick y se confirma que corrió.
    // ======================================================================
    await test("8. iniciarEscanerIdentidades dispara un escaneo inicial completo en segundo plano", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupFetchAllParticipating() {
                return { "g1@g.us": { id: "g1@g.us", participants: [participante({ id: "111@lid" })] } };
            }
        };

        lifecycle.iniciarEscanerIdentidades("sesionH", sock); // no se espera a propósito

        await esperar(50); // deja correr el fire-and-forget

        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 9. detenerEscanerIdentidades: una señal tardía de una sesión ya
    //    detenida no debe hacer nada (protege contra socket muerto).
    // ======================================================================
    await test("9. detenerEscanerIdentidades cancela un escaneo tardío de esa sesión", async () => {

        const { fake, lifecycle } = cargarModulos();

        const sock = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupFetchAllParticipating() {
                return {}; // sin grupos, para el escaneo inicial de iniciarEscanerIdentidades
            }
        };

        lifecycle.iniciarEscanerIdentidades("sesionI", sock);
        await esperar(20);

        lifecycle.detenerEscanerIdentidades("sesionI");

        // Señal tardía simulada (p. ej. un evento que llegó después de que
        // la sesión ya cambió) — debe cancelarse sin tocar Supabase.
        const r = await lifecycle.escanearTodosLosGrupos("sesionI", sock);

        assert.strictEqual(r, null, "no debe escanear con una sesión ya detenida");
        assert.strictEqual(fake.tablas.usuarios.length, 0);

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

    console.error("💥 Error inesperado ejecutando las pruebas del ciclo de vida del escáner");
    console.error(err);
    process.exitCode = 1;

});
