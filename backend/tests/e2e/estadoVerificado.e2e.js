// ==========================================================================
// PRUEBA DE NAVEGADOR — Sesiones, Grupos y Contactos cuando el backend no
// puede responder (caso real del 16/10: el backend de producción devuelve
// 503 TOKEN_SERVICIO_NO_CONFIGURADO) y después, cuando ya responde.
//
// Entorno AISLADO (entornoPanel.js): Chrome + panel real (next dev) + base
// en memoria. El «backend» de /sessions y /contactos es un doble con dos
// modos:
//   sin_token   responde exactamente lo que responde hoy producción;
//   configurado responde como el backend real con el token correcto.
// Nada sale a Supabase ni a WhatsApp.
//
//     node backend/tests/e2e/estadoVerificado.e2e.js
// ==========================================================================

const assert = require("assert");
const {
    PANEL, tablas: t, servirTablas, registrarUsuario, arrancarEntorno, esperarTexto, textoPagina, captura, crearPasos
} = require("./entornoPanel");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario("tok-a", A, "admin-a@prueba.local");

const S1 = "11111111-0000-4000-8000-000000000001";   // activa, guardada «conectado»
const S2 = "22222222-0000-4000-8000-000000000002";   // preferida, guardada «conectado»
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";

servirTablas(["sesiones", "grupos_autorizados"]);
t.sesiones = [
    { id: S1, usuario_id: A, nombre: "Principal", telefono: "573000000001", estado: "conectado", activa: true, principal: false, created_at: "2026-10-01T00:00:00Z" },
    { id: S2, usuario_id: A, nombre: "Respaldo", telefono: "573000000002", estado: "conectado", activa: false, principal: true, created_at: "2026-10-02T00:00:00Z" }
];
t.grupos_autorizados = [
    { id: "ga-1", usuario_id: A, grupo_id: G1, activo: true, created_at: "2026-10-01T00:00:00Z" },
    { id: "ga-2", usuario_id: A, grupo_id: G2, activo: false, created_at: "2026-10-01T00:00:00Z" }
];
const autorizadosAntes = JSON.stringify(t.grupos_autorizados);

let modo = "sin_token";
const SIN_TOKEN = { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO", error: "El backend no tiene configurado el token de servicio." };

const salud = (sessionId, estado) => ({
    sessionId, estado, causas: [], accion: null, conectadoEn: new Date().toISOString(), listenerEn: null,
    ultimoMensajeRecibidoEn: null, ultimoProcesadoOkEn: null, ultimoError: null, erroresSeguidos: 0, recuperaciones: [], lease: null
});

function montarBackend(app) {
    app.use(["/sessions", "/contactos"], (req, res, next) => modo === "sin_token" ? res.status(503).json(SIN_TOKEN) : next());
    app.get("/sessions/salud", (req, res) => res.json({ ok: true, instancia: "VPS", generadoEn: new Date().toISOString(), sesiones: [salud(S1, "saludable"), salud(S2, "desconectada")] }));
    app.get("/sessions/:id/grupos-disponibles", (req, res) => req.params.id === S1
        ? res.json({ success: true, sessionId: S1, grupos: [{ id: G1, nombre: "Rifas del martes" }] })
        : res.status(409).json({ success: false, error: `La sesión ${req.params.id} no tiene un socket conectado ahora mismo.` }));
    app.get("/contactos", (req, res) => res.json({ success: true, contactos: [{
        id: "c1", nombre: "Cliente Uno", telefono: "573111111111", lid: null, estadoIdentificacion: "solo_telefono",
        cantidadReservas: 2, cantidadPagadas: 1, primeraVezVisto: "2026-10-01T00:00:00Z", ultimaActividad: new Date().toISOString(), telefonoPendiente: false
    }] }));
}

const TECNICO = /token|backend|proxy|HTTP|supabase|socket/i;

const pulsarBoton = (page, texto) => page.evaluate((texto) => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === texto);
    if (!b) throw new Error(`No hay botón «${texto}»`);
    b.click();
}, texto);

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno({ montarBackend });

    try {

        const page = await entorno.nuevaPagina("tok-a");

        // ---------------------------------------------- 1. sin token (hoy) ---
        await page.goto(`${PANEL}/sesiones`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Sin verificar");
        let texto = await textoPagina(page);
        assert.ok(!texto.includes("Bot activo"), "sin verificar no debe decir «Bot activo»");
        assert.ok(!/^Conectada$/m.test(texto), "sin verificar no debe decir «Conectada»");
        assert.ok(texto.includes("En uso · sin verificar"));
        assert.ok(texto.includes("Último estado guardado: conectada"));
        assert.ok(texto.includes("No se ha desconectado nada"));
        await captura(page, "sesiones-sin-token");
        paso("Sesiones sin token: «Sin verificar», sin «Conectada» ni «Bot activo»");

        await page.goto(`${PANEL}/automatizacion/grupos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Autorizados sin verificar");
        texto = await textoPagina(page);
        assert.ok(texto.includes("No pudimos comprobar tus sesiones de WhatsApp"));
        assert.ok(texto.includes("Principal — sin verificar"));
        assert.ok(texto.includes(`JID: ${G1}`) && texto.includes(`JID: ${G2}`), "los dos grupos autorizados siguen visibles");
        assert.ok(texto.includes("Sin verificar ahora"));
        assert.ok(!texto.includes("No disponible actualmente"), "no se afirma que no existan");
        assert.ok(!texto.includes("desconectada ahora mismo"), "no se afirma que estén desconectadas");
        assert.ok(!texto.includes("socket"), "sin textos técnicos");
        await captura(page, "grupos-sin-token");
        paso("Grupos sin token: autorizados «sin verificar», no «No disponible» ni «desconectada»");

        await page.goto(`${PANEL}/contactos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "No pudimos cargar los contactos");
        texto = await textoPagina(page);
        assert.ok(!TECNICO.test(texto.split("Escanear grupos ahora").pop()), "el error no muestra textos técnicos");
        const conteos = await page.$$eval(".contactos-filtro-conteo", (xs) => xs.map(x => x.textContent.trim()));
        assert.ok(conteos.length > 0 && conteos.every(c => c === "—"), `contadores sin datos deben ser «—», no 0: ${conteos}`);
        await captura(page, "contactos-sin-token");
        paso("Contactos sin token: mensaje sencillo, contadores «—» y botón Reintentar");

        // --------------------------------- 2. token configurado: Reintentar ---
        modo = "configurado";

        await pulsarBoton(page, "Reintentar");
        await esperarTexto(page, "Cliente Uno");
        const conteosOk = await page.$$eval(".contactos-filtro-conteo", (xs) => xs.map(x => x.textContent.trim()));
        assert.strictEqual(conteosOk[0], "1");
        paso("Contactos: «Reintentar» repite la consulta y muestra los contactos guardados");

        await page.goto(`${PANEL}/automatizacion/grupos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Rifas del martes");
        texto = await textoPagina(page);
        assert.ok(texto.includes("Principal — conectada"));
        assert.ok(texto.includes("Respaldo — desconectada ahora mismo"), "el 409 real sí se muestra como desconectada");
        assert.ok(texto.includes("No disponibles actualmente") && texto.includes(`JID: ${G2}`), "G2 no reportado por la sesión conectada");
        paso("Grupos con token: conectada / desconectada (409) / no disponible, con datos reales");

        await page.goto(`${PANEL}/sesiones`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Saludable · escuchando");
        texto = await textoPagina(page);
        assert.ok(texto.includes("Bot activo"));
        assert.ok(!texto.includes("Sin verificar"));
        paso("Sesiones con token: estado real del bot («Saludable · escuchando», «Bot activo»)");

        assert.strictEqual(JSON.stringify(t.grupos_autorizados), autorizadosAntes, "grupos_autorizados no cambió");
        assert.deepStrictEqual(t.sesiones.map(s => [s.estado, s.activa, s.principal]), [["conectado", true, false], ["conectado", false, true]], "sesiones no cambió");
        assert.deepStrictEqual(page.erroresJs, [], `errores JS: ${page.erroresJs}`);
        paso("Ni grupos autorizados ni sesiones se modificaron; sin errores JS");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
