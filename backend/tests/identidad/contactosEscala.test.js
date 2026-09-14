// ==========================================================================
// PRUEBAS DE ESCALA — listarContactos.js (informe "Bad Request" con
// ~2.800 contactos_tenant, 2026-09). Cubre específicamente lo que el fix
// de lotes debía garantizar:
//
//   - más de 300 contactos (dispara más de un lote de ids)
//   - división en lotes correcta (trocear())
//   - ~2.800 identidades (la escala real de producción)
//   - concurrencia acotada al leer "usuarios" por lotes
//
// Mismo estilo que el resto del proyecto: script plano de Node, sin jest,
// fake de Supabase inyectado vía require.cache.
//
//     node backend/tests/identidad/contactosEscala.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_LISTAR_CONTACTOS = path.resolve(__dirname, "../../bot/funciones/usuarios/listarContactos.js");

const TENANT = "tenant-escala";

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_LISTAR_CONTACTOS];

    const mod = require(RUTA_LISTAR_CONTACTOS);

    return { fake, ...mod };

}

// Siembra N contactos ya resueltos directamente en las tablas del fake
// (usuarios + contactos_tenant) — no pasa por obtenerUsuarioGlobal a
// propósito: estas pruebas son sobre listarContactos/obtenerUsuariosPorIds,
// no sobre la resolución de identidad (ya cubierta en contactosTenant.test.js
// e identityResolver.test.js).
function sembrarContactos(fake, cantidad, { tenant = TENANT, conTelefono = false } = {}) {

    // tests/identidad/fakeSupabase.js solo pre-inicializa "usuarios" y
    // "mensajes_grupos_sorteos" -- contactos_tenant se crea recién al
    // primer .from("contactos_tenant"), que estas pruebas no disparan antes
    // de sembrar directo.
    if (!fake.tablas.contactos_tenant) fake.tablas.contactos_tenant = [];

    const ahora = new Date();

    for (let i = 0; i < cantidad; i++) {

        const id = `u-${i}`;

        fake.tablas.usuarios.push({
            id,
            nombre: `Persona ${i}`,
            telefono: conTelefono ? `300${String(i).padStart(7, "0")}` : null,
            lid: `${1000000 + i}@lid`
        });

        fake.tablas.contactos_tenant.push({
            usuario_id: tenant,
            usuario_global_id: id,
            primer_visto_en: ahora,
            ultimo_visto_en: new Date(ahora.getTime() + i), // orden determinístico
            origen: "escaneo_grupo"
        });

    }

}

// Envuelve fake.client.from() para medir cuántas ejecuciones de query están
// EN VUELO al mismo tiempo (concurrencia real) — sin tocar el fake
// compartido. Cada ejecución se retrasa unos milisegundos a propósito para
// forzar que se solapen si de verdad corren en paralelo. Se mide SOLO la
// tabla indicada (aquí, "usuarios") — listarContactos también dispara en
// paralelo las consultas de reservas (otras tablas, otro presupuesto de
// concurrencia, no gobernado por CONCURRENCIA_LOTES_IDS), así que medir
// TODAS las tablas juntas mediría un número que ningún código promete
// acotar.
function medirConcurrencia(client, tablaAMedir) {

    let enVuelo = 0;
    let maximo = 0;

    const fromOriginal = client.from.bind(client);

    client.from = (tabla) => {

        const builder = fromOriginal(tabla);

        if (tabla !== tablaAMedir) return builder;

        const thenOriginal = builder.then.bind(builder);

        builder.then = (onFulfilled, onRejected) => {

            enVuelo++;
            maximo = Math.max(maximo, enVuelo);

            return thenOriginal((valor) => {

                return new Promise((resolve) => {
                    setTimeout(() => {
                        enVuelo--;
                        resolve(onFulfilled ? onFulfilled(valor) : valor);
                    }, 4);
                });

            }, (err) => {

                enVuelo--;
                if (onRejected) return onRejected(err);
                throw err;

            });

        };

        return builder;

    };

    return { obtenerMaximo: () => maximo };

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
    // 1. trocear() divide correctamente, sin perder ni duplicar elementos.
    // ======================================================================
    await test("1. trocear() divide un array en lotes del tamaño esperado, sin perder elementos", async () => {

        const { trocear } = cargarModulos();

        const array = Array.from({ length: 733 }, (_, i) => i);
        const lotes = trocear(array, 250);

        assert.strictEqual(lotes.length, 3, "733 / 250 -> 3 lotes (250 + 250 + 233)");
        assert.strictEqual(lotes[0].length, 250);
        assert.strictEqual(lotes[1].length, 250);
        assert.strictEqual(lotes[2].length, 233);

        const reunido = lotes.flat();
        assert.deepStrictEqual(reunido, array, "ningún elemento se pierde ni se duplica al trocear");

    });

    // ======================================================================
    // 2. Concurrencia acotada del helper genérico (sin Supabase de por
    //    medio) — nunca deja más de N tareas en vuelo a la vez.
    // ======================================================================
    await test("2. conConcurrenciaLimitada nunca ejecuta más de N tareas a la vez", async () => {

        const { conConcurrenciaLimitada } = cargarModulos();

        let enVuelo = 0;
        let maximo = 0;

        const tareas = Array.from({ length: 47 }, (_, i) => i);

        await conConcurrenciaLimitada(tareas, 5, async (item) => {

            enVuelo++;
            maximo = Math.max(maximo, enVuelo);

            await new Promise((resolve) => setTimeout(resolve, 2));

            enVuelo--;
            return item;

        });

        assert.ok(maximo <= 5, `nunca deben coincidir más de 5 tareas en vuelo (máximo observado: ${maximo})`);
        assert.ok(maximo > 1, "la prueba debe demostrar concurrencia REAL (no una ejecución 100% serial) -- máximo observado: " + maximo);

    });

    // ======================================================================
    // 3. Más de 300 contactos (dispara 2 lotes de ids con TAMANO_LOTE_IDS=250)
    //    -> listarContactos devuelve TODOS, sin truncar ni duplicar.
    // ======================================================================
    await test("3. listarContactos con 320 contactos (2 lotes) devuelve los 320 completos", async () => {

        const { fake, listarContactos, TAMANO_LOTE_IDS } = cargarModulos();

        assert.strictEqual(TAMANO_LOTE_IDS, 250, "la prueba asume el tamaño de lote documentado");

        sembrarContactos(fake, 320);

        const { contactos } = await listarContactos({ usuarioId: TENANT });

        assert.strictEqual(contactos.length, 320);

        const idsUnicos = new Set(contactos.map((c) => c.id));
        assert.strictEqual(idsUnicos.size, 320, "sin duplicados");

        // 320 ids / 250 por lote -> exactamente 2 llamadas SELECT a "usuarios".
        assert.strictEqual(fake.llamadas.usuarios.select, 2);

    });

    // ======================================================================
    // 4. ~2.800 contactos (la escala real de producción) -> 12 lotes,
    //    ninguno excede el límite que causaba el "Bad Request" original.
    // ======================================================================
    await test("4. listarContactos con 2.800 contactos (escala real) -> todos presentes, en lotes de máx. 250", async () => {

        const { fake, listarContactos } = cargarModulos();

        sembrarContactos(fake, 2800, { conTelefono: true });

        const { contactos } = await listarContactos({ usuarioId: TENANT });

        assert.strictEqual(contactos.length, 2800, "los ~2.800 contactos deben aparecer completos");

        // 2800 / 250 = 11.2 -> 12 lotes.
        assert.strictEqual(fake.llamadas.usuarios.select, 12);

        // Más recientes primero (sembrarContactos asigna ultimo_visto_en
        // creciente con i, así que el último sembrado -id más alto- debe
        // quedar primero).
        assert.strictEqual(contactos[0].id, "u-2799");

    });

    // ======================================================================
    // 5. Concurrencia acotada MEDIDA EN VIVO sobre el camino real
    //    (listarContactos -> obtenerUsuariosPorIds -> Supabase): nunca hay
    //    más de CONCURRENCIA_LOTES_IDS lecturas de "usuarios" en vuelo a la vez.
    // ======================================================================
    await test("5. listarContactos a escala real: la concurrencia contra Supabase queda acotada (no todos los lotes a la vez)", async () => {

        const { fake, listarContactos } = cargarModulos();

        sembrarContactos(fake, 2800);

        const medidor = medirConcurrencia(fake.client, "usuarios");

        const { contactos } = await listarContactos({ usuarioId: TENANT });

        assert.strictEqual(contactos.length, 2800);

        // 12 lotes en total, concurrencia acotada a 5 -> nunca deben coincidir
        // los 12 a la vez, pero SÍ debe haber concurrencia real (>1).
        assert.ok(medidor.obtenerMaximo() <= 5, `concurrencia máxima observada (${medidor.obtenerMaximo()}) no debe superar 5`);
        assert.ok(medidor.obtenerMaximo() > 1, "debe haber concurrencia real, no un lote a la vez");

    });

    // ======================================================================
    // 6. Un lote que falla no vacía todo el listado -- los demás lotes
    //    (que sí tuvieron éxito) siguen apareciendo.
    // ======================================================================
    await test("6. Si un lote de identidades falla, los contactos de los OTROS lotes siguen apareciendo", async () => {

        const { fake, listarContactos } = cargarModulos();

        sembrarContactos(fake, 320); // 2 lotes: [0..249], [250..319]

        // Se fuerza el error en la PRIMERA consulta select a "usuarios"
        // (agota exactamente un uso del error forzado).
        fake.forzarProximoError("usuarios", "select", { message: "fallo simulado de red" });

        const { contactos } = await listarContactos({ usuarioId: TENANT });

        // El primer lote (250 ids) falló: quedan 70 del segundo lote.
        assert.strictEqual(contactos.length, 70, "el lote fallido no debe vaciar el listado completo");

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
    console.error("💥 Error inesperado ejecutando las pruebas de escala de Contactos");
    console.error(err);
    process.exitCode = 1;
});
