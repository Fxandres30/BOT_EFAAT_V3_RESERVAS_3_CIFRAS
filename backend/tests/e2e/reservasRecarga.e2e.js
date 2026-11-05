// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Reservas tras RECARGAR la página (F5):
// instantánea del índice en localStorage (excepción autorizada 05/11/2026).
//
//   1. Primera carga: el servidor valida y se guarda la instantánea, sin
//      cuentas de pago ni otros datos sensibles.
//   2. Cinco recargas seguidas (con el servidor lento): nunca aparece
//      «Consultando sorteo…» ni el esqueleto; se ve el aviso «sin confirmar»
//      hasta que valida el servidor y luego desaparece.
//   3. Cambio en el servidor durante la recarga: primero la instantánea con
//      su aviso, después lo del servidor (prioridad) y se reescribe.
//   4. Servidor caído al recargar: se mantiene la instantánea con el aviso de
//      que no se pudo validar; la interfaz no se vacía.
//   5. Cambio de usuario en el mismo navegador: nunca se ve nada de la cuenta
//      anterior y su instantánea se borra.
//   6. Cierre de sesión: no queda ninguna instantánea.
//   7. Sin errores de JavaScript.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria, sin
// WhatsApp. No toca datos reales.
//
//     node backend/tests/e2e/reservasRecarga.e2e.js
//     (si ya hay un `next dev` en frontend/: E2E_FRONTEND=<copia del panel>)
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const servicio = require(path.join(RAIZ, "sorteos/servicio.js"));

const TOKEN_A = "e2e-token-recarga-a";
const TOKEN_B = "e2e-token-recarga-b";
const A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const B = "bbbbbbbb-0000-4000-8000-0000000000d2";
registrarUsuario(TOKEN_A, A, "recarga-a@prueba.local");
registrarUsuario(TOKEN_B, B, "recarga-b@prueba.local");

const PREFIJO = "efaat:indice-reservas:v1:";
const CLAVE_SESION = "sb-127-auth-token";

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Titular Secreto", activa: true }];
t.eventos_bot = [];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const { paso, terminar } = crearPasos();

const sesionDe = (token, id, email) => ({
    access_token: token, refresh_token: `r-${token}`, token_type: "bearer",
    expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
    user: { id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }
});

// Vigía armado desde el primer instante de cada documento: cuenta cada
// aparición de «Consultando sorteo…», del esqueleto, del aviso de
// instantánea y de los textos que se le indiquen.
function instalarVigia() {
    // Cambio de sesión de la prueba: se aplica DESPUÉS de la sesión que
    // inyecta entornoPanel (los scripts corren en orden de registro).
    try {
        const s = sessionStorage.getItem("e2e-sesion");
        if (s === "ninguna") localStorage.removeItem("sb-127-auth-token");
        else if (s) localStorage.setItem("sb-127-auth-token", s);
    } catch { /* nada */ }
    const buscar = JSON.parse(sessionStorage.getItem("e2e-buscar") || "[]");
    window.__vigia = { consultando: 0, esqueleto: 0, aviso: 0, vistos: {} };
    new MutationObserver(() => {
        const v = window.__vigia;
        if (!document.body) return;
        const txt = document.body.innerText;
        if (txt.includes("Consultando sorteo")) v.consultando++;
        if (document.querySelector('[aria-label="Cargando tablas"]')) v.esqueleto++;
        if (document.querySelector("[data-instantanea]")) v.aviso++;
        for (const b of buscar) if (txt.includes(b)) v.vistos[b] = (v.vistos[b] || 0) + 1;
    }).observe(document, { childList: true, subtree: true, characterData: true });
}

const vigia = (page) => page.evaluate(() => window.__vigia);
const instantaneas = (page) => page.evaluate((p) => Object.keys(localStorage).filter(k => k.startsWith(p)), PREFIJO);
const sinAviso = (page) => page.waitForFunction(() => !document.querySelector("[data-instantanea]"), { timeout: 60000 });

async function main() {

    const sorteo = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Lotería Recarga", hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 100000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-e2e"],
        publicar_en: new Date(`${fechaColombia(2)}T08:00:00-05:00`).toISOString(), fecha_sorteo: fechaColombia(2),
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(sorteo.ok, JSON.stringify(sorteo));
    const fila = t.sorteos_programados.find(s => s.id === sorteo.data.id);
    fila.estado = "programado";

    const entorno = await arrancarEntorno();

    try {

        servirTablas(["reservas_dos_cifras", "5k_15k_reservas_2_cifras", "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);
        const page = await entorno.nuevaPagina(TOKEN_A);
        await page.setViewport({ width: 1366, height: 900 });
        await page.evaluateOnNewDocument(instalarVigia);

        // Servidor de sorteos controlable: lento (para ver la instantánea) o caído.
        let retrasoMs = 0;
        let caido = false;
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            if (!/\/api\/sorteos\/(activos|gestion)(\?|$)|\/api\/sorteos(\?|$)/.test(req.url())) return req.continue();
            if (caido) return req.abort("failed");
            if (retrasoMs) return setTimeout(() => req.continue().catch(() => {}), retrasoMs);
            req.continue();
        });

        // 1. Primera carga.
        await page.goto(`${PANEL}/tablas`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería Recarga");
        await page.waitForFunction((p) => Object.keys(localStorage).some(k => k.startsWith(p)), { timeout: 30000 }, PREFIJO);
        const guardado = await page.evaluate((k) => localStorage.getItem(k), PREFIJO + A);
        assert.ok(guardado && guardado.includes("Lotería Recarga"), "instantánea guardada");
        for (const sensible of ["3000000001", "Titular Secreto", "Nequi Prueba", "Premio mayor", "cuentas"]) {
            assert.ok(!guardado.includes(sensible), `la instantánea contiene «${sensible}»`);
        }
        assert.deepStrictEqual(await instantaneas(page), [PREFIJO + A]);
        paso("primera carga: el servidor valida y se guarda la instantánea sin datos sensibles");

        // 2. Cinco recargas seguidas con el servidor lento.
        retrasoMs = 2500;
        for (let i = 1; i <= 5; i++) {
            await page.reload({ waitUntil: "domcontentloaded" });
            await esperarTexto(page, "Lotería Recarga");
            const alPintar = await textoPagina(page);
            assert.ok(alPintar.includes("sin confirmar"), `recarga ${i}: falta el aviso de instantánea`);
            await sinAviso(page);
            await new Promise(r => setTimeout(r, 300));
            const v = await vigia(page);
            assert.strictEqual(v.consultando, 0, `recarga ${i}: apareció «Consultando sorteo…»`);
            assert.strictEqual(v.esqueleto, 0, `recarga ${i}: apareció el esqueleto`);
            assert.ok(v.aviso > 0);
            console.log(`   recarga ${i}: datos al instante con aviso; validado por el servidor`);
        }
        paso("5 recargas seguidas: sin «Consultando sorteo…» ni esqueleto; aviso «sin confirmar» hasta validar");

        // 3. Cambio en el servidor mientras la página está cerrada.
        fila.config = { ...fila.config, nombre: "Lotería Actualizada" };
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería Recarga");
        assert.ok((await textoPagina(page)).includes("sin confirmar"), "lo guardado se presenta como no confirmado");
        await esperarTexto(page, "Lotería Actualizada");
        await sinAviso(page);
        let texto = await textoPagina(page);
        assert.ok(!texto.includes("Lotería Recarga"), "lo del servidor sustituye a la instantánea");
        await page.waitForFunction((k) => (localStorage.getItem(k) || "").includes("Lotería Actualizada"), { timeout: 30000 }, PREFIJO + A);
        paso("cambio durante la recarga: instantánea con aviso, luego prevalece el servidor y se reescribe");

        // 4. Servidor caído al recargar.
        retrasoMs = 0;
        caido = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "No se pudo validar con el servidor");
        texto = await textoPagina(page);
        assert.ok(texto.includes("Lotería Actualizada") && texto.includes("Programado"), "se conserva la última información guardada");
        let v = await vigia(page);
        assert.strictEqual(v.consultando + v.esqueleto, 0, "la interfaz no se vacía");
        caido = false;
        paso("servidor caído: se mantiene la instantánea con aviso de que no se pudo validar");

        // 5. Cambio de usuario en el mismo navegador (sin cerrar sesión antes).
        await page.evaluate((s) => {
            sessionStorage.setItem("e2e-sesion", s);
            sessionStorage.setItem("e2e-buscar", JSON.stringify(["Lotería Actualizada", "Lotería Recarga"]));
        }, JSON.stringify(sesionDe(TOKEN_B, B, "recarga-b@prueba.local")));
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Sin sorteo activo ni programado");
        await new Promise(r => setTimeout(r, 1500));
        v = await vigia(page);
        assert.deepStrictEqual(v.vistos, {}, "se mostró información de la cuenta anterior");
        texto = await textoPagina(page);
        assert.ok(!texto.includes("sin confirmar"), "B no tiene instantánea propia aún");
        const claves = await instantaneas(page);
        assert.ok(!claves.includes(PREFIJO + A), "la instantánea de A se borró");
        paso("cambio de usuario: nada de la cuenta anterior se muestra y su instantánea se borra");

        // 6. Cierre de sesión.
        await page.waitForFunction((k) => Boolean(localStorage.getItem(k)), { timeout: 30000 }, PREFIJO + B);
        await page.evaluate(() => sessionStorage.setItem("e2e-sesion", "ninguna"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => location.pathname === "/login", { timeout: 60000 });
        assert.deepStrictEqual(await instantaneas(page), [], "sin sesión no queda ninguna instantánea");
        paso("cierre de sesión: no queda ninguna instantánea");

        assert.deepStrictEqual(page.erroresJs, [], page.erroresJs.join("\n"));
        paso("sin errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
