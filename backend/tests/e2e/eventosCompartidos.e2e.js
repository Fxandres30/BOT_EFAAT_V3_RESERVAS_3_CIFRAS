// ==========================================================================
// PRUEBA DE NAVEGADOR — /eventos muestra UNA tarjeta por sorteo real aunque
// se haya publicado en varios grupos (una fila de eventos_bot por grupo).
// Entorno AISLADO (entornoPanel.js): Chrome + panel real (next dev) + base
// en memoria. Nada sale a Supabase ni a WhatsApp.
//
//     node backend/tests/e2e/eventosCompartidos.e2e.js
// ==========================================================================

const assert = require("assert");
const {
    PANEL, tablas: t, servirTablas, registrarUsuario, arrancarEntorno, esperarTexto, textoPagina, captura, crearPasos
} = require("./entornoPanel");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
registrarUsuario("tok-a", A, "admin-a@prueba.local");

const fila = (id, extra = {}) => ({
    id, usuario_id: A, identidad_evento_real: "manizales-2026-10-14", nombre_evento: "Lotería de Manizales",
    grupo_id: `1203${id}@g.us`, grupo_nombre: `Grupo ${id}`, activo: true, abierto: true, estado: "abierto",
    hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-14", valor: "5000", cifras: 2, cantidad_numeros: 100,
    tabla: "5k_15k_reservas_2_cifras", premios: [], reservados: 40, pagados: 30, pendientes: 10, libres: 60,
    actualizado_en: "2026-10-14T20:00:00Z", ...extra
});

servirTablas(["eventos_bot"]);
t.eventos_bot = [
    // Un sorteo en 3 grupos (uno pendiente de abrir).
    fila("Uno"), fila("Dos", { abierto: false }), fila("Tres"),
    // Otro sorteo distinto en uno de esos grupos, misma fecha y hora.
    fila("Uno-b", { grupo_id: "1203Uno@g.us", grupo_nombre: "Grupo Uno", identidad_evento_real: "boyaca-2026-10-14", nombre_evento: "Lotería de Boyacá" }),
    // Otro cliente con la MISMA identidad: nunca se mezcla con el de A.
    fila("Ajeno", { usuario_id: B, nombre_evento: "Lotería de Manizales (cliente B)" })
];

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const a = await entorno.nuevaPagina("tok-a");
        await a.goto(`${PANEL}/eventos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Lotería de Manizales");

        const tarjetas = await a.evaluate(() => [...document.querySelectorAll("article h3")].map(h => h.textContent.trim()));
        assert.strictEqual(tarjetas.filter(n => n === "Lotería de Manizales").length, 1, `tarjetas: ${tarjetas.join(" | ")}`);
        assert.ok(tarjetas.includes("Lotería de Boyacá"), "el sorteo distinto sigue separado");
        assert.ok(tarjetas.includes("Lotería de Manizales (cliente B)"), "la fila de otro cliente no se funde con la de A");
        assert.strictEqual(tarjetas.length, 3, `tarjetas: ${tarjetas.join(" | ")}`);
        const texto = await textoPagina(a);
        assert.ok(/Activos\s*3/.test(texto), "contador de activos por sorteo, no por grupo");
        paso("Un sorteo en 3 grupos = 1 tarjeta; otro sorteo distinto y el de otro cliente aparecen por separado (3 tarjetas, no 5)");

        const tarjeta = await a.evaluate(() => {
            const h = [...document.querySelectorAll("article h3")].find(x => x.textContent.trim() === "Lotería de Manizales");
            const art = h.closest("article");
            art.querySelector("details summary")?.click();
            return art;
        });
        void tarjeta;
        await a.waitForFunction(() => {
            const h = [...document.querySelectorAll("article h3")].find(x => x.textContent.trim() === "Lotería de Manizales");
            return h.closest("article").querySelector('ul[aria-label="Grupos del sorteo"]')?.offsetParent;
        });
        const grupos = await a.evaluate(() => {
            const h = [...document.querySelectorAll("article h3")].find(x => x.textContent.trim() === "Lotería de Manizales");
            const art = h.closest("article");
            return {
                resumen: art.querySelector("details summary").textContent.trim(),
                items: [...art.querySelectorAll('ul[aria-label="Grupos del sorteo"] li')].map(li => li.innerText.replace(/\s+/g, " ").trim()),
                progreso: art.innerText.includes("40 / 100 números reservados")
            };
        });
        assert.strictEqual(grupos.resumen, "3 grupos");
        assert.deepStrictEqual(grupos.items, ["Grupo Uno Abierto", "Grupo Dos Pendiente de abrir", "Grupo Tres Abierto"]);
        assert.ok(grupos.progreso, "contadores del sorteo, no sumados por grupo");
        await captura(a, "eventos_compartidos");
        paso("La tarjeta lista sus 3 grupos con el estado de cada uno; el progreso es el del sorteo (40/100, no 120)");

        assert.deepStrictEqual(a.erroresJs, [], "sin errores de JavaScript");
        paso("Sin errores de JavaScript en la página");

    } finally {

        await entorno.cerrar();

    }

}

terminar(main());
