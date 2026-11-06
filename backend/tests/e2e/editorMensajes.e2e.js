// ==========================================================================
// PRUEBA DE NAVEGADOR — editor visual de /mensajes (Comunicación → Mensajes).
// Entorno AISLADO (entornoPanel.js): Chrome + panel real (next dev) + base
// en memoria. Nada sale a Supabase ni a WhatsApp.
//
// Cubre: crear, escribir, insertar información automática con botones,
// buscar variables, vista previa con 1 y varios números (formato de
// WhatsApp), guardar, guardar como nueva, duplicar, eliminar, activar y
// desactivar sin perder lo que se edita, modos fija/aleatoria/rotación,
// persistencia tras recargar, plantillas antiguas, aviso de cambios sin
// guardar, móvil sin desbordes y sin errores de JavaScript.
//
//     node backend/tests/e2e/editorMensajes.e2e.js
// ==========================================================================

const assert = require("assert");
const {
    PANEL, tablas: t, servirTablas, registrarUsuario, arrancarEntorno, esperarTexto, captura, crearPasos, pulsar
} = require("./entornoPanel");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario("tok-a", A, "admin-a@prueba.local");

servirTablas(["configuracion_seleccion_mensajes", "plantillas_mensaje"]);
t.configuracion_seleccion_mensajes = [];
t.plantillas_mensaje = [];

const delTipo = (tipo) => t.plantillas_mensaje.filter((p) => p.usuario_id === A && p.tipo_respuesta === tipo);
const fila = (id) => t.plantillas_mensaje.find((p) => p.id === id);
const config = (tipo) => t.configuracion_seleccion_mensajes.find((c) => c.usuario_id === A && c.tipo_respuesta === tipo);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, mensaje, ms = 8000) {
    for (let i = 0; i < ms / 100; i++) { if (condicion()) return; await esperar(100); }
    assert.fail(mensaje);
}

const AREA = 'textarea[aria-label="Mensaje"]';
const valorMensaje = (page) => page.$eval(AREA, (el) => el.value);
const nombrePlantilla = (page) => page.evaluate(() => {
    const label = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Nombre de la plantilla"));
    return document.getElementById(label.htmlFor).value;
});

async function escribirAlFinal(page, texto) {
    await page.focus(AREA);
    await page.$eval(AREA, (el) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(texto);
}

async function vaciarMensaje(page) {
    await page.focus(AREA);
    await page.$eval(AREA, (el) => el.select());
    await page.keyboard.press("Backspace");
}

const burbuja = (page) => page.evaluate(() => {
    const b = document.querySelector('[data-testid="vista-previa-burbuja"]');
    return b ? { texto: b.innerText, html: b.innerHTML } : null;
});

const pulsarCaso = (page, etiqueta) => page.evaluate((etiqueta) => {
    [...document.querySelectorAll('button[role="tab"]')].find((b) => b.textContent.trim() === etiqueta).click();
}, etiqueta);

const pulsarModo = (page, titulo) => page.evaluate((titulo) => {
    [...document.querySelectorAll('button[role="radio"]')].find((b) => b.textContent.trim().startsWith(titulo)).click();
}, titulo);

const modoMarcado = (page) => page.evaluate(() =>
    [...document.querySelectorAll('button[role="radio"]')].find((b) => b.getAttribute("aria-checked") === "true")?.textContent.trim());

// Fila de la lista de plantillas por nombre.
const pulsarPlantilla = (page, nombre) => page.evaluate((nombre) => {
    const filaLista = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === nombre);
    filaLista.closest("div[class*=item]").click();
}, nombre);

const accionPlantilla = (page, nombre, etiqueta) => page.evaluate((nombre, etiqueta) => {
    const filaLista = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === nombre).closest("div[class*=item]");
    filaLista.querySelector(`button[aria-label="${etiqueta}"]`).click();
}, nombre, etiqueta);

const casillaPlantilla = (page, nombre) => page.evaluate((nombre) => {
    const filaLista = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === nombre).closest("div[class*=item]");
    filaLista.querySelector('input[type="checkbox"]').click();
}, nombre);

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const a = await entorno.nuevaPagina("tok-a");
        const dialogos = [];
        a.on("dialog", (d) => dialogos.push(d.message()));
        const erroresConsola = [];
        a.on("console", (m) => { if (m.type() === "error") erroresConsola.push(m.text()); });

        await a.setViewport({ width: 1600, height: 1000 });
        await a.goto(`${PANEL}/mensajes`, { waitUntil: "domcontentloaded" });
        await esperarTexto(a, "Agrega información automática");
        await a.waitForSelector(AREA);
        assert.ok(delTipo("reserva_completa").length >= 10, "plantillas iniciales sembradas");

        // ---- Plantilla antigua (sembrada) abierta por defecto ----
        const previaAntigua = await burbuja(a);
        assert.ok(previaAntigua && previaAntigua.texto.trim(), "vista previa de la plantilla existente");
        assert.ok(!previaAntigua.texto.includes("{{"), "sin códigos en la vista previa");
        const lista = await a.evaluate(() => [...document.querySelectorAll("div[class*=item] span[class*=preview]")].map((s) => s.textContent));
        assert.ok(lista.length && lista.every((x) => !x.includes("{{")), "la lista muestra [Nombre del cliente], no códigos");
        paso("Plantillas existentes: vista previa sin códigos y lista legible");

        // ---- Escritorio: mensaje y vista previa visibles a la vez ----
        const cajas = await a.evaluate((sel) => {
            const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
            return {
                area: r(document.querySelector(sel)),
                previa: r(document.querySelector('[aria-label="Vista previa del mensaje"]'))
            };
        }, AREA);
        assert.ok(cajas.previa.x > cajas.area.x + cajas.area.w - 1, `vista previa a la derecha: ${JSON.stringify(cajas)}`);
        assert.ok(cajas.previa.y < 1000 && cajas.area.y < 1000, "ambos en pantalla sin desplazarse");
        await captura(a, "editor_escritorio");
        paso("Escritorio (1600 px): mensaje y vista previa lado a lado, visibles sin desplazarse");

        // ---- Crear plantilla ----
        const antes = delTipo("reserva_completa").length;
        await pulsar(a, "Nueva plantilla");
        await hasta(() => delTipo("reserva_completa").length === antes + 1, "no se creó la plantilla");
        const nueva = delTipo("reserva_completa").find((p) => p.nombre === "Nueva plantilla" && p.contenido === "");
        assert.ok(nueva, "fila nueva vacía");
        await a.waitForFunction((sel) => document.activeElement === document.querySelector(sel) && document.querySelector(sel).value === "", {}, AREA);
        await esperarTexto(a, "Escribe tu mensaje y aquí verás cómo lo recibirá el cliente.");
        paso("Nueva plantilla: se crea, se abre y el cursor queda listo para escribir");

        // ---- Nombre + mensaje + información automática con botones ----
        await a.evaluate(() => {
            const label = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Nombre de la plantilla"));
            document.getElementById(label.htmlFor).focus();
            document.getElementById(label.htmlFor).select();
        });
        await a.keyboard.type("Bienvenida E2E");
        await escribirAlFinal(a, "*Hola*");
        await pulsar(a, "Nombre del cliente");
        await escribirAlFinal(a, ", tus números:");
        await pulsar(a, "Números reservados");
        await escribirAlFinal(a, " 🎉");
        assert.strictEqual(await valorMensaje(a), "*Hola* {{cliente}}, tus números: {{numeros_reservados}} 🎉");
        await esperarTexto(a, "Información automática en este mensaje:");
        paso("Escribir e insertar con botones: «Nombre del cliente» → {{cliente}} en el cursor, sin teclear códigos");

        // ---- Vista previa 1 / varios números + formato WhatsApp ----
        await pulsarCaso(a, "Con 1 número");
        let b = await burbuja(a);
        assert.ok(b.texto.includes("Hola Carlos, tus números: ( 45 ) 🎉"), b.texto);
        assert.ok(/<strong>Hola<\/strong>/.test(b.html), "negrita de WhatsApp");
        assert.ok(!b.texto.includes("*"), "sin asteriscos visibles");
        await pulsarCaso(a, "Con varios números");
        b = await burbuja(a);
        assert.ok(b.texto.includes("( 27 - 45 )"), b.texto);
        await esperarTexto(a, "Datos de ejemplo");
        paso("Vista previa en tiempo real: 1 número «( 45 )», varios «( 27 - 45 )», negrita aplicada, marcada como ejemplo");

        // ---- Buscar y usar «Más variables» (global + específica) ----
        await a.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Más variables")).click());
        await a.waitForSelector('input[aria-label="Buscar variables"]');
        await a.type('input[aria-label="Buscar variables"]', "pendiente");
        await a.waitForFunction(() => !!document.querySelector('button[aria-label="Insertar Valor pendiente"]'));
        const visibles = await a.evaluate(() => [...document.querySelectorAll('#mas-variables button[aria-label^="Insertar "]')].map((x) => x.getAttribute("aria-label")));
        assert.ok(visibles.length >= 3, JSON.stringify(visibles));
        assert.ok(visibles.every((x) => /pendiente/i.test(x)), JSON.stringify(visibles));
        await esperarTexto(a, "Puede quedar vacía aquí");
        await escribirAlFinal(a, " Debes:");
        await a.click('button[aria-label="Insertar Valor pendiente"]');
        assert.ok((await valorMensaje(a)).endsWith("Debes: {{monto_pendiente}}"));
        await a.focus('input[aria-label="Buscar variables"]');
        await a.keyboard.down("Control"); await a.keyboard.press("KeyA"); await a.keyboard.up("Control");
        await a.keyboard.press("Backspace");
        await a.type('input[aria-label="Buscar variables"]', "tu numero");
        await a.waitForFunction(() => !!document.querySelector('button[aria-label="Insertar «tu número» o «tus números»"]'));
        paso("Más variables: buscador sin tildes, disponibilidad explicada, variable global insertada");

        // Quitar el monto (no aplica a reservas) antes de guardar.
        const texto = (await valorMensaje(a)).replace(" Debes: {{monto_pendiente}}", "");
        await vaciarMensaje(a);
        await a.keyboard.type(texto);
        assert.strictEqual(await valorMensaje(a), "*Hola* {{cliente}}, tus números: {{numeros_reservados}} 🎉");

        // ---- Código desconocido avisado ----
        await escribirAlFinal(a, " {{inventada}}");
        await a.keyboard.press("Escape");
        await esperarTexto(a, "EFAAT no reconoce este código");
        for (let i = 0; i < " {{inventada}}".length; i++) await a.keyboard.press("Backspace");
        await a.waitForFunction(() => !document.body.innerText.includes("EFAAT no reconoce"));
        paso("Código escrito a mano que no existe: aviso claro; desaparece al quitarlo");

        // ---- Activar/desactivar OTRA plantilla no cambia la que se edita ----
        await esperarTexto(a, "Cambios sin guardar");
        const otra = delTipo("reserva_completa").find((p) => p.id !== nueva.id && p.habilitada);
        await casillaPlantilla(a, otra.nombre);
        await hasta(() => fila(otra.id).habilitada === false, "no se desactivó la otra plantilla");
        await esperar(300);
        assert.strictEqual(await nombrePlantilla(a), "Bienvenida E2E", "el editor sigue en la misma plantilla");
        assert.strictEqual(await valorMensaje(a), "*Hola* {{cliente}}, tus números: {{numeros_reservados}} 🎉", "no se pierde lo escrito");
        assert.strictEqual(dialogos.length, 0);
        await casillaPlantilla(a, otra.nombre);
        await hasta(() => fila(otra.id).habilitada === true, "no se reactivó");
        paso("Activar/desactivar otra plantilla: se guarda y el editor conserva lo escrito (antes saltaba a esa plantilla)");

        // ---- Guardar ----
        await pulsar(a, "Guardar cambios");
        await hasta(() => fila(nueva.id).contenido === "*Hola* {{cliente}}, tus números: {{numeros_reservados}} 🎉", "no se guardó el contenido");
        assert.strictEqual(fila(nueva.id).nombre, "Bienvenida E2E");
        assert.strictEqual(fila(otra.id).contenido, otra.contenido, "la otra plantilla no cambia");
        await esperarTexto(a, "Cambios guardados.");
        paso("Guardar cambios: se guarda solo esta plantilla (nombre y mensaje)");

        // ---- Guardar como nueva ----
        await escribirAlFinal(a, " ¡Suerte!");
        const totalAntes = delTipo("reserva_completa").length;
        await pulsar(a, "Guardar como nueva");
        await hasta(() => delTipo("reserva_completa").length === totalAntes + 1, "no se creó la copia");
        const copia = delTipo("reserva_completa").find((p) => p.nombre === "Bienvenida E2E (copia)");
        assert.ok(copia && copia.contenido.endsWith("¡Suerte!"));
        assert.ok(!fila(nueva.id).contenido.includes("¡Suerte!"), "la original no cambia");
        await a.waitForFunction(() => {
            const label = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Nombre de la plantilla"));
            return document.getElementById(label.htmlFor).value === "Bienvenida E2E (copia)";
        });
        paso("Guardar como nueva: crea la copia con el texto nuevo y deja la original intacta");

        // ---- Duplicar y eliminar ----
        const n1 = delTipo("reserva_completa").length;
        await accionPlantilla(a, "Bienvenida E2E", "Duplicar plantilla");
        await hasta(() => delTipo("reserva_completa").length === n1 + 1, "no se duplicó");
        await accionPlantilla(a, "Bienvenida E2E (copia)", "Eliminar plantilla");
        await hasta(() => !delTipo("reserva_completa").some((p) => p.id === copia.id), "no se eliminó");
        assert.ok(dialogos.some((m) => m.includes("¿Eliminar la plantilla")));
        paso("Duplicar y eliminar desde la lista siguen funcionando");

        // ---- Aviso de cambios sin guardar al cambiar de plantilla ----
        await pulsarPlantilla(a, "Bienvenida E2E");
        await a.waitForFunction(() => {
            const label = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Nombre de la plantilla"));
            return document.getElementById(label.htmlFor).value === "Bienvenida E2E";
        });
        dialogos.length = 0;
        await escribirAlFinal(a, " (borrador)");
        await pulsarPlantilla(a, otra.nombre);
        await hasta(() => dialogos.some((m) => m.includes("cambios sin guardar")), "no se pidió confirmación");
        assert.ok(!fila(nueva.id).contenido.includes("borrador"), "el borrador descartado no se guarda");
        paso("Cambiar de plantilla con cambios sin guardar: pide confirmación y nada se guarda solo");

        // ---- Modos de respuesta ----
        await pulsarModo(a, "Fija");
        await hasta(() => config("reserva_completa")?.modo_seleccion === "fijo", "no se guardó «fija»");
        assert.ok(config("reserva_completa").plantilla_fija_id, "con plantilla fija");
        await esperarTexto(a, "Siempre se enviará esta plantilla.");
        await pulsarModo(a, "Rotación");
        await hasta(() => config("reserva_completa")?.modo_seleccion === "rotacion", "no se guardó «rotación»");
        assert.strictEqual(config("reserva_completa").plantilla_fija_id, null);
        await pulsarModo(a, "Aleatoria");
        await hasta(() => config("reserva_completa")?.modo_seleccion === "aleatorio", "no se guardó «aleatoria»");
        assert.ok((await modoMarcado(a)).startsWith("Aleatoria"));
        paso("Modos Fija / Rotación / Aleatoria: se guardan igual que antes, con su explicación");

        // ---- Persistencia tras recargar ----
        await pulsarModo(a, "Rotación");
        await hasta(() => config("reserva_completa")?.modo_seleccion === "rotacion", "rotación");
        await a.reload({ waitUntil: "domcontentloaded" });
        await a.waitForSelector(AREA);
        await esperarTexto(a, "Bienvenida E2E");
        assert.ok((await modoMarcado(a)).startsWith("Rotación"), "modo persistido");
        await pulsarPlantilla(a, "Bienvenida E2E");
        await a.waitForFunction((sel) => document.querySelector(sel).value.startsWith("*Hola* {{cliente}}"), {}, AREA);
        b = await burbuja(a);
        assert.ok(b.texto.includes("Hola Carlos"));
        paso("Recargar: la plantilla, su mensaje y el modo siguen guardados");

        // ---- Otro tipo (consulta de pago): variables específicas ----
        await a.evaluate(() => [...document.querySelectorAll("aside button")].find((x) => x.textContent.includes("Pago parcial")).click());
        await a.waitForFunction(() => !!document.querySelector('button[title*="monto_pendiente"]'));
        paso("Consulta de pago: «Valor pendiente» aparece entre las principales de ese tipo");

        // ---- Móvil ----
        await a.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await a.reload({ waitUntil: "domcontentloaded" });
        await a.waitForSelector(AREA);
        await esperar(500);
        const movil = await a.evaluate((sel) => {
            const y = (el) => el.getBoundingClientRect().top + window.scrollY;
            return {
                desborde: document.documentElement.scrollWidth - window.innerWidth,
                area: y(document.querySelector(sel)),
                previa: y(document.querySelector('[aria-label="Vista previa del mensaje"]')),
                info: y(document.getElementById("titulo-info-automatica"))
            };
        }, AREA);
        assert.ok(movil.desborde <= 0, `desborde horizontal: ${movil.desborde}px`);
        assert.ok(movil.area < movil.previa && movil.previa < movil.info, `orden móvil: ${JSON.stringify(movil)}`);
        await captura(a, "editor_movil");
        paso("Móvil (390 px): sin desplazamiento horizontal; vista previa justo después del mensaje");

        assert.deepStrictEqual(a.erroresJs, [], "sin errores de JavaScript");
        const relevantes = erroresConsola.filter((m) => !/Download the React DevTools|favicon|Failed to load resource/i.test(m));
        assert.deepStrictEqual(relevantes, [], "sin errores en consola");
        paso("Sin errores de JavaScript ni de consola");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
