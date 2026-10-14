// ==========================================================================
// PRUEBA DE NAVEGADOR — interruptor «Reacciones automáticas ✅/❌» en
// /mensajes. Entorno AISLADO (entornoPanel.js): Chrome + panel real (next
// dev) + base en memoria compartida con el código real del bot que lee el
// interruptor (bot/funciones/reservas/reaccionReserva.js). Nada sale a
// Supabase ni a WhatsApp.
//
//     node backend/tests/e2e/reaccionesPanel.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, servirTablas, registrarUsuario, arrancarEntorno, esperarTexto, textoPagina, captura, crearPasos
} = require("./entornoPanel");

const reaccion = require(path.join(__dirname, "..", "..", "bot", "funciones", "reservas", "reaccionReserva.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
registrarUsuario("tok-a", A, "admin-a@prueba.local");
registrarUsuario("tok-b", B, "admin-b@prueba.local");

servirTablas(["configuracion_seleccion_mensajes", "plantillas_mensaje"]);
t.configuracion_seleccion_mensajes = [];
t.plantillas_mensaje = [];

const filaDe = (usuario) => t.configuracion_seleccion_mensajes.filter(f => f.usuario_id === usuario && f.tipo_respuesta === "reacciones_reserva");

const interruptor = (page) => page.evaluate(() => {
    const b = [...document.querySelectorAll('button[role="switch"]')].find(x => x.getAttribute("aria-labelledby") === "titulo-reacciones");
    return b ? { marcado: b.getAttribute("aria-checked"), texto: b.textContent.trim(), deshabilitado: b.disabled } : null;
});

const esperarInterruptor = (page, marcado) => page.waitForFunction((marcado) => {
    const b = [...document.querySelectorAll('button[role="switch"]')].find(x => x.getAttribute("aria-labelledby") === "titulo-reacciones");
    return b && !b.disabled && b.getAttribute("aria-checked") === marcado;
}, { timeout: 60000 }, marcado);

const pulsarInterruptor = (page) => page.evaluate(() => {
    [...document.querySelectorAll('button[role="switch"]')].find(x => x.getAttribute("aria-labelledby") === "titulo-reacciones").click();
});

// Lo que haría el bot al ir a reaccionar (sin caché: como tras vencer los 30 s).
async function bot(usuario) {
    reaccion._reiniciar();
    return reaccion.reaccionesActivadas(usuario);
}

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const a = await entorno.nuevaPagina("tok-a");
        await a.goto(`${PANEL}/mensajes`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Reacciones automáticas ✅/❌");
        await esperarInterruptor(a, "true");
        assert.strictEqual((await interruptor(a)).texto, "Activado");
        assert.strictEqual(filaDe(A).length, 0, "sin fila guardada");
        assert.strictEqual(await bot(A), true);
        await captura(a, "reacciones_activado");
        paso("Por defecto: «Reacciones automáticas ✅/❌» Activado (sin fila guardada) y el bot reacciona");

        await pulsarInterruptor(a);
        await esperarInterruptor(a, "false");
        assert.strictEqual((await interruptor(a)).texto, "Desactivado");
        await a.waitForFunction(() => true);
        for (let i = 0; i < 50 && !filaDe(A).length; i++) await new Promise(r => setTimeout(r, 100));
        assert.deepStrictEqual(filaDe(A).map(f => f.habilitada), [false], "guardado en la base");
        assert.strictEqual(await bot(A), false, "el bot lee «desactivado»");
        paso("Desactivar: se guarda en la base (configuracion_seleccion_mensajes) y el bot deja de reaccionar");

        await a.reload({ waitUntil: "domcontentloaded" });
        await esperarInterruptor(a, "false");
        await new Promise(r => setTimeout(r, 400));   // fin de la transición del interruptor
        const colores = await a.evaluate(() => {
            const b = [...document.querySelectorAll('button[role="switch"]')].find(x => x.getAttribute("aria-labelledby") === "titulo-reacciones");
            const pista = b.querySelector("span");
            const ref = document.querySelector("aside [role=switch]");
            return { pista: getComputedStyle(pista).backgroundColor, encendido: ref ? getComputedStyle(ref).backgroundColor : null };
        });
        assert.notStrictEqual(colores.pista, colores.encendido, `desactivado no debe verse como encendido: ${JSON.stringify(colores)}`);
        await captura(a, "reacciones_desactivado");
        paso("Recargar el panel: sigue Desactivado (persistido)");

        await pulsarInterruptor(a);
        await esperarInterruptor(a, "true");
        for (let i = 0; i < 50 && filaDe(A)[0]?.habilitada !== true; i++) await new Promise(r => setTimeout(r, 100));
        assert.deepStrictEqual(filaDe(A).map(f => f.habilitada), [true], "misma fila, sin duplicados");
        assert.strictEqual(await bot(A), true);
        paso("Activar de nuevo: misma fila actualizada (sin duplicados) y el bot vuelve a reaccionar");

        const b = await entorno.nuevaPagina("tok-b");
        await b.goto(`${PANEL}/mensajes`, { waitUntil: "domcontentloaded" });
        await esperarInterruptor(b, "true");
        await pulsarInterruptor(b);
        await esperarInterruptor(b, "false");
        for (let i = 0; i < 50 && !filaDe(B).length; i++) await new Promise(r => setTimeout(r, 100));
        assert.deepStrictEqual([filaDe(A)[0].habilitada, filaDe(B)[0].habilitada], [true, false]);
        assert.deepStrictEqual([await bot(A), await bot(B)], [true, false]);
        paso("Dos clientes: cada uno tiene su propio interruptor; desactivar B no afecta a A");

        const texto = await textoPagina(a);
        const riel = await a.evaluate(() => [...document.querySelectorAll("aside button")].map(x => x.textContent.trim()));
        assert.ok(!riel.some(x => /reacci/i.test(x)), "no aparece como tipo de respuesta en la lista");
        assert.ok(!/token|\bAPI\b|HTTP \d|Supabase|migraci/i.test(texto.split("Reacciones automáticas")[1]?.slice(0, 400) || ""), "sin texto técnico");
        assert.deepStrictEqual([...a.erroresJs, ...b.erroresJs], [], "sin errores de JavaScript");
        paso("La lista de tipos de respuesta no cambia; sin texto técnico ni errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
