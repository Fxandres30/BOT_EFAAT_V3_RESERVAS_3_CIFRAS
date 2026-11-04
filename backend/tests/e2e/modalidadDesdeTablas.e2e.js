// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas → «Editar» sin sorteo activo y
// elección OBLIGATORIA de modalidad (instantáneo / programado), con
// navegador real (Chrome vía puppeteer), el panel Next real (next dev) y la
// API real (routes/sorteos.js -> servicio).
//
//   1. Tabla sin sorteo activo: ventana informativa (no error) con
//      «Crear sorteo nuevo», «Ver el último publicado» y «Cerrar».
//   2. «Ver el último publicado» abre su vista previa y no cambia nada.
//   3. «Crear sorteo nuevo» pide la modalidad: sin elegir no se continúa.
//   4. Instantáneo: sin fecha/hora de publicación; grupos elegidos; vista
//      previa con «Publicar ahora» (no «Confirmar y programar»); no publica.
//   5. Al recargar, «Editar» lo abre como instantáneo y guardar no cambia
//      su modalidad.
//   6. Programado: exige fecha y hora de publicación; vista previa con
//      «Confirmar y programar»; al recargar sigue siendo programado.
//   7. Móvil (390 px): ventana y modalidades sin desborde.
//   8. Reservas, pagos y eventos intactos; sin errores de JavaScript.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria, sin
// WhatsApp. No toca datos reales.
//
//     node backend/tests/e2e/modalidadDesdeTablas.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    valorDe, rellenar, rellenarAria, marcar, pulsar, botonHabilitado, esperarTexto, textoPagina, captura, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const servicio = require(path.join(RAIZ, "sorteos/servicio.js"));

const TOKEN = "e2e-token-modalidad";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario(TOKEN, A, "modalidad@prueba.local");

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({
        numero: String(i).padStart(2, "0"), estado: i < 2 ? "pagado" : i < 4 ? "reservado" : "libre", usuario_id: A,
        ...(i < 4 ? { identidad_evento_real: "otro-sorteo" } : {})
    }));
}
const numerosAntes = JSON.stringify([t.reservas_dos_cifras, t["5k_15k_reservas_2_cifras"]]);

const { paso, terminar } = crearPasos();

const titulosModal = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] h2'), h => h.textContent.trim()));
const esperarModal = (page, titulo) =>
    page.waitForFunction((titulo) => [...document.querySelectorAll('[role="dialog"] h2')].some(h => h.textContent.trim() === titulo), { timeout: 60000 }, titulo);
const accionPorTitulo = (page, titulo) => page.evaluate((titulo) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim().startsWith(titulo));
    if (!b) return false;
    b.click();
    return true;
}, titulo);
const esperarFormulario = (page) => page.waitForFunction(() =>
    [...document.querySelectorAll("label")].some(l => l.textContent.includes("Hora del sorteo"))
    && document.body.innerText.includes("Grupo Prueba Uno") && document.body.innerText.includes("Nequi Prueba"), { timeout: 60000 });
const desbordeDialogo = (page) => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    const botones = [...d.querySelectorAll("button")].map(b => b.getBoundingClientRect()).filter(b => b.width > 0);
    return {
        pagina: document.documentElement.scrollWidth - window.innerWidth,
        dialogo: d.scrollWidth - d.clientWidth,
        fuera: botones.filter(b => b.left < r.left - 1 || b.right > r.right + 1).length
    };
});

async function abrirEditar(page, precio) {
    await page.goto(`${PANEL}/tablas/${precio}`, { waitUntil: "domcontentloaded" });
    await pulsar(page, "Editar");
}

async function rellenarComun(page, nombre) {
    await rellenar(page, "Lotería o nombre del sorteo", nombre);
    await rellenar(page, "Hora del sorteo", "23:50");
    await rellenarAria(page, "Premio", "Premio mayor");
    await rellenarAria(page, "Valor del premio", "300000");
    await marcar(page, "Grupo Prueba Dos");
    await marcar(page, "Nequi Prueba");
}

async function main() {

    // Último sorteo de $5.000: ya publicado (no editable, sin evento activo).
    const previo = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Lotería Anterior", hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 100000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-e2e"],
        publicar_en: new Date(`${fechaColombia(1)}T08:00:00-05:00`).toISOString(), fecha_sorteo: fechaColombia(1),
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(previo.ok, JSON.stringify(previo));
    Object.assign(t.sorteos_programados.find(s => s.id === previo.data.id), { estado: "publicado" });
    t.sorteos_programados_grupos.filter(g => g.sorteo_id === previo.data.id).forEach(g => { g.estado = "publicado"; });

    const entorno = await arrancarEntorno();

    try {

        servirTablas(["reservas_dos_cifras", "5k_15k_reservas_2_cifras", "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);
        const page = await entorno.nuevaPagina(TOKEN);
        await page.setViewport({ width: 1366, height: 900 });

        // 1. Ventana «Sin sorteo activo».
        await abrirEditar(page, 5000);
        await esperarTexto(page, "Es una situación normal");
        let texto = await textoPagina(page);
        await captura(page, "modalidad_sin_activo_0");
        assert.ok(texto.includes("Es una situación normal"), "se distingue de un error: " + texto.slice(-600));
        assert.ok(!texto.includes("No se pudo cargar"), "no se presenta como error");
        assert.ok(!texto.includes("Hora del sorteo"), "no abre un formulario por su cuenta");
        assert.ok(texto.includes("Crear sorteo nuevo") && texto.includes("Ver el último publicado"), texto);
        assert.strictEqual(await botonHabilitado(page, "Cerrar"), true);
        const iconos = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button svg')].length);
        assert.ok(iconos >= 2, "acciones con icono");
        await captura(page, "modalidad_sin_activo");
        paso("tabla sin sorteo activo: ventana informativa con «Crear sorteo nuevo», «Ver el último publicado» y «Cerrar»");

        // 2. Ver el último publicado: solo lectura.
        const sorteosAntes = JSON.stringify([t.sorteos_programados, t.sorteos_programados_grupos]);
        assert.ok(await accionPorTitulo(page, "Ver el último publicado"));
        await esperarTexto(page, "Lotería Anterior");
        assert.strictEqual(JSON.stringify([t.sorteos_programados, t.sorteos_programados_grupos]), sorteosAntes, "consultar no cambia nada");
        paso("«Ver el último publicado» abre su vista previa sin modificar nada");

        // 3. «Crear sorteo nuevo» → elección obligatoria.
        await abrirEditar(page, 5000);
        await esperarTexto(page, "Es una situación normal");
        assert.ok(await accionPorTitulo(page, "Crear sorteo nuevo"));
        await esperarModal(page, "Nuevo sorteo · tabla $5.000");
        texto = await textoPagina(page);
        assert.ok(texto.includes("Sorteo instantáneo") && texto.includes("Sorteo programado"), texto);
        assert.ok(!texto.includes("Hora del sorteo"), "el formulario no se abre antes de elegir");
        assert.strictEqual(await botonHabilitado(page, "Continuar"), false, "sin elegir no se continúa");
        const marcadas = await page.evaluate(() => [...document.querySelectorAll('input[name="modalidad-sorteo"]')].filter(i => i.checked).length);
        assert.strictEqual(marcadas, 0, "ninguna modalidad por defecto");
        await captura(page, "modalidad_eleccion");
        paso("«Crear sorteo nuevo» pide elegir instantáneo o programado; ninguna por defecto y «Continuar» bloqueado");

        // 4. Instantáneo.
        await marcar(page, "Sorteo instantáneo");
        await pulsar(page, "Continuar");
        await esperarModal(page, "Sorteo instantáneo");
        await esperarFormulario(page);
        texto = await textoPagina(page);
        assert.ok(!texto.includes("Fecha y hora de publicación"), "sin fecha de publicación programada");
        assert.strictEqual(await valorDe(page, "Valor por número"), "5000", "precio de la tabla precargado");
        await rellenarComun(page, "Lotería E2E Instantánea");
        await pulsar(page, "Guardar y ver vista previa");
        await esperarModal(page, "Sorteo instantáneo · vista previa");
        await esperarTexto(page, "Lotería E2E Instantánea");
        assert.ok(await botonHabilitado(page, "Publicar ahora") !== null, "se publica con «Publicar ahora»");
        assert.strictEqual(await botonHabilitado(page, "Confirmar y programar"), null, "no se programa");
        const inst = t.sorteos_programados.find(s => s.config.nombre === "Lotería E2E Instantánea");
        assert.ok(inst, "sorteo creado");
        assert.strictEqual(inst.config.publicacion_inmediata, true);
        assert.strictEqual(inst.estado, "borrador", "no se publica sin confirmar");
        assert.deepStrictEqual(t.sorteos_programados_grupos.filter(g => g.sorteo_id === inst.id).map(g => g.grupo_id), ["g2@g.us"], "grupo elegido");
        await captura(page, "modalidad_instantaneo_vista");
        paso("instantáneo: sin fecha de publicación, grupo elegido, vista previa con «Publicar ahora»; nada se publica sin confirmar");

        // 5. Recargar: sigue siendo instantáneo; editar no cambia la modalidad.
        await abrirEditar(page, 5000);
        await esperarModal(page, "Editar sorteo instantáneo");
        await esperarFormulario(page);
        assert.ok(!(await textoPagina(page)).includes("Fecha y hora de publicación"));
        assert.strictEqual(await valorDe(page, "Lotería o nombre del sorteo"), "Lotería E2E Instantánea");
        await rellenar(page, "Hora del sorteo", "23:55");
        await pulsar(page, "Guardar cambios");
        await esperarModal(page, "Sorteo instantáneo · vista previa");
        const inst2 = t.sorteos_programados.find(s => s.id === inst.id);
        assert.strictEqual(inst2.version, 2);
        assert.strictEqual(inst2.config.publicacion_inmediata, true, "editar no lo vuelve programado");
        assert.strictEqual(inst2.config.hora_fin, "23:55");
        assert.strictEqual(t.sorteos_programados.filter(s => s.config.nombre === "Lotería E2E Instantánea").length, 1, "sin duplicar");
        paso("al recargar, «Editar» abre el instantáneo como instantáneo; guardar conserva la modalidad (versión 2, sin duplicar)");

        // 6. Programado (en $2.000, sin sorteos anteriores).
        await abrirEditar(page, 2000);
        await esperarTexto(page, "Es una situación normal");
        await esperarTexto(page, "Todavía no hay sorteos anteriores de este precio");
        assert.ok(!(await textoPagina(page)).includes("Ver el último publicado"));
        assert.ok(await accionPorTitulo(page, "Crear sorteo nuevo"));
        await marcar(page, "Sorteo programado");
        await pulsar(page, "Continuar");
        await esperarModal(page, "Nuevo sorteo");
        await esperarFormulario(page);
        assert.ok((await textoPagina(page)).includes("Fecha y hora de publicación"));
        await rellenarComun(page, "Lotería E2E Programada");
        await pulsar(page, "Guardar y ver vista previa");
        await esperarTexto(page, "Indica la fecha y hora de publicación.");
        assert.ok(!t.sorteos_programados.some(s => s.config.nombre === "Lotería E2E Programada"), "sin publicación no se guarda");
        const publicar = `${fechaColombia(1)}T08:00`;
        await rellenar(page, "Fecha y hora de publicación", publicar);
        await pulsar(page, "Guardar y ver vista previa");
        await esperarModal(page, "Vista previa");
        await esperarTexto(page, "Lotería E2E Programada");
        assert.ok(await botonHabilitado(page, "Confirmar y programar") !== null, "se programa");
        assert.strictEqual(await botonHabilitado(page, "Publicar ahora"), null, "no se publica ahora");
        const prog = t.sorteos_programados.find(s => s.config.nombre === "Lotería E2E Programada");
        assert.strictEqual(prog.config.publicacion_inmediata, false);
        assert.strictEqual(new Date(prog.publicar_en).toISOString(), new Date(`${publicar}:00-05:00`).toISOString());
        await abrirEditar(page, 2000);
        await esperarModal(page, "Editar sorteo");
        await esperarFormulario(page);
        assert.strictEqual(await valorDe(page, "Fecha y hora de publicación"), publicar, "al recargar conserva su programación");
        paso("programado: exige fecha y hora de publicación, vista previa con «Confirmar y programar»; al recargar sigue programado");

        // 7. Móvil.
        await page.setViewport({ width: 390, height: 844 });
        await abrirEditar(page, 1000);
        await esperarTexto(page, "Es una situación normal");
        let d = await desbordeDialogo(page);
        assert.deepStrictEqual(d, { pagina: 0, dialogo: 0, fuera: 0 }, JSON.stringify(d));
        await captura(page, "modalidad_movil_sin_activo");
        assert.ok(await accionPorTitulo(page, "Crear sorteo nuevo"));
        await esperarTexto(page, "Sorteo programado");
        d = await desbordeDialogo(page);
        assert.deepStrictEqual(d, { pagina: 0, dialogo: 0, fuera: 0 }, JSON.stringify(d));
        const anchos = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
            .filter(b => ["Volver", "Continuar"].includes(b.textContent.trim())).map(b => Math.round(b.getBoundingClientRect().width)));
        assert.ok(anchos.length === 2 && anchos[0] === anchos[1], `botones a lo ancho: ${anchos}`);
        await captura(page, "modalidad_movil_eleccion");
        await pulsar(page, "Volver");
        await esperarTexto(page, "Es una situación normal");
        await pulsar(page, "Cerrar");
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        paso("móvil (390 px): ventana y modalidades sin desborde, botones a lo ancho; «Volver» y «Cerrar» funcionan");

        // 8. Nada más cambió.
        assert.strictEqual(JSON.stringify([t.reservas_dos_cifras, t["5k_15k_reservas_2_cifras"]]), numerosAntes, "reservas y pagos intactos");
        assert.strictEqual(t.eventos_bot.length, 0, "ningún evento creado");
        assert.strictEqual(t.sorteos_programados.find(s => s.id === previo.data.id).estado, "publicado", "historial intacto");
        assert.deepStrictEqual(page.erroresJs, [], `errores de JavaScript: ${page.erroresJs.join(" | ")}`);
        paso("reservas, pagos, eventos e historial intactos; sin errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
