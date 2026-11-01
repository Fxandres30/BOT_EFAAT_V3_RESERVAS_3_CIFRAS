// ==========================================================================
// PRUEBAS — mensaje de publicación de sorteos: catálogo de 20 estilos,
// generador único, persistencia al crear y editar (programado, instantáneo
// y en curso), activo/inactivo, eliminar la personalización, sorteos
// antiguos sin texto, preferencia por cuenta (042), aislamiento entre
// clientes, límite de 4.000 caracteres y publicación real simulada.
//
// API HTTP REAL (routes/sorteos.js + exigirUsuario), servicio, publicador,
// «Compartir» (textoParaCompartir + compartirEnGrupos) y sendImage reales.
// Simulados: Supabase (memoria), el socket de WhatsApp y la captura de la
// imagen. No toca la base real ni envía nada.
//
//     node backend/tests/sorteos/mensajesPublicacion.test.js
// ==========================================================================

process.env.SESSIONS_API_TOKEN = "token-servicio-mensajes";
process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const mensajes = require(r("sorteos/mensajes.js"));
const { ESTILOS, plantillaDe } = require(r("sorteos/estilosMensaje.js"));
const { validarSorteo } = require(r("sorteos/validar.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { formatHora12 } = require(r("bot/utils/formatHora.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const PNG = Buffer.from("png-simulado");
const PREFS = "preferencias_mensaje_sorteo";

// ------------------------------------------ referencia: código anterior ---
// Copia literal del generador ANTERIOR a los estilos: un sorteo antiguo
// debe publicar exactamente lo mismo.
const PLANTILLA_ANTERIOR = [
    "🎉 *{{nombre}}* 🎉",
    "🕘 Juega a las {{hora}}",
    "💵 Valor del número: {{valor}}",
    "",
    "🏆 *Premios*",
    "{{premios}}",
    "",
    "💳 *Pagos*",
    "{{cuentas}}",
    "",
    "✍️ Escribe el número que quieres para reservarlo. Reservas hasta las {{hora_cierre}}."
].join("\n");

function generadorAnterior(config, cuentas, { fecha } = {}) {
    const pesos = (v) => `$${Number(v || 0).toLocaleString("es-CO")}`;
    const valores = {
        nombre: config.nombre,
        hora: config.hora_fin ? formatHora12(config.hora_fin) : "",
        hora_cierre: config.hora_cierre ? formatHora12(config.hora_cierre) : "",
        valor: pesos(config.valor),
        premios: (config.premios || []).map(p => `🍀 ${p.nombre}${p.premio ? `: ${pesos(p.premio)}` : ""}`).join("\n"),
        cuentas: cuentas?.length
            ? cuentas.map(c => `• ${c.nombre}: ${c.numero}${c.titular ? ` (${c.titular})` : ""}${c.instrucciones ? ` — ${c.instrucciones}` : ""}`).join("\n")
            : "(sin cuentas de pago configuradas)",
        cantidad: String(config.cantidad_numeros || ""),
        fecha: fecha || ""
    };
    return String(config.mensajes?.publicacion || PLANTILLA_ANTERIOR).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (c, n) =>
        Object.prototype.hasOwnProperty.call(valores, n.toLowerCase()) ? valores[n.toLowerCase()] : c);
}

// ------------------------------------------------------------ escenario ---

const CUENTA_A = { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "Ana", activa: true };
const CUENTA_B = { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3999999999", titular: "Secreta B", activa: true };

function escenario({ con042 = true } = {}) {
    fake = crearFake();
    enviados = [];
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }, { jid: "gb@g.us", nombre: "Grupo B" }];
    t.cuentas_pago = [CUENTA_A, { ...CUENTA_A, id: "cuenta-a2", nombre: "Daviplata A", numero: "3000000002", titular: null }, CUENTA_B];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
    if (con042) t[PREFS] = [];
    else fake.control.tablasInexistentes.add(PREFS);
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        hora_cierre: "22:00",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }, { nombre: "Dos últimas", premio: 50000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        diseno: { origen: "actual" },
        ...extra
    };
}

// Lo que el panel reenvía al editar sin cambiar nada: el config tal cual.
const reenvio = (s, extra = {}) => ({ ...s.config, version: s.version, ...extra });

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-mensajes", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });
const llamar = async (metodo, camino, cuerpo, jwt = "jwt-A") => {
    const res = await fetch(base + camino, { method: metodo, headers: h(jwt), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { status: res.status, json: await res.json() };
};
const get = (c, jwt) => llamar("GET", c, undefined, jwt);
const post = (c, b, jwt) => llamar("POST", c, b, jwt);
const put = (c, b, jwt) => llamar("PUT", c, b, jwt);

const sorteoDb = (id) => fake.tablas.sorteos_programados.find(s => s.id === id);

async function crear(datos, jwt = "jwt-A") {
    const c = await post("", datos, jwt);
    assert.strictEqual(c.status, 201, JSON.stringify(c.json));
    return c.json.data;
}

// ------------------------------------------- publicación (simulada) ---
let enviados = [];
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});
const depsPublicador = () => ({
    supabase: { from: (t) => fake.client.from(t) },
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    capturarImagen: async () => PNG,
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
});
async function programarYPublicar(datos) {
    const s = await crear(datos);
    const conf = await servicio.confirmar(A, s.id, { version: s.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    const vista = await servicio.vistaPrevia(A, s.id);
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: depsPublicador() });
    return { s, vista: vista.data };
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// Datos reales de un sorteo para el catálogo.
const CONFIG = {
    nombre: "Lotería de Medellín", hora_fin: "22:30", hora_cierre: "22:00", valor: 5000, cantidad_numeros: 100,
    premios: [{ nombre: "Premio mayor", premio: 1000000 }, { nombre: "Dos últimas cifras", premio: 200000 }, { nombre: "Bono", premio: null }]
};
const CUENTAS = [{ nombre: "Nequi", numero: "3001234567", titular: "Ana" }, { nombre: "Daviplata", numero: "3107654321" }];
const FECHA = "2026-10-30";

// Máximo realista: 20 premios y 10 cuentas con instrucciones.
const CONFIG_MAX = { ...CONFIG, premios: Array.from({ length: 20 }, (_, i) => ({ nombre: `Premio número ${i + 1} de la noche`, premio: 100000 * (20 - i) })) };
const CUENTAS_MAX = Array.from({ length: 10 }, (_, i) => ({ nombre: `Cuenta ${i + 1}`, numero: `300000000${i}`, titular: "Titular de la cuenta", instrucciones: "Envía el comprobante por este grupo" }));

// ================================================================ catálogo

prueba("C1. Hay 20 estilos con id y nombre únicos, los pedidos y en ese orden", () => {
    assert.strictEqual(ESTILOS.length, 20);
    assert.deepStrictEqual(ESTILOS.map(e => e.nombre), [
        "Clásico EFAAT", "Compacto", "Ficha técnica", "Cartel", "Boleto", "Pregunta y respuesta", "Urgencia", "Premio primero",
        "Comunicado formal", "Citas", "Titular de noticia", "Conversacional", "Pasos", "Tabla con guías", "Minimalista", "Agenda",
        "Tarjetas por sección", "Lista numerada", "Marco ornamental", "Pagos primero"
    ]);
    assert.strictEqual(new Set(ESTILOS.map(e => e.id)).size, 20);
    assert.ok(ESTILOS.every(e => e.descripcion && e.plantilla));
});

prueba("C2. El estilo clásico reproduce EXACTAMENTE el mensaje anterior", () => {
    assert.strictEqual(plantillaDe("clasico"), PLANTILLA_ANTERIOR);
    assert.strictEqual(mensajes.PLANTILLA_PUBLICACION, PLANTILLA_ANTERIOR);
    const nuevo = mensajes.generar(plantillaDe("clasico"), CONFIG, CUENTAS, { fecha: FECHA }).texto;
    assert.strictEqual(nuevo, generadorAnterior(CONFIG, CUENTAS, { fecha: FECHA }));
});

prueba("C3. Composiciones distintas: no solo cambian los emojis (estructura, orden de bloques y separadores)", () => {
    const sinEmojis = (t) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[ \t]+/g, " ");
    const esqueletos = ESTILOS.map(e => sinEmojis(e.plantilla));
    assert.strictEqual(new Set(esqueletos).size, 20, "quitando emojis, las 20 plantillas siguen siendo distintas");
    // Firma estructural: orden de las variables + nº de líneas + marcos.
    const firma = (p) => [
        [...p.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).join(","),
        p.split("\n").length,
        [...new Set(p.match(/[━┌│├└>`▸✦❖❓]|^\d\.|Paso/gm) || [])].sort().join("")
    ].join("|");
    const firmas = ESTILOS.map(e => firma(e.plantilla));
    assert.strictEqual(new Set(firmas).size, 20, `firmas repetidas: ${firmas.filter((f, i) => firmas.indexOf(f) !== i)}`);
    // El primer bloque (lo que se ve primero en WhatsApp) varía.
    const primeras = new Set(ESTILOS.map(e => sinEmojis(e.plantilla.split("\n")[0]).replace(/\{\{\w+\}\}/g, "X").trim()));
    assert.ok(primeras.size >= 14, `solo ${primeras.size} encabezados distintos`);
});

prueba("C4. Los 20 estilos con datos reales: sin variables sin resolver y con todos los datos del sorteo", () => {
    for (const e of ESTILOS) {
        const g = mensajes.generar(e.plantilla, CONFIG, CUENTAS, { fecha: FECHA });
        assert.deepStrictEqual(g.desconocidas, [], e.id);
        assert.ok(!/\{\{|\}\}/.test(g.texto), `${e.id}: variable sin resolver`);
        assert.ok(g.texto.includes("Lotería de Medellín") || g.texto.includes("LOTERÍA DE MEDELLÍN"), `${e.id}: nombre`);
        assert.ok(g.texto.includes("$5.000"), `${e.id}: valor`);
        assert.ok(g.texto.includes("10:30"), `${e.id}: hora del sorteo`);
        assert.ok(g.texto.includes("10:00"), `${e.id}: hora de cierre`);
        assert.ok(g.texto.includes("Premio mayor"), `${e.id}: premios`);
        assert.ok(g.texto.includes("3001234567") && g.texto.includes("3107654321"), `${e.id}: cuentas`);
        assert.ok(g.longitud <= 4000 && !g.excede, `${e.id}: límite`);
    }
});

prueba("C5. Máximo de premios (20) y cuentas (10): los 20 estilos caben en 4.000 caracteres", () => {
    for (const e of ESTILOS) {
        const g = mensajes.generar(e.plantilla, CONFIG_MAX, CUENTAS_MAX, { fecha: FECHA });
        assert.ok(!g.excede, `${e.id}: ${g.longitud} caracteres`);
        assert.ok(g.texto.includes("Premio número 20 de la noche") || g.texto.includes("Premio número 1 de la noche"), e.id);
        assert.ok(!/\{\{/.test(g.texto), e.id);
    }
});

prueba("C6. Variables nuevas: valores correctos", () => {
    const v = (nombre) => mensajes.generar(`{{${nombre}}}`, CONFIG, CUENTAS, { fecha: FECHA }).texto;
    assert.strictEqual(v("fecha_larga"), "viernes 30 de octubre");
    assert.strictEqual(v("fecha_titulo"), "Viernes 30 de octubre");
    assert.strictEqual(v("dia_semana"), "viernes");
    assert.strictEqual(v("rango"), "00 al 99");
    assert.strictEqual(mensajes.generar("{{rango}}", { ...CONFIG, cantidad_numeros: 1000 }, [], {}).texto, "000 al 999");
    assert.strictEqual(v("nombre_mayusculas"), "LOTERÍA DE MEDELLÍN");
    assert.strictEqual(v("premio_mayor"), "Premio mayor de $1.000.000");
    assert.strictEqual(mensajes.generar("{{premio_mayor}}", { ...CONFIG, premios: [{ nombre: "Chico", premio: 10 }, { nombre: "Grande", premio: 99 }] }, [], {}).texto, "Grande de $99");
    assert.strictEqual(v("premios_linea"), "Premio mayor $1.000.000 · Dos últimas cifras $200.000 · Bono");
    assert.strictEqual(v("premios_numerados"), "1. Premio mayor: $1.000.000\n2. Dos últimas cifras: $200.000\n3. Bono");
    assert.strictEqual(v("premios_texto"), "Premio mayor — $1.000.000\nDos últimas cifras — $200.000\nBono");
    assert.ok(/^Premio mayor \.+ \$1\.000\.000$/m.test(v("premios_guias")));
    assert.strictEqual(v("cuentas_compacto"), "Nequi 3001234567 · Daviplata 3107654321");
    assert.strictEqual(mensajes.generar("{{cuentas_compacto}}", CONFIG, [], {}).texto, "(sin cuentas de pago configuradas)");
    // Las de siempre siguen igual.
    assert.strictEqual(v("fecha"), FECHA);
    assert.strictEqual(v("cantidad"), "100");
    // Sin fecha: vacías, nunca "{{...}}".
    assert.strictEqual(mensajes.generar("{{fecha_larga}}|{{dia_semana}}", CONFIG, [], {}).texto, "|");
});

prueba("C7. Marcos: las listas quedan dentro del boleto, de la cita y de la tarjeta", () => {
    const boleto = mensajes.generar(plantillaDe("boleto"), CONFIG, CUENTAS, { fecha: FECHA }).texto;
    assert.ok(boleto.includes("│ 🍀 Premio mayor: $1.000.000\n│ 🍀 Dos últimas cifras: $200.000\n│ 🍀 Bono"));
    assert.ok(boleto.includes("│ • Nequi: 3001234567 (Ana)\n│ • Daviplata: 3107654321"));
    const citas = mensajes.generar(plantillaDe("citas"), CONFIG, CUENTAS, { fecha: FECHA }).texto;
    assert.ok(citas.includes("> 🍀 Premio mayor: $1.000.000\n> 🍀 Dos últimas cifras: $200.000"));
    const tarjetas = mensajes.generar(plantillaDe("tarjetas"), CONFIG, CUENTAS, { fecha: FECHA }).texto;
    assert.ok(tarjetas.includes("   🍀 Premio mayor: $1.000.000\n   🍀 Dos últimas cifras: $200.000"));
    // Un texto con letras antes de la variable no se repite por línea.
    assert.strictEqual(mensajes.generar("Premios: {{premios_texto}}", CONFIG, [], {}).texto.split("\n")[1], "Dos últimas cifras — $200.000");
});

prueba("C8. Mensajes antiguos (sin metadatos) se generan exactamente como antes, incluso con '> {{premios}}'", () => {
    for (const publicacion of ["", "Hola {{nombre}}\n> {{premios}}\n{{cuentas}} {{fecha}} {{cantidad}}", "Sin variables"]) {
        const config = { ...CONFIG, mensajes: { publicacion, aviso_cierre: "" } };
        assert.strictEqual(mensajes.mensajePublicacion(config, CUENTAS, { fecha: FECHA }).texto, generadorAnterior(config, CUENTAS, { fecha: FECHA }), JSON.stringify(publicacion));
    }
    // Recordatorios y aviso de cierre: sistema aparte, sin variables nuevas.
    const rec = mensajes.mensajeRecordatorio(CONFIG, { texto: "{{nombre}} {{rango}}" }, CUENTAS, { fecha: FECHA });
    assert.strictEqual(rec.texto, "Lotería de Medellín {{rango}}");
    assert.strictEqual(mensajes.mensajeAvisoCierre(CONFIG, CUENTAS, {}).texto, "🔒 *Lotería de Medellín* — reservas cerradas. ¡Gracias por participar!");
});

// ============================================================ persistencia

prueba("P1. consolidarMensajes: crear guarda el texto; sin cambios no sube la revisión; cambiar sí; metadatos ausentes se conservan", () => {
    const t1 = new Date("2026-10-01T00:00:00Z");
    const t2 = new Date("2026-10-02T00:00:00Z");
    const creado = mensajes.consolidarMensajes({ publicacion: "", aviso_cierre: "" }, null, { ahora: t1, estiloPorDefecto: "boleto" });
    assert.strictEqual(creado.publicacion, plantillaDe("boleto"), "vacío = plantilla del estilo, GUARDADA");
    assert.deepStrictEqual(creado.publicacion_meta, { estilo: "boleto", activo: true, personalizado: false, revision: 1, actualizado_en: t1.toISOString() });

    const igual = mensajes.consolidarMensajes({ publicacion: creado.publicacion, aviso_cierre: "" }, creado, { ahora: t2 });
    assert.deepStrictEqual(igual.publicacion_meta, creado.publicacion_meta, "sin cambios: misma revisión y fecha");

    const editado = mensajes.consolidarMensajes({ publicacion: "Mío {{nombre}}", aviso_cierre: "" }, creado, { ahora: t2 });
    assert.deepStrictEqual(editado.publicacion_meta, { estilo: "boleto", activo: true, personalizado: true, revision: 2, actualizado_en: t2.toISOString() });

    // Panel antiguo: no envía publicacion_meta -> se conservan estilo y activo.
    const inactivo = { ...editado, publicacion_meta: { ...editado.publicacion_meta, activo: false } };
    const viejo = mensajes.consolidarMensajes({ publicacion: "Mío {{nombre}}", aviso_cierre: "x" }, inactivo, { ahora: t2 });
    assert.strictEqual(viejo.publicacion_meta.activo, false);
    assert.strictEqual(viejo.publicacion_meta.estilo, "boleto");
    assert.strictEqual(viejo.aviso_cierre, "x");

    // Sorteo antiguo ("" sin metadatos) guardado sin tocar: clásico, sin nueva revisión.
    const antiguo = mensajes.consolidarMensajes({ publicacion: "", aviso_cierre: "" }, { publicacion: "", aviso_cierre: "" }, { ahora: t2 });
    assert.strictEqual(antiguo.publicacion, PLANTILLA_ANTERIOR);
    assert.strictEqual(antiguo.publicacion_meta.revision, 1);
});

prueba("P2. Validador: conserva estilo y activo, ignora basura y rechaza variables inexistentes", () => {
    const ok = validarSorteo(entrada({ mensajes: { publicacion: "{{nombre}}", aviso_cierre: "", publicacion_meta: { estilo: "cartel", activo: false, revision: 99, inventado: 1 } } }), { ahora: T0 });
    assert.ok(ok.ok, JSON.stringify(ok.errores));
    assert.deepStrictEqual(ok.config.mensajes.publicacion_meta, { estilo: "cartel", activo: false });
    const basura = validarSorteo(entrada({ mensajes: { publicacion: "", aviso_cierre: "", publicacion_meta: { estilo: "no-existe", activo: "si" } } }), { ahora: T0 });
    assert.strictEqual(basura.config.mensajes.publicacion_meta, undefined);
    const mal = validarSorteo(entrada({ mensajes: { publicacion: "Hola {{inventada}} {{nombre}}", aviso_cierre: "" } }), { ahora: T0 });
    assert.ok(mal.errores.some(e => e.campo === "mensajes" && e.mensaje.includes("{{inventada}}")));
});

prueba("P3. Crear sorteo PROGRAMADO sin escribir texto: se genera y GUARDA el mensaje; al abrirlo no está vacío", async () => {
    escenario();
    const s = await crear(entrada());
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, PLANTILLA_ANTERIOR, "guardado en la base");
    const abierto = await get(`/${s.id}`);
    assert.strictEqual(abierto.json.data.config.mensajes.publicacion, PLANTILLA_ANTERIOR, "el editor recibe el texto completo");
    assert.deepStrictEqual(
        { ...abierto.json.data.config.mensajes.publicacion_meta, actualizado_en: null },
        { estilo: "clasico", activo: true, personalizado: false, revision: 1, actualizado_en: null }
    );
});

prueba("P4. Crear sorteo INSTANTÁNEO con un estilo y texto editado: se guarda tal cual", async () => {
    escenario();
    const texto = `${plantillaDe("boleto")}\n\nPD: ¡suerte!`;
    const s = await crear(entrada({ publicar_en: null, publicacion_inmediata: true, fecha_sorteo: "2026-10-15", mensajes: { publicacion: texto, aviso_cierre: "", publicacion_meta: { estilo: "boleto", activo: true } } }));
    assert.strictEqual(sorteoDb(s.id).config.publicacion_inmediata, true);
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, texto);
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.estilo, "boleto");
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.personalizado, true);
});

prueba("P5. Editar y guardar SIN tocar el texto: se conserva byte a byte (misma revisión y fecha)", async () => {
    escenario();
    const texto = "  *Mi sorteo* {{nombre}}\n\n🍀 {{premios}}\n{{cuentas}}  ";
    const s = await crear(entrada({ mensajes: { publicacion: texto, aviso_cierre: "", publicacion_meta: { estilo: "cartel" } } }));
    const guardado = JSON.stringify(sorteoDb(s.id).config.mensajes);
    servicio._reloj.ahora = () => new Date(T0.getTime() + 60000);
    try {
        const abierto = (await get(`/${s.id}`)).json.data;
        const e = await put(`/${s.id}`, reenvio(abierto));
        assert.strictEqual(e.status, 200, JSON.stringify(e.json));
        assert.strictEqual(JSON.stringify(sorteoDb(s.id).config.mensajes), guardado);
        assert.strictEqual(sorteoDb(s.id).version, 2, "el sorteo sí sube de versión (se editó)");
        // Cambiar OTRO dato (premios) tampoco toca el texto.
        const otra = (await get(`/${s.id}`)).json.data;
        const e2 = await put(`/${s.id}`, reenvio(otra, { premios: [{ nombre: "Otro premio", premio: 1000 }] }));
        assert.strictEqual(e2.status, 200, JSON.stringify(e2.json));
        assert.strictEqual(JSON.stringify(sorteoDb(s.id).config.mensajes), guardado);
    } finally { servicio._reloj.ahora = () => T0; }
});

prueba("P6. Modificar el texto y volver a editar: se recupera exactamente la última versión", async () => {
    escenario();
    const s = await crear(entrada());
    const abierto = (await get(`/${s.id}`)).json.data;
    const nuevo = "🎯 Texto propio de *{{nombre}}*\n{{premios_numerados}}\n{{cuentas_compacto}}\nCierre {{hora_cierre}}";
    const e = await put(`/${s.id}`, reenvio(abierto, { mensajes: { ...abierto.config.mensajes, publicacion: nuevo } }));
    assert.strictEqual(e.status, 200, JSON.stringify(e.json));
    const reabierto = (await get(`/${s.id}`)).json.data;
    assert.strictEqual(reabierto.config.mensajes.publicacion, nuevo);
    assert.strictEqual(reabierto.config.mensajes.publicacion_meta.revision, 2);
    assert.strictEqual(reabierto.config.mensajes.publicacion_meta.personalizado, true);
    // Y la vista previa usa ESE texto con los datos reales.
    const vista = await servicio.vistaPrevia(A, s.id);
    assert.ok(vista.data.publicacion.startsWith("🎯 Texto propio de *Antioqueñita Día*\n1. Premio mayor: $300.000"));
});

prueba("P7. Cambiar de estilo: guarda el estilo nuevo y su texto; restaurar el original = sin personalizar", async () => {
    escenario();
    const s = await crear(entrada());
    let abierto = (await get(`/${s.id}`)).json.data;
    await put(`/${s.id}`, reenvio(abierto, { mensajes: { ...abierto.config.mensajes, publicacion: plantillaDe("agenda"), publicacion_meta: { estilo: "agenda", activo: true } } }));
    abierto = (await get(`/${s.id}`)).json.data;
    assert.strictEqual(abierto.config.mensajes.publicacion, plantillaDe("agenda"));
    assert.deepStrictEqual([abierto.config.mensajes.publicacion_meta.estilo, abierto.config.mensajes.publicacion_meta.personalizado, abierto.config.mensajes.publicacion_meta.revision], ["agenda", false, 2]);
});

prueba("P8. Desactivar y reactivar: el contenido se conserva; la vista previa avisa que se publica solo la imagen", async () => {
    escenario();
    const texto = "Texto que no se pierde {{nombre}}";
    const s = await crear(entrada({ mensajes: { publicacion: texto, aviso_cierre: "" } }));
    let abierto = (await get(`/${s.id}`)).json.data;
    await put(`/${s.id}`, reenvio(abierto, { mensajes: { ...abierto.config.mensajes, publicacion_meta: { estilo: "clasico", activo: false } } }));
    abierto = (await get(`/${s.id}`)).json.data;
    assert.strictEqual(abierto.config.mensajes.publicacion, texto);
    assert.strictEqual(abierto.config.mensajes.publicacion_meta.activo, false);
    assert.strictEqual(abierto.config.mensajes.publicacion_meta.revision, 1, "desactivar no es una nueva versión del texto");
    const vista = await servicio.vistaPrevia(A, s.id);
    assert.strictEqual(vista.data.publicacion_activa, false);
    assert.ok(vista.data.avisos.some(a => /DESACTIVADO.*solo la imagen/.test(a)));
    // Editar con un panel antiguo (sin metadatos) NO lo reactiva.
    await put(`/${s.id}`, reenvio(abierto, { mensajes: { publicacion: texto, aviso_cierre: "" } }));
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.activo, false);
    abierto = (await get(`/${s.id}`)).json.data;
    await put(`/${s.id}`, reenvio(abierto, { mensajes: { ...abierto.config.mensajes, publicacion_meta: { estilo: "clasico", activo: true } } }));
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.activo, true);
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, texto);
});

prueba("P9. Eliminar la personalización: vuelve a la plantilla del estilo y el sorteo NO se elimina", async () => {
    escenario();
    const s = await crear(entrada({ mensajes: { publicacion: "Personal {{nombre}}", aviso_cierre: "", publicacion_meta: { estilo: "pasos" } } }));
    const abierto = (await get(`/${s.id}`)).json.data;
    const e = await put(`/${s.id}`, reenvio(abierto, { mensajes: { ...abierto.config.mensajes, publicacion: "" } }));
    assert.strictEqual(e.status, 200, JSON.stringify(e.json));
    assert.ok(sorteoDb(s.id), "el sorteo sigue existiendo");
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, plantillaDe("pasos"));
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.personalizado, false);
});

prueba("P10. Sorteo ANTIGUO con mensaje vacío: publica lo mismo que antes y al editarlo muestra (y conserva) el clásico", async () => {
    escenario();
    const s = await crear(entrada());
    sorteoDb(s.id).config.mensajes = { publicacion: "", aviso_cierre: "" };  // como se guardaba antes
    const vista = await servicio.vistaPrevia(A, s.id);
    const sd = sorteoDb(s.id);
    assert.strictEqual(vista.data.publicacion, generadorAnterior(sd.config, sd.cuentas_snapshot, { fecha: "2026-10-22" }));
    assert.strictEqual(vista.data.publicacion_activa, true);
    const abierto = (await get(`/${s.id}`)).json.data;
    const e = await put(`/${s.id}`, reenvio(abierto));
    assert.strictEqual(e.status, 200, JSON.stringify(e.json));
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, PLANTILLA_ANTERIOR);
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion_meta.revision, 1);
    const vista2 = await servicio.vistaPrevia(A, s.id);
    assert.strictEqual(vista2.data.publicacion, vista.data.publicacion, "la publicación no cambia ni un carácter");
});

prueba("P11. Variables inexistentes y mensajes que superan 4.000 caracteres: no se guardan", async () => {
    escenario();
    const mal = await post("", entrada({ mensajes: { publicacion: "Hola {{precio}}", aviso_cierre: "" } }));
    assert.strictEqual(mal.status, 400);
    assert.ok(mal.json.errores.some(e => e.campo === "mensajes" && e.mensaje.includes("{{precio}}")));
    // 20 premios de 200 caracteres repetidos en el texto superan el límite YA GENERADOS.
    const largos = Array.from({ length: 20 }, (_, i) => ({ nombre: `${"x".repeat(190)} ${i}`, premio: 1000 }));
    const grande = await post("", entrada({ premios: largos, mensajes: { publicacion: "{{premios}}\n{{premios_texto}}", aviso_cierre: "" } }));
    assert.strictEqual(grande.status, 400, JSON.stringify(grande.json));
    assert.ok(grande.json.errores.some(e => e.campo === "mensajes" && /4000/.test(e.mensaje)));
    assert.strictEqual((fake.tablas.sorteos_programados || []).length, 0, "no se creó nada");
});

// ======================================================= sorteo en curso

async function publicadoEnCurso(datos) {
    const { s } = await programarYPublicar(datos);
    const ev = fake.tablas.eventos_bot.find(e => e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real);
    assert.ok(ev, "evento publicado");
    return { s, ev };
}

prueba("A1. Sorteo EN CURSO: llega el texto real (no vacío), su estilo y estado; editarlo conserva y sube la revisión", async () => {
    escenario();
    const { s, ev } = await publicadoEnCurso(entrada({ mensajes: { publicacion: "", aviso_cierre: "", publicacion_meta: { estilo: "urgencia" } } }));
    let activo = (await get(`/activos/${ev.id}`)).json.data;
    assert.strictEqual(activo.origen, "panel");
    assert.strictEqual(activo.publicacion_texto, plantillaDe("urgencia"));
    assert.deepStrictEqual([activo.publicacion_meta.estilo, activo.publicacion_meta.activo], ["urgencia", true]);
    const baseVista = { premios: activo.premios, hora_cierre: activo.hora_cierre, publicacion: activo.publicacion };
    // Guardar sin cambios: nada que guardar.
    const sin = await put(`/activos/${ev.id}`, { publicacion: activo.publicacion_texto, publicacion_meta: { estilo: "urgencia", activo: true }, base: baseVista });
    assert.strictEqual(sin.status, 200, JSON.stringify(sin.json));
    assert.ok(/No había cambios/.test(sin.json.aviso || ""), JSON.stringify(sin.json));
    // Editar texto + desactivar.
    const nuevo = "Último aviso de {{nombre}}";
    const e = await put(`/activos/${ev.id}`, { publicacion: nuevo, publicacion_meta: { estilo: "urgencia", activo: false }, base: baseVista });
    assert.strictEqual(e.status, 200, JSON.stringify(e.json));
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, nuevo);
    assert.deepStrictEqual([sorteoDb(s.id).config.mensajes.publicacion_meta.activo, sorteoDb(s.id).config.mensajes.publicacion_meta.revision], [false, 2]);
    activo = (await get(`/activos/${ev.id}`)).json.data;
    assert.strictEqual(activo.publicacion_texto, nuevo);
    assert.strictEqual(activo.publicacion_meta.activo, false);
    // Variables inexistentes: rechazado sin tocar nada.
    const antes = JSON.stringify(sorteoDb(s.id).config);
    const mal = await put(`/activos/${ev.id}`, { publicacion: "{{nada}}", base: { ...baseVista, publicacion: nuevo } });
    assert.strictEqual(mal.status, 400);
    assert.strictEqual(JSON.stringify(sorteoDb(s.id).config), antes);
});

// ============================================== publicación (simulada)

prueba("W1. Publicación real simulada: WhatsApp recibe imagen + EXACTAMENTE el texto de la vista previa", async () => {
    escenario();
    const { s, vista } = await programarYPublicar(entrada({ mensajes: { publicacion: "", aviso_cierre: "", publicacion_meta: { estilo: "ficha" } } }));
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].tipo, "imagen");
    assert.strictEqual(enviados[0].texto, vista.publicacion, "lo que se ve en la vista previa es lo que llega");
    assert.ok(enviados[0].texto.startsWith("*FICHA DEL SORTEO*\n```\nLotería : Antioqueñita Día"));
    assert.ok(!/\{\{/.test(enviados[0].texto));
});

prueba("W2. Mensaje INACTIVO: se publica la imagen sin texto y el sorteo queda publicado", async () => {
    escenario();
    const { s } = await programarYPublicar(entrada({ mensajes: { publicacion: "No debe salir {{nombre}}", aviso_cierre: "", publicacion_meta: { estilo: "clasico", activo: false } } }));
    assert.strictEqual(sorteoDb(s.id).estado, "publicado");
    assert.deepStrictEqual(enviados.map(e => [e.tipo, e.texto]), [["imagen", ""]]);
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, "No debe salir {{nombre}}", "el contenido sigue guardado");
    // «Compartir» de ese sorteo: también solo la imagen.
    const ev = fake.tablas.eventos_bot.find(e => e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real);
    const t = await destinos.textoParaCompartir(A, ev);
    assert.deepStrictEqual(t, { texto: "", origen: "sorteo", activo: false });
});

prueba("W3. Sorteo antiguo sin texto publicado: WhatsApp recibe lo mismo que con el código anterior", async () => {
    escenario();
    const s = await crear(entrada());
    sorteoDb(s.id).config.mensajes = { publicacion: "", aviso_cierre: "" };
    const conf = await servicio.confirmar(A, s.id, { version: s.version, confirmacion: true });
    assert.ok(conf.ok);
    await publicador.tick(sock(), { ahora: EN_PUBLICACION, deps: depsPublicador() });
    const ev = fake.tablas.eventos_bot.find(e => e.identidad_evento_real === sorteoDb(s.id).identidad_evento_real);
    const esperado = generadorAnterior({
        nombre: ev.nombre_evento, hora_fin: ev.hora_fin, hora_cierre: ev.hora_cierre, valor: ev.valor, premios: ev.premios, cantidad_numeros: ev.cantidad_numeros
    }, sorteoDb(s.id).cuentas_snapshot, { fecha: "2026-10-22" });
    assert.deepStrictEqual(enviados.map(e => e.texto), [esperado]);
});

// ==================================================== cuenta y aislamiento

prueba("X1. Preferencia por cuenta: A elige «Boleto», sus sorteos nuevos lo usan; B sigue con «Clásico»", async () => {
    escenario();
    const g = await put("/estilos-mensaje/predeterminado", { estilo: "boleto" });
    assert.strictEqual(g.status, 200, JSON.stringify(g.json));
    assert.strictEqual((await get("/estilos-mensaje")).json.data.predeterminado, "boleto");
    assert.strictEqual((await get("/estilos-mensaje", "jwt-B")).json.data.predeterminado, "clasico");
    const sa = await crear(entrada());
    assert.strictEqual(sorteoDb(sa.id).config.mensajes.publicacion_meta.estilo, "boleto");
    assert.strictEqual(sorteoDb(sa.id).config.mensajes.publicacion, plantillaDe("boleto"));
    const sb = await crear(entrada({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"] }), "jwt-B");
    assert.strictEqual(sorteoDb(sb.id).config.mensajes.publicacion_meta.estilo, "clasico");
    // Un estilo elegido en el sorteo manda sobre la preferencia.
    const sc = await crear(entrada({ mensajes: { publicacion: "", aviso_cierre: "", publicacion_meta: { estilo: "citas" } } }));
    assert.strictEqual(sorteoDb(sc.id).config.mensajes.publicacion_meta.estilo, "citas");
    assert.deepStrictEqual(fake.tablas[PREFS].map(p => [p.usuario_id, p.estilo_predeterminado]), [[A, "boleto"]]);
    const mal = await put("/estilos-mensaje/predeterminado", { estilo: "inventado" });
    assert.strictEqual(mal.status, 400);
});

prueba("X2. Aislamiento: A no lee ni usa cuentas, sorteos ni mensajes de B", async () => {
    escenario();
    const sb = await crear(entrada({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"], mensajes: { publicacion: "Secreto de B {{nombre}}", aviso_cierre: "" } }), "jwt-B");
    assert.strictEqual((await get(`/${sb.id}`)).status, 404, "A no abre el sorteo de B");
    const e = await put(`/${sb.id}`, { ...sorteoDb(sb.id).config, version: 1, mensajes: { publicacion: "pisado", aviso_cierre: "" } });
    assert.strictEqual(e.status, 404);
    assert.strictEqual(sorteoDb(sb.id).config.mensajes.publicacion, "Secreto de B {{nombre}}");
    const gen = await post("/mensaje/generar", { estilo: "clasico", datos: { nombre: "X", hora_fin: "22:30", valor: 3000, premios: [{ nombre: "P", premio: 1 }], cuentas: ["cuenta-b1", "cuenta-a1"] } });
    assert.strictEqual(gen.status, 200);
    assert.ok(!gen.json.data.texto.includes("3999999999") && !gen.json.data.texto.includes("Secreta B"), "la cuenta de B no aparece");
    assert.ok(gen.json.data.texto.includes("3000000001"));
});

prueba("X3. Sin la migración 042: catálogo con «Clásico», guardar preferencia = migración pendiente y crear sorteos funciona", async () => {
    escenario({ con042: false });
    const c = await get("/estilos-mensaje");
    assert.strictEqual(c.status, 200);
    assert.deepStrictEqual([c.json.data.predeterminado, c.json.data.preferencias_disponibles], ["clasico", false]);
    const g = await put("/estilos-mensaje/predeterminado", { estilo: "boleto" });
    assert.strictEqual(g.status, 503);
    assert.strictEqual(g.json.motivo, "migracion_pendiente");
    const s = await crear(entrada());
    assert.strictEqual(sorteoDb(s.id).config.mensajes.publicacion, PLANTILLA_ANTERIOR);
});

// ================================================================ API

prueba("G1. GET /estilos-mensaje: 20 estilos con plantilla y ejemplo resuelto; variables y límite", async () => {
    escenario();
    const c = await get("/estilos-mensaje");
    assert.strictEqual(c.status, 200, JSON.stringify(c.json));
    assert.strictEqual(c.json.data.estilos.length, 20);
    assert.ok(c.json.data.estilos.every(e => e.ejemplo && !/\{\{/.test(e.ejemplo)));
    assert.strictEqual(c.json.data.limite, 4000);
    assert.ok(c.json.data.variables.premios_linea && c.json.data.variables.nombre);
    assert.strictEqual((await get("/estilos-mensaje", null)).status, 401, "exige sesión");
});

prueba("G2. POST /mensaje/generar: mismo generador que la publicación; desconocidas y exceso informados", async () => {
    escenario();
    const datos = { nombre: "Antioqueñita Día", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000, premios: [{ nombre: "Premio mayor", premio: 300000 }], fecha_sorteo: "2026-10-22", cuentas: ["cuenta-a1"] };
    const g = await post("/mensaje/generar", { estilo: "agenda", datos });
    assert.strictEqual(g.status, 200, JSON.stringify(g.json));
    const esperado = mensajes.generar(plantillaDe("agenda"), { ...datos, cantidad_numeros: 100 }, [CUENTA_A], { fecha: "2026-10-22" }).texto;
    assert.strictEqual(g.json.data.texto, esperado);
    assert.ok(g.json.data.texto.includes("Jueves 22 de octubre") && g.json.data.texto.includes("00 al 99"));
    const d = await post("/mensaje/generar", { texto: "Hola {{inventada}} {{nombre}}", datos });
    assert.deepStrictEqual(d.json.data.desconocidas, ["inventada"]);
    assert.ok(d.json.data.texto.startsWith("Hola {{inventada}} Antioqueñita Día"));
    const largo = await post("/mensaje/generar", { texto: "{{premios}}".repeat(40), datos: { ...datos, premios: Array.from({ length: 20 }, () => ({ nombre: "y".repeat(150), premio: 1 })) } });
    assert.strictEqual(largo.json.data.excede, true);
    // Sin hora de cierre: se calcula igual que al guardar.
    const sinCierre = await post("/mensaje/generar", { texto: "{{hora_cierre}}", datos: { ...datos, hora_cierre: "" } });
    assert.ok(sinCierre.json.data.texto.length > 0);
});

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/sorteos", require(r("routes/sorteos.js")));
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, "127.0.0.1", res));
    base = `http://127.0.0.1:${server.address().port}/sorteos`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const silencio = {}; for (const m of ["log", "error", "warn", "table", "dir"]) { silencio[m] = console[m]; console[m] = () => {}; }
        try { await fn(); ok++; Object.assign(console, silencio); console.log(`✅ ${n}`); }
        catch (e) { falla++; Object.assign(console, silencio); console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
