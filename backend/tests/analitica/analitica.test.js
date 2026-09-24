// ==========================================================================
// PRUEBAS — Analítica privada (backend). Ejercita el código REAL de
// backend/analitica/* con un fake de Supabase inyectado vía require.cache
// (mismo enfoque que tests/pagos) y req/res simulados — sin servidor HTTP.
//
//     node backend/tests/analitica/analitica.test.js
//
// La lógica SQL (sesiones, heartbeat, retención, permisos) se prueba contra
// un Postgres real en sqlAnalitica.test.js.
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");

const ADMIN = "2491cbd0-5fb5-4cef-a06d-6092e69d40c4";
const NO_ADMIN = "99999999-9999-4999-8999-999999999999";
const TOKEN_ADMIN = "token-admin-valido-xxxxxxxxxxxx";
const TOKEN_NO_ADMIN = "token-registrado-no-admin-xxxx";
const V1 = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const UA = {
    androidMovil: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
    windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
    samsung: "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
    headless: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36",
    googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
};

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

// --------------------------------------------------------------------------
// Entorno
// --------------------------------------------------------------------------

function crearFakeSupabase() {

    const llamadas = [];

    const fake = {
        llamadas,
        admins: new Set([ADMIN]),
        respuestaRpc: () => ({ data: { ok: true, session_id: S1 }, error: null }),
        usuarios: { [TOKEN_ADMIN]: ADMIN, [TOKEN_NO_ADMIN]: NO_ADMIN },
        client: {
            rpc: async (funcion, parametros) => {
                llamadas.push({ funcion, parametros });
                return fake.respuestaRpc(funcion, parametros);
            },
            // Solo lo que usa exigirAdmin: from("analitica_admins").select().eq().maybeSingle()
            from: (tabla) => {
                assert.strictEqual(tabla, "analitica_admins");
                let id = null;
                const q = {
                    select: () => q,
                    eq: (col, valor) => { assert.strictEqual(col, "user_id"); id = valor; return q; },
                    maybeSingle: async () => ({ data: fake.admins.has(id) ? { user_id: id } : null, error: null })
                };
                return q;
            },
            auth: {
                getUser: async (token) => {
                    const id = fake.usuarios[token];
                    return id
                        ? { data: { user: { id } }, error: null }
                        : { data: { user: null }, error: { message: "invalid JWT" } };
                }
            }
        }
    };

    return fake;

}

function crearEntorno() {

    for (const clave of Object.keys(require.cache)) {
        if (clave.includes(`${path.sep}analitica${path.sep}`) || clave.endsWith(`routes${path.sep}analitica.js`)) {
            delete require.cache[clave];
        }
    }

    const rutaSupabase = path.join(RAIZ, "lib/supabase.js");
    const fake = crearFakeSupabase();

    require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: fake.client };

    return {
        fake,
        c: require(path.join(RAIZ, "analitica/controlador.js")),
        limite: require(path.join(RAIZ, "analitica/limiteTasa.js"))
    };

}

function crearRes() {
    return {
        statusCode: 200,
        body: null,
        status(codigo) { this.statusCode = codigo; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function crearReq({ headers = {}, body = {}, query = {}, params = {} } = {}) {
    return { headers, body, query, params };
}

// Ejecuta una cadena de middlewares como lo haría Express.
async function ejecutar(cadena, req) {

    const res = crearRes();

    for (const fn of cadena) {
        let siguio = false;
        await fn(req, res, () => { siguio = true; });
        if (!siguio) break;
    }

    return res;

}

function evento(extra = {}) {
    return { t: "page_view", v: V1, s: S1, p: "/sesiones", w: 390, h: 844, tc: 5, ...extra };
}

function reqRecolectar({ ev = evento(), ua = UA.androidMovil, xff = "" } = {}) {
    return crearReq({ body: { evento: ev, contexto: { user_agent: ua, x_forwarded_for: xff } } });
}

function conToken(token, extra = {}) {
    return crearReq({ headers: token ? { authorization: `Bearer ${token}` } : {}, ...extra });
}

// --------------------------------------------------------------------------

async function main() {

    const { parsearUserAgent } = require(path.join(RAIZ, "analitica/parsearUserAgent.js"));
    const { validarEvento } = require(path.join(RAIZ, "analitica/validarEvento.js"));
    const { resolverIp } = require(path.join(RAIZ, "analitica/resolverIp.js"));

    // ---------------- Sin configuración nueva ----------------

    await test("CONF. el código de analítica no lee ninguna variable de entorno propia", () => {
        const fs = require("fs");
        const archivos = [
            ...fs.readdirSync(path.join(RAIZ, "analitica")).map(f => path.join(RAIZ, "analitica", f)),
            path.join(RAIZ, "routes/analitica.js")
        ];
        for (const f of archivos) {
            const texto = fs.readFileSync(f, "utf8");
            assert.ok(!/process\.env/.test(texto), `${path.basename(f)} usa process.env`);
            assert.ok(!/ANALYTICS_/.test(texto), `${path.basename(f)} menciona ANALYTICS_*`);
        }
    });

    // ---------------- User-Agent ----------------

    await test("UA 1. móvil Android / Chrome", () => {
        assert.deepStrictEqual(parsearUserAgent(UA.androidMovil), { deviceType: "mobile", operatingSystem: "Android 14", browser: "Chrome 140" });
    });

    await test("UA 2. tablet Android (sin 'Mobile')", () => {
        assert.strictEqual(parsearUserAgent(UA.androidTablet).deviceType, "tablet");
    });

    await test("UA 3. iPhone / Safari", () => {
        assert.deepStrictEqual(parsearUserAgent(UA.iphone), { deviceType: "mobile", operatingSystem: "iOS 18.5", browser: "Safari 18" });
    });

    await test("UA 4. iPadOS se disfraza de Mac: táctil > 1 => tablet", () => {
        assert.strictEqual(parsearUserAgent(UA.ipadOs, 5).deviceType, "tablet");
        assert.strictEqual(parsearUserAgent(UA.ipadOs, 5).operatingSystem, "iPadOS");
        assert.strictEqual(parsearUserAgent(UA.ipadOs, 0).deviceType, "desktop");
    });

    await test("UA 5. PC Windows Chrome / Edge / Mac Firefox / Samsung", () => {
        assert.deepStrictEqual(parsearUserAgent(UA.windowsChrome), { deviceType: "desktop", operatingSystem: "Windows", browser: "Chrome 140" });
        assert.strictEqual(parsearUserAgent(UA.windowsEdge).browser, "Edge 140");
        assert.deepStrictEqual(parsearUserAgent(UA.macFirefox), { deviceType: "desktop", operatingSystem: "macOS", browser: "Firefox 131" });
        assert.strictEqual(parsearUserAgent(UA.samsung).browser, "Samsung Internet 27");
    });

    await test("UA 6. bots y navegadores headless (Puppeteer de compartirTabla) => null", () => {
        assert.strictEqual(parsearUserAgent(UA.headless), null);
        assert.strictEqual(parsearUserAgent(UA.googlebot), null);
        assert.strictEqual(parsearUserAgent(""), null);
    });

    // ---------------- Validación ----------------

    await test("VAL 1. evento válido se normaliza (query string y barra final fuera)", () => {
        const r = validarEvento(evento({ p: "/tablas/5000/?token=secreto#x", r: "https://www.google.com/search?q=efaat" }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.evento.pagina, "/tablas/5000");
        assert.strictEqual(r.evento.referrer, "https://www.google.com/search");
    });

    await test("VAL 2. campos desconocidos => rechazo (no se aceptan datos arbitrarios)", () => {
        assert.strictEqual(validarEvento(evento({ ip: "1.2.3.4" })).motivo, "campo_no_permitido");
        assert.strictEqual(validarEvento(evento({ device: "desktop" })).motivo, "campo_no_permitido");
    });

    await test("VAL 3. tipos inválidos, uuids inválidos, páginas inválidas", () => {
        assert.strictEqual(validarEvento(evento({ t: "session_start" })).motivo, "tipo_invalido");
        assert.strictEqual(validarEvento(evento({ v: "abc" })).motivo, "visitor_invalido");
        assert.strictEqual(validarEvento(evento({ s: 5 })).motivo, "sesion_invalida");
        assert.strictEqual(validarEvento(evento({ p: "https://evil.com/x" })).motivo, "pagina_invalida");
        assert.strictEqual(validarEvento(evento({ p: "//evil.com" })).motivo, "pagina_invalida");
        assert.strictEqual(validarEvento(evento({ p: "/" + "a".repeat(600) })).motivo, "pagina_invalida");
        assert.strictEqual(validarEvento(null).motivo, "cuerpo_invalido");
        assert.strictEqual(validarEvento([]).motivo, "cuerpo_invalido");
    });

    await test("VAL 4. pantalla/táctil fuera de rango o no enteros => rechazo", () => {
        assert.strictEqual(validarEvento(evento({ w: 0 })).motivo, "pantalla_invalida");
        assert.strictEqual(validarEvento(evento({ h: 1.5 })).motivo, "pantalla_invalida");
        assert.strictEqual(validarEvento(evento({ tc: 99 })).motivo, "pantalla_invalida");
    });

    await test("VAL 5. referrer no http(s) se descarta; basura se rechaza", () => {
        assert.strictEqual(validarEvento(evento({ r: "android-app://com.whatsapp/" })).evento.referrer, null);
        assert.strictEqual(validarEvento(evento({ r: "no es url" })).motivo, "referrer_invalido");
    });

    await test("VAL 6. rutas excluidas: impresión (Puppeteer), panel privado, APIs", () => {
        assert.strictEqual(validarEvento(evento({ p: "/tablas/imprimir/5000" })).ignorar, true);
        assert.strictEqual(validarEvento(evento({ p: "/analitica-privada" })).ignorar, true);
        assert.strictEqual(validarEvento(evento({ p: "/api/e" })).ignorar, true);
        assert.strictEqual(validarEvento(evento({ p: "/tablas" })).ignorar, false);
        assert.strictEqual(validarEvento(evento({ p: "/apis-no" })).ignorar, false);
    });

    await test("VAL 7. payload > 2 KB => rechazo", () => {
        assert.strictEqual(validarEvento(evento({ r: "https://x.com/" + "a".repeat(2100) })).ok, false);
    });

    // ---------------- IP ----------------

    await test("IP 1. última entrada de X-Forwarded-For (la que añade Next o nginx)", () => {
        assert.strictEqual(resolverIp("190.24.10.7"), "190.24.10.7");
        assert.strictEqual(resolverIp("6.6.6.6, 190.24.10.7"), "190.24.10.7", "lo inventado por el cliente queda a la izquierda");
        assert.strictEqual(resolverIp("::ffff:190.24.10.7"), "190.24.10.7");
        assert.strictEqual(resolverIp("2800:484::1"), "2800:484::1");
        assert.strictEqual(resolverIp("190.24.10.7:5123"), "190.24.10.7");
    });

    await test("IP 2. vacía o inválida => null", () => {
        assert.strictEqual(resolverIp(""), null);
        assert.strictEqual(resolverIp(undefined), null);
        assert.strictEqual(resolverIp("no-es-ip"), null);
        assert.strictEqual(resolverIp("1.2.3.4, basura"), null);
    });

    // ---------------- Ingestión ----------------

    await test("REC 1. evento válido llega a la RPC con dispositivo del UA real e IP", async () => {
        const { c, fake, limite } = crearEntorno();
        limite.reiniciar();
        const res = await ejecutar([c.recolectar], reqRecolectar({ xff: "9.9.9.9, 190.24.10.7" }));
        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(res.body, { ok: true, s: S1 });
        const p = fake.llamadas[0].parametros;
        assert.strictEqual(fake.llamadas[0].funcion, "analitica_registrar_evento");
        assert.strictEqual(p.p_device_type, "mobile");
        assert.strictEqual(p.p_operating_system, "Android 14");
        assert.strictEqual(p.p_ip, "190.24.10.7");
        assert.strictEqual(p.p_timeout_segundos, 1800);
        assert.strictEqual(p.p_screen_width, 390);
    });

    await test("REC 2. inválido => 400 sin tocar Supabase; bot/Puppeteer => 202 ignorado", async () => {
        const { c, fake } = crearEntorno();
        assert.strictEqual((await ejecutar([c.recolectar], reqRecolectar({ ev: evento({ extra: 1 }) }))).statusCode, 400);
        assert.strictEqual((await ejecutar([c.recolectar], reqRecolectar({ ua: UA.headless }))).statusCode, 202);
        assert.strictEqual((await ejecutar([c.recolectar], reqRecolectar({ ev: evento({ p: "/tablas/imprimir/5000" }) }))).statusCode, 202);
        assert.strictEqual(fake.llamadas.length, 0);
    });

    await test("REC 3. rate limiting por visitante y por IP => 429", async () => {
        const { c, limite } = crearEntorno();
        limite.reiniciar();
        let codigos = [];
        for (let i = 0; i < 25; i++) {
            codigos.push((await ejecutar([c.recolectar], reqRecolectar({ xff: "190.24.10.7" }))).statusCode);
        }
        assert.strictEqual(codigos.filter(x => x === 200).length, 20);
        assert.ok(codigos.slice(20).every(x => x === 429));
        // Misma IP rotando visitor_id: el cubo de IP (30) también corta.
        limite.reiniciar();
        codigos = [];
        for (let i = 0; i < 35; i++) {
            const v = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
            codigos.push((await ejecutar([c.recolectar], reqRecolectar({ ev: evento({ v }), xff: "190.24.10.7" }))).statusCode);
        }
        assert.strictEqual(codigos.filter(x => x === 200).length, 30);
        limite.reiniciar();
    });

    await test("REC 4. el token bucket se recupera con el tiempo", () => {
        const { limite } = crearEntorno();
        const l = limite.crearLimitador({ capacidad: 2, porSegundo: 1 });
        assert.ok(l.permitir("k", 0) && l.permitir("k", 0));
        assert.ok(!l.permitir("k", 0));
        assert.ok(l.permitir("k", 1000));
    });

    await test("REC 5. sesión ajena (rechazo de la función) => 409; error Supabase => 500", async () => {
        const { c, fake, limite } = crearEntorno();
        limite.reiniciar();
        fake.respuestaRpc = () => ({ data: { ok: false, motivo: "sesion_ajena" }, error: null });
        assert.strictEqual((await ejecutar([c.recolectar], reqRecolectar())).statusCode, 409);
        fake.respuestaRpc = () => ({ data: null, error: { message: "boom" } });
        assert.strictEqual((await ejecutar([c.recolectar], reqRecolectar())).statusCode, 500);
    });

    // ---------------- Autorización (Supabase Auth + analitica_admins) ----------------

    await test("AUTH 1. administrador existente (sesión Supabase + analitica_admins) => acceso", async () => {
        const { c } = crearEntorno();
        const r = await ejecutar([c.exigirAdmin, c.verificar], conToken(TOKEN_ADMIN));
        assert.strictEqual(r.statusCode, 200);
    });

    await test("AUTH 2. usuario registrado pero NO en analitica_admins => 404", async () => {
        const { c } = crearEntorno();
        const r = await ejecutar([c.exigirAdmin, c.verificar], conToken(TOKEN_NO_ADMIN));
        assert.strictEqual(r.statusCode, 404);
    });

    await test("AUTH 3. sin token / token inválido / formato raro => 404", async () => {
        const { c, fake } = crearEntorno();
        for (const req of [conToken(null), conToken("token-inventado-xxxxxxxxxxxxxxx"), crearReq({ headers: { authorization: "Basic abc" } })]) {
            assert.strictEqual((await ejecutar([c.exigirAdmin, c.resumen], req)).statusCode, 404);
        }
        assert.strictEqual(fake.llamadas.length, 0, "ninguna lectura se ejecutó");
    });

    await test("AUTH 4. quitar el usuario de analitica_admins revoca en la siguiente petición", async () => {
        const { c, fake } = crearEntorno();
        assert.strictEqual((await ejecutar([c.exigirAdmin, c.verificar], conToken(TOKEN_ADMIN))).statusCode, 200);
        fake.admins.delete(ADMIN);
        assert.strictEqual((await ejecutar([c.exigirAdmin, c.verificar], conToken(TOKEN_ADMIN))).statusCode, 404);
    });

    await test("AUTH 5. si Supabase falla al verificar => 404 (falla cerrado)", async () => {
        const { c, fake } = crearEntorno();
        fake.client.auth.getUser = async () => { throw new Error("red caída"); };
        assert.strictEqual((await ejecutar([c.exigirAdmin, c.verificar], conToken(TOKEN_ADMIN))).statusCode, 404);
    });

    // ---------------- Lecturas / rangos ----------------

    await test("LEC 1. resumen/historial pasan el rango de Bogotá a la RPC; detalle valida uuid", async () => {
        const { c, fake } = crearEntorno();
        fake.respuestaRpc = () => ({ data: { total: 0, filas: [] }, error: null });
        const r = await ejecutar([c.exigirAdmin, c.historial], conToken(TOKEN_ADMIN, { query: { preset: "rango", desde: "2026-09-01", hasta: "2026-09-02", limite: "999" } }));
        assert.strictEqual(r.statusCode, 200);
        const p = fake.llamadas.at(-1).parametros;
        assert.strictEqual(p.p_desde, "2026-09-01T05:00:00.000Z");
        assert.strictEqual(p.p_hasta, "2026-09-03T05:00:00.000Z");
        assert.strictEqual(p.p_limite, 200);
        const mal = await ejecutar([c.exigirAdmin, c.resumen], conToken(TOKEN_ADMIN, { query: { preset: "rango", desde: "2026-02-30", hasta: "2026-03-01" } }));
        assert.strictEqual(mal.statusCode, 400);
        const d = await ejecutar([c.exigirAdmin, c.detalleSesion], conToken(TOKEN_ADMIN, { params: { id: "x' or 1=1" } }));
        assert.strictEqual(d.statusCode, 400);
        fake.respuestaRpc = () => ({ data: null, error: null });
        const d2 = await ejecutar([c.exigirAdmin, c.detalleSesion], conToken(TOKEN_ADMIN, { params: { id: S1 } }));
        assert.strictEqual(d2.statusCode, 404);
    });

    await test("LEC 2. presets hoy/ayer/7d en America/Bogota (UTC-5) y límite de 93 días", () => {
        crearEntorno();
        const { resolverRango } = require(path.join(RAIZ, "analitica/rangoFechas.js"));
        // 2026-09-25 02:00 UTC = 2026-09-24 21:00 en Bogotá -> "hoy" es el 24.
        const ahora = new Date("2026-09-25T02:00:00Z");
        const hoy = resolverRango({ preset: "hoy" }, ahora);
        assert.strictEqual(hoy.desde.toISOString(), "2026-09-24T05:00:00.000Z");
        assert.strictEqual(hoy.hasta.toISOString(), "2026-09-25T05:00:00.000Z");
        assert.strictEqual(resolverRango({ preset: "ayer" }, ahora).desde.toISOString(), "2026-09-23T05:00:00.000Z");
        assert.strictEqual(resolverRango({ preset: "7d" }, ahora).desde.toISOString(), "2026-09-18T05:00:00.000Z");
        assert.strictEqual(resolverRango({ preset: "rango", desde: "2026-01-01", hasta: "2026-06-01" }, ahora), null);
        assert.strictEqual(resolverRango({ preset: "rango", desde: "2026-09-10", hasta: "2026-09-01" }, ahora), null);
        assert.strictEqual(resolverRango({ preset: "otro" }, ahora), null);
    });

    await test("LEC 3. el router: ingestión pública y TODAS las lecturas tras exigirAdmin", () => {
        crearEntorno();
        const router = require(path.join(RAIZ, "routes/analitica.js"));
        const rutas = router.stack.filter(l => l.route).map(l => ({
            ruta: `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`,
            primero: l.route.stack[0].handle.name
        }));
        assert.deepStrictEqual(rutas.map(r => r.ruta), [
            "POST /recolectar", "GET /verificar", "GET /resumen",
            "GET /activos", "GET /historial", "GET /sesiones/:id"
        ]);
        assert.ok(rutas.filter(r => r.ruta.startsWith("GET")).every(r => r.primero === "exigirAdmin"));
    });

    const fallidas = resultados.filter(r => !r.ok);

    console.log("");
    console.log(`TOTAL: ${resultados.length}  ✅ PASA: ${resultados.length - fallidas.length}  ❌ FALLA: ${fallidas.length}`);

    if (fallidas.length) process.exit(1);

}

main();
