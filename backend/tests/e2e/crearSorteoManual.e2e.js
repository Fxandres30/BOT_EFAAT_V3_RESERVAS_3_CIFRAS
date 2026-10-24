// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — crear un sorteo de 2 cifras A MANO desde
// /eventos, con un navegador real (Chrome vía puppeteer), el panel Next real
// (next dev) y la API real del backend (routes/sorteos.js + sorteos/*).
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase ni WhatsApp.
//
//     node backend/tests/e2e/crearSorteoManual.e2e.js
//
// No se incluye en la regresión (`*.test.js`): necesita compilar el panel.
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, peticionesSupabase, registrarUsuario, arrancarEntorno,
    rellenar, rellenarAria, marcar, pulsar, botonHabilitado, esperarTexto, textoPagina, captura, mananaColombia, crearPasos
} = require("./entornoPanel");

const TOKEN_USUARIO = "e2e-token-usuario";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";

registrarUsuario(TOKEN_USUARIO, A, "e2e@prueba.local");
t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];   // ningún anuncio detectado: el flujo no depende del detector
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN_USUARIO);
        const erroresConsola = page.erroresJs;

        // 1. /eventos -> botón «Crear sorteo» abre el modal correcto.
        await page.goto(`${PANEL}/eventos`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Crear sorteo");
        await esperarTexto(page, "Configurar sorteo");
        const textoModal = await textoPagina(page);
        assert.ok(!/se crean automáticamente/i.test(textoModal), "el mensaje antiguo NO debe aparecer");
        assert.ok(textoModal.includes("2 CIFRAS — PAGO"));
        paso("/eventos: «Crear sorteo» abre el modal de modalidad, sin el mensaje antiguo");

        // 1b. «Configurar sorteo» VISIBLE dentro de la pantalla (no solo en el
        // DOM), en escritorio y en móvil, junto a «Cerrar» en el pie del modal.
        for (const [nombre, ancho, alto] of [["escritorio", 1366, 768], ["movil", 390, 844]]) {
            await page.setViewport({ width: ancho, height: alto });
            await new Promise(res => setTimeout(res, 400));
            const caja = await page.evaluate(() => {
                const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Configurar sorteo");
                if (!b) return null;
                const r = b.getBoundingClientRect();
                const s = getComputedStyle(b);
                const pie = b.parentElement;
                return {
                    dentro: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.width > 0 && r.height > 0,
                    visible: s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0,
                    junto: [...pie.querySelectorAll("button")].some(x => x.textContent.trim() === "Cerrar")
                };
            });
            assert.ok(caja, `«Configurar sorteo» no existe (${nombre})`);
            assert.ok(caja.dentro && caja.visible, `«Configurar sorteo» no se ve en pantalla (${nombre}): ${JSON.stringify(caja)}`);
            assert.ok(caja.junto, "«Configurar sorteo» va en el pie, junto a «Cerrar»");
            if (process.env.E2E_CAPTURAS) await page.screenshot({ path: path.join(process.env.E2E_CAPTURAS, `modal_${nombre}.png`) });
        }
        await page.setViewport({ width: 1366, height: 768 });
        paso("«Configurar sorteo» visible en el pie del modal (1366×768 y 390×844), junto a «Cerrar»");

        // 2. 3 cifras deshabilitadas de verdad.
        await marcar(page, "3 CIFRAS — PAGO");
        await esperarTexto(page, "Todavía no disponible");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), false);
        await captura(page, "modal_3cifras_deshabilitado");
        await marcar(page, "3 CIFRAS — GRATIS");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), false);
        await marcar(page, "2 CIFRAS — PAGO");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), true);
        paso("3 cifras de pago y gratis: «Configurar sorteo» deshabilitado; 2 cifras habilitado");

        // 3. Formulario manual real.
        await pulsar(page, "Configurar sorteo");
        await esperarTexto(page, "Nuevo sorteo");
        await esperarTexto(page, "Grupo Prueba Uno");   // catálogos cargados del backend
        await esperarTexto(page, "Nequi Prueba");
        const opciones = await page.evaluate(() => [...document.querySelectorAll("option")].map(o => ({ v: o.value, d: o.disabled })));
        assert.ok(opciones.some(o => o.v === "tres_cifras_pago" && o.d) && opciones.some(o => o.v === "tres_cifras_gratis" && o.d), "3 cifras deshabilitadas en el formulario");
        await captura(page, "formulario_abierto");
        paso("el botón abre el formulario de creación manual (grupos y cuentas desde el backend)");

        const publicarEn = mananaColombia();
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Manual");
        await rellenar(page, "Hora del sorteo", "22:30");
        await rellenar(page, "Cierre de reservas", "22:20");
        await rellenar(page, "Valor por número", "5000");
        await rellenarAria(page, "Premio", "Premio mayor");
        await rellenarAria(page, "Valor del premio", "300000");
        await marcar(page, "Grupo Prueba Uno");
        await marcar(page, "Grupo Prueba Dos");
        await marcar(page, "Nequi Prueba");
        await rellenar(page, "Fecha y hora de publicación", publicarEn);
        await rellenar(page, "Mensaje de publicación", "🎯 {{nombre}} a las {{hora}} — valor {{valor}}\n{{premios}}\n{{cuentas}}");
        await rellenar(page, "Aviso al cerrar", "🔒 {{nombre}} cerrado");
        await pulsar(page, "Agregar recordatorio");
        await rellenarAria(page, "Texto del recordatorio", "⏰ Falta 1 hora para {{nombre}}");
        await rellenarAria(page, "Minutos antes del cierre", "60");

        // 4. Guardar -> borrador REAL en el backend + vista previa.
        await pulsar(page, "Guardar y ver vista previa");
        await esperarTexto(page, "Anuncio que se publicará");
        const filas = t.sorteos_programados || [];
        assert.strictEqual(filas.length, 1, "un borrador en la base");
        const sorteo = filas[0];
        assert.strictEqual(sorteo.estado, "borrador");
        assert.strictEqual(sorteo.usuario_id, A);
        assert.strictEqual(sorteo.config.nombre, "Lotería E2E Manual");
        assert.strictEqual(Number(sorteo.config.valor), 5000);
        assert.deepStrictEqual([...sorteo.config.grupos].sort(), ["g1@g.us", "g2@g.us"]);
        assert.strictEqual(sorteo.cuentas_snapshot[0].nombre, "Nequi Prueba");
        paso(`borrador guardado en el backend (id ${sorteo.id.slice(0, 8)}, estado borrador, 2 grupos, cuenta copiada)`);

        const vista = await textoPagina(page);
        for (const esperado of ["Lotería E2E Manual", "10:30 PM", "$5.000", "Premio mayor", "Nequi Prueba", "Grupo Prueba Uno", "Grupo Prueba Dos", "Falta 1 hora para Lotería E2E Manual", "Lotería E2E Manual cerrado", "Tabla de números: 100/100"]) {
            assert.ok(vista.includes(esperado), `la vista previa debe mostrar «${esperado}»:
${vista}`);
        }
        assert.ok(!/\{\{/.test(vista.split("Anuncio que se publicará")[1] || ""), "sin variables sin resolver");
        assert.strictEqual(await botonHabilitado(page, "Confirmar y programar"), false, "no se confirma sin marcar la revisión");
        await captura(page, "vista_previa");
        paso("vista previa con los datos guardados (anuncio, premios, cuenta, grupos, recordatorio, aviso)");

        // 5. Recargar -> el borrador persiste y aparece en «Sorteos programados».
        await pulsar(page, "Cerrar");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.body.textContent.includes("Los sorteos creados desde el panel"), { timeout: 60000 });
        await page.evaluate(() => [...document.querySelectorAll("a")].find(a => a.getAttribute("href") === "/sorteos" && a.closest("details")).click());
        await page.waitForFunction(() => location.pathname === "/sorteos");
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Manual");
        await esperarTexto(page, "Borrador (sin confirmar)");
        paso("tras recargar /eventos, su enlace lleva a «Sorteos programados», donde el borrador persiste");

        // 6. Editar (borrador): versión 2, sin duplicar grupos.
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo");
        // El formulario pide el sorteo al backend antes de mostrar los campos.
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.startsWith("Valor por número")));
        await rellenar(page, "Valor por número", "5000");
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Manual (editada)");
        await pulsar(page, "Guardar cambios");
        await esperarTexto(page, "Anuncio que se publicará");
        await esperarTexto(page, "Lotería E2E Manual (editada)");
        assert.strictEqual(t.sorteos_programados.length, 1, "editar no crea otro sorteo");
        assert.strictEqual(t.sorteos_programados[0].version, 2);
        paso("editar el borrador: misma fila, versión 2, vista previa actualizada");

        // 7. Confirmación expresa -> programado. Nada se envía.
        await marcar(page, "Revisé la fecha");
        await pulsar(page, "Confirmar y programar");
        await page.waitForFunction(() => !document.body.innerText.includes("Anuncio que se publicará"));
        await esperarTexto(page, "Programado");
        const prog = t.sorteos_programados[0];
        assert.strictEqual(prog.estado, "programado");
        assert.strictEqual(prog.confirmado_version, 2);
        const gruposPub = (t.sorteos_programados_grupos || []).filter(g => g.sorteo_id === prog.id);
        assert.strictEqual(gruposPub.length, 2, "un registro por grupo");
        assert.ok(gruposPub.every(g => g.estado === "pendiente" && !g.publicado_en));
        assert.strictEqual((t.automation_actions || []).length, 0, "ningún envío");
        assert.strictEqual(t.eventos_bot.length, 0, "no se creó ningún evento ni se publicó nada");
        paso("confirmación expresa: estado programado (versión 2), 2 grupos pendientes, 0 envíos");

        // 8. Recargar y cancelar: sin duplicados ni publicaciones.
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Programado");
        await pulsar(page, "Cancelar programación");
        await esperarTexto(page, "Sorteo cancelado");
        assert.strictEqual(t.sorteos_programados.length, 1);
        assert.strictEqual(t.sorteos_programados[0].estado, "cancelado");
        assert.strictEqual((t.sorteos_programados_grupos || []).filter(g => g.sorteo_id === prog.id).length, 2, "sin grupos duplicados");
        assert.strictEqual((t.automation_actions || []).length, 0);
        paso("cancelar: estado cancelado, sin filas duplicadas ni publicaciones");

        // 8b. Detalles: estados y línea de tiempo.
        await pulsar(page, "Detalles e historial");
        await esperarTexto(page, "Historial");
        const detalle = await textoPagina(page);
        assert.ok(/Programación: Cancelado/.test(detalle) && /Confirmada la versión 2/.test(detalle), detalle);
        await pulsar(page, "Cerrar");
        paso("detalles: estado de la programación, estado operativo e historial");

        // 8c. Eliminar: la confirmación muestra sorteo, grupos, publicaciones y reservas.
        await pulsar(page, "Eliminar…");
        await esperarTexto(page, "Eliminar definitivamente");
        const confirmacion = await textoPagina(page);
        assert.ok(/Grupos \(2\) · publicaciones realizadas: 0/.test(confirmacion), confirmacion);
        assert.ok(/Grupo Prueba Uno/.test(confirmacion) && /Reservas relacionadas/.test(confirmacion));
        await pulsar(page, "Eliminar definitivamente");
        await esperarTexto(page, "Programación eliminada");
        assert.strictEqual(t.sorteos_programados.length, 0);
        assert.strictEqual((t.sorteos_programados_grupos || []).filter(g => g.sorteo_id === prog.id).length, 0);
        assert.ok(t.reservas_dos_cifras.every(f => f.estado === "libre"), "la tabla no se toca");
        paso("eliminar sin actividad: confirmación con impacto; se borra solo la programación");

        // 9. Aislamiento: el panel no habló con ningún Supabase real.
        assert.ok(peticionesSupabase.every(p => !/sorteos_programados|cuentas_pago/.test(p)), "el panel no escribe sorteos directo en la base");
        assert.deepStrictEqual(erroresConsola, [], "sin errores de JavaScript en la página");
        paso("aislado: sin Supabase real; el panel solo usa la API /sorteos; sin errores de JS");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
