// ==========================================================================
// PRUEBAS de contactos_tenant (migración 018) — la relación real
// tenant<->identidad que reemplaza a reservas/mensajes como fuente de
// "quién existe" en el panel Contactos (diagnóstico de arquitectura,
// 2026-09: "Contactos muestra ~147 en vez de ~2.800").
//
// Cubre, en un solo archivo:
//   - obtenerUsuarioGlobal.js::registrarContactoTenant (vía el parámetro
//     público usuarioIdTenant)
//   - listarContactos.js (contactos_tenant JOIN usuarios, sin filtrar por
//     reservas/mensajes)
//   - obtenerPerfilContacto.js (ya no exige reservas para existir)
//   - agregarTelefonoContacto.js (no duplica, no sobrescribe)
//   - aislamiento entre tenants sobre la MISMA identidad global
//
// Mismo estilo que el resto del proyecto: script plano de Node, sin jest,
// fake de Supabase inyectado vía require.cache.
//
//     node backend/tests/identidad/contactosTenant.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");

const RUTAS_A_RECARGAR = [
    "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js",
    "../../bot/funciones/usuarios/listarContactos.js",
    "../../bot/funciones/usuarios/obtenerPerfilContacto.js",
    "../../bot/funciones/usuarios/agregarTelefonoContacto.js",
    "../../bot/funciones/usuarios/identityScanner/normalizarCandidatos.js"
].map((p) => path.resolve(__dirname, p));

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    RUTAS_A_RECARGAR.forEach((r) => delete require.cache[r]);

    const obtenerUsuarioGlobalMod = require(RUTAS_A_RECARGAR[0]);
    const { listarContactos } = require(RUTAS_A_RECARGAR[1]);
    const { obtenerPerfilContacto } = require(RUTAS_A_RECARGAR[2]);
    const { agregarTelefonoContacto } = require(RUTAS_A_RECARGAR[3]);

    return { fake, obtenerUsuarioGlobalMod, listarContactos, obtenerPerfilContacto, agregarTelefonoContacto };

}

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";

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
    // 1. Participante descubierto (LID, escaneo de grupo) -> contacto tenant.
    // ======================================================================
    await test("1. Participante descubierto vía escaneo -> crea la relación en contactos_tenant", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900001@lid",
            nombre: "Kelly J",
            usuarioIdTenant: TENANT_A,
            origenContacto: "escaneo_grupo"
        });

        assert.ok(usuario);

        const relaciones = fake.tablas.contactos_tenant || [];

        assert.strictEqual(relaciones.length, 1);
        assert.strictEqual(relaciones[0].usuario_id, TENANT_A);
        assert.strictEqual(relaciones[0].usuario_global_id, usuario.id);
        assert.strictEqual(relaciones[0].origen, "escaneo_grupo");
        assert.ok(relaciones[0].primer_visto_en);
        assert.ok(relaciones[0].ultimo_visto_en);

    });

    // ======================================================================
    // 2. Mismo usuario descubierto de nuevo -> NO duplica la relación, solo
    //    refresca ultimo_visto_en; primer_visto_en y origen no se tocan.
    // ======================================================================
    await test("2. Mismo contacto descubierto otra vez -> no duplica la relación, solo refresca ultimo_visto_en", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900002@lid",
            usuarioIdTenant: TENANT_A,
            origenContacto: "escaneo_grupo"
        });

        // Se fuerza un primer_visto_en/ultimo_visto_en "viejo" para poder
        // comprobar que la segunda resolución SÍ avanza ultimo_visto_en y
        // NO toca primer_visto_en/origen.
        const viejo = new Date("2020-01-01T00:00:00.000Z");
        fake.tablas.contactos_tenant[0].primer_visto_en = viejo;
        fake.tablas.contactos_tenant[0].ultimo_visto_en = viejo;

        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900002@lid",
            usuarioIdTenant: TENANT_A,
            origenContacto: "mensaje" // origen distinto -- no debe sobrescribir el primero
        });

        assert.strictEqual(u1.id, u2.id);

        const relaciones = fake.tablas.contactos_tenant;

        assert.strictEqual(relaciones.length, 1, "no debe crear una segunda fila de relación");
        assert.strictEqual(relaciones[0].origen, "escaneo_grupo", "el origen del primer descubrimiento no se sobrescribe");
        assert.strictEqual(new Date(relaciones[0].primer_visto_en).getTime(), viejo.getTime(), "primer_visto_en nunca se toca en una relación ya existente");
        assert.ok(new Date(relaciones[0].ultimo_visto_en).getTime() > viejo.getTime(), "ultimo_visto_en SÍ debe avanzar");

    });

    // ======================================================================
    // 3. LID sin teléfono -> igual se registra el contacto (sin inventar
    //    ningún teléfono).
    // ======================================================================
    await test("3. LID sin teléfono -> se registra el contacto, telefono queda null", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900003@lid",
            nombre: "Solo Lid",
            usuarioIdTenant: TENANT_A
        });

        assert.strictEqual(usuario.telefono, null);
        assert.strictEqual(fake.tablas.contactos_tenant.length, 1);
        assert.strictEqual(fake.tablas.contactos_tenant[0].usuario_global_id, usuario.id);

    });

    // ======================================================================
    // 4. LID + teléfono juntos -> una sola identidad, una sola relación.
    // ======================================================================
    await test("4. LID + teléfono juntos -> una identidad, una relación tenant/contacto", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900004@lid",
            telefono: "3009000004",
            nombre: "Lid Y Tel",
            usuarioIdTenant: TENANT_A
        });

        assert.strictEqual(usuario.lid, "900004@lid");
        assert.strictEqual(usuario.telefono, "3009000004");
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(fake.tablas.contactos_tenant.length, 1);

    });

    // ======================================================================
    // 5. Un "mensaje" posterior (misma persona) actualiza ultimo_visto_en.
    // ======================================================================
    await test("5. Resolución posterior (simulando un mensaje) actualiza ultimo_visto_en", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900005@lid",
            usuarioIdTenant: TENANT_A,
            origenContacto: "escaneo_grupo"
        });

        const antes = new Date("2021-06-01T00:00:00.000Z");
        fake.tablas.contactos_tenant[0].ultimo_visto_en = antes;

        await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900005@lid",
            usuarioIdTenant: TENANT_A,
            origenContacto: "mensaje"
        });

        assert.ok(new Date(fake.tablas.contactos_tenant[0].ultimo_visto_en).getTime() > antes.getTime());

    });

    // ======================================================================
    // 6. Contacto SIN ninguna reserva sigue apareciendo en listarContactos.
    // ======================================================================
    await test("6. Contacto sin reservas sigue apareciendo en listarContactos (con cantidadReservas=0)", async () => {

        const { fake, obtenerUsuarioGlobalMod, listarContactos } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900006@lid",
            nombre: "Nunca Reservó",
            usuarioIdTenant: TENANT_A
        });

        // A propósito NO se siembra ninguna fila en ninguna tabla dinámica
        // de reservas para este usuario.

        const { contactos } = await listarContactos({ usuarioId: TENANT_A });

        const encontrado = contactos.find((c) => c.id === usuario.id);

        assert.ok(encontrado, "el contacto debe aparecer aunque nunca haya reservado");
        assert.strictEqual(encontrado.cantidadReservas, 0);
        assert.strictEqual(encontrado.cantidadPagadas, 0);

    });

    // ======================================================================
    // 6-B. obtenerPerfilContacto tampoco exige reservas/mensajes.
    // ======================================================================
    await test("6-B. obtenerPerfilContacto no devuelve null solo porque el contacto no tenga reservas", async () => {

        const { obtenerUsuarioGlobalMod, obtenerPerfilContacto } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900007@lid",
            nombre: "Recién Descubierto",
            usuarioIdTenant: TENANT_A
        });

        const perfil = await obtenerPerfilContacto({ usuarioId: TENANT_A, contactoId: usuario.id });

        assert.ok(perfil, "el perfil debe poder abrirse aunque no haya reservas/mensajes");
        assert.strictEqual(perfil.identidad.id, usuario.id);
        assert.strictEqual(perfil.identidad.telefonoPendiente, true);
        assert.deepStrictEqual(perfil.reservas, []);
        assert.deepStrictEqual(perfil.actividad, []);

    });

    // ======================================================================
    // 7. Agregar teléfono no crea un usuario ni una relación duplicada.
    // ======================================================================
    await test("7. agregarTelefonoContacto asocia el teléfono al mismo usuario_global_id sin duplicar nada", async () => {

        const { fake, obtenerUsuarioGlobalMod, agregarTelefonoContacto } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "900008@lid",
            nombre: "Falta Tel",
            usuarioIdTenant: TENANT_A
        });

        const resultado = await agregarTelefonoContacto({ contactoId: usuario.id, telefono: "3009000008" });

        assert.strictEqual(resultado.ok, true);
        assert.strictEqual(resultado.usuario.id, usuario.id);
        assert.strictEqual(resultado.usuario.telefono, "3009000008");

        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear un usuario nuevo");
        assert.strictEqual(fake.tablas.contactos_tenant.length, 1, "no debe crear una relación nueva");

        // No sobrescribe un teléfono YA asignado con uno distinto.
        const segundo = await agregarTelefonoContacto({ contactoId: usuario.id, telefono: "3001112222" });

        assert.strictEqual(segundo.ok, false);
        assert.strictEqual(segundo.motivo, "ya_tiene_otro_telefono");
        assert.strictEqual(fake.tablas.usuarios[0].telefono, "3009000008", "el teléfono original no debe cambiar");

    });

    // ======================================================================
    // 8. Aislamiento: un contacto de Tenant A no aparece como contacto de
    //    Tenant B, aunque la identidad global sea la MISMA fila de "usuarios".
    // ======================================================================
    await test("8. Contacto de Tenant A no aparece en el listado de Tenant B (misma identidad global, tenants distintos)", async () => {

        const { obtenerUsuarioGlobalMod, listarContactos } = cargarModulos();

        // Misma persona (mismo LID) descubierta por DOS tenants distintos
        // -- escenario real: la persona es cliente de dos negocios que usan
        // esta plataforma.
        const usuarioParaA = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "compartido@lid",
            nombre: "Cliente Compartido",
            usuarioIdTenant: TENANT_A
        });

        const listaA = await listarContactos({ usuarioId: TENANT_A });
        const listaB = await listarContactos({ usuarioId: TENANT_B });

        assert.ok(listaA.contactos.find((c) => c.id === usuarioParaA.id), "SÍ debe aparecer para el tenant que lo descubrió");
        assert.ok(!listaB.contactos.find((c) => c.id === usuarioParaA.id), "NO debe aparecer para un tenant que nunca lo descubrió");

    });

    // ======================================================================
    // 9. Identidad global compartida correctamente: cuando el OTRO tenant
    //    también descubre a la misma persona, sigue siendo la MISMA fila de
    //    "usuarios" (no se duplica la identidad), y ahora sí aparece para
    //    ambos tenants con sus propias relaciones independientes.
    // ======================================================================
    await test("9. Identidad global compartida: el mismo LID descubierto por dos tenants sigue siendo un único usuarios.id", async () => {

        const { fake, obtenerUsuarioGlobalMod, listarContactos } = cargarModulos();

        const uA = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "dosTenants@lid",
            usuarioIdTenant: TENANT_A
        });

        const uB = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "dosTenants@lid",
            usuarioIdTenant: TENANT_B
        });

        assert.strictEqual(uA.id, uB.id, "misma identidad global para ambos tenants");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe duplicarse la identidad global");
        assert.strictEqual(fake.tablas.contactos_tenant.length, 2, "sí debe haber DOS relaciones, una por tenant");

        const listaA = await listarContactos({ usuarioId: TENANT_A });
        const listaB = await listarContactos({ usuarioId: TENANT_B });

        assert.ok(listaA.contactos.find((c) => c.id === uA.id));
        assert.ok(listaB.contactos.find((c) => c.id === uB.id));

    });

    // ======================================================================
    // 10. Sin usuarioIdTenant (llamador que no conoce el tenant) -> se
    //     comporta exactamente igual que antes: resuelve/crea en "usuarios",
    //     sin tocar contactos_tenant en absoluto.
    // ======================================================================
    await test("10. Sin usuarioIdTenant -> no escribe en contactos_tenant (compatibilidad hacia atrás)", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const usuario = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "sinTenant@lid",
            nombre: "Sin Tenant"
        });

        assert.ok(usuario);
        assert.strictEqual((fake.tablas.contactos_tenant || []).length, 0);

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
    console.error("💥 Error inesperado ejecutando las pruebas de contactos_tenant");
    console.error(err);
    process.exitCode = 1;
});
