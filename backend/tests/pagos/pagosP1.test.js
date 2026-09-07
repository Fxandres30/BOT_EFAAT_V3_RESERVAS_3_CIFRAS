// ==========================================================================
// PRUEBAS — Módulo de Pagos FASE P1 (ingesta cruda de movimientos).
//
// Ejercita el código REAL de producción (autenticacionDispositivo.js,
// pagosController.js, credenciales.js, hashDuplicado.js) contra un fake
// de Supabase fiel al índice único parcial de la migración 005 — sin
// levantar un servidor HTTP real (se invocan middleware/handler
// directamente con req/res simulados, mismo enfoque que el resto de
// pruebas de este repo que no usan un framework de test).
//
//     node backend/tests/pagos/pagosP1.test.js
// ==========================================================================

const assert = require("assert");

const { crearEntorno, crearReq, ejecutarRuta } = require("./entornoFakePagos");

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

function movimientoValido(overrides = {}) {

    return {
        proveedor: "Nequi",
        valor: 25000,
        moneda: "COP",
        fecha_hora_movimiento: "2026-09-07T15:30:00.000Z",
        remitente_nombre: "Juan Perez",
        remitente_cuenta: "3001234567",
        referencia: "M12345678",
        texto_original: "Nequi: Recibiste $25.000 de JUAN PEREZ. Ref: M12345678",
        ...overrides
    };

}

async function main() {

    // ---------------------------------------------------------------
    // 1) dispositivo válido acepta movimiento
    // ---------------------------------------------------------------
    await test("1. dispositivo válido acepta movimiento", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({
            usuario_id: "user-a",
            nombre: "Pixel de prueba",
            credencial_hash: credenciales.hashCredencial(secreto),
            activo: true
        });

        const req = crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido()
        });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, req);

        assert.strictEqual(res.statusCode, 201, "debe responder 201 Created");
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.duplicado, false);
        assert.strictEqual(res.body.movimiento.usuario_id, "user-a", "el movimiento debe quedar atado al usuario_id del dispositivo");

    });

    // ---------------------------------------------------------------
    // 2) dispositivo inválido rechaza
    // ---------------------------------------------------------------
    await test("2. dispositivo inválido (secreto incorrecto) rechaza con 401", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secretoReal = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({
            usuario_id: "user-a",
            nombre: "Pixel de prueba",
            credencial_hash: credenciales.hashCredencial(secretoReal),
            activo: true
        });

        const req = crearReq({
            authorization: `Bearer ${dispositivo.id}.secreto-incorrecto`,
            body: movimientoValido()
        });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, req);

        assert.strictEqual(res.statusCode, 401, "debe responder 401");
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(fakeSupabase._movimientos().length, 0, "no debe haberse creado ningún movimiento");

    });

    // ---------------------------------------------------------------
    // 3) dispositivo inactivo rechaza
    // ---------------------------------------------------------------
    await test("3. dispositivo inactivo rechaza con 401 aunque el secreto sea correcto", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({
            usuario_id: "user-a",
            nombre: "Pixel desactivado",
            credencial_hash: credenciales.hashCredencial(secreto),
            activo: false
        });

        const req = crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido()
        });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, req);

        assert.strictEqual(res.statusCode, 401, "debe responder 401");
        assert.strictEqual(fakeSupabase._movimientos().length, 0, "no debe haberse creado ningún movimiento");

    });

    // ---------------------------------------------------------------
    // 4) dispositivo de tenant A no puede enviar para tenant B
    // ---------------------------------------------------------------
    await test("4. el usuario_id SIEMPRE viene del dispositivo autenticado, nunca del body", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivoDeA = fakeSupabase._agregarDispositivo({
            usuario_id: "tenant-A",
            nombre: "Dispositivo de A",
            credencial_hash: credenciales.hashCredencial(secreto),
            activo: true
        });

        // El dispositivo pertenece al tenant A; aunque el body intentara
        // colar un usuario_id de B, el controlador ni siquiera lo lee del
        // body — lo toma de req.dispositivo, resuelto por la credencial.
        const req = crearReq({
            authorization: `Bearer ${dispositivoDeA.id}.${secreto}`,
            body: movimientoValido({ usuario_id: "tenant-B" })
        });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, req);

        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(res.body.movimiento.usuario_id, "tenant-A", "el movimiento debe quedar en el tenant del DISPOSITIVO, nunca en el que sugiera el body");
        assert.notStrictEqual(res.body.movimiento.usuario_id, "tenant-B");

    });

    // ---------------------------------------------------------------
    // 5) movimiento válido se guarda
    // ---------------------------------------------------------------
    await test("5. un movimiento válido queda persistido y recuperable vía GET del mismo tenant", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({
            usuario_id: "user-a",
            nombre: "Pixel",
            credencial_hash: credenciales.hashCredencial(secreto),
            activo: true
        });

        const auth = `Bearer ${dispositivo.id}.${secreto}`;

        await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: auth, body: movimientoValido() }));

        const resGet = await ejecutarRuta(autenticarDispositivo, controller.listarMovimientos, crearReq({ authorization: auth }));

        assert.strictEqual(resGet.statusCode, 200);
        assert.strictEqual(resGet.body.movimientos.length, 1, "debe verse el movimiento recién creado");

    });

    // ---------------------------------------------------------------
    // GET no permite ver movimientos de otro tenant
    // ---------------------------------------------------------------
    await test("GET /pagos/movimientos nunca devuelve movimientos de otro tenant", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secretoA = credenciales.generarSecreto();
        const dispositivoA = fakeSupabase._agregarDispositivo({ usuario_id: "tenant-A", nombre: "A", credencial_hash: credenciales.hashCredencial(secretoA), activo: true });

        const secretoB = credenciales.generarSecreto();
        const dispositivoB = fakeSupabase._agregarDispositivo({ usuario_id: "tenant-B", nombre: "B", credencial_hash: credenciales.hashCredencial(secretoB), activo: true });

        await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: `Bearer ${dispositivoA.id}.${secretoA}`, body: movimientoValido({ referencia: "REF-A" }) }));
        await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: `Bearer ${dispositivoB.id}.${secretoB}`, body: movimientoValido({ referencia: "REF-B" }) }));

        const resGetA = await ejecutarRuta(autenticarDispositivo, controller.listarMovimientos, crearReq({ authorization: `Bearer ${dispositivoA.id}.${secretoA}` }));

        assert.strictEqual(resGetA.body.movimientos.length, 1);
        assert.strictEqual(resGetA.body.movimientos[0].referencia, "REF-A");

    });

    // ---------------------------------------------------------------
    // 6) movimiento duplicado no genera duplicación
    // ---------------------------------------------------------------
    await test("6. el mismo movimiento enviado dos veces NO crea dos filas independientes", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });
        const auth = `Bearer ${dispositivo.id}.${secreto}`;

        const primera = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: auth, body: movimientoValido() }));
        const segunda = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: auth, body: movimientoValido() }));

        assert.strictEqual(primera.statusCode, 201);
        assert.strictEqual(primera.body.duplicado, false);

        assert.strictEqual(segunda.statusCode, 200, "el segundo envío no es un error, es un duplicado reconocido");
        assert.strictEqual(segunda.body.duplicado, true);
        assert.strictEqual(segunda.body.movimientoOriginalId, primera.body.movimiento.id);

        const pendientes = fakeSupabase._movimientos().filter(m => m.estado === "pendiente");
        const duplicados = fakeSupabase._movimientos().filter(m => m.estado === "duplicado");

        assert.strictEqual(pendientes.length, 1, "debe existir exactamente UN movimiento pendiente (no dos independientes)");
        assert.strictEqual(duplicados.length, 1, "el segundo intento debe quedar registrado como duplicado, no descartado en silencio");
        assert.strictEqual(duplicados[0].duplicado_de_id, pendientes[0].id, "el duplicado debe enlazar al original");

    });

    // ---------------------------------------------------------------
    // Dos tenants distintos con el mismo movimiento NO chocan entre sí
    // ---------------------------------------------------------------
    await test("el mismo movimiento en dos tenants distintos NO se considera duplicado cruzado", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secretoA = credenciales.generarSecreto();
        const dispositivoA = fakeSupabase._agregarDispositivo({ usuario_id: "tenant-A", nombre: "A", credencial_hash: credenciales.hashCredencial(secretoA), activo: true });

        const secretoB = credenciales.generarSecreto();
        const dispositivoB = fakeSupabase._agregarDispositivo({ usuario_id: "tenant-B", nombre: "B", credencial_hash: credenciales.hashCredencial(secretoB), activo: true });

        const resA = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: `Bearer ${dispositivoA.id}.${secretoA}`, body: movimientoValido() }));
        const resB = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ authorization: `Bearer ${dispositivoB.id}.${secretoB}`, body: movimientoValido() }));

        assert.strictEqual(resA.body.duplicado, false);
        assert.strictEqual(resB.body.duplicado, false, "la deduplicación es por tenant — el mismo movimiento en OTRO negocio no es un duplicado");

    });

    // ---------------------------------------------------------------
    // 7) referencia se conserva exactamente
    // ---------------------------------------------------------------
    await test("7. la referencia se conserva byte a byte, incluyendo mayúsculas/guiones", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });

        const referenciaOriginal = "M-AbC-000999-XyZ";

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ referencia: referenciaOriginal })
        }));

        assert.strictEqual(res.body.movimiento.referencia, referenciaOriginal, "la referencia no debe normalizarse/recortarse al guardar");

    });

    // ---------------------------------------------------------------
    // 8) texto_original se conserva exactamente
    // ---------------------------------------------------------------
    await test("8. texto_original se conserva exactamente, incluyendo saltos de línea y emojis", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });

        const textoOriginal = "Nequi 📲\nRecibiste $25.000\nDe: JUAN PEREZ\nRef: M12345678";

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ texto_original: textoOriginal })
        }));

        assert.strictEqual(res.body.movimiento.texto_original, textoOriginal, "texto_original nunca debe recortarse ni normalizarse");

    });

    // ---------------------------------------------------------------
    // 9) valor se conserva correctamente
    // ---------------------------------------------------------------
    await test("9. el valor numérico (con decimales) se conserva sin redondeos inesperados", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ valor: 125350.75 })
        }));

        assert.strictEqual(res.body.movimiento.valor, 125350.75);

        // Un valor NO numérico debe rechazarse ANTES de tocar Supabase.
        const resInvalido = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ valor: "no-es-un-numero", referencia: "OTRA-REF" })
        }));

        assert.strictEqual(resInvalido.statusCode, 400);
        assert.strictEqual(resInvalido.body.code, "VALOR_INVALIDO");

    });

    // ---------------------------------------------------------------
    // 10) fecha/hora se conserva correctamente
    // ---------------------------------------------------------------
    await test("10. fecha_hora_movimiento se conserva (normalizada a ISO 8601) y una fecha inválida se rechaza", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });

        const fechaOriginal = "2026-01-15T08:07:03.000Z";

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ fecha_hora_movimiento: fechaOriginal })
        }));

        assert.strictEqual(new Date(res.body.movimiento.fecha_hora_movimiento).getTime(), new Date(fechaOriginal).getTime());

        const resInvalida = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: movimientoValido({ fecha_hora_movimiento: "no-es-una-fecha", referencia: "OTRA-REF-2" })
        }));

        assert.strictEqual(resInvalida.statusCode, 400);
        assert.strictEqual(resInvalida.body.code, "FECHA_INVALIDA");

    });

    // ---------------------------------------------------------------
    // Extra: campos obligatorios faltantes se rechazan con 400
    // ---------------------------------------------------------------
    await test("extra. faltan campos obligatorios -> 400 CAMPOS_INCOMPLETOS, nada se guarda", async () => {

        const { fakeSupabase, credenciales, autenticarDispositivo, controller } = crearEntorno();

        const secreto = credenciales.generarSecreto();
        const dispositivo = fakeSupabase._agregarDispositivo({ usuario_id: "user-a", nombre: "Pixel", credencial_hash: credenciales.hashCredencial(secreto), activo: true });

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({
            authorization: `Bearer ${dispositivo.id}.${secreto}`,
            body: { proveedor: "Nequi" } // faltan valor, fecha_hora_movimiento, texto_original
        }));

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.code, "CAMPOS_INCOMPLETOS");
        assert.strictEqual(fakeSupabase._movimientos().length, 0);

    });

    // ---------------------------------------------------------------
    // Extra: falta el header Authorization por completo
    // ---------------------------------------------------------------
    await test("extra. sin header Authorization -> 401 SIN_CREDENCIAL", async () => {

        const { autenticarDispositivo, controller } = crearEntorno();

        const res = await ejecutarRuta(autenticarDispositivo, controller.crearMovimiento, crearReq({ body: movimientoValido() }));

        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.code, "SIN_CREDENCIAL");

    });

    console.log("\n============================");
    const pasaron = resultados.filter(r => r.ok).length;
    const fallaron = resultados.filter(r => !r.ok).length;
    console.log(`TOTAL: ${resultados.length}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================");

    if (fallaron) {
        console.log("Fallos:", resultados.filter(r => !r.ok).map(r => r.nombre));
    }

    process.exit(fallaron ? 1 : 0);

}

main().catch(err => {
    console.error("💥 ERROR INESPERADO:", err);
    process.exit(1);
});
