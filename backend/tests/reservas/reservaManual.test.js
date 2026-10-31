// ==========================================================================
// PRUEBAS — reserva manual asistida desde el panel (services/reservaManual.js
// + routes/tablas.js) y auditoría (reservas_auditoria, migración 032).
//
// Rutas HTTP REALES (Express + exigirUsuario), servicios REALES del bot
// (reservarNumeros, filtroCliente, politicaGrupos, listarContactos,
// obtenerUsuarioGlobal). Supabase es un doble EN MEMORIA: son simulaciones,
// no tocan ninguna base real. La atomicidad del UPDATE condicionado a
// estado='libre' la simula el doble ejecutando cada consulta de forma
// atómica, como Postgres con una fila bloqueada.
//
//     node backend/tests/reservas/reservaManual.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T = "5k_15k_reservas_2_cifras";

const C1 = "c1c1c1c1-0000-4000-8000-000000000001";      // María (A y B)
const C1D = "c1c1c1c1-0000-4000-8000-0000000000d1";     // duplicado de María (mismo teléfono)
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";      // Juan (A)
const C3 = "c3c3c3c3-0000-4000-8000-000000000003";      // Pedro (solo B)

const EV_A1 = "e0000000-0000-4000-8000-0000000000a1";
const EV_A2 = "e0000000-0000-4000-8000-0000000000a2";
const EV_B1 = "e0000000-0000-4000-8000-0000000000b1";

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);
// Sin WhatsApp en ninguna prueba: si algo intentara enviar, falla.
let envios = 0;
inyectar("services/baileys/send.js", new Proxy({}, { get: () => async () => { envios++; throw new Error("WhatsApp no debe usarse"); } }));

fake.tokens["jwt-A"] = { id: A, email: "dueno@a.co" };
fake.tokens["jwt-B"] = { id: B, email: "dueno@b.co" };

const NUMEROS = Array.from({ length: 10 }, (_, i) => String(i).padStart(2, "0"));

function sembrar() {

    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    fake.control.tablasInexistentes.clear();
    fake.control.fallarTabla = null;

    fake.tablas[T] = [A, B].flatMap(u => NUMEROS.map(numero => ({ id: `${u}-${numero}`, usuario_id: u, numero, estado: "libre" })));

    const filaA = (n) => fake.tablas[T].find(f => f.usuario_id === A && f.numero === n);
    Object.assign(filaA("05"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan Gómez", telefono: "3104445566", contacto: "3104445566", grupo_id: "gA2@g.us", grupo_nombre: "Grupo Dos", evento_id: EV_A2, identidad_evento_real: "idA" });
    Object.assign(filaA("06"), { estado: "pagado", usuario_global_id: C2, comprador: "Juan Gómez", telefono: "3104445566", contacto: "3104445566", evento_id: EV_A2, identidad_evento_real: "idA", fecha_pago: "2026-10-22", hora_pago: "10:00:00" });
    Object.assign(filaA("07"), { estado: "bloqueado", temporal_por: "apartado" });
    Object.assign(filaA("08"), { estado: "en_proceso", temporal_por: "panel", bloqueado_hasta: "2000-01-01T00:00:00Z" });

    const evento = (id, usuario, grupo, nombre, identidad, extra = {}) => ({
        id, usuario_id: usuario, tabla: T, activo: true, estado: "abierto", valor: "5000", cifras: 2,
        grupo_id: grupo, grupo_nombre: nombre, identidad_evento_real: identidad, nombre_evento: "Chontico",
        fecha_evento: "2999-01-01", hora_cierre: "23:59", hora_fin: "23:59", telefono_bot: "573000000000",
        creado_en: "2026-10-22T10:00:00Z", ...extra
    });

    fake.tablas.eventos_bot = [
        evento(EV_A1, A, "gA1@g.us", "Grupo Uno", "idA"),
        evento(EV_A2, A, "gA2@g.us", "Grupo Dos", "idA"),
        evento(EV_B1, B, "gB1@g.us", "Grupo de B", "idB")
    ];

    fake.tablas.grupos_autorizados = [
        { usuario_id: A, grupo_id: "gA1@g.us", activo: true },
        { usuario_id: A, grupo_id: "gA2@g.us", activo: true },
        { usuario_id: B, grupo_id: "gB1@g.us", activo: true }
    ];

    fake.tablas.usuarios = [
        { id: C1, nombre: "María Pérez", telefono: "3001112233", lid: "111@lid" },
        { id: C1D, nombre: "Maria P", telefono: "3001112233", lid: null },
        { id: C2, nombre: "Juan Gómez", telefono: "3104445566", lid: null },
        { id: C3, nombre: "Pedro B", telefono: "3207778899", lid: null }
    ];

    fake.tablas.contactos_tenant = [
        { usuario_id: A, usuario_global_id: C1, ultimo_visto_en: "2026-10-22T09:00:00Z" },
        { usuario_id: A, usuario_global_id: C1D, ultimo_visto_en: "2026-10-01T09:00:00Z" },
        { usuario_id: A, usuario_global_id: C2, ultimo_visto_en: "2026-10-20T09:00:00Z" },
        { usuario_id: B, usuario_global_id: C1, ultimo_visto_en: "2026-10-21T09:00:00Z" },
        { usuario_id: B, usuario_global_id: C3, ultimo_visto_en: "2026-10-21T09:00:00Z" }
    ];

    fake.tablas.mensajes_grupos_sorteos = [
        { usuario_id: C1, grupo_id: "gA1@g.us", grupo_nombre: "Grupo Uno" },
        { usuario_id: C1, grupo_id: "gB1@g.us", grupo_nombre: "Grupo de B" }
    ];

    fake.tablas.reservas_actividad = [];
    fake.tablas.reservas_auditoria = [];

    require("../../services/reservaManual").olvidarDirectorio();
    require("../../bot/funciones/grupos/politicaGrupos").olvidarAutorizacion();

}

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

let base;

function pedir(metodo, camino, { token = "jwt-A", cuerpo, servicio = true } = {}) {
    return new Promise((resolve, reject) => {
        const datos = cuerpo !== undefined ? JSON.stringify(cuerpo) : null;
        const headers = {};
        if (servicio) headers["x-service-token"] = process.env.SESSIONS_API_TOKEN;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (datos) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(datos); }
        const req = http.request(base + camino, { method: metodo, headers }, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        });
        req.on("error", reject);
        if (datos) req.write(datos);
        req.end();
    });
}

const fila = (usuario, numero) => fake.tablas[T].find(f => f.usuario_id === usuario && f.numero === numero);
const filasDe = (usuario) => JSON.stringify(fake.tablas[T].filter(f => f.usuario_id === usuario));
const auditoria = () => fake.tablas.reservas_auditoria || [];
const reservar = (numero, cuerpo, token) => pedir("POST", `/tablas/5000/numeros/${numero}/reservar`, { cuerpo, token });

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------ búsqueda ---

prueba("buscar por nombre (sin tildes): solo contactos de A, sin duplicados, con su grupo de A", async () => {
    sembrar();
    const r = await pedir("GET", "/tablas/contactos/buscar?q=maria");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.contactos.map(c => c.id), [C1], "el duplicado con el mismo teléfono no se repite");
    assert.deepStrictEqual(r.json.contactos[0].grupos, [{ grupoId: "gA1@g.us", grupoNombre: "Grupo Uno" }], "el grupo de B no aparece para A");
    assert.ok(!("lid" in r.json.contactos[0]), "no expone el LID");
});

prueba("buscar por teléfono (parcial y con +57/espacios)", async () => {
    sembrar();
    for (const q of ["300111", "+57 300 111 2233", "3001112233"]) {
        const r = await pedir("GET", `/tablas/contactos/buscar?q=${encodeURIComponent(q)}`);
        assert.deepStrictEqual(r.json.contactos.map(c => c.id), [C1], q);
    }
    const juan = await pedir("GET", "/tablas/contactos/buscar?q=310444");
    assert.deepStrictEqual(juan.json.contactos.map(c => c.id), [C2]);
    assert.deepStrictEqual(juan.json.contactos[0].grupos.map(g => g.grupoId), ["gA2@g.us"], "grupo sacado de su reserva");
});

prueba("contactos de distintos clientes: B no ve a Juan; ve a María solo con el grupo de B", async () => {
    sembrar();
    assert.deepStrictEqual((await pedir("GET", "/tablas/contactos/buscar?q=juan", { token: "jwt-B" })).json.contactos, []);
    const maria = await pedir("GET", "/tablas/contactos/buscar?q=maria", { token: "jwt-B" });
    assert.deepStrictEqual(maria.json.contactos[0].grupos.map(g => g.grupoId), ["gB1@g.us"]);
    assert.deepStrictEqual((await pedir("GET", "/tablas/contactos/buscar?q=pedro")).json.contactos, [], "A no ve a Pedro");
});

prueba("sin sesión o sin token de servicio -> 401/403 y no consulta nada", async () => {
    sembrar();
    assert.strictEqual((await pedir("GET", "/tablas/contactos/buscar?q=maria", { token: null })).status, 401);
    assert.notStrictEqual((await pedir("GET", "/tablas/contactos/buscar?q=maria", { servicio: false })).status, 200);
});

// ------------------------------------------------------------ contexto ---

prueba("contexto de un número libre: acciones, sorteo y los dos grupos del sorteo", async () => {
    sembrar();
    const r = await pedir("GET", "/tablas/5000/numeros/00");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.estado, "libre");
    assert.deepStrictEqual(r.json.acciones, ["reservar"]);
    assert.strictEqual(r.json.sorteo.aceptaReservas, true);
    assert.deepStrictEqual(r.json.contextos.map(c => [c.grupoId, c.autorizado]), [["gA1@g.us", true], ["gA2@g.us", true]]);
    assert.ok(!r.json.contextos.some(c => c.grupoId === "gB1@g.us"));
});

prueba("contexto por estado: reservado/pagado/bloqueado/en proceso vencido", async () => {
    sembrar();
    const acc = async (n) => (await pedir("GET", `/tablas/5000/numeros/${n}`)).json;
    assert.deepStrictEqual((await acc("05")).acciones, ["pagar", "liberar"]);
    assert.deepStrictEqual((await acc("06")).acciones, ["liberar"]);
    assert.deepStrictEqual((await acc("07")).acciones, ["desbloquear"]);
    const vencido = await acc("08");
    assert.strictEqual(vencido.estado, "en_proceso_vencido");
    assert.deepStrictEqual(vencido.acciones, ["desbloquear"]);
});

// ------------------------------------------------------------ reservar ---

prueba("reserva manual correcta: mismo servicio que el bot, grupo elegido y auditoría con operador del token", async () => {
    sembrar();
    const antesB = filasDe(B);
    const r = await reservar("00", {
        contactoId: C1, eventoId: EV_A1, motivo: "El bot no respondió", observaciones: "Pidió por audio",
        solicitudId: "sol-1", usuarioId: B, operador: "hacker", estado: "pagado"
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const f = fila(A, "00");
    assert.strictEqual(f.estado, "reservado", "nunca el estado que manda el navegador");
    assert.strictEqual(f.usuario_global_id, C1);
    assert.strictEqual(f.comprador, "María Pérez");
    assert.strictEqual(f.telefono, "3001112233");
    assert.strictEqual(f.grupo_id, "gA1@g.us");
    assert.strictEqual(f.evento_id, EV_A1);
    assert.strictEqual(f.identidad_evento_real, "idA");
    assert.ok(f.fecha_reserva && f.hora_reserva);
    assert.strictEqual(filasDe(B), antesB, "la cuadrícula de B no cambia aunque el cuerpo diga usuarioId: B");

    const [a] = auditoria();
    assert.strictEqual(auditoria().length, 1);
    assert.strictEqual(a.usuario_id, A);
    assert.strictEqual(a.operador_id, A);
    assert.strictEqual(a.operador_email, "dueno@a.co");
    assert.strictEqual(a.origen, "manual");
    assert.strictEqual(a.accion, "reservar");
    assert.deepStrictEqual([a.estado_anterior, a.estado_nuevo, a.resultado], ["libre", "reservado", "ok"]);
    assert.deepStrictEqual([a.numero, a.contacto_id, a.grupo_id, a.evento_id, a.precio], ["00", C1, "gA1@g.us", EV_A1, 5000]);
    assert.deepStrictEqual([a.motivo, a.observaciones, a.solicitud_id], ["El bot no respondió", "Pidió por audio", "sol-1"]);
    assert.ok(!("creado_en" in a) || a.creado_en, "la fecha la pone la base");

    const act = fake.tablas.reservas_actividad.find(x => x.numero === "00");
    assert.strictEqual(act.realizado_por, "panel:dueno@a.co");
    assert.strictEqual(act.detalle.origen, "manual");
    assert.strictEqual(envios, 0, "no se envió nada por WhatsApp");
});

prueba("número reservado, pagado o bloqueado -> 409 no_disponible, sin cambios y con rechazo auditado", async () => {
    sembrar();
    for (const n of ["05", "06", "07", "08"]) {
        const antes = JSON.stringify(fila(A, n));
        const r = await reservar(n, { contactoId: C1, eventoId: EV_A1, motivo: "prueba" });
        assert.strictEqual(r.status, 409, n);
        assert.strictEqual(r.json.motivo, "no_disponible");
        assert.strictEqual(JSON.stringify(fila(A, n)), antes, `${n} intacto`);
    }
    assert.ok(auditoria().every(a => a.resultado === "rechazado" && a.codigo === "no_disponible" && a.origen === "manual"));
    assert.strictEqual(auditoria().length, 4);
});

prueba("validaciones: motivo, contacto, grupo, formato del número", async () => {
    sembrar();
    assert.strictEqual((await reservar("00", { contactoId: C1, eventoId: EV_A1 })).json.motivo, "falta_motivo");
    assert.strictEqual((await reservar("00", { eventoId: EV_A1, motivo: "x bot" })).json.motivo, "falta_contacto");
    assert.strictEqual((await reservar("00", { contactoId: C1, motivo: "x bot" })).json.motivo, "falta_grupo", "dos grupos: hay que elegir");
    assert.strictEqual((await reservar("00", { contactoId: C1, eventoId: EV_B1, motivo: "x bot" })).json.motivo, "falta_grupo", "evento de B no es un contexto de A");
    assert.strictEqual((await reservar("000", { contactoId: C1, eventoId: EV_A1, motivo: "x bot" })).json.motivo, "numero_invalido");
    assert.strictEqual(fila(A, "00").estado, "libre");
});

prueba("contacto de otro cliente -> 404 y nada cambia", async () => {
    sembrar();
    const r = await reservar("00", { contactoId: C3, eventoId: EV_A1, motivo: "prueba" });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(fila(A, "00").estado, "libre");
});

prueba("sorteo cerrado -> se reserva igual (el estado del sorteo no bloquea); grupo desautorizado -> rechazo", async () => {
    sembrar();
    fake.tablas.eventos_bot.filter(e => e.usuario_id === A).forEach(e => { e.estado = "cerrado"; e.hora_cierre = "00:00"; e.fecha_evento = "2000-01-01"; });
    const cerrado = await reservar("00", { contactoId: C1, eventoId: EV_A1, motivo: "prueba" });
    assert.strictEqual(cerrado.status, 200, JSON.stringify(cerrado.json));
    assert.deepStrictEqual([fila(A, "00").estado, fila(A, "00").evento_id], ["reservado", EV_A1]);
    sembrar();
    fake.tablas.grupos_autorizados.find(g => g.grupo_id === "gA2@g.us").activo = false;
    require("../../bot/funciones/grupos/politicaGrupos").olvidarAutorizacion();
    assert.strictEqual((await reservar("00", { contactoId: C1, eventoId: EV_A2, motivo: "prueba" })).json.motivo, "grupo_no_autorizado");
    assert.strictEqual(fila(A, "00").estado, "libre");
});

prueba("dos intentos simultáneos sobre el mismo número: uno gana, el otro 409", async () => {
    sembrar();
    const [r1, r2] = await Promise.all([
        reservar("01", { contactoId: C1, eventoId: EV_A1, motivo: "simultáneo 1" }),
        reservar("01", { contactoId: C2, eventoId: EV_A2, motivo: "simultáneo 2" })
    ]);
    const estados = [r1.status, r2.status].sort();
    assert.deepStrictEqual(estados, [200, 409], JSON.stringify([r1.json, r2.json]));
    const ganador = r1.status === 200 ? C1 : C2;
    assert.strictEqual(fila(A, "01").usuario_global_id, ganador);
    assert.strictEqual(auditoria().filter(a => a.resultado === "ok").length, 1);
    assert.strictEqual(auditoria().filter(a => a.resultado === "rechazado" && a.codigo === "no_disponible").length, 1);
});

prueba("reintento del mismo envío (respuesta perdida) -> ok idempotente, sin segunda auditoría ok", async () => {
    sembrar();
    const cuerpo = { contactoId: C1, eventoId: EV_A1, motivo: "reintento", solicitudId: "sol-r" };
    assert.strictEqual((await reservar("02", cuerpo)).status, 200);
    const r = await reservar("02", cuerpo);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.idempotente, true);
    assert.strictEqual(auditoria().filter(a => a.resultado === "ok").length, 1);
});

prueba("fallo del backend al guardar -> 500 auditado, el número sigue libre; el reintento funciona", async () => {
    sembrar();
    const fromReal = fake.client.from;
    let fallado = false;
    fake.client.from = (tabla) => {
        const b = fromReal(tabla);
        if (tabla !== T || fallado) return b;
        const updateReal = b.update;
        b.update = (x) => {
            fallado = true;
            updateReal(x);
            b.then = (ok, ko) => Promise.resolve({ data: null, error: { code: "57014", message: "timeout simulado" } }).then(ok, ko);
            return b;
        };
        return b;
    };
    try {
        const r = await reservar("03", { contactoId: C2, eventoId: EV_A2, motivo: "falla", solicitudId: "sol-f" });
        assert.strictEqual(r.status, 500, JSON.stringify(r.json));
        assert.strictEqual(r.json.motivo, "error_guardar");
    } finally {
        fake.client.from = fromReal;
    }
    assert.strictEqual(fila(A, "03").estado, "libre");
    assert.ok(auditoria().some(a => a.resultado === "error" && a.codigo === "error_guardar"));
    const r2 = await reservar("03", { contactoId: C2, eventoId: EV_A2, motivo: "falla", solicitudId: "sol-f" });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(fila(A, "03").usuario_global_id, C2);
});

prueba("sin la migración 032: la reserva funciona igual (auditoría omitida, sin error)", async () => {
    sembrar();
    fake.control.tablasInexistentes.add("reservas_auditoria");
    const r = await reservar("04", { contactoId: C1, eventoId: EV_A1, motivo: "sin 032" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fila(A, "04").estado, "reservado");
    const ctx = await pedir("GET", "/tablas/5000/numeros/04");
    assert.strictEqual(ctx.json.auditoriaDisponible, false);
});

// ------------------------------------------------------- contacto nuevo ---

prueba("contacto nuevo: alta controlada y reserva; teléfono de A reutilizado; de otra cuenta, rechazado", async () => {
    sembrar();
    const r = await reservar("09", { nuevoContacto: { nombre: "Ana Nueva", telefono: "+57 315 000 1122" }, eventoId: EV_A1, motivo: "Cliente nuevo" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const ana = fake.tablas.usuarios.find(u => u.telefono === "3150001122");
    assert.ok(ana, "creada con el teléfono normalizado");
    assert.ok(fake.tablas.contactos_tenant.some(c => c.usuario_id === A && c.usuario_global_id === ana.id && c.origen === "manual_panel"));
    assert.strictEqual(fila(A, "09").usuario_global_id, ana.id);

    const usuariosAntes = fake.tablas.usuarios.length;
    const juan = await reservar("01", { nuevoContacto: { nombre: "Otro nombre", telefono: "3104445566" }, eventoId: EV_A2, motivo: "ya existe" });
    assert.strictEqual(juan.status, 200);
    assert.strictEqual(fila(A, "01").usuario_global_id, C2, "reutiliza el contacto existente de A");
    assert.strictEqual(fake.tablas.usuarios.length, usuariosAntes, "sin duplicados");
    assert.strictEqual(fake.tablas.usuarios.find(u => u.id === C2).nombre, "Juan Gómez", "no pisa el nombre");

    const pedro = await reservar("02", { nuevoContacto: { nombre: "Pedro", telefono: "3207778899" }, eventoId: EV_A1, motivo: "de B" });
    assert.strictEqual(pedro.status, 409);
    assert.strictEqual(pedro.json.motivo, "telefono_no_vinculable");
    assert.ok(!fake.tablas.contactos_tenant.some(c => c.usuario_id === A && c.usuario_global_id === C3), "A no queda vinculado a Pedro");
    assert.ok(!JSON.stringify(pedro.json).includes("Pedro B"), "no expone el nombre que conoce B");

    assert.strictEqual((await reservar("02", { nuevoContacto: { nombre: "X", telefono: "12" }, eventoId: EV_A1, motivo: "mal" })).json.motivo, "telefono_invalido");
});

// ----------------------------------------------------- pagar / liberar ---

prueba("registrar pago: reservado -> pagado con método y observaciones; pagado o libre -> 409", async () => {
    sembrar();
    const r = await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo: { metodoPago: "Nequi", observaciones: "Comprobante 123", solicitudId: "pago-1" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(fila(A, "05").estado, "pagado");
    assert.ok(fila(A, "05").fecha_pago);
    const a = auditoria().find(x => x.accion === "pagar");
    assert.deepStrictEqual([a.metodo_pago, a.observaciones, a.estado_anterior, a.estado_nuevo, a.operador_email], ["Nequi", "Comprobante 123", "reservado", "pagado", "dueno@a.co"]);

    const ctx = await pedir("GET", "/tablas/5000/numeros/05");
    assert.strictEqual(ctx.json.pago.metodoPago, "Nequi");
    assert.strictEqual(ctx.json.historial[0].accion, "pagar");

    const otra = await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo: { metodoPago: "Nequi", solicitudId: "pago-1" } });
    assert.strictEqual(otra.json.idempotente, true, "reintento del mismo pago");
    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/06/pagar", { cuerpo: {} })).status, 409);
    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/00/pagar", { cuerpo: {} })).status, 409);
});

prueba("liberar: exige confirmación; anular un pagado exige motivo; desbloquear un bloqueado", async () => {
    sembrar();
    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/05/liberar", { cuerpo: {} })).json.motivo, "falta_confirmacion");
    assert.strictEqual(fila(A, "05").estado, "reservado");

    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/06/liberar", { cuerpo: { confirmar: true } })).json.motivo, "falta_motivo");
    assert.strictEqual(fila(A, "06").estado, "pagado");

    const anular = await pedir("POST", "/tablas/5000/numeros/06/liberar", { cuerpo: { confirmar: true, motivo: "Pago duplicado devuelto" } });
    assert.strictEqual(anular.status, 200);
    assert.strictEqual(fila(A, "06").estado, "libre");
    assert.strictEqual(fila(A, "06").usuario_global_id, null);

    const desbloquear = await pedir("POST", "/tablas/5000/numeros/07/liberar", { cuerpo: { confirmar: true } });
    assert.strictEqual(desbloquear.json.accion, "desbloquear");
    assert.strictEqual(fila(A, "07").estado, "libre");

    const acciones = auditoria().filter(x => x.resultado === "ok").map(x => [x.numero, x.accion, x.estado_anterior]);
    assert.deepStrictEqual(acciones, [["06", "liberar", "pagado"], ["07", "desbloquear", "bloqueado"]]);
    assert.strictEqual(fake.tablas.reservas_actividad.find(x => x.numero === "06").tipo, "cancelado");
});

prueba("liberar no pisa un cambio concurrente (el estado cambió entre leer y escribir)", async () => {
    sembrar();
    fake.control.despuesDeLeer = (tabla) => {
        // Después de entregar la lectura y antes del UPDATE (otra escritura).
        if (tabla === T) { fake.control.despuesDeLeer = null; queueMicrotask(() => { fila(A, "05").estado = "pagado"; }); }
    };
    const r = await pedir("POST", "/tablas/5000/numeros/05/liberar", { cuerpo: { confirmar: true } });
    fake.control.despuesDeLeer = null;
    assert.strictEqual(r.json.motivo, "estado_cambio");
    assert.strictEqual(fila(A, "05").estado, "pagado", "el pago concurrente se conserva");
});

// --------------------------------------------------- auditoría del bot ---

prueba("reserva automática del bot: auditada con origen 'bot' y sin operador", async () => {
    sembrar();
    const { reservarNumeros } = require("../../bot/funciones/reservas/reservarNumeros");
    const evento = fake.tablas.eventos_bot.find(e => e.id === EV_A1);
    const r = await reservarNumeros({ evento, numeros: ["04"], usuario: { id: C1, nombre: "María Pérez", telefono: "3001112233" }, lib: null });
    assert.strictEqual(r.length, 1);
    const [a] = auditoria();
    assert.deepStrictEqual([a.origen, a.operador_id, a.operador_email, a.accion, a.resultado, a.contacto_id], ["bot", null, null, "reservar", "ok", C1]);
    assert.strictEqual(fake.tablas.reservas_actividad[0].realizado_por, "bot");
});

// --------------------------------------------------------- aislamiento ---

prueba("ninguna operación de A cambia datos de B (cuadrícula, eventos, contactos)", async () => {
    sembrar();
    const instantanea = () => JSON.stringify({
        filas: fake.tablas[T].filter(f => f.usuario_id === B),
        eventos: fake.tablas.eventos_bot.filter(e => e.usuario_id === B),
        contactos: fake.tablas.contactos_tenant.filter(c => c.usuario_id === B)
    });
    const antes = instantanea();
    await reservar("00", { contactoId: C1, eventoId: EV_A1, motivo: "aislamiento" });
    await pedir("POST", "/tablas/5000/numeros/00/pagar", { cuerpo: { metodoPago: "Efectivo" } });
    await pedir("POST", "/tablas/5000/numeros/00/liberar", { cuerpo: { confirmar: true, motivo: "aislamiento" } });
    await pedir("POST", "/tablas/5000/numeros/07/liberar", { cuerpo: { confirmar: true } });
    await reservar("01", { nuevoContacto: { nombre: "Nueva", telefono: "3009990000" }, eventoId: EV_A1, motivo: "aislamiento" });
    assert.strictEqual(instantanea(), antes);
    assert.ok(auditoria().every(a => a.usuario_id === A));
    // Y B, sobre el mismo número, opera solo lo suyo.
    const rB = await reservar("00", { contactoId: C3, eventoId: EV_B1, motivo: "de B" }, "jwt-B");
    assert.strictEqual(rB.status, 200);
    assert.strictEqual(fila(B, "00").usuario_global_id, C3);
    assert.strictEqual(fila(A, "00").estado, "libre");
});

// ------------------------------------------- pagos sin duplicar (UX-F1) ---

prueba("pago: dos POST simultáneos de la MISMA solicitud pagan una vez y ambos responden éxito", async () => {
    sembrar();
    const cuerpo = { metodoPago: "Nequi", solicitudId: "doble-clic-1" };
    const [r1, r2] = await Promise.all([
        pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo }),
        pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo })
    ]);
    assert.deepStrictEqual([r1.status, r2.status], [200, 200], JSON.stringify([r1.json, r2.json]));
    assert.strictEqual(fila(A, "05").estado, "pagado");
    const pagos = auditoria().filter(x => x.accion === "pagar" && x.numero === "05");
    assert.strictEqual(pagos.length, 1, "una sola ejecución auditada: " + JSON.stringify(pagos.map(p => [p.resultado, p.codigo])));
    assert.strictEqual(pagos[0].resultado, "ok");
    assert.strictEqual((fake.tablas.reservas_actividad || []).filter(x => x.numero === "05" && x.tipo === "pagado").length, 1);
});

prueba("pago: reintento de una solicitud ya hecha = idempotente aunque la auditoría no se pueda leer", async () => {
    sembrar();
    const cuerpo = { solicitudId: "reintento-sin-032" };
    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo })).status, 200);
    fake.tablas.reservas_auditoria = [];          // como sin la migración 032
    const otra = await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo });
    assert.strictEqual(otra.status, 200, JSON.stringify(otra.json));
    assert.strictEqual(otra.json.idempotente, true);
    // Regla intacta: OTRA solicitud sobre un número pagado se rechaza.
    const distinta = await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo: { solicitudId: "otra-solicitud" } });
    assert.strictEqual(distinta.status, 409);
    assert.strictEqual(distinta.json.motivo, "no_reservado");
    // Y sin solicitud, igual que siempre.
    assert.strictEqual((await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo: {} })).status, 409);
});

prueba("pago: la solicitud de un cliente no sirve para otro ni para otro número", async () => {
    sembrar();
    Object.assign(fila(A, "04"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan Gómez", telefono: "3104445566", contacto: "3104445566", evento_id: EV_A2, identidad_evento_real: "idA" });
    const cuerpo = { solicitudId: "misma-cadena" };
    await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo });
    const r04 = await pedir("POST", "/tablas/5000/numeros/04/pagar", { cuerpo });
    assert.strictEqual(r04.status, 200);
    assert.ok(!r04.json.idempotente, "04 se paga de verdad");
    assert.strictEqual(fila(A, "04").estado, "pagado");
    const rB = await pedir("POST", "/tablas/5000/numeros/05/pagar", { cuerpo, token: "jwt-B" });
    assert.strictEqual(rB.status, 409, "B no hereda el pago de A");
    assert.strictEqual(fila(B, "05").estado, "libre");
});

prueba("lote de pagos: dos envíos simultáneos del mismo lote escriben una vez", async () => {
    sembrar();
    const cuerpo = { accion: "pagar", numeros: ["05"], solicitudId: "lote-doble-1" };
    const [r1, r2] = await Promise.all([
        pedir("POST", "/tablas/5000/lote", { cuerpo }),
        pedir("POST", "/tablas/5000/lote", { cuerpo })
    ]);
    assert.deepStrictEqual([r1.status, r2.status], [200, 200], JSON.stringify([r1.json, r2.json]));
    // Según llegue el segundo: comparte la ejecución (misma respuesta) o ve el número ya pagado.
    assert.strictEqual(r1.json.hechos + r2.json.hechos, 1, JSON.stringify([r1.json, r2.json]));
    assert.strictEqual(auditoria().filter(x => x.accion === "pagar" && x.numero === "05" && x.resultado === "ok").length, 1);
});

prueba("servicio: llamadas solapadas de la misma solicitud comparten UNA ejecución (pago y lote)", async () => {
    sembrar();
    const servicio = require("../../services/reservaManual");
    const datos = { usuarioId: A, operador: { id: A, email: "dueno@a.co" }, precio: "5000", numero: "05", solicitudId: "solapada-1" };
    const [p1, p2, p3] = await Promise.all([servicio.pagarManual(datos), servicio.pagarManual(datos), servicio.pagarManual(datos)]);
    assert.ok(p1.ok && p2.ok && p3.ok, JSON.stringify([p1, p2, p3]));
    assert.strictEqual(p1, p2, "misma respuesta compartida");
    assert.strictEqual(auditoria().filter(x => x.accion === "pagar" && x.numero === "05").length, 1);

    sembrar();
    const lote = { accion: "pagar", usuarioId: A, operador: { id: A, email: "dueno@a.co" }, precio: "5000", numeros: ["05"], solicitudId: "solapada-lote" };
    const [l1, l2] = await Promise.all([servicio.operarLote(lote), servicio.operarLote(lote)]);
    assert.strictEqual(l1, l2, "misma respuesta compartida");
    assert.strictEqual(l1.hechos, 1);
    assert.strictEqual(auditoria().filter(x => x.accion === "pagar" && x.numero === "05").length, 1);
});

// ------------------------------- reservas independientes de los sorteos ---

const pagar = (numero, cuerpo = {}) => pedir("POST", `/tablas/5000/numeros/${numero}/pagar`, { cuerpo });
const lote = (cuerpo) => pedir("POST", "/tablas/5000/lote", { cuerpo });

prueba("D-reservas 1. con sorteo activo: se vincula al sorteo y grupo elegidos", async () => {
    sembrar();
    const r = await reservar("01", { contactoId: C1, eventoId: EV_A2, motivo: "prueba activo" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const f = fila(A, "01");
    assert.deepStrictEqual([f.estado, f.evento_id, f.identidad_evento_real, f.grupo_id], ["reservado", EV_A2, "idA", "gA2@g.us"]);
    assert.ok(!r.json.sinSorteo);
});

prueba("D-reservas 2. con sorteo activo, el propietario puede elegir reservar sin sorteo", async () => {
    sembrar();
    const r = await reservar("01", { contactoId: C1, sinSorteo: true, motivo: "sin vincular" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.sinSorteo, true);
    const f = fila(A, "01");
    assert.deepStrictEqual([f.estado, f.evento_id, f.identidad_evento_real, f.grupo_id, f.usuario_global_id], ["reservado", null, null, null, C1]);
    assert.strictEqual((await reservar("02", { contactoId: C1, sinSorteo: true, eventoId: EV_A1, motivo: "dos destinos" })).json.motivo, "destino_ambiguo");
});

prueba("D-reservas 3. sin sorteo activo ni programado: la reserva se permite (antes: sin_sorteo)", async () => {
    sembrar();
    fake.tablas.eventos_bot = fake.tablas.eventos_bot.filter(e => e.usuario_id !== A);
    const ctx = await pedir("GET", "/tablas/5000/numeros/03");
    assert.strictEqual(ctx.json.sorteo, null);
    assert.deepStrictEqual(ctx.json.programados, []);
    const r = await reservar("03", { contactoId: C2, motivo: "sin ningún sorteo" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.sinSorteo, true);
    assert.strictEqual(fila(A, "03").estado, "reservado");
    assert.strictEqual(fila(A, "03").usuario_global_id, C2);
    const a = auditoria().find(x => x.numero === "03" && x.resultado === "ok");
    assert.deepStrictEqual([a.evento_id, a.grupo_id, a.origen], [null, null, "manual"]);
});

prueba("D-reservas 4. sin sorteo se conservan las validaciones: disponibilidad, concurrencia, duplicado, formato y contacto", async () => {
    sembrar();
    fake.tablas.eventos_bot = [];
    assert.strictEqual((await reservar("05", { contactoId: C1, motivo: "ocupado" })).json.motivo, "no_disponible", "reservado de otro");
    assert.strictEqual((await reservar("07", { contactoId: C1, motivo: "bloqueado" })).json.motivo, "no_disponible", "bloqueado");
    assert.strictEqual((await reservar("08", { contactoId: C1, motivo: "en proceso" })).json.motivo, "no_disponible", "retención temporal");
    assert.strictEqual((await reservar("000", { contactoId: C1, motivo: "formato" })).json.motivo, "numero_invalido");
    assert.strictEqual((await reservar("04", { motivo: "sin contacto" })).json.motivo, "falta_contacto");
    assert.strictEqual((await reservar("04", { contactoId: C3, motivo: "contacto ajeno" })).status, 404);
    const [r1, r2] = await Promise.all([
        reservar("04", { contactoId: C1, motivo: "simultáneo 1", solicitudId: "x1" }),
        reservar("04", { contactoId: C2, motivo: "simultáneo 2", solicitudId: "x2" })
    ]);
    assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1.json, r2.json]));
    const ganador = r1.status === 200 ? C1 : C2;
    const repetido = await reservar("04", { contactoId: ganador, motivo: "reintento" });
    assert.strictEqual(repetido.json.idempotente, true, "reintento del mismo contacto: no duplica");
    assert.strictEqual(auditoria().filter(x => x.numero === "04" && x.resultado === "ok").length, 1);
});

prueba("D-reservas 5. lote sin sorteo: una solicitud, reserva solo los libres", async () => {
    sembrar();
    fake.tablas.eventos_bot = [];
    const r = await lote({ accion: "reservar", numeros: ["01", "02", "05"], contactoId: C1, motivo: "lote sin sorteo", solicitudId: "lote-ss" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.hechos, r.json.omitidos], [2, 1]);
    assert.deepStrictEqual(["01", "02"].map(n => fila(A, n).estado), ["reservado", "reservado"]);
    assert.strictEqual(fila(A, "05").usuario_global_id, C2, "el ocupado no se tocó");
});

// ------------------------------- pagos independientes del contacto ---

// Reservas con distintos datos de contacto, todas 'reservado' en la cuadrícula de A.
function sembrarPagos() {
    sembrar();
    Object.assign(fila(A, "01"), { estado: "reservado", usuario_global_id: C2, comprador: "Juan", telefono: "3104445566", contacto: "3104445566", lid: null, evento_id: EV_A1, identidad_evento_real: "idA" });
    Object.assign(fila(A, "02"), { estado: "reservado", usuario_global_id: C1, comprador: "Solo LID", telefono: null, contacto: null, lid: "999@lid", evento_id: EV_A1, identidad_evento_real: "idA" });
    Object.assign(fila(A, "03"), { estado: "reservado", usuario_global_id: C2, comprador: "Sin JID", telefono: "3104445566", contacto: "3104445566", lid: null, lib: null, evento_id: EV_A1, identidad_evento_real: "idA" });
    Object.assign(fila(A, "04"), { estado: "reservado", usuario_global_id: null, comprador: "Sin WhatsApp", telefono: null, contacto: null, lid: null, evento_id: EV_A1, identidad_evento_real: "idA" });
    Object.assign(fila(A, "09"), { estado: "reservado" });  // datos incompletos: solo el estado
}

prueba("D-pagos 1-5. con teléfono, sin teléfono, sin JID, sin contacto de WhatsApp y datos incompletos: se registra el pago", async () => {
    sembrarPagos();
    for (const [n, caso] of [["01", "con teléfono"], ["02", "sin teléfono"], ["03", "sin JID"], ["04", "sin contacto WhatsApp"], ["09", "datos incompletos"]]) {
        const antes = { ...fila(A, n) };
        const r = await pagar(n, { metodoPago: "Efectivo", solicitudId: `p-${n}` });
        assert.strictEqual(r.status, 200, `${caso}: ${JSON.stringify(r.json)}`);
        const f = fila(A, n);
        assert.strictEqual(f.estado, "pagado", caso);
        assert.ok(f.fecha_pago && f.hora_pago, caso);
        for (const c of ["comprador", "telefono", "contacto", "lid", "usuario_global_id", "evento_id", "grupo_id"]) {
            assert.strictEqual(f[c] ?? null, antes[c] ?? null, `${caso}: no inventa ni cambia ${c}`);
        }
    }
    assert.strictEqual(envios, 0, "ningún pago toca WhatsApp");
});

prueba("D-pagos 6. lote con contactos incompletos: todos pagados en una solicitud", async () => {
    sembrarPagos();
    const r = await lote({ accion: "pagar", numeros: ["01", "02", "03", "04", "09"], solicitudId: "lote-incompletos", otrosSorteoAutorizados: ["09"] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.hechos, 5, JSON.stringify(r.json.resultados));
    assert.ok(["01", "02", "03", "04", "09"].every(n => fila(A, n).estado === "pagado"));
});

prueba("D-pagos 7. pago parcial y completo: cada número conserva su estado (pendiente/pagado)", async () => {
    sembrar();
    for (const n of ["01", "02", "03"]) Object.assign(fila(A, n), { estado: "reservado", usuario_global_id: C1, comprador: "María", telefono: null, contacto: null, lid: "111@lid", evento_id: EV_A1, identidad_evento_real: "idA" });
    assert.strictEqual((await pagar("01", { solicitudId: "parcial-1" })).status, 200);
    assert.deepStrictEqual(["01", "02", "03"].map(n => fila(A, n).estado), ["pagado", "reservado", "reservado"], "parcial: 1 pagado, 2 pendientes");
    const r = await lote({ accion: "pagar", numeros: ["01", "02", "03"], solicitudId: "completo-1" });
    assert.deepStrictEqual([r.json.hechos, r.json.sinCambio], [2, 1], JSON.stringify(r.json));
    assert.deepStrictEqual(["01", "02", "03"].map(n => fila(A, n).estado), ["pagado", "pagado", "pagado"], "completo");
    assert.strictEqual((await pagar("00", {})).json.motivo, "no_reservado", "un libre nunca pasa a pagado");
});

prueba("D-pagos 8. reserva hecha sin sorteo se puede pagar (uno y lote)", async () => {
    sembrar();
    fake.tablas.eventos_bot = [];
    assert.strictEqual((await reservar("01", { contactoId: C1, motivo: "sin sorteo" })).status, 200);
    assert.strictEqual((await reservar("02", { contactoId: C1, motivo: "sin sorteo" })).status, 200);
    const uno = await pagar("01", { solicitudId: "ss-1" });
    assert.strictEqual(uno.status, 200, JSON.stringify(uno.json));
    assert.strictEqual(fila(A, "01").estado, "pagado");
    const varios = await lote({ accion: "pagar", numeros: ["02"], solicitudId: "ss-lote", otrosSorteoAutorizados: ["02"] });
    assert.strictEqual(varios.json.hechos, 1, JSON.stringify(varios.json));
});

prueba("estático: las rutas sacan cliente y operador del token, nunca del cuerpo", () => {
    const fuente = require("fs").readFileSync(path.join(RAIZ, "routes/tablas.js"), "utf8");
    const bloque = fuente.slice(fuente.indexOf("Intervención MANUAL"));
    assert.ok(!/b\.usuarioId|req\.body\.usuarioId|b\.operador|b\.estado/.test(bloque));
    assert.ok(/usuarioId: req\.usuarioId/.test(bloque));
});

(async () => {
    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); ok++; console.log(`✅ ${n}`); }
        catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.stack); }
    }
    servidor.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
