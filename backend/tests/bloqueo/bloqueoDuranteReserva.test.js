// ==========================================================================
// PRUEBAS — bloqueo hecho MIENTRAS una reserva está en curso (barrera de
// reservarNumeros.js, ver bot/funciones/bloqueo/bloqueoActivo.js).
//
//   Bot (detectarReserva): el número se leyó libre, el administrador bloquea
//   al contacto antes del UPDATE → no se reserva nada y no se responde
//   (null). Por teléfono y por LID.
//   Panel (services/reservaManual.js): prepararReserva ya pasó, el bloqueo
//   llega antes del UPDATE → se rechaza con «contacto_bloqueado» (no con
//   «No se pudo guardar»), queda auditado y la fila sigue libre. Igual en
//   reserva por lote. Contacto ya bloqueado desde el principio: mismo
//   rechazo sin leer la tabla.
//   Aislamiento: un bloqueo de OTRO cliente no frena la reserva.
//   Fail-open documentado: si «bloqueados» no se puede leer, la reserva se
//   hace como siempre (bot y panel).
//
// Funciones REALES; Supabase en memoria (tests/sorteos/fakeSupabaseSorteos);
// sin WhatsApp (espía que falla si se usa).
//
//     node backend/tests/bloqueo/bloqueoDuranteReserva.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(ruta, exportsObj) {
    require.cache[r(ruta)] = { id: r(ruta), filename: r(ruta), loaded: true, exports: exportsObj };
}

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { throw new Error("WhatsApp no debe usarse"); } }));

const { detectarReserva } = require(r("bot/funciones/reservas/detectarReserva.js"));
const reservaManual = require(r("services/reservaManual.js"));
const { olvidarBloqueos } = require(r("bot/funciones/bloqueo/bloqueoActivo.js"));
const { olvidarAutorizacion } = require(r("bot/funciones/grupos/politicaGrupos.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T = "5k_15k_reservas_2_cifras";
const EV = "e0000000-0000-4000-8000-0000000000a1";
const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const MARIA = { id: C1, nombre: "María Pérez", telefono: "3001112233", lid: "111@lid" };
const OPERADOR = { id: A, email: "dueno@a.co" };

const evento = {
    id: EV, usuario_id: A, tabla: T, activo: true, estado: "abierto", valor: "5000", cifras: 2,
    grupo_id: "gA1@g.us", grupo_nombre: "Grupo Uno", identidad_evento_real: "idA", nombre_evento: "Chontico",
    fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", telefono_bot: "573000000000",
    creado_en: "2026-10-22T10:00:00Z"
};

const filaBloqueo = (usuario, extra = {}) => ({ id: `blq-${usuario}`, usuario_id: usuario, telefono: MARIA.telefono, lid: null, jid: null, nombre: "María", activo: true, ...extra });

function sembrar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.fallarTabla = null;
    fake.control.antesDeEscribir = null;
    fake.control.despuesDeLeer = null;
    fake.control.tablasInexistentes.clear();

    fake.tablas[T] = Array.from({ length: 10 }, (_, i) => ({ id: `A-${i}`, usuario_id: A, numero: String(i).padStart(2, "0"), estado: "libre" }));
    fake.tablas.eventos_bot = [{ ...evento }];
    fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "gA1@g.us", activo: true }];
    fake.tablas.usuarios = [{ id: C1, nombre: MARIA.nombre, telefono: MARIA.telefono, lid: MARIA.lid }];
    fake.tablas.contactos_tenant = [{ usuario_id: A, usuario_global_id: C1, ultimo_visto_en: "2026-10-22T09:00:00Z" }];
    fake.tablas.mensajes_grupos_sorteos = [{ usuario_id: C1, grupo_id: "gA1@g.us", grupo_nombre: "Grupo Uno" }];
    fake.tablas.bloqueados = [];
    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];
    fake.tablas.plantillas_mensaje = [];
    fake.tablas.configuracion_seleccion_mensajes = [];

    olvidarBloqueos();
    reservaManual.olvidarDirectorio();
    olvidarAutorizacion();
}

// El administrador bloquea justo después de que se leyó la cuadrícula (es
// decir, con la reserva ya en marcha y antes del UPDATE).
function bloquearAlLeerTabla(fila) {
    let hecho = false;
    fake.control.despuesDeLeer = (tabla) => {
        if (tabla === T && !hecho) { hecho = true; fake.tablas.bloqueados.push(fila); }
    };
}

const fila = (n) => fake.tablas[T].find(f => f.numero === n);
const foto = () => JSON.stringify(fake.tablas[T]);
const auditoria = () => fake.tablas.reservas_auditoria || [];

const reservarPanel = (numero, extra = {}) => reservaManual.reservarManual({
    usuarioId: A, operador: OPERADOR, precio: 5000, numero, contactoId: C1, eventoId: EV, motivo: "Pidió por audio", ...extra
});
const reservarLotePanel = (numeros) => reservaManual.operarLote({
    accion: "reservar", usuarioId: A, operador: OPERADOR, precio: 5000, numeros, contactoId: C1, eventoId: EV, motivo: "Pidió por audio"
});

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------------- bot ---

prueba("bot: bloqueo por teléfono durante la reserva → nada reservado y sin respuesta", async () => {
    sembrar();
    const antes = foto();
    bloquearAlLeerTabla(filaBloqueo(A));
    const reserva = await detectarReserva({ evento, texto: "03 04", usuario: MARIA, lib: null });
    assert.strictEqual(reserva, null, "a un bloqueado no se le responde");
    assert.strictEqual(foto(), antes, "ninguna fila cambió");
    assert.strictEqual(fake.tablas.reservas_actividad.length, 0);
});

prueba("bot: bloqueo por LID (sin teléfono en el bloqueo) durante la reserva → null", async () => {
    sembrar();
    bloquearAlLeerTabla(filaBloqueo(A, { telefono: null, lid: MARIA.lid }));
    const reserva = await detectarReserva({ evento, texto: "03", usuario: MARIA, lib: null });
    assert.strictEqual(reserva, null);
    assert.strictEqual(fila("03").estado, "libre");
});

prueba("bot: la caché de 15 s no tapa un bloqueo nuevo (lectura fresca antes del UPDATE)", async () => {
    sembrar();
    // Primera reserva: llena la caché sin bloqueo.
    const primera = await detectarReserva({ evento, texto: "01", usuario: MARIA, lib: null });
    assert.deepStrictEqual(primera.reservados, ["01"]);
    // Bloqueo inmediatamente después, sin invalidar la caché.
    fake.tablas.bloqueados.push(filaBloqueo(A));
    const segunda = await detectarReserva({ evento, texto: "02", usuario: MARIA, lib: null });
    assert.strictEqual(segunda, null);
    assert.strictEqual(fila("02").estado, "libre");
});

prueba("bot: un bloqueo de OTRO cliente no afecta la reserva", async () => {
    sembrar();
    bloquearAlLeerTabla(filaBloqueo(B));
    const reserva = await detectarReserva({ evento, texto: "03", usuario: MARIA, lib: null });
    assert.deepStrictEqual(reserva.reservados, ["03"]);
    assert.strictEqual(fila("03").usuario_global_id, C1);
});

prueba("bot: fail-open — «bloqueados» ilegible → se reserva como siempre", async () => {
    sembrar();
    fake.tablas.bloqueados.push(filaBloqueo(A));
    fake.control.fallarTabla = "bloqueados";
    const reserva = await detectarReserva({ evento, texto: "03", usuario: MARIA, lib: null });
    assert.deepStrictEqual(reserva.reservados, ["03"]);
    assert.strictEqual(fila("03").estado, "reservado");
});

// ----------------------------------------------------------------- panel ---

prueba("panel: bloqueo durante la reserva → «contacto_bloqueado» (no «No se pudo guardar»), auditado, fila libre", async () => {
    sembrar();
    bloquearAlLeerTabla(filaBloqueo(A));
    const res = await reservarPanel("03");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.motivo, "contacto_bloqueado", JSON.stringify(res));
    assert.ok(/bloqueado/i.test(res.mensaje) && !/No se pudo guardar/.test(res.mensaje), res.mensaje);
    assert.strictEqual(fila("03").estado, "libre");
    const a = auditoria().find(x => x.numero === "03");
    assert.ok(a, "el rechazo queda auditado");
    assert.deepStrictEqual([a.resultado, a.codigo, a.origen], ["rechazado", "contacto_bloqueado", "manual"]);
});

prueba("panel: contacto ya bloqueado → rechazo antes de tocar la tabla", async () => {
    sembrar();
    fake.tablas.bloqueados.push(filaBloqueo(A));
    const antes = foto();
    const res = await reservarPanel("03");
    assert.strictEqual(res.motivo, "contacto_bloqueado");
    assert.strictEqual(foto(), antes);
});

prueba("panel (lote): bloqueo durante la reserva → «contacto_bloqueado», ningún número tocado", async () => {
    sembrar();
    const antes = foto();
    bloquearAlLeerTabla(filaBloqueo(A));
    const res = await reservarLotePanel(["03", "04", "05"]);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.motivo, "contacto_bloqueado", JSON.stringify(res));
    assert.strictEqual(foto(), antes);
    const codigos = auditoria().filter(x => ["03", "04", "05"].includes(x.numero)).map(x => x.codigo);
    assert.deepStrictEqual(codigos, ["contacto_bloqueado", "contacto_bloqueado", "contacto_bloqueado"]);
});

prueba("panel: un bloqueo de OTRO cliente no frena la reserva", async () => {
    sembrar();
    fake.tablas.bloqueados.push(filaBloqueo(B));
    const res = await reservarPanel("03");
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(fila("03").estado, "reservado");
});

prueba("panel: fail-open — «bloqueados» ilegible → se reserva como siempre", async () => {
    sembrar();
    fake.tablas.bloqueados.push(filaBloqueo(A));
    fake.control.fallarTabla = "bloqueados";
    const res = await reservarPanel("03");
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(fila("03").estado, "reservado");
});

prueba("panel: fallo real de escritura sigue diciendo «No se pudo guardar» (no «bloqueado»)", async () => {
    sembrar();
    // Tras leer la fila libre, la tabla deja de responder: falla el UPDATE.
    fake.control.despuesDeLeer = (tabla) => { if (tabla === T) fake.control.fallarTabla = T; };
    const res = await reservarPanel("03");
    fake.control.fallarTabla = null;
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.motivo, "error_guardar", JSON.stringify(res));
});

(async () => {
    let ok = 0;
    const errores = console.error, avisos = console.warn;
    for (const { n, fn } of pruebas) {
        console.error = () => {}; console.warn = () => {};
        try { await fn(); console.error = errores; console.warn = avisos; ok++; console.log(`✔ ${n}`); }
        catch (e) { console.error = errores; console.warn = avisos; console.log(`✘ ${n}\n   ${e.stack}`); }
    }
    console.log(`\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    process.exit(ok === pruebas.length ? 0 : 1);
})();
