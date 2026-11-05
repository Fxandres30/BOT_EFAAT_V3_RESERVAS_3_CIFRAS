// ==========================================================================
// PRUEBAS (frontend) — landing pública: simulador de la demostración y
// configuración comercial de planes.
//
// Carga los módulos TypeScript REALES transpilándolos con el TypeScript del
// propio proyecto (mismo método que tests/mensajes). Sin dependencias nuevas.
//
//     node frontend/tests/landing/landing.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// Transpila y evalúa un módulo TypeScript. Solo puede importar otros
// módulos .ts del propio proyecto ("./x" o "@/x"); cualquier otra
// dependencia (Supabase, React, red...) hace fallar la carga.
const cacheModulos = new Map();
function cargarTs(relativa) {
    const clave = path.normalize(relativa);
    if (cacheModulos.has(clave)) return cacheModulos.get(clave).exports;
    const fuente = fs.readFileSync(path.join(FRONT, clave), "utf8");
    const { outputText } = ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const modulo = { exports: {} };
    cacheModulos.set(clave, modulo);
    const requerir = (spec) => {
        if (spec.startsWith("./")) return cargarTs(path.join(path.dirname(clave), `${spec}.ts`));
        if (spec.startsWith("@/")) return cargarTs(`${spec.slice(2)}.ts`);
        throw new Error(`${relativa} no debe importar ${spec}`);
    };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const sim = cargarTs("components/landing/demo/simuladorDemo.ts");
const ses = cargarTs("components/landing/demo/sesionDemo.ts");
const planes = cargarTs("lib/comercial/planes.ts");

let ok = 0;
function prueba(nombre, fn) {
    fn();
    ok++;
    console.log("  ✔", nombre);
}

console.log("Simulador de la demostración");

const T0 = () => sim.crearTablaInicial();
const msg = (tabla, texto, quien = "Camila") => sim.procesarMensaje(tabla, texto, quien);

prueba("tabla inicial: 100 números, 20 ocupados (reservados y pagados), ninguno de Camila", () => {
    const t = T0();
    assert.strictEqual(t.length, 100);
    assert.deepStrictEqual(sim.contarTabla(t), { libres: 80, reservados: 11, pagados: 9 });
    assert.deepStrictEqual(sim.numerosDe(t, "Camila").todos, []);
    assert.deepStrictEqual(sim.numerosDe(t, "Mateo"), { todos: [12, 41, 74], reservados: [41, 74], pagados: [12] });
    assert.deepStrictEqual([...sim.PARTICIPANTES_DEMO], ["Camila", "Mateo", "Sara"]);
});

prueba("reserva completa con distintas formas de escribir, con reacción ✅", () => {
    for (const texto of ["Me anotas el 23 y el 46", "apártame 23, 46", "23-46", "quiero el 23 y 46 porfa", "dame el 23 y el 46!"]) {
        const r = msg(T0(), texto);
        assert.strictEqual(r.tipo, "reserva_completa", texto);
        assert.deepStrictEqual(r.reservados, [23, 46], texto);
        assert.strictEqual(r.reaccion, "✅");
        assert.match(r.respuesta, /23 y 46 quedaron reservados/);
        assert.deepStrictEqual(sim.numerosDe(r.tabla, "Camila").reservados, [23, 46]);
    }
});

prueba("las funciones son puras: no modifican la tabla recibida", () => {
    const t = T0();
    const copia = JSON.stringify(t);
    msg(t, "quiero el 10");
    sim.marcarPagados(t, [7]);
    sim.liberarNumeros(t, [7]);
    sim.confirmarPagoDe(t, "Mateo");
    assert.strictEqual(JSON.stringify(t), copia);
});

prueba("reserva parcial: dice cuáles se reservaron y cuáles no, sin reacción", () => {
    const r = msg(T0(), "Quiero el 20, 45 y 46");
    assert.strictEqual(r.tipo, "reserva_parcial");
    assert.deepStrictEqual(r.reservados, [20, 46]);
    assert.strictEqual(r.reaccion, null);
    assert.match(r.respuesta, /20 y 46 quedaron reservados\. 45 ya estaba ocupado\./);
    assert.deepStrictEqual(sim.contarTabla(r.tabla), { libres: 78, reservados: 13, pagados: 9 });
});

prueba("reserva parcial con un número que ya era propio, sin reacción", () => {
    const t = msg(T0(), "el 23").tabla;
    const r = msg(t, "el 23 y el 24");
    assert.strictEqual(r.tipo, "reserva_parcial");
    assert.deepStrictEqual(r.reservados, [24]);
    assert.match(r.respuesta, /24 quedó reservado\. 23 ya era tuyo\./);
});

prueba("ocupados (reservados o pagados por otros): ❌ solo si todos lo están", () => {
    const uno = msg(T0(), "el 45 por favor");
    assert.strictEqual(uno.tipo, "numero_ocupado");
    assert.strictEqual(uno.reaccion, "❌");
    const varios = msg(T0(), "Apártame el 03 y el 07");
    assert.strictEqual(varios.tipo, "todos_ocupados");
    assert.strictEqual(varios.reaccion, "❌");
    assert.match(varios.respuesta, /03 y 07 ya estaban ocupados/);
    const t = msg(T0(), "el 23").tabla;
    const mixto = msg(t, "el 23 y el 45");
    assert.strictEqual(mixto.reaccion, null);
    assert.strictEqual(mixto.tabla, t);
    assert.strictEqual(msg(t, "el 23").tipo, "ya_era_tuyo");
});

prueba("mis números con su estado de pago", () => {
    let t = T0();
    assert.match(msg(t, "¿Cuáles son mis números?").respuesta, /todavía no tienes números/);
    t = msg(t, "el 05 y el 06").tabla;
    assert.match(msg(t, "mis numeros").respuesta, /tus números son: 05 y 06\n⏳ Todos están pendientes de pago\./);
    t = sim.marcarPagados(t, [5]).tabla;
    const r = msg(t, "qué números tengo").respuesta;
    assert.match(r, /✅ Pagado: 05/);
    assert.match(r, /⏳ Pendiente de pago: 06/);
    const mateo = msg(T0(), "mis números", "Mateo");
    assert.match(mateo.respuesta, /Mateo, tus números son: 12, 41 y 74/);
});

prueba("cantidad y valores: total, pagado y pendiente", () => {
    let t = msg(T0(), "15 16 17").tabla;
    t = sim.marcarPagados(t, [15]).tabla;
    assert.strictEqual(msg(t, "¿Cuántos tengo?").respuesta, "Camila, tienes 3 números en total.");
    const total = msg(t, "¿Cuánto es todo lo mío?");
    assert.strictEqual(total.tipo, "valor_total");
    assert.match(total.respuesta, /total de tus números es: \$15\.000\.\n✅ Pagado: \$5\.000\n⏳ Pendiente: \$10\.000/);
    assert.strictEqual(msg(t, "valor total de mis reservas").tipo, "valor_total");
    const debe = msg(t, "¿Cuánto debo?");
    assert.strictEqual(debe.tipo, "valor_pendiente");
    assert.match(debe.respuesta, /te falta pagar: 16 y 17 — \$10\.000/);
    assert.match(msg(t, "cuánto he pagado").respuesta, /has pagado: \$5\.000/);
    assert.match(msg(T0(), "cuanto debo").respuesta, /no debes nada/);
    assert.strictEqual(msg(t, "¿Cuántos tengo?").tabla, t);
});

prueba("disponibilidad general: lista real de libres, sin reservar", () => {
    const t = T0();
    for (const p of ["¿Qué números quedan?", "cuales hay disponibles", "tabla", "números libres"]) {
        const r = msg(t, p);
        assert.strictEqual(r.tipo, "disponibilidad", p);
        assert.strictEqual(r.tabla, t);
        assert.match(r.respuesta, /^Números disponibles \(80\):\n00 01 02 04 05 06 08 09 10 11\n/);
        assert.ok(!/\b03\b/.test(r.respuesta), "03 está ocupado");
    }
});

prueba("estado de un número concreto: pregunta, nunca reserva", () => {
    const t = msg(T0(), "el 30").tabla;
    const r = msg(t, "¿El 23 está libre?");
    assert.strictEqual(r.tipo, "numero_especifico");
    assert.strictEqual(r.tabla, t);
    assert.strictEqual(r.respuesta, "El número 23 está libre.");
    assert.strictEqual(msg(t, "¿el 18 está libre?").respuesta, "El número 18 está reservado por otra persona.");
    assert.strictEqual(msg(t, "¿el 03 sigue disponible?").respuesta, "El número 03 ya fue pagado por otra persona.");
    assert.strictEqual(msg(t, "¿el 30 está libre?").respuesta, "El número 30 ya lo tienes reservado.");
});

prueba("«ya pagué» / «ya cancelé» es una afirmación: sin respuesta del bot", () => {
    const t = msg(T0(), "15 16").tabla;
    for (const texto of ["Ya pagué", "ya cancelé el 15", "listo, te transferí"]) {
        const r = msg(t, texto);
        assert.strictEqual(r.tipo, "aviso_pago", texto);
        assert.strictEqual(r.respuesta, null);
        assert.strictEqual(r.tabla, t);
    }
    assert.deepStrictEqual(msg(t, "Ya pagué").numeros, [15, 16]);
    assert.deepStrictEqual(msg(t, "ya cancelé el 15").numeros, [15]);
    // La pregunta sí se responde.
    assert.strictEqual(msg(t, "¿ya pagué?").tipo, "valor_pendiente");
});

prueba("«cancelar» es pagar: nunca reserva ni suelta números", () => {
    const t = msg(T0(), "15").tabla;
    const r = msg(t, "quiero cancelar el 15");
    assert.strictEqual(r.tipo, "valor_pendiente");
    assert.strictEqual(r.tabla, t);
    assert.match(r.nota, /«cancelar» significa pagar/);
    assert.strictEqual(msg(T0(), "quiero cancelar el 20").tabla[20], null);
});

prueba("pedir soltar un número no lo libera: queda como aviso para el organizador", () => {
    const t = msg(T0(), "15 16").tabla;
    const r = msg(t, "Ya no quiero el 15");
    assert.strictEqual(r.tipo, "solicitud_liberar");
    assert.strictEqual(r.respuesta, null);
    assert.strictEqual(r.tabla, t);
    assert.deepStrictEqual(r.numeros, [15]);
    assert.deepStrictEqual(msg(t, "suelta el 45").numeros, [], "45 no es de Camila");
    assert.strictEqual(msg(t, "Ya no quiero el 20").tabla[20], null, "no debe reservar el 20");
});

prueba("operaciones del organizador: pagar, confirmar por participante y liberar", () => {
    const t = T0();
    const p = sim.marcarPagados(t, [7, 3, 50]);
    assert.deepStrictEqual(p.cambiados, [7], "solo pasa a pagado lo reservado");
    const c = sim.confirmarPagoDe(t, "Mateo");
    assert.deepStrictEqual(c.cambiados, [41, 74]);
    assert.deepStrictEqual(sim.numerosDe(c.tabla, "Mateo").reservados, []);
    const l = sim.liberarNumeros(t, [3, 7, 20]);
    assert.deepStrictEqual(l.cambiados, [3, 7]);
    assert.strictEqual(sim.contarTabla(l.tabla).libres, 82);
    assert.strictEqual(sim.liberarNumeros(t, [20]).tabla, t, "sin cambios devuelve la misma tabla");
});

prueba("fuera de rango, cantidades, máximo por mensaje y mensajes sin intención", () => {
    const t = T0();
    assert.strictEqual(msg(t, "quiero el 123").tipo, "fuera_de_rango");
    const cantidad = msg(t, "quiero 3 números");
    assert.strictEqual(cantidad.tipo, "ayuda");
    assert.strictEqual(cantidad.tabla, t);
    assert.strictEqual(msg(t, "hola").tipo, "ayuda");
    const pedido = Array.from({ length: 15 }, (_, i) => 60 + i).join(" ");
    assert.ok(msg(t, pedido).reservados.length <= sim.MAX_NUMEROS_POR_MENSAJE);
});

console.log("Sesión de la demostración (chat + panel)");

const accion = (s, ...acciones) => acciones.reduce(ses.reducirDemo, s);
const escribir = (s, texto, autor = "Camila") => accion(s, { tipo: "enviar", autor, texto }, { tipo: "responder" });
const ultimo = (s) => s.mensajes[s.mensajes.length - 1];
const pendientesDe = (s) => s.avisos.filter((a) => a.estado === "pendiente");

prueba("sesión inicial y reinicio", () => {
    const s = ses.crearSesion();
    assert.strictEqual(s.mensajes.length, 1);
    assert.strictEqual(s.mensajes[0].clase, "sistema");
    assert.deepStrictEqual(s.avisos, []);
    const sucia = escribir(s, "15 16");
    assert.deepStrictEqual(accion(sucia, { tipo: "reiniciar" }), ses.crearSesion());
});

prueba("reserva desde el chat: respuesta, reacción, tabla y aviso al organizador", () => {
    let s = accion(ses.crearSesion(), { tipo: "enviar", autor: "Camila", texto: "Me anotas el 15 y el 16" });
    assert.ok(s.enEspera, "espera la respuesta automática");
    assert.strictEqual(accion(s, { tipo: "enviar", autor: "Camila", texto: "otro" }), s, "no se envía mientras responde");
    s = accion(s, { tipo: "responder" });
    const propio = s.mensajes.find((m) => m.clase === "texto");
    assert.strictEqual(propio.reaccion, "✅");
    assert.strictEqual(ultimo(s).clase, "bot");
    assert.deepStrictEqual(s.resaltados, [15, 16]);
    assert.strictEqual(s.tabla[15].dueno, "Camila");
    assert.deepStrictEqual(s.avisos.map((a) => [a.tipo, a.participante, a.numeros, a.estado]), [["reserva", "Camila", [15, 16], "info"]]);
    assert.strictEqual(ses.textoAviso(s.avisos[0]), "Camila reservó 15 y 16");
});

prueba("historial de varios participantes en la misma conversación", () => {
    let s = escribir(ses.crearSesion(), "15", "Camila");
    s = escribir(s, "15 y 20", "Mateo");
    s = escribir(s, "mis números", "Sara");
    const autores = s.mensajes.filter((m) => m.clase === "texto").map((m) => m.autor);
    assert.deepStrictEqual(autores, ["Camila", "Mateo", "Sara"]);
    assert.strictEqual(s.tabla[15].dueno, "Camila");
    assert.strictEqual(s.tabla[20].dueno, "Mateo");
    assert.match(ultimo(s).texto, /Sara, tus números son: 38, 56 y 77/);
});

prueba("comprobante → pendiente en el panel → Aprobar: números pagados", () => {
    let s = escribir(ses.crearSesion(), "15 16");
    s = accion(s, { tipo: "comprobante", autor: "Camila" });
    assert.strictEqual(ultimo(s).clase, "comprobante");
    const [p] = pendientesDe(s);
    assert.strictEqual(p.tipo, "comprobante");
    assert.match(ses.textoAviso(p), /Camila envió un comprobante · 15 y 16 · \$10\.000/);
    s = accion(s, { tipo: "aprobar", avisoId: p.id });
    assert.strictEqual(s.tabla[15].estado, "pagado");
    assert.strictEqual(s.tabla[16].estado, "pagado");
    assert.deepStrictEqual(pendientesDe(s), []);
    assert.strictEqual(s.avisos[0].tipo, "pago_confirmado");
    assert.match(escribir(s, "cuánto debo").mensajes.at(-1).texto, /estás al día/);
});

prueba("comprobante → Rechazar: los números siguen reservados", () => {
    let s = escribir(ses.crearSesion(), "15 16");
    s = accion(s, { tipo: "comprobante", autor: "Camila" });
    s = accion(s, { tipo: "rechazar", avisoId: pendientesDe(s)[0].id });
    assert.strictEqual(s.tabla[15].estado, "reservado");
    assert.deepStrictEqual(pendientesDe(s), []);
    assert.strictEqual(ses.textoAviso(s.avisos[0]), "Comprobante de Camila rechazado · 15 y 16 siguen pendientes");
});

prueba("sticker de pago del organizador: cita el comprobante y confirma en silencio", () => {
    let s = escribir(ses.crearSesion(), "15 16");
    s = accion(s, { tipo: "comprobante", autor: "Camila" });
    const antes = s.mensajes.length;
    s = accion(s, { tipo: "sticker", autor: ses.ORGANIZADOR });
    assert.strictEqual(s.mensajes.length, antes + 1, "solo el sticker: el bot no responde");
    const sticker = ultimo(s);
    assert.strictEqual(sticker.clase, "sticker");
    assert.strictEqual(sticker.dePago, true);
    assert.deepStrictEqual(sticker.cita, { autor: "Camila", texto: "🧾 Comprobante · 15 y 16" });
    assert.strictEqual(s.tabla[15].estado, "pagado");
    assert.deepStrictEqual(pendientesDe(s), []);
});

prueba("«ya pagué» queda pendiente y el sticker lo confirma; sin nada pendiente no cambia nada", () => {
    let s = escribir(ses.crearSesion(), "15");
    s = escribir(s, "Ya pagué");
    assert.ok(!s.mensajes.some((m) => m.clase === "bot" && m.id > 3 && /pag/.test(m.texto)), "el bot no responde a la afirmación");
    assert.strictEqual(pendientesDe(s)[0].tipo, "aviso_pago");
    assert.strictEqual(ses.pagoPendienteMasReciente(s).participante, "Camila");
    s = accion(s, { tipo: "sticker", autor: ses.ORGANIZADOR });
    assert.strictEqual(s.tabla[15].estado, "pagado");
    const sinPendiente = accion(s, { tipo: "sticker", autor: ses.ORGANIZADOR });
    assert.strictEqual(JSON.stringify(sinPendiente.tabla), JSON.stringify(s.tabla));
    assert.match(ultimo(sinPendiente).texto, /solo confirma cuando responde/);
});

prueba("sticker de un participante y comprobante sin deuda no cambian la tabla", () => {
    const s0 = ses.crearSesion();
    const s = accion(s0, { tipo: "sticker", autor: "Camila" });
    assert.strictEqual(s.tabla, s0.tabla);
    assert.match(ultimo(s).texto, /solo cuenta el sticker de pago del organizador/);
    const c = accion(s0, { tipo: "comprobante", autor: "Camila" });
    assert.strictEqual(ultimo(c).clase, "nota");
    assert.deepStrictEqual(c.avisos, []);
});

prueba("pedido de soltar → Liberar desde el panel: el número vuelve a disponible", () => {
    let s = escribir(ses.crearSesion(), "15 16");
    s = escribir(s, "Ya no quiero el 15");
    const [p] = pendientesDe(s);
    assert.strictEqual(p.tipo, "solicitud_liberar");
    assert.strictEqual(s.tabla[15].dueno, "Camila", "el bot no libera solo");
    s = accion(s, { tipo: "liberar", numeros: p.numeros, avisoId: p.id });
    assert.strictEqual(s.tabla[15], null);
    assert.strictEqual(s.tabla[16].dueno, "Camila");
    assert.deepStrictEqual(pendientesDe(s), []);
    assert.strictEqual(ses.textoAviso(s.avisos[0]), "15 volvió a estar disponible (antes de Camila)");
    const conPedido = escribir(escribir(ses.crearSesion(), "15"), "suelta el 15");
    const mantener = accion(conPedido, { tipo: "mantener", avisoId: pendientesDe(conPedido)[0].id });
    assert.ok(mantener.avisos.every((a) => a.estado !== "pendiente"));
    assert.strictEqual(mantener.tabla[15].dueno, "Camila");
});

prueba("panel: marcar pagado y liberar un número directamente", () => {
    let s = accion(ses.crearSesion(), { tipo: "pagar", numeros: [41] });
    assert.strictEqual(s.tabla[41].estado, "pagado");
    assert.strictEqual(ses.textoAviso(s.avisos[0]), "Pago confirmado de Mateo · 41 quedó pagado");
    s = accion(s, { tipo: "liberar", numeros: [41, 74] });
    assert.strictEqual(s.tabla[41], null);
    assert.strictEqual(sim.contarTabla(s.tabla).libres, 82);
});

prueba("el organizador no recibe respuesta automática", () => {
    const s = accion(ses.crearSesion(), { tipo: "enviar", autor: ses.ORGANIZADOR, texto: "el 15" });
    assert.strictEqual(s.enEspera, null);
    assert.strictEqual(s.tabla[15], null);
    assert.strictEqual(ultimo(s).clase, "nota");
});

console.log("Configuración comercial");

prueba("cuatro planes con los precios y grupos aprobados", () => {
    const resumen = planes.PLANES.map((p) => [p.nombre, p.precioMensualCOP, p.maxGrupos]);
    assert.deepStrictEqual(resumen, [
        ["Esencial", 49999, 1],
        ["Profesional", 139999, 2],
        ["Avanzado", 299999, 5],
        ["Empresarial", 499999, 10]
    ]);
    assert.deepStrictEqual(planes.PLANES.filter((p) => p.recomendado).map((p) => p.id), ["profesional"]);
    assert.strictEqual(planes.DIAS_PRUEBA_GRATUITA, 3);
    assert.strictEqual(planes.HORAS_PRUEBA_GRATUITA, 72);
});

prueba("formato COP y texto de grupos", () => {
    assert.strictEqual(planes.formatearCOP(49999), "$49.999");
    assert.strictEqual(planes.formatearCOP(499999), "$499.999");
    assert.strictEqual(planes.formatearCOP(5000), "$5.000");
    assert.strictEqual(planes.textoGrupos(1), "1 grupo de WhatsApp");
    assert.strictEqual(planes.textoGrupos(5), "Hasta 5 grupos de WhatsApp");
});

prueba("capacidades comerciales de tablas y secciones de respaldo", () => {
    const resumen = planes.PLANES.map((p) => [p.id, p.maxTablas, p.maxRespaldos]);
    assert.deepStrictEqual(resumen, [
        ["esencial", 1, 1],
        ["profesional", 2, 2],
        ["avanzado", 5, 5],
        ["empresarial", 10, 10]
    ]);
    assert.strictEqual(planes.textoTablas(1), "1 tabla de configuración");
    assert.strictEqual(planes.textoTablas(5), "5 tablas de configuración");
    assert.strictEqual(planes.textoRespaldos(1), "1 sección de respaldo · 1 número");
    assert.strictEqual(planes.textoRespaldos(10), "10 secciones de respaldo · 10 números");
});

prueba("los enlaces de solicitud son mailto a contacto@efaat.com", () => {
    const general = planes.enlaceSolicitud();
    assert.ok(general.startsWith("mailto:contacto@efaat.com?subject="));
    const generalTexto = decodeURIComponent(general);
    assert.match(generalTexto, /subject=Solicitud de prueba gratuita de 3 días de EFAAT&/);
    assert.match(generalTexto, /Quiero solicitar la prueba gratuita de 3 días\./);
    assert.ok(!/7 d[ií]as/.test(generalTexto), "el correo de prueba no debe citar 7 días");
    assert.match(decodeURIComponent(planes.enlaceSolicitud(planes.PLANES[1])), /plan Profesional/);
});

console.log("Textos comerciales");

const textoLanding = ["app/page.tsx", "components/landing/Landing.tsx", "components/landing/demo/DemoSorteo.tsx"]
    .map((a) => fs.readFileSync(path.join(FRONT, a), "utf8"))
    .join("\n")
    // Solo el texto visible: los comentarios explican las reglas y las nombran.
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const textoComercial = ["app/page.tsx", "components/landing/Landing.tsx"]
    .map((a) => fs.readFileSync(path.join(FRONT, a), "utf8"))
    .join("\n")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

prueba("reacciones descritas como ✅ todos reservados, ❌ todos ocupados, ninguna si es parcial", () => {
    assert.match(textoLanding, /✅ cuando se reservan todos los números pedidos/);
    assert.match(textoLanding, /❌ cuando todos estaban ocupados/);
    assert.match(textoLanding, /si la reserva es parcial, no reacciona/);
    assert.ok(!textoLanding.includes("👍"));
});

prueba("consultas: números reservados, pagos pendientes y disponibilidad (igual que el bot real)", () => {
    // consultas/resolverConsulta.js responde mis números, lo pendiente de
    // pago y «Números disponibles (N)»; la demo simula las tres.
    assert.match(textoComercial, /titulo: "Consultas de los participantes"/);
    assert.match(textoComercial, /Los participantes pueden consultar sus números reservados, conocer sus pagos pendientes y preguntar qué números siguen disponibles\./);
    assert.ok(!/Consulta de números propios/.test(textoComercial));
    assert.ok(!/solo con los suyos/.test(textoComercial));
    // Descripción SEO (app/page.tsx) coherente con la tarjeta.
    const pagina = fs.readFileSync(path.join(FRONT, "app/page.tsx"), "utf8");
    assert.ok(!/números propios/.test(pagina), "la descripción SEO no debe limitarse a los números propios");
    assert.match(pagina, /consultan sus números reservados, sus pagos pendientes y los números disponibles/);
    const demo = sim.procesarMensaje(sim.crearTablaInicial(), "¿Qué números quedan?");
    assert.strictEqual(demo.tipo, "disponibilidad");
});

prueba("sticker de pago: en verificación y sin consultar bancos", () => {
    assert.match(textoLanding, /Confirmación de pagos con sticker/);
    assert.match(textoLanding, /Está en verificación/);
    assert.match(textoLanding, /No consulta bancos/);
    assert.ok(!/Confirmación automática de pagos/.test(textoLanding));
});

prueba("prueba gratuita como solicitud pendiente, sin activación inmediata", () => {
    assert.match(textoLanding, /queda pendiente/);
    assert.ok(!/habilitamos/i.test(textoLanding));
    assert.ok(!/Probar gratis/.test(textoLanding));
    assert.match(textoLanding, /no activa nada de inmediato/);
    assert.ok(!/(activación|acceso) inmediat/i.test(textoLanding));
});

prueba("la duración de la prueba (3 días / 72 horas) se define solo en planes.ts", () => {
    const landing = fs.readFileSync(path.join(FRONT, "components/landing/Landing.tsx"), "utf8");
    // Sin constantes ni enlaces de prueba propios en la landing.
    assert.ok(!/const\s+(DIAS|HORAS)_PRUEBA/.test(landing), "la landing no debe declarar su propia duración");
    assert.ok(!/enlacePrueba/.test(landing), "la landing no debe tener su propio correo de prueba");
    assert.match(landing, /import \{[^}]*\bDIAS_PRUEBA_GRATUITA\b[^}]*\} from "@\/lib\/comercial\/planes"/);
    assert.match(landing, /import \{[^}]*\bHORAS_PRUEBA_GRATUITA\b[^}]*\} from "@\/lib\/comercial\/planes"/);
    // Ninguna cifra de días escrita a mano en Landing.tsx (app/page.tsx es
    // metadata estática y queda fuera de esta fase).
    const landingSinComentarios = landing.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\b\d+ d[ií]as|siete d[ií]as|tres d[ií]as|\b\d+ horas/i.test(landingSinComentarios), "duración escrita a mano");
    assert.ok(!/7 d[ií]as|siete d[ií]as/i.test(textoLanding), "queda una mención a 7 días");
    // Los botones de prueba usan el correo central (3 días).
    assert.match(textoLanding, /href=\{enlaceSolicitud\(\)\}/);
    assert.match(textoLanding, /Solicitar prueba gratis de \{DIAS_PRUEBA_GRATUITA\} días/);
    assert.match(textoLanding, /\(\$\{HORAS_PRUEBA_GRATUITA\} horas\)/);
    for (const plan of planes.PLANES) {
        assert.ok(!/\d+ d[ií]as/.test(decodeURIComponent(planes.enlaceSolicitud(plan))), `${plan.id} no debe citar duración`);
    }
});

prueba("no se anuncian pagos Android ni control de inactividad", () => {
    assert.ok(!/android/i.test(textoLanding));
    assert.ok(!/inactividad|inactivos?/i.test(textoLanding));
    assert.ok(!/lector de pagos/i.test(textoLanding));
});

console.log("Conexión de WhatsApp");

prueba("recomendaciones de conexión: número dedicado y administrador marcados como esenciales", () => {
    assert.match(textoLanding, /Recomendaciones para conectar WhatsApp correctamente/);
    const landing = fs.readFileSync(path.join(FRONT, "components/landing/Landing.tsx"), "utf8");
    const esenciales = [...landing.matchAll(/titulo: "([^"]+)",\s*texto: "[^"]*",\s*esencial: true/g)].map((m) => m[1]);
    assert.deepStrictEqual(esenciales, ["Utiliza un número dedicado para EFAAT", "Haz administrador al número conectado"]);
    assert.match(textoLanding, /Mantén activa y estable la conexión/);
    assert.match(textoLanding, /Ser administrador no garantiza por sí solo/);
});

prueba("administración de conexiones sin prometer respaldo automático ni sesiones simultáneas", () => {
    assert.match(textoLanding, /Administra tus conexiones desde el panel/);
    assert.match(textoLanding, /una sola sesión a la\s+vez/);
    assert.match(textoLanding, /no forma parte de las funciones garantizadas/);
    assert.ok(!/simultáne/i.test(textoLanding));
    assert.ok(!/(cambia|pasa|conmuta)[a-z]* automáticamente/i.test(textoLanding));
    assert.ok(!/todas las funciones (administrativas|de administrador)/i.test(textoLanding));
});

prueba("preguntas frecuentes de conexión", () => {
    for (const p of [
        "¿Necesito conectar mi WhatsApp?",
        "¿Por qué mi número debe ser administrador?",
        "¿Puedo conectar más de un número?",
        "¿Qué pasa si WhatsApp desconecta mi número?",
        "¿Puedo eliminar una conexión desde el panel?"
    ]) {
        assert.ok(textoLanding.includes(`p: "${p}"`), p);
    }
});

console.log("Aislamiento");

prueba("la landing y la demo no usan Supabase, fetch ni el backend", () => {
    const archivos = [
        "app/page.tsx",
        "components/landing/Landing.tsx",
        "components/landing/demo/DemoSorteo.tsx",
        "components/landing/demo/simuladorDemo.ts",
        "components/landing/demo/sesionDemo.ts",
        "lib/comercial/planes.ts"
    ];
    for (const a of archivos) {
        const fuente = fs.readFileSync(path.join(FRONT, a), "utf8")
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "");
        for (const prohibido of [/supabase/i, /\bfetch\s*\(/, /fetchConSesion/, /botApi/, /XMLHttpRequest/, /localStorage/, /\/api\//]) {
            assert.ok(!prohibido.test(fuente), `${a} contiene ${prohibido}`);
        }
    }
});

console.log(`\n${ok} pruebas superadas`);
