// ==========================================================================
// PRUEBAS — programación avanzada de sorteos (panel -> WhatsApp).
//
//   A. Fecha del sorteo distinta de la publicación (la víspera o antes):
//      validación con el INSTANTE del cierre (Colombia), identidad y evento
//      con la fecha del sorteo, publicador y cierre por hora.
//   B. Reinicio opcional de la tabla: nunca por defecto; vista previa con lo
//      que se modificaría; confirmación con la misma huella; solo el cliente
//      del token; bloqueos explicados; migración 030 pendiente.
//   C. Cuentas de pago: obligatorias para programar, solo las propias, solo
//      las seleccionadas en el anuncio y en la vista previa.
//   D. Estilo de la tabla: copia guardada (preset, biblioteca propia, actual),
//      conservada al editar, igual en la vista previa y en la publicación.
//   E. Dos clientes.
//
// Servicio y publicador REALES; Supabase en memoria
// (tests/sorteos/fakeSupabaseSorteos.js) + rpc de reinicio espiado.
//
//     node backend/tests/sorteos/programacionAvanzada.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

let fake = crearFake();

// rpc de la migración 030 (reiniciar_tabla_cliente), configurable por prueba.
const rpc = { llamadas: [], respuesta: null };

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async (nombre, args) => { rpc.llamadas.push({ nombre, args }); return typeof rpc.respuesta === "function" ? rpc.respuesta(args) : rpc.respuesta; }
    }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const repo = require(r("sorteos/repo.js"));
const { validarSorteo } = require(r("sorteos/validar.js"));
const { crearIdentidadEventoReal } = require(r("bot/funciones/eventos/identidadEventoReal.js"));
const { verificarHoraCierre } = require(r("bot/funciones/eventos/lifecycle/verificarHoraCierre.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

// 15/10 10:00 Colombia. Se publica el 15/10 a las 20:00; el sorteo es el 16/10.
const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR_VISPERA = new Date("2026-10-16T01:00:00Z");     // 15/10 20:00 Colombia
const EN_PUBLICACION = new Date("2026-10-16T01:01:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABLA = "5k_15k_reservas_2_cifras";
const DISENO_B = "dddddddd-0000-4000-8000-0000000000bb";
const DISENO_A = "dddddddd-0000-4000-8000-0000000000aa";

const CONFIG_DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: {
        available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" },
        reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" },
        pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
};

function escenario() {
    fake = crearFake();
    rpc.llamadas = [];
    rpc.respuesta = null;
    const t = fake.tablas;
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }];
    t.cuentas_pago = [
        { id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true },
        { id: "cuenta-a2", usuario_id: A, nombre: "Daviplata A", tipo: "daviplata", numero: "3000000009", titular: "A", activa: true },
        { id: "cuenta-b1", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000002", activa: true }
    ];
    t.tabla_disenos = [
        { id: DISENO_A, usuario_id: A, nombre: "Mi oscuro", config: CONFIG_DISENO },
        { id: DISENO_B, usuario_id: B, nombre: "De B", config: CONFIG_DISENO }
    ];
    t.tabla_configuracion_visual = [];
    t.eventos_bot = [];
    t[TABLA] = [
        ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < 3 ? "pagado" : i < 6 ? "reservado" : "libre", identidad_evento_real: i < 6 ? "sorteo-anterior" : null, usuario_id: A })),
        ...Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: B }))
    ];
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Lotería de Manizales",
        hora_fin: "22:30",
        valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR_VISPERA.toISOString(),
        fecha_sorteo: "2026-10-16",
        mensajes: { publicacion: "{{nombre}} {{fecha}} {{cuentas}}", aviso_cierre: "" },
        recordatorios: [],
        ...extra
    };
}

function deps() {
    const enviados = [];
    return {
        enviados,
        d: {
            supabase: { from: (t) => fake.client.from(t) },
            guardarEvento, consultarEvento, abrirGrupo, ejecutarUnaVez, actualizarEvento,
            puedeActuar: () => true,
            sendMessage: async ({ jid, text }) => { enviados.push({ jid, text }); }
        }
    };
}

const sock = (usuarioId) => ({
    context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}`, telefono: "573000000000" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
    groupSettingUpdate: async () => {}
});

// Respuesta de la base para el reinicio (como la función de la 030).
const REINICIO_POSIBLE = (args) => ({
    data: {
        ok: true, aplicado: args.p_aplicar === true, huella: "huella-1", liberables: 6, protegidos: 0,
        archivados: args.p_aplicar ? 6 : undefined,
        por_sorteo: [{ identidad: "sorteo-anterior", nombre_evento: "Manizales 14/10", clase: "liberable", reservados: 3, pagados: 3, otros: 0 }]
    },
    error: null
});

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------------- A ---

prueba("A1. validar: publicar la VÍSPERA es válido; la fecha por defecto es la de la publicación", () => {
    const v = validarSorteo(entrada(), { ahora: T0 });
    assert.deepStrictEqual(v.errores, []);
    assert.strictEqual(v.config.fecha_sorteo, "2026-10-16");
    const mismoDia = validarSorteo(entrada({ fecha_sorteo: undefined, publicar_en: "2026-10-15T15:30:00Z" }), { ahora: T0 });
    assert.strictEqual(mismoDia.config.fecha_sorteo, "2026-10-15", "sin fecha: el día de la publicación (compatible)");
    const lejos = validarSorteo(entrada({ fecha_sorteo: "2026-10-30" }), { ahora: T0 });
    assert.deepStrictEqual(lejos.errores, [], "cualquier fecha futura válida");
});

prueba("A2. validar: la publicación debe ser ANTES del instante de cierre (fecha + hora, Colombia), con mensaje y solución", () => {
    // 15/10 20:00 publicación, sorteo el MISMO 15/10 con cierre 19:00 -> no.
    const tarde = validarSorteo(entrada({ fecha_sorteo: "2026-10-15", hora_fin: "19:04", hora_cierre: "19:00" }), { ahora: T0 });
    const e = tarde.errores.find(x => x.campo === "publicar_en");
    assert.ok(e && /antes del cierre de reservas \(2026-10-15 19:00/.test(e.mensaje) && /Adelanta la publicación o cambia la fecha del sorteo/.test(e.mensaje), JSON.stringify(tarde.errores));
    // Mismo cierre 19:00 pero el sorteo es al día siguiente -> sí (antes no se podía).
    const vispera = validarSorteo(entrada({ hora_fin: "19:04", hora_cierre: "19:00" }), { ahora: T0 });
    assert.deepStrictEqual(vispera.errores, []);
    const antes = validarSorteo(entrada({ fecha_sorteo: "2026-10-14" }), { ahora: T0 });
    assert.ok(antes.errores.some(x => x.campo === "fecha_sorteo" || x.campo === "publicar_en"), "fecha del sorteo anterior a la publicación");
    const pasado = validarSorteo(entrada({ publicar_en: "2026-10-15T14:00:00Z" }), { ahora: T0 });
    assert.ok(pasado.errores.some(x => x.campo === "publicar_en" && /1 minuto en el futuro/.test(x.mensaje)));
    assert.ok(validarSorteo(entrada({ fecha_sorteo: "2026-02-31" }), { ahora: T0 }).errores.some(x => x.campo === "fecha_sorteo"));
});

prueba("A3. sorteo de la víspera: identidad, evento, anuncio y cierre usan la FECHA DEL SORTEO", async () => {
    escenario();
    fake.tablas[TABLA] = fake.tablas[TABLA].map(f => ({ ...f, estado: "libre", identidad_evento_real: null }));
    const c = await servicio.crearSorteo(A, entrada());
    assert.ok(c.ok, JSON.stringify(c));
    const esperada = crearIdentidadEventoReal({ usuario_id: A, nombre_evento: "Lotería de Manizales", hora_fin: "22:30", valor: 5000, fecha_evento: "2026-10-16" });
    assert.strictEqual(c.data.identidad_evento_real, esperada);
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(v.data.fecha_sorteo, "2026-10-16");
    const conf = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
});

prueba("A4. publicador: publica la víspera; evento con fecha 16/10; el cierre por hora no lo cierra el 15/10", async () => {
    escenario();
    fake.tablas[TABLA] = fake.tablas[TABLA].map(f => ({ ...f, estado: "libre", identidad_evento_real: null }));
    const c = await servicio.crearSorteo(A, entrada());
    await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
    const { d, enviados } = deps();
    const log = console.log; console.log = () => {};
    try { await publicador.tick(sock(A), { ahora: EN_PUBLICACION, deps: d }); } finally { console.log = log; }
    const ev = fake.tablas.eventos_bot.find(e => e.grupo_id === "g1@g.us");
    assert.ok(ev, "evento creado");
    assert.strictEqual(String(ev.fecha_evento).slice(0, 10), "2026-10-16");
    assert.ok(enviados.length === 1 && /2026-10-16|16\/10/.test(enviados[0].text), enviados.map(e => e.text).join("|"));
    assert.strictEqual(verificarHoraCierre(ev, new Date("2026-10-16T03:30:00Z")), false, "15/10 22:30 Colombia: aún no");
    assert.strictEqual(verificarHoraCierre(ev, new Date("2026-10-17T03:30:00Z")), true, "16/10 22:30 Colombia: sí");
});

// ------------------------------------------------------------------- B ---

prueba("B1. reinicio NUNCA por defecto: sin elegirlo no se llama a la base y los números de otro sorteo bloquean con la solución", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada());
    assert.strictEqual(c.data.config.tabla.reiniciar, false);
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(rpc.llamadas.length, 0);
    assert.strictEqual(v.data.reinicio, null);
    assert.ok(v.data.bloqueos.some(b => /6 número\(s\) reservados o pagados de otro sorteo/.test(b) && /Reiniciar tabla antes de programar/.test(b)), v.data.bloqueos.join(" | "));
    assert.strictEqual(v.data.puede_confirmar, false);
});

prueba("B2. reinicio elegido: vista previa con qué se modifica y de qué sorteo; la tabla se ve como quedará; no bloquea", async () => {
    escenario();
    rpc.respuesta = REINICIO_POSIBLE;
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.deepStrictEqual(rpc.llamadas.map(l => [l.nombre, l.args.p_usuario, l.args.p_tabla, l.args.p_aplicar]), [["reiniciar_tabla_cliente", A, TABLA, false]]);
    assert.strictEqual(v.data.reinicio.posible, true);
    assert.strictEqual(v.data.reinicio.liberables, 6);
    assert.ok(v.data.reinicio.se_liberarian[0].includes("3 pagado(s), 3 reservado(s)") && v.data.reinicio.se_liberarian[0].includes("Manizales 14/10"));
    assert.deepStrictEqual(v.data.bloqueos, []);
    assert.ok(v.data.avisos.some(a => /se archivarán \(no se borran\)/.test(a)));
    assert.strictEqual(v.data.numeros.numerosOcupados.length, 0, "vista: como quedará tras el reinicio");
    assert.strictEqual(v.data.numeros.numerosDisponibles.length, 100);
});

prueba("B3. reinicio CANCELADO o sin la huella vista: no se programa y la base no escribe nada", async () => {
    escenario();
    rpc.respuesta = REINICIO_POSIBLE;
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    for (const reinicio of [undefined, { confirmado: false, huella: "huella-1" }, { confirmado: true, huella: "otra" }]) {
        const r1 = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true, reinicio });
        assert.strictEqual(r1.motivo, "confirmacion_reinicio_requerida");
    }
    assert.ok(rpc.llamadas.every(l => l.args.p_aplicar === false), "nunca se aplicó");
    assert.strictEqual(fake.tablas.sorteos_programados.find(s => s.id === c.data.id).estado, "borrador");
});

prueba("B4. reinicio CONFIRMADO: la base lo aplica con la huella vista, para el cliente del token y su tabla; queda programado", async () => {
    escenario();
    rpc.respuesta = REINICIO_POSIBLE;
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    const r1 = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true, reinicio: { confirmado: true, huella: "huella-1" } });
    assert.ok(r1.ok, JSON.stringify(r1));
    const aplicada = rpc.llamadas.find(l => l.args.p_aplicar === true);
    assert.deepStrictEqual([aplicada.args.p_usuario, aplicada.args.p_tabla, aplicada.args.p_huella, aplicada.args.p_sorteo], [A, TABLA, "huella-1", c.data.id]);
    assert.strictEqual(aplicada.args.p_liberar_bloqueados, false, "los bloqueados a mano se conservan por defecto");
    assert.strictEqual(r1.data.estado, "programado");
});

prueba("B5. protegidos (sorteo activo, pago en proceso): bloqueado con explicación y sin escribir", async () => {
    escenario();
    rpc.respuesta = () => ({ data: { ok: false, motivo: "protegido", huella: "h", liberables: 2, protegidos: 4, por_sorteo: [
        { identidad: "activo", nombre_evento: "Boyacá hoy", clase: "protegido_activo", reservados: 1, pagados: 2, otros: 0 },
        { identidad: null, nombre_evento: null, clase: "protegido_en_proceso", reservados: 0, pagados: 0, otros: 1 }
    ] }, error: null });
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    const b = v.data.bloqueos.find(x => /No se puede reiniciar la tabla/.test(x));
    assert.ok(b && /del sorteo activo «Boyacá hoy»/.test(b) && /con pago en proceso/.test(b) && /Nada se modificó/.test(b) && /Conservar tabla/.test(b), b);
    const r1 = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true, reinicio: { confirmado: true, huella: "h" } });
    assert.strictEqual(r1.motivo, "bloqueado");
    assert.ok(rpc.llamadas.every(l => l.args.p_aplicar === false));
});

prueba("B6. la tabla cambió entre la vista previa y la confirmación: no se modifica nada", async () => {
    escenario();
    let n = 0;
    rpc.respuesta = (args) => (args.p_aplicar ? { data: { ok: false, motivo: "tabla_cambio", huella: "huella-2", por_sorteo: [] }, error: null } : (n++, REINICIO_POSIBLE(args)));
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    const r1 = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true, reinicio: { confirmado: true, huella: "huella-1" } });
    assert.strictEqual(r1.motivo, "tabla_cambio");
    assert.strictEqual(fake.tablas.sorteos_programados.find(s => s.id === c.data.id).estado, "borrador");
});

prueba("B7. migración 030 sin aplicar: el reinicio no está disponible y se explica cómo seguir", async () => {
    escenario();
    rpc.respuesta = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.ok(v.data.bloqueos.some(b => /falta la migración 030/.test(b) && /Conservar tabla/.test(b)));
});

prueba("B8. bloqueados a mano: se conservan por defecto (se avisa) y solo se liberan eligiéndolo y reiniciando", async () => {
    escenario();
    rpc.respuesta = (args) => ({ data: { ok: true, huella: "huella-1", liberables: 6, conservados: args.p_liberar_bloqueados ? 0 : 2, protegidos: 0, por_sorteo: [
        { identidad: "manizales-1410", nombre_evento: "Manizales 14/10", clase: "liberable", reservados: 3, pagados: 3, otros: 0 },
        ...(args.p_liberar_bloqueados ? [] : [{ identidad: null, nombre_evento: null, clase: "conservado", reservados: 0, pagados: 0, otros: 2 }])
    ] }, error: null });
    const c = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    assert.strictEqual(c.data.config.tabla.liberar_bloqueados, false);
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.strictEqual(rpc.llamadas.at(-1).args.p_liberar_bloqueados, false);
    assert.strictEqual(v.data.reinicio.conservados, 2);
    assert.ok(/2 número\(s\) bloqueados a mano se conservan/.test(v.data.reinicio.se_conservan[0]));
    // Sin reiniciar, la opción no tiene efecto aunque llegue marcada.
    const sin = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: false, liberar_bloqueados: true } }));
    assert.strictEqual(sin.data.config.tabla.liberar_bloqueados, false);
    const con = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true, liberar_bloqueados: true } }));
    const v2 = await servicio.vistaPrevia(A, con.data.id);
    assert.strictEqual(rpc.llamadas.at(-1).args.p_liberar_bloqueados, true);
    assert.strictEqual(v2.data.reinicio.liberar_bloqueados, true);
    const r1 = await servicio.confirmar(A, con.data.id, { version: con.data.version, confirmacion: true, reinicio: { confirmado: true, huella: "huella-1" } });
    assert.ok(r1.ok, JSON.stringify(r1));
    assert.strictEqual(rpc.llamadas.find(l => l.args.p_aplicar === true).args.p_liberar_bloqueados, true);
});

// ------------------------------------------------------------------- C ---

prueba("C1. sin cuentas de pago no se programa (bloqueo con indicación; con cuentas: A3/A4)", async () => {
    escenario();
    fake.tablas[TABLA] = fake.tablas[TABLA].map(f => ({ ...f, estado: "libre", identidad_evento_real: null }));
    const sin = await servicio.crearSorteo(A, entrada({ cuentas: [] }));
    const v = await servicio.vistaPrevia(A, sin.data.id);
    assert.ok(v.data.bloqueos.some(b => /al menos una cuenta de pago/.test(b)));
    assert.strictEqual(v.data.puede_confirmar, false);
});

prueba("C2. solo las cuentas SELECCIONADAS aparecen en la vista previa y en el anuncio; se conservan al editar", async () => {
    escenario();
    fake.tablas[TABLA] = fake.tablas[TABLA].map(f => ({ ...f, estado: "libre", identidad_evento_real: null }));
    const c = await servicio.crearSorteo(A, entrada({ cuentas: ["cuenta-a2"] }));
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.deepStrictEqual(v.data.cuentas.map(x => x.id), ["cuenta-a2"]);
    assert.ok(v.data.publicacion.includes("3000000009") && !v.data.publicacion.includes("3000000001"));
    const e = await servicio.editar(A, c.data.id, { ...entrada({ cuentas: ["cuenta-a2"] }), version: c.data.version });
    assert.deepStrictEqual(e.data.config.cuentas, ["cuenta-a2"]);
});

prueba("C3. una cuenta de OTRO cliente no se acepta; una creada en el formulario queda del cliente del token", async () => {
    escenario();
    const ajena = await servicio.crearSorteo(A, entrada({ cuentas: ["cuenta-b1"] }));
    assert.strictEqual(ajena.motivo, "validacion");
    assert.ok(ajena.errores.some(e => e.campo === "cuentas"));
    const nueva = await servicio.crearCuenta(A, { nombre: "Nueva", tipo: "nequi", numero: "3001234567", usuario_id: B });
    assert.ok(nueva.ok);
    assert.strictEqual(fake.tablas.cuentas_pago.find(x => x.id === nueva.data.id).usuario_id, A);
});

// ------------------------------------------------------------------- D ---

prueba("D1. estilo predefinido: se guarda la copia, se conserva al editar y es el de la vista previa", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada({ diseno: { origen: "preset", nombre: "Oscuro", config: CONFIG_DISENO } }));
    assert.deepStrictEqual(c.data.config.diseno.config, CONFIG_DISENO);
    const e = await servicio.editar(A, c.data.id, { ...entrada({ diseno: c.data.config.diseno }), version: c.data.version });
    assert.deepStrictEqual(e.data.config.diseno, c.data.config.diseno);
    const v = await servicio.vistaPrevia(A, e.data.id);
    assert.deepStrictEqual(v.data.diseno.config, CONFIG_DISENO);
});

prueba("D2. estilo de la biblioteca: solo diseños PROPIOS; uno de otro cliente se rechaza", async () => {
    escenario();
    const propio = await servicio.crearSorteo(A, entrada({ diseno: { origen: "biblioteca", diseno_id: DISENO_A } }));
    assert.ok(propio.ok, JSON.stringify(propio));
    assert.strictEqual(propio.data.config.diseno.nombre, "Mi oscuro");
    const ajeno = await servicio.crearSorteo(A, entrada({ diseno: { origen: "biblioteca", diseno_id: DISENO_B } }));
    assert.strictEqual(ajeno.motivo, "validacion");
    assert.ok(ajeno.errores.some(e => e.campo === "diseno"));
});

prueba("D3. estilo inválido (colores o tamaños fuera de rango) se rechaza; 'actual' copia el diseño activo de esa tabla", async () => {
    escenario();
    const malo = await servicio.crearSorteo(A, entrada({ diseno: { origen: "preset", config: { ...CONFIG_DISENO, theme: { ...CONFIG_DISENO.theme, pageBg: "url(javascript:x)" } } } }));
    assert.strictEqual(malo.motivo, "validacion");
    fake.tablas.tabla_configuracion_visual = [{ usuario_id: A, precio: 5000, config: CONFIG_DISENO, diseno_origen_id: DISENO_A }];
    const actual = await servicio.crearSorteo(A, entrada());
    assert.deepStrictEqual(actual.data.config.diseno.config, CONFIG_DISENO);
    assert.strictEqual(actual.data.config.diseno.origen, "actual");
});

prueba("D4. publicación: NO toca el diseño global de la tabla; la imagen lee el estilo guardado en el sorteo del evento", async () => {
    escenario();
    fake.tablas[TABLA] = fake.tablas[TABLA].map(f => ({ ...f, estado: "libre", identidad_evento_real: null }));
    const c = await servicio.crearSorteo(A, entrada({ diseno: { origen: "preset", nombre: "Oscuro", config: CONFIG_DISENO } }));
    await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
    const antes = JSON.stringify(fake.tablas.tabla_configuracion_visual);
    const { d } = deps();
    const log = console.log; console.log = () => {};
    try { await publicador.tick(sock(A), { ahora: EN_PUBLICACION, deps: d }); } finally { console.log = log; }
    assert.strictEqual(JSON.stringify(fake.tablas.tabla_configuracion_visual), antes, "diseño global intacto");
    const ev = fake.tablas.eventos_bot.find(e => e.grupo_id === "g1@g.us" && e.usuario_id === A);
    assert.ok(ev, "evento creado");
    const leido = await repo.disenoDelEvento(A, ev.id);
    assert.deepStrictEqual(leido.data.config, CONFIG_DISENO, "la imagen usa el estilo del sorteo");
    assert.strictEqual((await repo.disenoDelEvento(B, ev.id)).data, null, "otro cliente no lo obtiene");
});

prueba("D5. vista previa: la tabla usa los MISMOS datos que la imagen (número + libre/ocupado, sin datos personales)", async () => {
    escenario();
    const c = await servicio.crearSorteo(A, entrada());
    const v = await servicio.vistaPrevia(A, c.data.id);
    assert.deepStrictEqual(Object.keys(v.data.numeros).sort(), ["numerosDisponibles", "numerosOcupados"]);
    assert.deepStrictEqual(v.data.numeros.numerosOcupados, ["00", "01", "02", "03", "04", "05"]);
    assert.strictEqual(v.data.numeros.numerosDisponibles.length, 94);
});

// ------------------------------------------------------------------- E ---

prueba("E1. dos clientes: B no ve, no confirma ni reinicia el sorteo de A; su vista previa usa su propia tabla", async () => {
    escenario();
    rpc.respuesta = REINICIO_POSIBLE;
    const deA = await servicio.crearSorteo(A, entrada({ tabla: { reiniciar: true } }));
    assert.strictEqual((await servicio.vistaPrevia(B, deA.data.id)).motivo, "no_encontrado");
    const conf = await servicio.confirmar(B, deA.data.id, { version: deA.data.version, confirmacion: true, reinicio: { confirmado: true, huella: "huella-1" } });
    assert.strictEqual(conf.motivo, "no_encontrado");
    assert.ok(rpc.llamadas.every(l => l.args.p_usuario === A), "el reinicio nunca se pide para otro cliente");
    const deB = await servicio.crearSorteo(B, entrada({ grupos: ["gb@g.us"], cuentas: ["cuenta-b1"] }));
    const vB = await servicio.vistaPrevia(B, deB.data.id);
    assert.deepStrictEqual(vB.data.numeros.numerosOcupados, [], "la cuadrícula de B, no la de A");
});

(async () => {
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        const err = console.error; console.error = () => {};
        try { await fn(); ok++; console.error = err; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.error = err; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
