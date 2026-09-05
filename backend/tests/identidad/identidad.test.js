// ==========================================================================
// PRUEBAS DEL SISTEMA DE IDENTIDAD (sección 12 del pedido).
//
// No hay framework de pruebas instalado en el proyecto (no jest/mocha/vitest
// en backend/node_modules ni en package.json). Este archivo es un script
// plano de Node, sin dependencias nuevas, ejecutable con:
//
//     node backend/tests/identidad/identidad.test.js
//
// Usa un fake de Supabase en memoria (fakeSupabase.js) inyectado vía
// require.cache ANTES de cargar los módulos bajo prueba, para no tocar la
// base de datos real ni el proceso de arranque de backend/lib/supabase.js
// (que hace una prueba de conexión de red al hacer require()).
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE =
    path.resolve(__dirname, "../../lib/supabase.js");

const RUTA_OBTENER_USUARIO_GLOBAL =
    path.resolve(__dirname, "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js");

const RUTA_GUARDAR_MENSAJE_GRUPO =
    path.resolve(__dirname, "../../bot/funciones/mensajes/guardarMensajeGrupo.js");

const RUTA_OBTENER_USUARIO =
    path.resolve(__dirname, "../../bot/middleware/obtenerUsuario.js");

const RUTA_CONSULTAR_MIS_NUMEROS =
    path.resolve(__dirname, "../../bot/funciones/consultas/consultarMisNumeros.js");

const RUTA_RESERVAR_NUMEROS =
    path.resolve(__dirname, "../../bot/funciones/reservas/reservarNumeros.js");

// Carga (o recarga) los módulos bajo prueba con un fake de Supabase nuevo y
// aislado por prueba, para que ninguna prueba contamine a otra.
function cargarModulos() {

    const fake = crearFakeSupabase();

    // Se registra el fake en el cache de módulos de Node ANTES de requerir
    // cualquier cosa que dependa de "lib/supabase.js" (todas las rutas
    // relativas distintas a ese archivo resuelven al mismo path absoluto).
    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    // Recarga limpia de los módulos bajo prueba (por si una prueba anterior
    // ya los había cacheado con otro fake).
    delete require.cache[RUTA_OBTENER_USUARIO_GLOBAL];
    delete require.cache[RUTA_GUARDAR_MENSAJE_GRUPO];
    delete require.cache[RUTA_OBTENER_USUARIO];
    delete require.cache[RUTA_CONSULTAR_MIS_NUMEROS];
    delete require.cache[RUTA_RESERVAR_NUMEROS];

    const obtenerUsuarioGlobalMod = require(RUTA_OBTENER_USUARIO_GLOBAL);
    const { guardarMensajeGrupo } = require(RUTA_GUARDAR_MENSAJE_GRUPO);
    const obtenerUsuario = require(RUTA_OBTENER_USUARIO);
    const { consultarMisNumeros } = require(RUTA_CONSULTAR_MIS_NUMEROS);
    const { reservarNumeros } = require(RUTA_RESERVAR_NUMEROS);

    return {
        fake,
        obtenerUsuarioGlobalMod,
        guardarMensajeGrupo,
        obtenerUsuario,
        consultarMisNumeros,
        reservarNumeros
    };

}

// ==========================================================================
// Runner mínimo
// ==========================================================================

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

function ctxGrupoFromMe({ id = "MSG1" } = {}) {

    return {
        message: {
            key: { fromMe: true, participant: null, remoteJid: "grupo1@g.us", id },
            pushName: null
        },
        chat: { participante: null, remoteJid: "grupo1@g.us" }
    };

}

function ctxGrupoReal({ participant, pushName = null, id = "MSG1" }) {

    return {
        message: {
            key: { fromMe: false, participant, remoteJid: "grupo1@g.us", id },
            pushName
        },
        chat: { participante: participant, remoteJid: "grupo1@g.us" }
    };

}

async function main() {

    // ======================================================================
    // 1. LID nuevo → crea 1 usuario.
    // ======================================================================
    await test("1. LID nuevo crea 1 usuario", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "111@lid",
            nombre: "Ana"
        });

        assert.ok(u, "debe crear el usuario");
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(u.lid, "111@lid");

    });

    // ======================================================================
    // 2. Mismo LID nuevamente → mismo usuario.id.
    // ======================================================================
    await test("2. Mismo LID nuevamente devuelve el mismo usuario.id", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "222@lid" });
        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "222@lid" });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe duplicar");

    });

    // ======================================================================
    // 3. Teléfono nuevo → crea 1 usuario.
    // ======================================================================
    await test("3. Teléfono nuevo crea 1 usuario", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3000000001" });

        assert.ok(u);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 4. Mismo teléfono nuevamente → mismo usuario.id.
    // ======================================================================
    await test("4. Mismo teléfono nuevamente devuelve el mismo usuario.id", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3000000002" });
        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3000000002" });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 5. LID primero, teléfono después → mismo usuario.id.
    // ======================================================================
    await test("5. LID primero y teléfono después → mismo usuario.id (se completa el teléfono)", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "333@lid" });
        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "333@lid",
            telefono: "3000000003"
        });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(u2.telefono, "3000000003", "debe completar el teléfono en la misma fila");

    });

    // ======================================================================
    // 6. Teléfono primero, LID después → mismo usuario.id.
    // ======================================================================
    await test("6. Teléfono primero y LID después → mismo usuario.id (se completa el LID)", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3000000004" });
        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            telefono: "3000000004",
            lid: "444@lid"
        });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1);
        assert.strictEqual(u2.lid, "444@lid");

    });

    // ======================================================================
    // 7. LID + teléfono del mismo usuario → mismo usuario.id.
    // ======================================================================
    await test("7. LID+teléfono del mismo usuario resuelven al mismo id", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "555@lid",
            telefono: "3000000005"
        });

        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "555@lid",
            telefono: "3000000005"
        });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 8. LID X + teléfono Y de usuarios distintos → CONTINGENCIA, no fusiona.
    // ======================================================================
    await test("8. LID y teléfono de usuarios distintos generan IDENTITY_CONFLICT y no fusionan", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const x = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "A@lid" });
        const y = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "B0000" });

        assert.notStrictEqual(x.id, y.id);

        let contingencia = null;
        const registrarOriginal = obtenerUsuarioGlobalMod.registrarContingenciaIdentidad;

        obtenerUsuarioGlobalMod.registrarContingenciaIdentidad = (tipo, detalle) => {
            contingencia = { tipo, detalle };
        };

        const totalAntes = fake.tablas.usuarios.length;

        let resultado;

        try {

            resultado = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
                lid: "A@lid",
                telefono: "B0000"
            });

        } finally {

            obtenerUsuarioGlobalMod.registrarContingenciaIdentidad = registrarOriginal;

        }

        assert.strictEqual(resultado, null, "no debe fusionar ni devolver un usuario");
        assert.strictEqual(fake.tablas.usuarios.length, totalAntes, "no debe crear filas nuevas");
        assert.ok(contingencia, "debe registrar la contingencia");
        assert.strictEqual(contingencia.tipo, "IDENTITY_CONFLICT");
        assert.strictEqual(contingencia.detalle.usuarioIdEncontradoPorLid, x.id);
        assert.strictEqual(contingencia.detalle.usuarioIdEncontradoPorTelefono, y.id);

        // Verifica también que ninguna de las dos filas originales cambió.
        const xEnDb = fake.tablas.usuarios.find(u => u.id === x.id);
        const yEnDb = fake.tablas.usuarios.find(u => u.id === y.id);

        assert.strictEqual(xEnDb.telefono || null, null, "no debe escribir el teléfono en X");
        assert.strictEqual(yEnDb.lid || null, null, "no debe escribir el LID en Y");

    });

    // ======================================================================
    // 9. fromMe=true → 0 creación de usuarios, PERO el mensaje SÍ se guarda
    //    (usuario_id = NULL, from_me = true) para que el panel de Chats
    //    conserve la conversación completa.
    // ======================================================================
    await test("9. fromMe=true: 0 usuarios creados, el mensaje se guarda con usuario_id NULL y from_me true", async () => {

        const { fake, obtenerUsuarioGlobalMod, guardarMensajeGrupo, obtenerUsuario } = cargarModulos();

        // Capa 1: obtenerUsuarioGlobal con fromMe:true — blindaje defensivo.
        const r1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            jid: "573106814436@s.whatsapp.net",
            fromMe: true
        });

        assert.strictEqual(r1, null);
        assert.strictEqual(fake.tablas.usuarios.length, 0);

        // Capa 2: obtenerUsuario (middleware) — nunca intenta resolver.
        const usuarioResuelto = await obtenerUsuario(ctxGrupoFromMe());

        assert.strictEqual(usuarioResuelto, null);
        assert.strictEqual(fake.tablas.usuarios.length, 0);

        // Capa 3: guardarMensajeGrupo — SÍ guarda el mensaje, sin identidad.
        const msgFromMe = {
            key: { fromMe: true, id: "MSG1", participant: null, remoteJid: "grupo1@g.us" },
            message: { conversation: "✅ Reserva realizada correctamente." },
            pushName: null
        };

        const mensaje = await guardarMensajeGrupo({
            msg: msgFromMe,
            texto: "✅ Reserva realizada correctamente.",
            grupoId: "grupo1@g.us",
            grupoNombre: "Grupo Sorteo",
            usuario: usuarioResuelto // null — se ignora igual aunque llegara con algo
        });

        assert.ok(mensaje, "el mensaje del BOT debe quedar guardado (lo necesita el panel de Chats)");
        assert.strictEqual(mensaje.usuario_id, null, "usuario_id debe ser NULL para fromMe");
        assert.strictEqual(mensaje.from_me, true, "from_me debe conservarse como true");
        assert.strictEqual(mensaje.telefono, null, "no debe filtrarse el teléfono del bot como si fuera identidad");
        assert.strictEqual(mensaje.lid, null);
        assert.strictEqual(mensaje.texto, "✅ Reserva realizada correctamente.");
        assert.strictEqual(mensaje.grupo_id, "grupo1@g.us");

        assert.strictEqual(fake.tablas.usuarios.length, 0, "usuarios sigue en 0 — el mensaje no contamina identidad");
        assert.strictEqual(fake.tablas.mensajes_grupos_sorteos.length, 1, "el mensaje debe quedar en el historial");

    });

    // ======================================================================
    // 10. fromMe=true repetido 100 veces → 0 usuarios nuevos, y los 100
    //     mensajes quedan conservados en el historial.
    // ======================================================================
    await test("10. fromMe=true repetido 100 veces → 0 usuarios nuevos, 100 mensajes conservados", async () => {

        const { fake, obtenerUsuario, guardarMensajeGrupo } = cargarModulos();

        for (let i = 0; i < 100; i++) {

            const ctx = ctxGrupoFromMe({ id: `MSG${i}` });

            const usuarioResuelto = await obtenerUsuario(ctx);
            assert.strictEqual(usuarioResuelto, null);

            const mensaje = await guardarMensajeGrupo({
                msg: ctx.message,
                texto: `mensaje del bot #${i}`,
                grupoId: "grupo1@g.us",
                grupoNombre: null,
                usuario: usuarioResuelto
            });

            assert.ok(mensaje, `el mensaje #${i} del bot debe guardarse`);
            assert.strictEqual(mensaje.usuario_id, null);
            assert.strictEqual(mensaje.from_me, true);

        }

        assert.strictEqual(fake.tablas.usuarios.length, 0, "0 usuarios nuevos tras 100 mensajes fromMe");
        assert.strictEqual(fake.tablas.mensajes_grupos_sorteos.length, 100, "los 100 mensajes quedan en el historial");

    });

    // ======================================================================
    // 11. guardarMensajeGrupo no genera una segunda identidad.
    // ======================================================================
    await test("11. guardarMensajeGrupo reutiliza ctx.usuario y no crea una segunda identidad", async () => {

        const { fake, obtenerUsuario, guardarMensajeGrupo } = cargarModulos();

        const usuario = await obtenerUsuario(ctxGrupoReal({
            participant: "999@s.whatsapp.net",
            pushName: "Cliente Real"
        }));

        assert.ok(usuario);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

        // El mensaje trae un participant DISTINTO al usado para resolver.
        // Si guardarMensajeGrupo volviera a resolver identidad por su
        // cuenta (el bug original), esto generaría/buscaría un usuario
        // distinto. Con el fix, ni siquiera importa el "participant" del
        // msg para identidad: usa exclusivamente el `usuario` recibido.
        const msg = {
            key: { fromMe: false, participant: "888@s.whatsapp.net", remoteJid: "grupo1@g.us", id: "MSG1" },
            message: { conversation: "hola" },
            pushName: "Otro Nombre"
        };

        const fila = await guardarMensajeGrupo({
            msg,
            texto: "hola",
            grupoId: "grupo1@g.us",
            grupoNombre: null,
            usuario
        });

        assert.ok(fila);
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe crear ni buscar una segunda identidad");
        assert.strictEqual(fila.usuario_id, usuario.id);
        assert.strictEqual(fila.telefono, usuario.telefono);

    });

    // ======================================================================
    // 11-B. Mensaje real con SOLO LID → identifica/crea usuario (pipeline
    //       completo: obtenerUsuario → guardarMensajeGrupo).
    // ======================================================================
    await test("11-B. Mensaje real con solo LID identifica al usuario en todo el pipeline", async () => {

        const { fake, obtenerUsuario, guardarMensajeGrupo } = cargarModulos();

        const ctx = ctxGrupoReal({ participant: "700@lid", pushName: "Cliente LID" });

        const usuario = await obtenerUsuario(ctx);

        assert.ok(usuario);
        assert.strictEqual(usuario.lid, "700@lid");
        assert.strictEqual(usuario.telefono, null);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

        const fila = await guardarMensajeGrupo({
            msg: ctx.message,
            texto: "hola",
            grupoId: "grupo1@g.us",
            grupoNombre: null,
            usuario
        });

        assert.ok(fila);
        assert.strictEqual(fila.usuario_id, usuario.id);
        assert.strictEqual(fila.lid, "700@lid");

    });

    // ======================================================================
    // 11-C. Mensaje real con SOLO teléfono → identifica/crea usuario
    //       (pipeline completo).
    // ======================================================================
    await test("11-C. Mensaje real con solo teléfono identifica al usuario en todo el pipeline", async () => {

        const { fake, obtenerUsuario, guardarMensajeGrupo } = cargarModulos();

        const ctx = ctxGrupoReal({ participant: "3007001111@s.whatsapp.net", pushName: "Cliente Tel" });

        const usuario = await obtenerUsuario(ctx);

        assert.ok(usuario);
        assert.strictEqual(usuario.telefono, "3007001111");
        assert.strictEqual(usuario.lid, null);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

        const fila = await guardarMensajeGrupo({
            msg: ctx.message,
            texto: "hola",
            grupoId: "grupo1@g.us",
            grupoNombre: null,
            usuario
        });

        assert.ok(fila);
        assert.strictEqual(fila.usuario_id, usuario.id);
        assert.strictEqual(fila.telefono, "3007001111");

    });

    // ======================================================================
    // 11-D. Doble resolución: exactamente UNA resolución de identidad por
    //       mensaje entrante real. Se cuenta cuántas veces se consulta/
    //       escribe realmente la tabla "usuarios" en todo el pipeline.
    // ======================================================================
    await test("11-D. Una sola resolución de identidad por mensaje entrante (conteo de llamadas a 'usuarios')", async () => {

        const { fake, obtenerUsuario, guardarMensajeGrupo } = cargarModulos();

        const ctx = ctxGrupoReal({ participant: "701@lid", pushName: "Cliente Único" });

        const usuario = await obtenerUsuario(ctx);
        assert.ok(usuario);

        // Para un LID nuevo, la ÚNICA resolución esperada es:
        // 1 SELECT (buscar por lid, no existe) + 1 INSERT (crear) = 2
        // llamadas a "usuarios". Ninguna llamada adicional debe originarse
        // en obtenerUsuario más allá de esa única resolución.
        const llamadasTrasResolucion = { ...fake.llamadas.usuarios };
        assert.strictEqual(llamadasTrasResolucion.select, 1);
        assert.strictEqual(llamadasTrasResolucion.insert, 1);
        assert.strictEqual(llamadasTrasResolucion.update, 0);

        const fila = await guardarMensajeGrupo({
            msg: ctx.message,
            texto: "hola",
            grupoId: "grupo1@g.us",
            grupoNombre: null,
            usuario
        });

        assert.ok(fila);

        // guardarMensajeGrupo NO debe agregar NINGUNA llamada más a
        // "usuarios": debe reutilizar `usuario` tal cual.
        assert.deepStrictEqual(
            fake.llamadas.usuarios,
            llamadasTrasResolucion,
            "guardarMensajeGrupo no debe volver a tocar la tabla 'usuarios'"
        );

    });

    // ======================================================================
    // 11-E. Reserva: usuario.id llega intacto hasta usuario_global_id.
    // ======================================================================
    // Usa reservarNumeros.js REAL, sin modificar, para probar que el
    // usuario.id producido por la identidad corregida es exactamente el
    // que termina escrito en usuario_global_id.
    await test("11-E. usuario.id llega intacto hasta reservas.usuario_global_id (reservarNumeros real, sin tocar)", async () => {

        const { fake, obtenerUsuario, reservarNumeros } = cargarModulos();

        const ctx = ctxGrupoReal({ participant: "702@lid", pushName: "Comprador" });
        const usuario = await obtenerUsuario(ctx);

        assert.ok(usuario);

        fake.tablas["numeros_evento_reserva_test"] = [
            { numero: 45, estado: "libre", usuario_global_id: null },
            { numero: 46, estado: "libre", usuario_global_id: null }
        ];

        const evento = {
            tabla: "numeros_evento_reserva_test",
            grupo_id: "grupo1@g.us",
            grupo_nombre: "Grupo Sorteo",
            id: "evento-1",
            usuario_id: "tenant-1", // dueño del bot — NO es el comprador
            telefono_bot: "3000000000"
        };

        const reservados = await reservarNumeros({
            evento,
            numeros: [45],
            usuario,
            comprador: usuario.nombre,
            contacto: usuario.telefono,
            lib: usuario.lid
        });

        assert.strictEqual(reservados.length, 1);
        assert.strictEqual(
            reservados[0].usuario_global_id,
            usuario.id,
            "reservas.usuario_global_id debe ser exactamente usuarios.id del comprador"
        );

        assert.notStrictEqual(
            reservados[0].usuario_global_id,
            evento.usuario_id,
            "usuario_global_id (comprador) nunca debe confundirse con evento.usuario_id (tenant/dueño del bot)"
        );

    });

    // ======================================================================
    // 12. Número liberado y vuelto a pedir → misma identidad.
    // ======================================================================
    // No se modifica detectarReserva/reservarNumeros (fuera de alcance); lo
    // que se garantiza aquí es el contrato de identidad del que depende ese
    // flujo: para el mismo LID/teléfono, usuarios.id es estable en el
    // tiempo sin importar qué pase con la disponibilidad del número 45.
    await test("12. Número liberado y pedido de nuevo: la identidad permanece estable", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const uReserva = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "45X@lid",
            telefono: "3004500045"
        });

        // ... aquí, en el flujo real, 45 se reserva y luego se libera
        // (detectarReserva / reservarNumeros, no tocado por este cambio).

        const uReReserva = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "45X@lid",
            telefono: "3004500045"
        });

        assert.strictEqual(uReserva.id, uReReserva.id);
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // 13. "mis números" consulta por usuario_global_id.
    // ======================================================================
    // Usa el consultarMisNumeros.js REAL, sin modificar, para probar que el
    // usuario.id que produce la identidad corregida encaja con su criterio
    // ya existente (usuario_global_id = usuario.id).
    await test('13. "mis números" consulta por usuario_global_id (consultarMisNumeros real, sin tocar)', async () => {

        const { fake, obtenerUsuarioGlobalMod, consultarMisNumeros } = cargarModulos();

        const usuarioA = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "compradorA@lid" });
        const usuarioB = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ lid: "compradorB@lid" });

        fake.tablas["numeros_evento_test"] = [
            { numero: 10, estado: "reservado", usuario_global_id: usuarioA.id },
            { numero: 45, estado: "reservado", usuario_global_id: usuarioA.id },
            { numero: 7, estado: "reservado", usuario_global_id: usuarioB.id },
            { numero: 20, estado: "libre", usuario_global_id: usuarioA.id }
        ];

        const numeros = await consultarMisNumeros({
            evento: { tabla: "numeros_evento_test" },
            usuario: usuarioA
        });

        assert.deepStrictEqual(numeros, [10, 45]);

    });

    // ======================================================================
    // 14. Dos resoluciones simultáneas del mismo teléfono → no permite dos
    //     identidades (simula el comportamiento una vez exista el índice
    //     UNIQUE pendiente en Supabase).
    // ======================================================================
    await test("14. Concurrencia: unique_violation en INSERT reutiliza la fila ganadora, sin duplicar", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const filaGanadora = {
            id: "ganador-1",
            telefono: "3009999999",
            lid: null,
            nombre: null,
            ultima_actividad: new Date()
        };

        // Este proceso ve "no existe" en su SELECT inicial (nadie ha hecho
        // commit todavía) e intenta el INSERT. En ese instante, el otro
        // proceso concurrente confirma su fila y Postgres responde
        // unique_violation (23505) — así se manifestaría con el índice
        // UNIQUE de la sección 8, todavía no creado en Supabase.
        fake.forzarProximoError(
            "usuarios",
            "insert",
            { code: "23505", message: 'duplicate key value violates unique constraint "usuarios_telefono_key"' },
            () => { fake.tablas.usuarios.push(filaGanadora); }
        );

        assert.strictEqual(fake.tablas.usuarios.length, 0, "precondición: nadie existe todavía");

        const resultado = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3009999999" });

        assert.ok(resultado, "debe recuperar la identidad en vez de fallar");
        assert.strictEqual(resultado.id, "ganador-1", "debe reutilizar la fila que ganó la carrera");
        assert.strictEqual(fake.tablas.usuarios.length, 1, "no debe quedar una fila duplicada");

    });

    // ======================================================================
    // EXTRA 15. El escenario real de los 474: 2+ filas YA duplicadas en BD
    //           para el mismo teléfono. No debe crear una tercera ni fusionar.
    // ======================================================================
    await test("15 (extra). 2+ filas ya duplicadas por teléfono → contingencia, NO se crea una tercera", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        fake.tablas.usuarios.push(
            { id: "dup-1", telefono: "3106814436", lid: null, nombre: null },
            { id: "dup-2", telefono: "3106814436", lid: null, nombre: null }
        );

        let contingencia = null;
        const registrarOriginal = obtenerUsuarioGlobalMod.registrarContingenciaIdentidad;

        obtenerUsuarioGlobalMod.registrarContingenciaIdentidad = (tipo, detalle) => {
            contingencia = { tipo, detalle };
        };

        let resultado;

        try {

            resultado = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({ telefono: "3106814436" });

        } finally {

            obtenerUsuarioGlobalMod.registrarContingenciaIdentidad = registrarOriginal;

        }

        assert.strictEqual(resultado, null, "una colisión NUNCA debe tratarse como usuario inexistente");
        assert.strictEqual(fake.tablas.usuarios.length, 2, "no debe insertar una tercera fila");
        assert.ok(contingencia);
        assert.strictEqual(contingencia.tipo, "DUPLICATE_ROWS_TELEFONO");

    });

    // ======================================================================
    // EXTRA 16. Un teléfono/LID ya asignado nunca se sobrescribe con un
    //           valor distinto, aunque no haya una segunda fila en conflicto.
    // ======================================================================
    await test("16 (extra). Nunca se sobrescribe un teléfono/LID ya asignado con uno distinto", async () => {

        const { fake, obtenerUsuarioGlobalMod } = cargarModulos();

        const u1 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "666@lid",
            telefono: "3000000006"
        });

        const u2 = await obtenerUsuarioGlobalMod.obtenerUsuarioGlobal({
            lid: "666@lid",
            telefono: "3000000999" // teléfono distinto, mismo LID
        });

        assert.strictEqual(u1.id, u2.id);
        assert.strictEqual(u2.telefono, "3000000006", "el teléfono original nunca se sobrescribe");
        assert.strictEqual(fake.tablas.usuarios.length, 1);

    });

    // ======================================================================
    // EXTRA 17. Verificación estructural: guardarMensajeGrupo.js ya no
    //           importa/llama a obtenerUsuarioGlobal (imposible una segunda
    //           resolución, no solo "no ocurre en este test").
    // ======================================================================
    await test("17 (extra). guardarMensajeGrupo.js no importa obtenerUsuarioGlobal", async () => {

        const fs = require("fs");
        const fuente = fs.readFileSync(RUTA_GUARDAR_MENSAJE_GRUPO, "utf8");

        // No debe importarlo ni invocarlo como función. (El nombre puede
        // aparecer en comentarios explicando por qué ya no se llama, así
        // que se comprueba específicamente require(...) y la invocación
        // "obtenerUsuarioGlobal(", no cualquier mención textual.)
        assert.ok(
            !/require\([^)]*obtenerUsuarioGlobal[^)]*\)/.test(fuente),
            "guardarMensajeGrupo.js no debe importar obtenerUsuarioGlobal"
        );

        assert.ok(
            !/\bobtenerUsuarioGlobal\s*\(/.test(fuente),
            "guardarMensajeGrupo.js no debe invocar obtenerUsuarioGlobal(...)"
        );

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

    console.error("💥 Error inesperado ejecutando las pruebas de identidad");
    console.error(err);
    process.exitCode = 1;

});
