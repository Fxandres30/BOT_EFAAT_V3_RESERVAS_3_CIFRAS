// ==========================================================================
// PRUEBAS DE ESCALA — escanerIdentidades.js::importarIdentidades()
// (informe "escaneo de ~2.800 participantes tarda 30-60min", 2026-09).
//
// Cubre específicamente lo que el fix de concurrencia debía garantizar:
//   - ~2.800 identidades importadas correctamente (LID-only y LID+teléfono)
//   - concurrencia acotada al resolver contra Supabase (no todo en serie,
//     tampoco todo a la vez)
//   - un error individual NO aborta el resto del escaneo
//   - usuarioIdTenant nunca se pierde a escala
//   - nunca se duplica un usuario ni una relación tenant/contacto
//
// El guard "dos escaneos simultáneos para la misma sesión" YA tiene una
// prueba dedicada y verificada en
// tests/identidad/escanerIdentidadesLifecycle.test.js
// ("2. escanearTodosLosGrupos: dos llamadas simultáneas -> solo un escaneo
// en curso") — no se duplica aquí, ver el resumen final.
//
//     node backend/tests/identidad/escanerIdentidadesEscala.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/usuarios/identityScanner/identityResolver.js",
    "../../bot/funciones/usuarios/escanerIdentidades.js"
].map((p) => path.resolve(__dirname, p));

const TENANT = "tenant-escala-scan";

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    RUTAS_A_RECARGAR.forEach((r) => delete require.cache[r]);

    const { importarIdentidades } = require(RUTAS_A_RECARGAR[2]);

    return { fake, importarIdentidades };

}

function generarIdentidades(cantidad, { conTelefono = false } = {}) {

    return Array.from({ length: cantidad }, (_, i) => ({
        lid: `${2000000 + i}@lid`,
        telefono: conTelefono && i % 2 === 0 ? `300${String(i).padStart(7, "0")}` : null,
        nombre: `Participante ${i}`
    }));

}

// Mismo criterio que contactosEscala.test.js::medirConcurrencia — mide
// concurrencia REAL contra una tabla específica, sin tocar el fake
// compartido.
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
                    }, 3);
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

// Hace que la N-ésima llamada a .from(tabla) de todo el proceso RECHACE
// (excepción real, no un {data:null,error} manejado con gracia por
// buscarPorCampo) — simula un fallo duro (p. ej. de red), no un error de
// Postgres ya contemplado. Determinístico: con Promise.all sobre un array,
// cada función async arranca en orden hasta su primer await, así que la
// llamada #1 siempre pertenece a identidades[0].
function forzarExcepcionEnLlamada(client, tabla, numeroLlamada) {

    let contador = 0;

    const fromOriginal = client.from.bind(client);

    client.from = (t) => {

        const builder = fromOriginal(t);

        if (t !== tabla) return builder;

        const thenOriginal = builder.then.bind(builder);

        builder.then = (onFulfilled, onRejected) => {

            contador++;

            if (contador === numeroLlamada) {

                // IMPORTANTE: hay que INVOCAR onRejected (el protocolo
                // "thenable" del que depende `await`) — devolver una
                // promesa rechazada sin más, sin que nadie la consuma,
                // queda como unhandled rejection y tumba el proceso entero.
                const error = new Error("fallo de red simulado (excepción real, no error de Supabase)");
                return onRejected ? onRejected(error) : Promise.reject(error).catch(() => {});

            }

            return thenOriginal(onFulfilled, onRejected);

        };

        return builder;

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
    // 1. ~2.800 identidades LID-only, todas nuevas -> se importan todas,
    //    sin duplicados, cada una con su relación tenant/contacto.
    // ======================================================================
    await test("1. importarIdentidades con 2.800 identidades LID-only -> todas importadas, sin duplicados", async () => {

        const { fake, importarIdentidades } = cargarModulos();

        const identidades = generarIdentidades(2800);

        const resultado = await importarIdentidades({ identidades, usuarioIdTenant: TENANT });

        assert.strictEqual(resultado.total, 2800);
        assert.strictEqual(resultado.nuevos, 2800);
        assert.strictEqual(resultado.errores, 0);
        assert.strictEqual(resultado.importados, 2800);

        assert.strictEqual(fake.tablas.usuarios.length, 2800, "no debe haber usuarios duplicados");

        const lidsUnicos = new Set(fake.tablas.usuarios.map((u) => u.lid));
        assert.strictEqual(lidsUnicos.size, 2800);

        // Relación tenant/contacto: una por identidad, para el tenant correcto
        // (usuarioIdTenant nunca se pierde a escala).
        assert.strictEqual(fake.tablas.contactos_tenant.length, 2800);
        assert.ok(fake.tablas.contactos_tenant.every((r) => r.usuario_id === TENANT), "usuarioIdTenant debe propagarse a CADA relación, sin excepción");

    });

    // ======================================================================
    // 2. Mezcla LID-only / LID+teléfono a escala -> cada una con su
    //    identidad correcta, ninguna se confunde con otra.
    // ======================================================================
    await test("2. importarIdentidades con mezcla LID-only y LID+teléfono (2.800) -> cada identidad correcta", async () => {

        const { fake, importarIdentidades } = cargarModulos();

        const identidades = generarIdentidades(2800, { conTelefono: true });

        const resultado = await importarIdentidades({ identidades, usuarioIdTenant: TENANT });

        assert.strictEqual(resultado.nuevos, 2800);
        assert.strictEqual(fake.tablas.usuarios.length, 2800);

        const conTelefono = fake.tablas.usuarios.filter((u) => u.telefono);
        const soloLid = fake.tablas.usuarios.filter((u) => !u.telefono);

        // La mitad (i par) se generó con teléfono -- 1400 de 2800.
        assert.strictEqual(conTelefono.length, 1400);
        assert.strictEqual(soloLid.length, 1400);

        // Un LID nunca se convierte en teléfono, y viceversa -- regla dura
        // sin cambios.
        for (const u of fake.tablas.usuarios) {
            assert.ok(u.lid.endsWith("@lid"));
            if (u.telefono) assert.ok(/^\d{10}$/.test(u.telefono));
        }

    });

    // ======================================================================
    // 3. Concurrencia acotada MEDIDA EN VIVO contra "usuarios" durante un
    //    escaneo a escala real.
    // ======================================================================
    await test("3. importarIdentidades a escala real: concurrencia contra Supabase queda acotada (no 2.800 a la vez, no una por una)", async () => {

        const { fake, importarIdentidades } = cargarModulos();

        const identidades = generarIdentidades(300); // suficiente para observar varios lotes

        const medidor = medirConcurrencia(fake.client, "usuarios");

        await importarIdentidades({ identidades, usuarioIdTenant: TENANT });

        // CONCURRENCIA_IMPORTACION documentado = 18. Cada identidad hace
        // VARIAS llamadas a "usuarios" (canonicalizarLid, resolverIdentidadExistente,
        // insert...), así que el máximo real puede superar 18 en algún
        // instante puntual (varias fases de distintas identidades del mismo
        // lote coincidiendo) -- lo que se garantiza es que NO se procesan las
        // 300 identidades de una sola vez (habría sido cientos de llamadas
        // simultáneas) y que SÍ hay paralelismo real.
        assert.ok(medidor.obtenerMaximo() > 1, "debe haber concurrencia real, no todo en serie");
        assert.ok(medidor.obtenerMaximo() < 300, "no debe procesar las 300 identidades del todo a la vez (sigue habiendo límite de lote)");

    });

    // ======================================================================
    // 4. Un error individual (excepción real, no un error de Postgres ya
    //    manejado) NO aborta el resto del escaneo.
    // ======================================================================
    await test("4. Una identidad que falla con una excepción real no aborta el resto del escaneo", async () => {

        const { fake, importarIdentidades } = cargarModulos();

        const identidades = generarIdentidades(50);

        // La llamada #1 a .from("usuarios") de TODO el proceso pertenece,
        // de forma determinística, a identidades[0] (Promise.all sobre un
        // array dispara cada función en orden hasta su primer await).
        forzarExcepcionEnLlamada(fake.client, "usuarios", 1);

        const resultado = await importarIdentidades({ identidades, usuarioIdTenant: TENANT });

        assert.strictEqual(resultado.total, 50, "las 50 identidades deben procesarse, ninguna debe abortar el escaneo completo");
        assert.strictEqual(resultado.errores, 1, "exactamente 1 error registrado");
        assert.strictEqual(resultado.nuevos, 49, "las otras 49 deben importarse igual, sin verse afectadas por el error de la primera");

        assert.strictEqual(fake.tablas.usuarios.length, 49, "la identidad que falló no debe haber creado ninguna fila a medias");

        const conError = resultado.resultados.filter((r) => r.errorInesperado);
        assert.strictEqual(conError.length, 1);
        assert.strictEqual(conError[0].usuario, null);

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
    console.error("💥 Error inesperado ejecutando las pruebas de escala del escáner de identidades");
    console.error(err);
    process.exitCode = 1;
});
