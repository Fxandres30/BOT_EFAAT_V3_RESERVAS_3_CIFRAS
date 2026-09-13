// ==========================================================================
// PRUEBAS — Identidad de evento real entre grupos (Fase Identidad Real +
// Eventos/Tablas compartidas, 2026-09-13).
//
// Mismo estilo que tests/identidad/identidad.test.js: script plano de Node,
// fake de Supabase en memoria inyectado vía require.cache, funciones REALES
// sin modificar (salvo el propio cambio bajo prueba).
//
//     node backend/tests/eventos/identidadEventoReal.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("../identidad/fakeSupabase");

const RUTA_SUPABASE = path.resolve(__dirname, "../../lib/supabase.js");
const RUTA_IDENTIDAD_EVENTO_REAL = path.resolve(__dirname, "../../bot/funciones/eventos/identidadEventoReal.js");
const RUTA_RESERVAR_NUMEROS = path.resolve(__dirname, "../../bot/funciones/reservas/reservarNumeros.js");
const RUTA_CONSULTAR_DISPONIBILIDAD = path.resolve(__dirname, "../../bot/funciones/consultas/consultarDisponibilidad.js");
const RUTA_CONSULTAR_RESERVAS = path.resolve(__dirname, "../../bot/funciones/reservas/consultarReservas.js");
const RUTA_ACTUALIZAR_EVENTO = path.resolve(__dirname, "../../bot/funciones/reservas/actualizarEvento.js");
const RUTA_VERIFICAR_TODOS_PAGADOS = path.resolve(__dirname, "../../bot/funciones/eventos/lifecycle/verificarTodosPagados.js");
const RUTA_CONSULTAR_MIS_NUMEROS = path.resolve(__dirname, "../../bot/funciones/consultas/consultarMisNumeros.js");
const RUTA_OBTENER_USUARIO_GLOBAL = path.resolve(__dirname, "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js");
const RUTA_MARCAR_PAGADAS = path.resolve(__dirname, "../../bot/funciones/pagos/marcarReservasPagadasPorAdmin.js");

function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    for (const ruta of [
        RUTA_IDENTIDAD_EVENTO_REAL,
        RUTA_RESERVAR_NUMEROS,
        RUTA_CONSULTAR_DISPONIBILIDAD,
        RUTA_CONSULTAR_RESERVAS,
        RUTA_ACTUALIZAR_EVENTO,
        RUTA_VERIFICAR_TODOS_PAGADOS,
        RUTA_CONSULTAR_MIS_NUMEROS,
        RUTA_OBTENER_USUARIO_GLOBAL,
        RUTA_MARCAR_PAGADAS
    ]) {
        delete require.cache[ruta];
    }

    return {
        fake,
        crearIdentidadEventoReal: require(RUTA_IDENTIDAD_EVENTO_REAL).crearIdentidadEventoReal,
        reservarNumeros: require(RUTA_RESERVAR_NUMEROS).reservarNumeros,
        consultarDisponibilidad: require(RUTA_CONSULTAR_DISPONIBILIDAD).consultarDisponibilidad,
        consultarReservas: require(RUTA_CONSULTAR_RESERVAS).consultarReservas,
        actualizarEvento: require(RUTA_ACTUALIZAR_EVENTO).actualizarEvento,
        verificarTodosPagados: require(RUTA_VERIFICAR_TODOS_PAGADOS).verificarTodosPagados,
        consultarMisNumeros: require(RUTA_CONSULTAR_MIS_NUMEROS).consultarMisNumeros,
        obtenerUsuarioGlobal: require(RUTA_OBTENER_USUARIO_GLOBAL).obtenerUsuarioGlobal,
        marcarReservasPagadasPorAdmin: require(RUTA_MARCAR_PAGADAS).marcarReservasPagadasPorAdmin
    };

}

function crearEvento(overrides = {}) {

    return {
        id: overrides.id || `evento-${Math.random().toString(36).slice(2)}`,
        tabla: "tabla_test",
        usuario_id: "tenant-A",
        grupo_id: "grupo-A@g.us",
        grupo_nombre: "Grupo A",
        cantidad_numeros: 100,
        ...overrides
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
    // 1. La identidad del sorteo real NO depende del grupo_id.
    // ======================================================================
    await test("1. Mismo sorteo real (nombre+hora+valor+fecha+tenant) en 3 grupos -> misma identidad", async () => {

        const { crearIdentidadEventoReal } = cargarModulos();

        const base = { usuario_id: "tenant-A", nombre_evento: "Sinuano Noche", hora_fin: "20:30", valor: "5000", fecha_evento: "2026-09-13" };

        const idA = crearIdentidadEventoReal(base);
        const idB = crearIdentidadEventoReal(base); // grupo_id ni siquiera es un parámetro

        assert.strictEqual(idA, idB);
        assert.ok(idA.length === 64, "debe ser un hash sha256 hex (64 caracteres)");

    });

    await test("2. Evento distinto (fecha) -> identidad distinta", async () => {

        const { crearIdentidadEventoReal } = cargarModulos();

        const base = { usuario_id: "tenant-A", nombre_evento: "Sinuano Noche", hora_fin: "20:30", valor: "5000", fecha_evento: "2026-09-13" };

        const idHoy = crearIdentidadEventoReal(base);
        const idOtroDia = crearIdentidadEventoReal({ ...base, fecha_evento: "2026-09-14" });

        assert.notStrictEqual(idHoy, idOtroDia);

    });

    await test("3. Mismo nombre/hora/valor/fecha pero OTRO tenant -> identidad distinta (aislamiento de tenant)", async () => {

        const { crearIdentidadEventoReal } = cargarModulos();

        const base = { usuario_id: "tenant-A", nombre_evento: "Sinuano Noche", hora_fin: "20:30", valor: "5000", fecha_evento: "2026-09-13" };

        const idTenantA = crearIdentidadEventoReal(base);
        const idTenantB = crearIdentidadEventoReal({ ...base, usuario_id: "tenant-B" });

        assert.notStrictEqual(idTenantA, idTenantB);

    });

    // ======================================================================
    // 4-6. Reserva hecha desde un grupo aparece disponible/ocupada igual
    //      desde otro grupo que comparte el MISMO evento real.
    // ======================================================================
    await test("4. reservarNumeros() escribe identidad_evento_real en la fila", async () => {

        const { fake, reservarNumeros } = cargarModulos();

        fake.tablas.tabla_test = [{ numero: 25, estado: "libre" }];

        const evento = crearEvento({ identidad_evento_real: "hash-evento-1" });

        const reservados = await reservarNumeros({ evento, numeros: [25], usuario: { id: "u1" } });

        assert.strictEqual(reservados.length, 1);
        assert.strictEqual(reservados[0].identidad_evento_real, "hash-evento-1");

    });

    await test("5. Número reservado desde Grupo A aparece OCUPADO al consultar disponibilidad desde Grupo B (mismo evento real)", async () => {

        const { fake, reservarNumeros, consultarDisponibilidad } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 25, estado: "libre" },
            { numero: 26, estado: "libre" }
        ];

        const eventoGrupoA = crearEvento({ id: "evento-A", grupo_id: "grupoA@g.us", identidad_evento_real: "hash-evento-1" });
        const eventoGrupoB = crearEvento({ id: "evento-B", grupo_id: "grupoB@g.us", identidad_evento_real: "hash-evento-1" });

        await reservarNumeros({ evento: eventoGrupoA, numeros: [25], usuario: { id: "u1" } });

        const disponibilidadB = await consultarDisponibilidad({ evento: eventoGrupoB });

        assert.deepStrictEqual(disponibilidadB.numerosOcupados, [25], "Grupo B debe ver el 25 ocupado, reservado desde Grupo A");
        assert.deepStrictEqual(disponibilidadB.numerosDisponibles, [26]);

    });

    await test("6. Pago confirmado con evento_id de Grupo B se refleja al consultar desde Grupo A (verificarTodosPagados ya no subcuenta por grupo)", async () => {

        const { fake, verificarTodosPagados } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 1, estado: "pagado", evento_id: "evento-B", identidad_evento_real: "hash-evento-1" }
        ];

        const eventoGrupoA = crearEvento({ id: "evento-A", grupo_id: "grupoA@g.us", identidad_evento_real: "hash-evento-1", cantidad_numeros: 1 });

        const todosPagados = await verificarTodosPagados(eventoGrupoA);

        assert.strictEqual(todosPagados, true, "el pago hecho bajo evento_id de OTRO grupo del mismo sorteo real debe contar para Grupo A");

    });

    // ======================================================================
    // 7-9. Aislamiento: un evento distinto (u otro tenant) que comparte la
    //      misma tabla física por precio NUNCA contamina al evento actual.
    // ======================================================================
    await test("7. Reserva de un evento DISTINTO (mismo precio, tabla compartida) NO aparece ocupada para este evento", async () => {

        const { fake, reservarNumeros, consultarDisponibilidad } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 25, estado: "libre" },
            { numero: 26, estado: "libre" }
        ];

        const eventoAjeno = crearEvento({ id: "evento-ajeno", grupo_id: "grupo-otro@g.us", identidad_evento_real: "hash-evento-AJENO" });
        const miEvento = crearEvento({ id: "evento-mio", grupo_id: "grupo-mio@g.us", identidad_evento_real: "hash-evento-MIO" });

        await reservarNumeros({ evento: eventoAjeno, numeros: [25], usuario: { id: "usuario-ajeno" } });

        const disponibilidadMia = await consultarDisponibilidad({ evento: miEvento });

        assert.deepStrictEqual(disponibilidadMia.numerosOcupados, [], "el 25 reservado por un evento AJENO no debe verse ocupado para mi evento");
        assert.deepStrictEqual(disponibilidadMia.numerosDisponibles, [26], "el 25 tampoco debe ofrecerse como disponible: ya está físicamente tomado");

    });

    await test("8. actualizarEvento(): reservados/pagados se aíslan por evento real; libres sigue siendo el conteo físico global", async () => {

        const { fake, reservarNumeros, actualizarEvento } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 1, estado: "libre" },
            { numero: 2, estado: "libre" },
            { numero: 3, estado: "libre" }
        ];

        fake.tablas.eventos_bot = [
            { id: "evento-mio", reservados: 0, pagados: 0, pendientes: 0, libres: 0 },
            { id: "evento-ajeno", reservados: 0, pagados: 0, pendientes: 0, libres: 0 }
        ];

        const eventoAjeno = crearEvento({ id: "evento-ajeno", identidad_evento_real: "hash-AJENO" });
        const miEvento = crearEvento({ id: "evento-mio", identidad_evento_real: "hash-MIO" });

        await reservarNumeros({ evento: eventoAjeno, numeros: [1], usuario: { id: "u-ajeno" } });
        await reservarNumeros({ evento: miEvento, numeros: [2], usuario: { id: "u-mio" } });

        await actualizarEvento(miEvento);

        const filaMia = fake.tablas.eventos_bot.find(e => e.id === "evento-mio");

        assert.strictEqual(filaMia.reservados, 1, "solo debe contar la reserva de MI evento, no la del ajeno");
        assert.strictEqual(filaMia.libres, 1, "libres es un conteo físico global: quedó exactamente 1 número (el 3) sin reclamar por nadie");

    });

    await test("9. consultarMisNumeros(): una reserva del MISMO usuario pero de OTRO evento no se mezcla en 'mis números' de este evento", async () => {

        const { fake, reservarNumeros, consultarMisNumeros, obtenerUsuarioGlobal } = cargarModulos();

        const usuario = await obtenerUsuarioGlobal({ lid: "cliente@lid" });

        fake.tablas.tabla_test = [
            { numero: 10, estado: "libre" },
            { numero: 20, estado: "libre" }
        ];

        const eventoViejo = crearEvento({ id: "evento-viejo", identidad_evento_real: "hash-viejo" });
        const eventoNuevo = crearEvento({ id: "evento-nuevo", identidad_evento_real: "hash-nuevo" });

        await reservarNumeros({ evento: eventoViejo, numeros: [10], usuario });
        await reservarNumeros({ evento: eventoNuevo, numeros: [20], usuario });

        const misNumerosEnElNuevo = await consultarMisNumeros({ evento: eventoNuevo, usuario });

        assert.deepStrictEqual(misNumerosEnElNuevo, [20], "el número reservado en el evento VIEJO no debe aparecer en 'mis números' del evento NUEVO");

    });

    // ======================================================================
    // 10. Compatibilidad: eventos SIN identidad_evento_real (dato previo a
    //     esta migración) siguen funcionando exactamente como antes.
    // ======================================================================
    await test("10. Compatibilidad hacia atrás: evento sin identidad_evento_real no filtra (comportamiento previo intacto)", async () => {

        const { fake, reservarNumeros, consultarDisponibilidad } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 1, estado: "libre" },
            { numero: 2, estado: "libre" }
        ];

        const eventoSinIdentidad = crearEvento({ id: "evento-legacy" }); // sin identidad_evento_real

        await reservarNumeros({ evento: eventoSinIdentidad, numeros: [1], usuario: { id: "u1" } });

        const disponibilidad = await consultarDisponibilidad({ evento: eventoSinIdentidad });

        assert.deepStrictEqual(disponibilidad.numerosOcupados, [1]);
        assert.deepStrictEqual(disponibilidad.numerosDisponibles, [2]);

    });

    // ======================================================================
    // 11. Concurrencia: dos "grupos" intentando reservar el MISMO número al
    //     mismo tiempo -- solo uno debe ganarlo (UPDATE...WHERE estado='libre'
    //     real de reservarNumeros.js, sin tocar).
    // ======================================================================
    await test("11. Concurrencia: dos reservas simultáneas del mismo número -> solo una gana, ninguna queda duplicada", async () => {

        const { fake, reservarNumeros } = cargarModulos();

        fake.tablas.tabla_test = [{ numero: 25, estado: "libre" }];

        const eventoGrupoA = crearEvento({ id: "evento-A", grupo_id: "grupoA@g.us", identidad_evento_real: "hash-evento-1" });
        const eventoGrupoB = crearEvento({ id: "evento-B", grupo_id: "grupoB@g.us", identidad_evento_real: "hash-evento-1" });

        const [resultadoA, resultadoB] = await Promise.all([
            reservarNumeros({ evento: eventoGrupoA, numeros: [25], usuario: { id: "u-A" } }),
            reservarNumeros({ evento: eventoGrupoB, numeros: [25], usuario: { id: "u-B" } })
        ]);

        const gano = [resultadoA.length > 0, resultadoB.length > 0].filter(Boolean).length;

        assert.strictEqual(gano, 1, "exactamente una de las dos reservas concurrentes debe ganar el número 25");

        const filasNumero25 = fake.tablas.tabla_test.filter(f => f.numero === 25);
        assert.strictEqual(filasNumero25.length, 1, "no debe quedar una fila duplicada para el número 25");
        assert.strictEqual(filasNumero25[0].estado, "reservado");

    });

    // ======================================================================
    // 12. Pago compartido: sticker de admin en Grupo B confirma el pago de
    //     una reserva hecha por el cliente en Grupo A (mismo sorteo real).
    // ======================================================================
    await test("12. marcarReservasPagadasPorAdmin(): sticker en Grupo B paga una reserva hecha en Grupo A (mismo evento real)", async () => {

        const { fake, reservarNumeros, marcarReservasPagadasPorAdmin, obtenerUsuarioGlobal } = cargarModulos();

        const cliente = await obtenerUsuarioGlobal({ lid: "cliente-compartido@lid" });

        fake.tablas.tabla_test = [{ numero: 30, estado: "libre" }];

        const eventoGrupoA = crearEvento({ id: "evento-A", usuario_id: "tenant-X", grupo_id: "grupoA@g.us", identidad_evento_real: "hash-compartido" });
        const eventoGrupoB = crearEvento({ id: "evento-B", usuario_id: "tenant-X", grupo_id: "grupoB@g.us", identidad_evento_real: "hash-compartido" });

        await reservarNumeros({ evento: eventoGrupoA, numeros: [30], usuario: cliente, comprador: cliente.nombre, contacto: cliente.telefono });

        const resultado = await marcarReservasPagadasPorAdmin({
            evento: eventoGrupoB,
            usuario: cliente,
            realizadoPor: "admin-grupoB"
        });

        assert.strictEqual(resultado.estado, "confirmado", "el sticker en Grupo B debe encontrar y pagar la reserva hecha en Grupo A");
        assert.strictEqual(resultado.actualizadas.length, 1);
        assert.strictEqual(resultado.actualizadas[0].estado, "pagado");

    });

    // ======================================================================
    // 13-14. Red de seguridad de despliegue: si la migración 015 todavía no
    //        se aplicó (columna inexistente, error 42703 de Postgres), las
    //        reservas y el guardado de eventos NO deben romperse — deben
    //        reintentar sin la columna nueva en vez de fallar por completo.
    // ======================================================================
    await test("13. reservarNumeros() sobrevive si identidad_evento_real todavía no existe en Supabase (42703)", async () => {

        const { fake, reservarNumeros } = cargarModulos();

        fake.tablas.tabla_test = [{ numero: 40, estado: "libre" }];

        fake.forzarProximoError(
            "tabla_test",
            "update",
            { code: "42703", message: 'column "identidad_evento_real" of relation "tabla_test" does not exist' }
        );

        const evento = crearEvento({ identidad_evento_real: "hash-futuro" });

        const reservados = await reservarNumeros({ evento, numeros: [40], usuario: { id: "u1" } });

        assert.strictEqual(reservados.length, 1, "debe reintentar sin la columna y completar la reserva igual");
        assert.strictEqual(reservados[0].estado, "reservado");

    });

    await test("14. actualizarEvento() sobrevive si identidad_evento_real todavía no existe en Supabase (42703)", async () => {

        const { fake, actualizarEvento } = cargarModulos();

        fake.tablas.tabla_test = [
            { numero: 1, estado: "reservado" },
            { numero: 2, estado: "libre" }
        ];

        fake.tablas.eventos_bot = [{ id: "evento-mio", reservados: 0, pagados: 0, pendientes: 0, libres: 0 }];

        fake.forzarProximoError(
            "tabla_test",
            "select",
            { code: "42703", message: 'column "identidad_evento_real" of relation "tabla_test" does not exist' }
        );

        const evento = crearEvento({ id: "evento-mio", identidad_evento_real: "hash-futuro" });

        const ok = await actualizarEvento(evento);

        assert.strictEqual(ok, true, "debe reintentar sin la columna y actualizar los contadores igual");

        const fila = fake.tablas.eventos_bot.find(e => e.id === "evento-mio");
        assert.strictEqual(fila.reservados, 1);
        assert.strictEqual(fila.libres, 1);

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidos = resultados.filter(r => !r.ok);

    console.log("\n============================================");
    console.log(`Pruebas: ${resultados.length}  |  OK: ${resultados.length - fallidos.length}  |  Fallidas: ${fallidos.length}`);
    console.log("============================================");

    if (fallidos.length) process.exitCode = 1;

}

main().catch(err => {
    console.error("💥 Error inesperado ejecutando las pruebas de identidad de evento real");
    console.error(err);
    process.exitCode = 1;
});
