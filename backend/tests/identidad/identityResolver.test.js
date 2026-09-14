// ==========================================================================
// PRUEBAS DE identityResolver.js — capa 3 del IdentitySync
// (IdentityScanner -> IdentityNormalizer -> IdentityResolver -> "usuarios").
//
// No reimplementa las pruebas de obtenerUsuarioGlobal.js (enriquecimiento/
// conflicto de base) — esas ya existen y siguen intactas. Esto prueba
// específicamente lo que identityResolver.js AGREGA por encima:
//   - elegir el mejor candidato de una persona ya normalizada
//   - canonicalización de LID con/sin sufijo de dispositivo (sección 6)
//   - detección de "hubo cambio real" para logging (esNuevo/fueEnriquecido)
//
//     node backend/tests/identidad/identityResolver.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/usuarios/identityScanner/identityResolver.js"
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

    const resolver = require(RUTAS_A_RECARGAR[1]);

    return { fake, resolver };

}

// Construye el mismo shape que produce normalizarCandidatos() para UNA
// persona, sin pasar por el escaneo recursivo completo (las pruebas de
// extracción ya viven en backend/_test_identity_scanner.js).
function candidatoTelefono(valor, valido = true) {
    return { tipo: "phone", valor, crudo: `${valor}@s.whatsapp.net`, valido, source: "test" };
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
    // Caso A / creación
    // ======================================================================
    await test("A. Sin usuario previo + solo LID -> crea usuario nuevo (esNuevo=true)", async () => {

        const { fake, resolver } = cargarModulos();

        const r = await resolver.resolverIdentidad({
            telefonos: [],
            lids: ["555000111@lid"],
            candidatos: [],
            nombre: "Nuevo Cliente"
        });

        assert.ok(r.usuario);
        assert.strictEqual(r.esNuevo, true);
        assert.strictEqual(r.fueEnriquecido, false);
        assert.strictEqual(r.conflicto, false);
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "555000111@lid");

    });

    // ======================================================================
    // Caso C: usuario ya existe con LID+telefono null -> llega el teléfono
    // ======================================================================
    await test("C. Usuario existente (LID, sin teléfono) + llega teléfono -> se enriquece, NO se duplica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-1", lid: "123456@lid", telefono: null, nombre: null });

        const r = await resolver.resolverIdentidad({
            telefonos: ["3001234567"],
            lids: ["123456@lid"],
            candidatos: [candidatoTelefono("3001234567")]
        });

        assert.strictEqual(r.esNuevo, false);
        assert.strictEqual(r.fueEnriquecido, true);
        assert.strictEqual(r.usuario.id, "u-1");
        assert.strictEqual(r.usuario.telefono, "3001234567");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear una segunda fila");

    });

    // ======================================================================
    // Caso simétrico: usuario ya existe con teléfono+LID null -> llega el LID
    // ======================================================================
    await test("Usuario existente (teléfono, sin LID) + llega LID -> se enriquece, NO se duplica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-2", lid: null, telefono: "3009998888", nombre: null });

        const r = await resolver.resolverIdentidad({
            telefonos: ["3009998888"],
            lids: ["777888@lid"],
            candidatos: [candidatoTelefono("3009998888")]
        });

        assert.strictEqual(r.fueEnriquecido, true);
        assert.strictEqual(r.usuario.id, "u-2");
        assert.strictEqual(r.usuario.lid, "777888@lid");
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // Caso D: LID + teléfono juntos, primera vez -> una sola identidad
    // ======================================================================
    await test("D. LID + teléfono juntos (primera vez, mismo mensaje) -> una sola identidad creada", async () => {

        const { fake, resolver } = cargarModulos();

        const r = await resolver.resolverIdentidad({
            telefonos: ["3005551111"],
            lids: ["999111@lid"],
            candidatos: [candidatoTelefono("3005551111")],
            nombre: "Persona D"
        });

        assert.strictEqual(r.esNuevo, true);
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.usuarios[0].lid, "999111@lid");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3005551111");

    });

    // ======================================================================
    // Caso E (dirección 1): ya existe SIN sufijo, llega CON sufijo -> no duplica
    // ======================================================================
    await test("E1. Existe LID sin sufijo de dispositivo, llega el mismo LID CON sufijo -> se reutiliza, no duplica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-3", lid: "444555666@lid", telefono: null, nombre: "Con Bare" });

        const r = await resolver.resolverIdentidad({
            telefonos: [],
            lids: ["444555666:11@lid"], // mismo user, CON sufijo de dispositivo
            candidatos: []
        });

        assert.strictEqual(r.esNuevo, false, "no debe tratarse como una identidad nueva");
        assert.strictEqual(r.usuario.id, "u-3", "debe resolver a la fila YA existente");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "NO debe crear una segunda fila por el sufijo de dispositivo");
        assert.strictEqual(r.lidUsado, "444555666@lid", "debe canonicalizar al valor YA guardado (sin sufijo), no al crudo con sufijo");

    });

    // ======================================================================
    // Caso E (dirección 2): ya existe CON sufijo, llega SIN sufijo -> no duplica
    // ======================================================================
    await test("E2. Existe LID CON sufijo de dispositivo, llega el mismo LID SIN sufijo -> se reutiliza, no duplica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-4", lid: "222333444:5@lid", telefono: null, nombre: null });

        const r = await resolver.resolverIdentidad({
            telefonos: [],
            lids: ["222333444@lid"], // mismo user, SIN sufijo
            candidatos: []
        });

        assert.strictEqual(r.usuario.id, "u-4");
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // Caso E (dirección 3): dos sufijos de dispositivo DISTINTOS, ninguno bare
    // ======================================================================
    await test("E3. Existe LID con sufijo :5, llega el mismo LID con sufijo :11 (ninguno bare) -> se reutiliza, no duplica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-5", lid: "111222333:5@lid", telefono: null, nombre: null });

        const r = await resolver.resolverIdentidad({
            telefonos: [],
            lids: ["111222333:11@lid"],
            candidatos: []
        });

        assert.strictEqual(r.usuario.id, "u-5");
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 7. Conflicto: LID A ya es de X, teléfono ya es de Y (distintos) ->
    //    llega LID A + teléfono de Y -> IDENTITY_CONFLICT, nada se toca.
    // ======================================================================
    await test("Conflicto: LID de un usuario + teléfono de OTRO usuario -> conflicto=true, ninguno se modifica", async () => {

        const { fake, resolver } = cargarModulos();

        fake.tablas.usuarios.push({ id: "u-X", lid: "AAA111@lid", telefono: null, nombre: null });
        fake.tablas.usuarios.push({ id: "u-Y", lid: null, telefono: "3001112222", nombre: null });

        const r = await resolver.resolverIdentidad({
            telefonos: ["3001112222"],
            lids: ["AAA111@lid"],
            candidatos: [candidatoTelefono("3001112222")]
        });

        assert.strictEqual(r.conflicto, true);
        assert.strictEqual(r.usuario, null);
        assert.strictEqual(fake.tablas.usuarios.length, 2, "no debe crear ni fusionar filas");

        const x = fake.tablas.usuarios.find(u => u.id === "u-X");
        const y = fake.tablas.usuarios.find(u => u.id === "u-Y");

        assert.strictEqual(x.telefono, null, "el usuario X no debe recibir el teléfono del conflicto");
        assert.strictEqual(y.lid, null, "el usuario Y no debe recibir el LID del conflicto");

    });

    // ======================================================================
    // Sin identificadores -> no llama a Supabase en absoluto
    // ======================================================================
    await test("Sin teléfono ni LID -> no resuelve nada, no toca Supabase", async () => {

        const { fake, resolver } = cargarModulos();

        const r = await resolver.resolverIdentidad({ telefonos: [], lids: [], candidatos: [] });

        assert.strictEqual(r.usuario, null);
        assert.strictEqual(r.conflicto, false);
        assert.strictEqual(fake.tablas.usuarios.length, 0);
        assert.deepStrictEqual(fake.llamadas.usuarios, undefined, "no debe haber ni una sola llamada a la tabla usuarios");

    });

    // ======================================================================
    // fromMe -> nunca resuelve identidad de cliente
    // ======================================================================
    await test("fromMe=true -> nunca resuelve, aunque traiga LID/teléfono", async () => {

        const { fake, resolver } = cargarModulos();

        const r = await resolver.resolverIdentidad({
            telefonos: ["3000000000"],
            lids: ["000111@lid"],
            candidatos: [candidatoTelefono("3000000000")],
            fromMe: true
        });

        assert.strictEqual(r.usuario, null);
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
    console.error("💥 Error inesperado ejecutando las pruebas de identityResolver");
    console.error(err);
    process.exitCode = 1;
});
