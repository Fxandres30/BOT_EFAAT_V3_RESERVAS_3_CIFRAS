// ==========================================================================
// PRUEBA DE NAVEGADOR — Calendario de loterías + selección real de grupos
// en el formulario de creación manual. Entorno AISLADO (entornoPanel.js):
// Chrome + panel real (next dev) + API real /sorteos sobre Supabase falso.
// No toca Supabase ni WhatsApp; nada se publica.
//
//     node backend/tests/e2e/calendarioLoterias.e2e.js
// ==========================================================================

const assert = require("assert");
const {
    PANEL, fake, tablas: t, registrarUsuario, arrancarEntorno,
    rellenar, rellenarAria, valorDe, marcar, marcada, pulsar, esperarTexto, textoPagina, captura, crearPasos
} = require("./entornoPanel");
const { horarioPara } = require("../../sorteos/calendario");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = "cccccccc-0000-4000-8000-00000000000c";
const D = "dddddddd-0000-4000-8000-00000000000d";

registrarUsuario("tok-a", A, "admin-a@prueba.local");
registrarUsuario("tok-b", B, "admin-b@prueba.local");
registrarUsuario("tok-c", C, "sin-grupos@prueba.local");
registrarUsuario("tok-d", D, "inactivos@prueba.local");

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true },
    { usuario_id: A, grupo_id: "g3@g.us", activo: true },
    { usuario_id: B, grupo_id: "gb@g.us", activo: true },
    { usuario_id: D, grupo_id: "gd@g.us", activo: false }
];
t.grupos = [
    { jid: "g1@g.us", nombre: "Grupo Uno A" }, { jid: "g2@g.us", nombre: "Grupo Dos A" },
    { jid: "g3@g.us", nombre: "Grupo Tres A" }, { jid: "gb@g.us", nombre: "Grupo Ajeno B" }
];
t.cuentas_pago = [{ id: "cuenta-a", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", activa: true }];
t.eventos_bot = [];
// Catálogo global tal como lo carga la migración 026 (leído del propio SQL).
t.loterias_catalogo_global = require("../sorteos/catalogo026").catalogoGlobalDe026();

t["5k_15k_reservas_2_cifras"] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));

// Fechas fijas futuras (2026): jueves, viernes, domingo y festivo.
const JUEVES = "2026-10-29";
const VIERNES = "2026-10-30";
const DOMINGO = "2026-11-01";
const FESTIVO = "2026-11-02";   // Todos los Santos (lunes trasladado)

const { paso, terminar } = crearPasos();

// Nada técnico en pantalla para el cliente.
const TECNICO = /token|SESSIONS_|BOT_API|API|proxy|variable de entorno|HTTP d|50[23]|401|migraci[oó]n|backend|Supabase|lease|listener/i;
async function sinTextoTecnico(page, donde) {
    const texto = await textoPagina(page);
    const m = texto.match(TECNICO);
    assert.ok(!m, `texto técnico visible en ${donde}: «${m && m[0]}»`);
}

const cajaHorario = (page) => page.evaluate(() => document.querySelector('[aria-label="Horario de la lotería"]')?.innerText || "");

async function main() {

    const entorno = await arrancarEntorno();
    const paginas = [];

    try {

        // ------------------------------------------------ A. calendario ---
        const a = await entorno.nuevaPagina("tok-a");
        paginas.push(a);
        await a.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Calendario de loterías");
        await esperarTexto(a, "Sorteos tradicionales");
        await esperarTexto(a, "Lotería de Manizales");
        const textoCal = await textoPagina(a);
        for (const nombre of ["Antioqueñita Día", "Antioqueñita Tarde", "Dorado Mañana", "Samán de la Suerte", "Pijao de Oro", "Super Astro Sol", "La Culona Noche", "Paisa Lotto", "SuperMillonaria", "Lotería de Bogotá", "Extra de Colombia Mensual"]) {
            assert.ok(textoCal.includes(nombre), `falta ${nombre}`);
        }
        assert.strictEqual(t.loterias_catalogo.filter(f => f.usuario_id === A).length, 42);
        assert.ok(!textoCal.includes("Horario pendiente"), "todas con horario del listado");
        const tarjetaPijao = await a.evaluate(() => [...document.querySelectorAll("h3")].find(h => h.textContent.trim() === "Pijao de Oro").closest("div").parentElement.innerText);
        for (const dato of ["Hora habitual: 14:00", "Sábado: 21:00", "Domingo: 22:00", "(20:00)"]) assert.ok(tarjetaPijao.includes(dato), `Pijao de Oro: falta «${dato}»\n${tarjetaPijao}`);
        await captura(a, "calendario_catalogo");
        paso("Calendario: 27 chances + 15 tradicionales con los horarios del listado (p. ej. Pijao de Oro: 14:00, sábado 21:00, domingo 22:00, festivos 20:00)");

        await a.evaluate(() => {
            const el = document.querySelector('[aria-label="Buscar lotería"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "sinu");
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await a.waitForFunction(() => !document.body.innerText.includes("Antioqueñita Día"));
        const tarjetas = await a.evaluate(() => [...document.querySelectorAll("h3")].map(h => h.textContent.trim()));
        assert.deepStrictEqual(tarjetas.sort(), ["Sinuano Día", "Sinuano Noche"]);
        paso("Búsqueda por nombre: «sinu» → Sinuano Día y Sinuano Noche");

        // Editar Sinuano Día (del listado: L–S 14:30, domingo y festivos 13:00):
        // el cliente quita el domingo y deja los festivos sin regla.
        await a.evaluate(() => {
            const card = [...document.querySelectorAll("h3")].find(h => h.textContent.trim() === "Sinuano Día").closest("div").parentElement;
            [...card.querySelectorAll("button")].find(b => b.textContent.trim() === "Editar").click();
        });
        await esperarTexto(a, "Editar Sinuano Día");
        await marcar(a, "Domingo");
        await rellenar(a, "Festivos", "sin_regla");
        await rellenar(a, "Condiciones y notas", "Lunes a sábado. Domingos y festivos: confirmar.");
        await pulsar(a, "Guardar");
        await a.waitForFunction(() => !document.body.innerText.includes("Editar Sinuano Día"));
        await esperarTexto(a, "Hora habitual: 14:30");
        const sinuano = t.loterias_catalogo.find(f => f.usuario_id === A && f.nombre === "Sinuano" && f.modalidad === "Día");
        assert.deepStrictEqual([...sinuano.dias].sort(), [1, 2, 3, 4, 5, 6]);
        assert.strictEqual(sinuano.hora, "14:30");
        assert.deepStrictEqual([sinuano.regla_festivo, sinuano.horas_por_dia], ["sin_regla", {}], "personalización guardada");
        await captura(a, "calendario_editado");
        paso("Personalizar: Sinuano Día sin domingo y festivos sin regla, guardado solo en el calendario de A");

        // Eliminar «Dorado Mañana» del calendario de A: persiste y no vuelve.
        await a.evaluate(() => {
            const el = document.querySelector('[aria-label="Buscar lotería"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "dorado");
            el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await a.waitForFunction(() => [...document.querySelectorAll("h3")].some(h => h.textContent.trim() === "Dorado Mañana"));
        await a.evaluate(() => {
            const card = [...document.querySelectorAll("h3")].find(h => h.textContent.trim() === "Dorado Mañana").closest("div").parentElement;
            [...card.querySelectorAll("button")].find(b => b.textContent.trim() === "Eliminar").click();
        });
        await a.waitForFunction(() => ![...document.querySelectorAll("h3")].some(h => h.textContent.trim() === "Dorado Mañana"));
        assert.ok(!t.loterias_catalogo.some(f => f.usuario_id === A && f.nombre === "Dorado" && f.modalidad === "Mañana"), "borrada en la base");
        await a.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Sinuano Día");
        assert.ok(!(await textoPagina(a)).includes("Dorado Mañana"), "tras recargar no reaparece");
        assert.strictEqual(t.loterias_catalogo_global.length, 42, "el catálogo global no cambia");
        paso("Eliminar «Dorado Mañana» de su calendario: se borra, no reaparece al recargar y el catálogo global queda igual");

        // ---------------------------------------- B. formulario + horario ---
        await a.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await pulsar(a, "Nuevo sorteo");
        await esperarTexto(a, "Grupo Uno A");
        await a.waitForFunction(() => document.querySelectorAll("#loterias-calendario option").length > 0, { timeout: 30000 });
        const opciones = await a.evaluate(() => [...document.querySelectorAll("#loterias-calendario option")].map(o => o.value));
        assert.ok(opciones.includes("Sinuano Día") && !opciones.includes("Dorado Mañana") && opciones.length === 41, `el buscador ofrece el calendario: ${JSON.stringify(opciones)}`);
        await rellenar(a, "Lotería o nombre del sorteo", "Sinuano Día");
        await esperarTexto(a, "Del calendario de loterías.");
        await rellenar(a, "Fecha y hora de publicación", `${JUEVES}T08:00`);
        await a.waitForFunction(() => document.querySelector('[aria-label="Horario de la lotería"]')?.innerText.includes("14:30"));
        assert.strictEqual(await valorDe(a, "Hora del sorteo"), "14:30", "la hora se sugiere y rellena");
        assert.ok((await cajaHorario(a)).includes("jueves"));
        paso("Seleccionar «Sinuano Día» + jueves: muestra el horario habitual 14:30 y lo propone en «Hora del sorteo»");

        await rellenar(a, "Fecha y hora de publicación", `${DOMINGO}T08:00`);
        await a.waitForFunction(() => /no se juega los domingo/.test(document.querySelector('[aria-label="Horario de la lotería"]')?.innerText || ""));
        await rellenar(a, "Fecha y hora de publicación", `${FESTIVO}T08:00`);
        await a.waitForFunction(() => /festivo \(Todos los Santos\)/.test(document.querySelector('[aria-label="Horario de la lotería"]')?.innerText || ""));
        assert.ok(/no tiene una regla para festivos/.test(await cajaHorario(a)));
        await captura(a, "formulario_festivo");
        paso("Domingo: avisa que no se juega; festivo (Todos los Santos) sin regla: advierte y no inventa hora");

        await rellenar(a, "Fecha y hora de publicación", `${JUEVES}T08:00`);
        await a.waitForFunction(() => /jueves/.test(document.querySelector('[aria-label="Horario de la lotería"]')?.innerText || ""));
        await rellenar(a, "Hora del sorteo", "15:00");
        await esperarTexto(a, "cambio manual");
        await rellenar(a, "Fecha y hora de publicación", `${VIERNES}T08:00`);
        await a.waitForFunction(() => /viernes/.test(document.querySelector('[aria-label="Horario de la lotería"]')?.innerText || ""));
        assert.strictEqual(await valorDe(a, "Hora del sorteo"), "15:00", "un cambio manual nunca se pisa");
        assert.strictEqual(horarioPara({ ...sinuano, horas_por_dia: {} }, VIERNES).data.hora, "14:30");
        paso("Cambio manual de fecha y hora: la hora escrita (15:00) se respeta al cambiar a viernes");

        // ------------------------------------------------ C. grupos ---
        const visibles = await a.evaluate(() => [...document.querySelectorAll("label")].map(l => l.textContent.trim()));
        assert.ok(!visibles.includes("Grupo Ajeno B"), "nunca se ofrecen grupos ajenos");
        await marcar(a, "Grupo Uno A");
        await marcar(a, "Grupo Dos A");
        await marcar(a, "Grupo Tres A");
        await esperarTexto(a, "Seleccionados: 3 de 3");
        await rellenar(a, "Valor por número", "5000");
        await rellenarAria(a, "Premio", "Premio mayor");
        await rellenarAria(a, "Valor del premio", "300000");
        await marcar(a, "Nequi A");
        await pulsar(a, "Guardar y ver vista previa");
        await esperarTexto(a, "Anuncio que se publicará");
        assert.strictEqual(t.sorteos_programados.length, 1);
        const s = t.sorteos_programados[0];
        assert.strictEqual(s.config.loteria_id, sinuano.id);
        assert.strictEqual(s.config.nombre, "Sinuano Día");
        assert.strictEqual(s.config.hora_fin, "15:00");
        assert.deepStrictEqual([...s.config.grupos].sort(), ["g1@g.us", "g2@g.us", "g3@g.us"]);
        assert.strictEqual(t.sorteos_programados_grupos.filter(g => g.sorteo_id === s.id).length, 3);
        paso("Varios grupos: 3 grupos propios seleccionados y guardados en el borrador con la lotería del calendario");

        await pulsar(a, "Cerrar");
        await a.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Sinuano Día");
        await pulsar(a, "Editar");
        await esperarTexto(a, "Editar sorteo programado");
        await a.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.trim() === "Grupo Tres A" && l.querySelector("input")));
        assert.strictEqual(await valorDe(a, "Lotería o nombre del sorteo"), "Sinuano Día");
        await esperarTexto(a, "Del calendario de loterías.");
        assert.strictEqual(await valorDe(a, "Hora del sorteo"), "15:00");
        assert.strictEqual(await valorDe(a, "Fecha y hora de publicación"), `${VIERNES}T08:00`);
        assert.deepStrictEqual([await marcada(a, "Grupo Uno A"), await marcada(a, "Grupo Dos A"), await marcada(a, "Grupo Tres A")], [true, true, true]);
        paso("Recargar y editar: conserva lotería, fecha, hora manual y los 3 grupos marcados");

        await marcar(a, "Grupo Tres A");
        await pulsar(a, "Guardar y ver vista previa");
        await esperarTexto(a, "Anuncio que se publicará");
        assert.strictEqual(t.sorteos_programados.length, 1, "editar no duplica el sorteo");
        assert.strictEqual(t.sorteos_programados[0].version, 2);
        assert.deepStrictEqual(t.sorteos_programados_grupos.filter(g => g.sorteo_id === s.id && g.estado !== "cancelado").map(g => g.grupo_id).sort(), ["g1@g.us", "g2@g.us"]);
        assert.ok(t.sorteos_programados_grupos.filter(g => g.sorteo_id === s.id).every((g, i, arr) => arr.findIndex(x => x.grupo_id === g.grupo_id) === i), "sin filas de grupo duplicadas");
        assert.strictEqual((t.automation_actions || []).length, 0, "nada publicado");
        paso("Editar quitando un grupo: misma programación (versión 2), 2 grupos, sin duplicados ni envíos");

        await pulsar(a, "Cerrar");
        await a.reload({ waitUntil: "domcontentloaded" });
        await pulsar(a, "Editar");
        await a.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.trim() === "Grupo Tres A" && l.querySelector("input")));
        assert.deepStrictEqual([await marcada(a, "Grupo Uno A"), await marcada(a, "Grupo Dos A"), await marcada(a, "Grupo Tres A")], [true, true, false]);
        await pulsar(a, "Cancelar");
        paso("Tras recargar, la edición muestra exactamente los 2 grupos guardados");

        // Grupo AJENO forzado por la API del panel (con la sesión de A).
        const ajeno = await a.evaluate(async (cuerpo) => {
            const sesion = JSON.parse(localStorage.getItem("sb-127-auth-token"));
            const res = await fetch("/api/sorteos", { method: "POST", headers: { Authorization: `Bearer ${sesion.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
            return { status: res.status, json: await res.json() };
        }, { ...s.config, grupos: ["g1@g.us", "gb@g.us"], publicar_en: s.config.publicar_en });
        assert.strictEqual(ajeno.status, 400);
        assert.ok(ajeno.json.errores.some(e => e.campo === "grupos"));
        assert.strictEqual(t.sorteos_programados.length, 1);
        paso("Grupo ajeno forzado por la API: 400 «Grupos no autorizados», nada guardado");

        // API caída para los grupos -> error explícito + Reintentar.
        fake.control.fallarTabla = "grupos_autorizados";
        await pulsar(a, "Nuevo sorteo");
        await esperarTexto(a, "No pudimos cargar tus grupos de WhatsApp. Inténtalo de nuevo.");
        await sinTextoTecnico(a, "error de grupos");
        let texto = await textoPagina(a);
        assert.ok(!/No tienes grupos autorizados/.test(texto) && !/Todavía no hay grupos/.test(texto), "un fallo no se disfraza de lista vacía");
        await captura(a, "grupos_error_api");
        fake.control.fallarTabla = null;
        await pulsar(a, "Reintentar");
        await esperarTexto(a, "Grupo Uno A");
        await pulsar(a, "Cancelar");
        paso("Fallo de la API de grupos: mensaje de error propio + «Reintentar» recupera la lista");

        // ------------------------------------------- otros usuarios ---
        const c = await entorno.nuevaPagina("tok-c");
        paginas.push(c);
        await c.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await pulsar(c, "Nuevo sorteo");
        await esperarTexto(c, "Todavía no hay grupos de WhatsApp habilitados para");
        await esperarTexto(c, "Todavía no tienes cuentas de pago. Crea una en");
        assert.ok(await c.evaluate(() => [...document.querySelectorAll("a")].some(a => a.getAttribute("href") === "/sorteos" && a.closest("section"))), "enlace para crear la cuenta");
        await sinTextoTecnico(c, "formulario sin grupos ni cuentas");
        texto = await textoPagina(c);
        assert.ok(texto.includes("sin-grupos@prueba.local"), "dice con qué cuenta se inició sesión");
        assert.ok(!texto.includes("Grupo Uno A") && !texto.includes("Grupo Ajeno B"));
        await captura(c, "grupos_usuario_sin_grupos");
        paso("Usuario sin grupos ni cuentas: explicación sencilla con enlaces (grupos y cuenta de pago), sin texto técnico");

        const d = await entorno.nuevaPagina("tok-d");
        paginas.push(d);
        await d.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await pulsar(d, "Nuevo sorteo");
        await esperarTexto(d, "Tus 1 grupo(s) de WhatsApp están desactivados en EFAAT");
        await sinTextoTecnico(d, "grupos desactivados");
        paso("Usuario con grupos registrados pero inactivos: lo dice explícitamente");

        const b = await entorno.nuevaPagina("tok-b");
        paginas.push(b);
        await b.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await pulsar(b, "Nuevo sorteo");
        await esperarTexto(b, "Grupo Ajeno B");
        texto = await textoPagina(b);
        assert.ok(!texto.includes("Grupo Uno A"), "B solo ve sus grupos");
        await pulsar(b, "Cancelar");
        await b.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(b, "Sinuano Día");
        const sinuanoB = t.loterias_catalogo.find(f => f.usuario_id === B && f.nombre === "Sinuano" && f.modalidad === "Día");
        assert.ok(sinuanoB.dias.includes(7) && sinuanoB.regla_festivo === "hora_especial", "B conserva el horario del listado (la edición de A no le llega)");
        assert.ok((await textoPagina(b)).includes("Dorado Mañana"), "B conserva lo que A eliminó");
        paso("Otro usuario con grupos: ve solo los suyos y su propio calendario (incluido lo que A eliminó)");

        // Calendario sin la tabla (025 sin aplicar): mensaje sencillo.
        fake.control.tablasInexistentes = new Set(["loterias_catalogo"]);
        await a.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Esta función todavía no está disponible");
        await sinTextoTecnico(a, "calendario sin migración");
        await a.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await pulsar(a, "Nuevo sorteo");
        await esperarTexto(a, "No pudimos cargar el calendario de loterías. Puedes escribir el nombre de la lotería a mano.");
        await sinTextoTecnico(a, "formulario sin calendario");
        await pulsar(a, "Cancelar");
        fake.control.tablasInexistentes = new Set();
        paso("Calendario no disponible: mensajes sencillos y se puede escribir la lotería a mano");

        // Error de carga: la pantalla muestra un mensaje sencillo y la consola
        // del navegador dice la CATEGORÍA real del fallo.
        const consola = [];
        a.on("console", async (m) => {
            try { consola.push((await Promise.all(m.args().map(x => x.jsonValue()))).map(v => typeof v === "string" ? v : JSON.stringify(v)).join(" ")); } catch { /* página recargada */ }
        });
        const tokenServicio = require("../../middleware/tokenServicio");
        const token = process.env.SESSIONS_API_TOKEN;
        delete process.env.SESSIONS_API_TOKEN;
        tokenServicio._configurarPrueba({ dir: require("os").tmpdir() + "/sin-panel-" + Date.now() });
        await a.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "No pudimos completar la operación");
        await a.waitForFunction(() => true);
        for (let i = 0; i < 30 && !consola.some(c => /configuración: el backend no tiene token de servicio/.test(c)); i++) await new Promise(res => setTimeout(res, 200));
        process.env.SESSIONS_API_TOKEN = token;
        tokenServicio._configurarPrueba();
        assert.ok(consola.some(c => /configuración: el backend no tiene token de servicio/.test(c)), consola.join("\n"));
        await sinTextoTecnico(a, "error de carga del calendario");

        await a.setRequestInterception(true);
        const interceptar = (req) => req.url().includes("/api/sorteos/loterias")
            ? req.respond({ status: 404, contentType: "text/html", body: "<html>Cannot GET</html>" })
            : req.continue();
        a.on("request", interceptar);
        consola.length = 0;
        await a.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "No pudimos completar la operación");
        for (let i = 0; i < 30 && !consola.some(c => /ruta inexistente/.test(c)); i++) await new Promise(res => setTimeout(res, 200));
        a.off("request", interceptar);
        await a.setRequestInterception(false);
        assert.ok(consola.some(c => /ruta inexistente/.test(c)), consola.join("\n"));
        paso("Error de carga: mensaje sencillo en pantalla; la consola distingue «configuración» (sin token) y «ruta inexistente» (404 no JSON)");

        // ------------------------------------------------- cierre ---
        assert.strictEqual(t.eventos_bot.length, 0, "ningún evento creado ni publicado");
        assert.strictEqual((t.automation_actions || []).length, 0);
        const errores = paginas.flatMap(p => p.erroresJs);
        assert.deepStrictEqual(errores, [], "sin errores de JavaScript");
        paso("Sin publicaciones ni eventos; sin errores de JavaScript en ninguna sesión");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
