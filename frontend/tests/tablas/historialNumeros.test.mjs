// ==========================================================================
// PRUEBAS (frontend) — «Historial de números» del panel de tablas:
//   - estado actual (fila de la tabla) separado de los movimientos;
//   - ceros iniciales conservados; nada inventado (datos ausentes = null);
//   - sin auditoría (032 sin aplicar) se usa la actividad registrada; con
//     auditoría, la actividad que la duplica se descarta;
//   - archivo de reinicios (030) como movimiento del número;
//   - búsqueda por número / nombre / contacto y filtros estado/grupo/fecha;
//   - obtenerEventosHistorial: solo SELECT, filtrado por usuario y tabla, y
//     tolera que las tablas no existan;
//   - la sección no consulta Supabase por su cuenta.
//
//     node frontend/tests/tablas/historialNumeros.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

let clienteGlobal = null;

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    const requerir = spec => spec === "@/lib/supabase"
        ? { supabase: new Proxy({}, { get: (_, p) => clienteGlobal[p] }) }
        : require(spec);
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const H = cargarTs(path.join(FRONT, "components/tablas/historialDatos.ts"));
const { obtenerEventosHistorial } = cargarTs(path.join(FRONT, "services/tablas/obtenerHistorial.ts"));

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const TABLA = "reservas_dos_cifras";

const fila = (numero, extra = {}) => ({
    id: Number(numero), numero, estado: "libre", comprador: null, contacto: null, nombre: null, telefono: null, lib: null,
    grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null, usuario_id: U, usuario_global_id: null,
    telefono_bot: null, fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null, temporal_por: null,
    bloqueado_hasta: null, ip_reserva: null, contacto_lower: null, creado_en: "2026-10-01T00:00:00Z", ...extra
});

const NUMEROS = [
    fila("00"),
    fila("07", { estado: "reservado", comprador: "Ana Pérez", telefono: "573001112233", grupo_nombre: "Sorteos Ana", nombre_evento: "Chance", fecha_reserva: "2026-10-22", hora_reserva: "14:05:09" }),
    fila("12", { estado: "pagado", nombre: "Beto", contacto: "Beto WA", grupo_nombre: "Grupo B", fecha_reserva: "2026-10-21", hora_reserva: "09:00:00", fecha_pago: "2026-10-21", hora_pago: "10:30:00" }),
    fila("33"),
    fila("45")
];

const act = (id, numero, tipo, creado_en, realizado_por, detalle = {}) => ({ id, usuario_id: U, tabla: TABLA, numero, evento_id: null, tipo, detalle, realizado_por, creado_en });

const ACTIVIDAD = [
    act("a1", "07", "reservado", "2026-10-22T19:05:09Z", "bot", { comprador: "Ana Pérez", contacto: "573001112233", grupo_nombre: "Sorteos Ana" }),
    act("a2", "12", "pagado", "2026-10-21T15:30:00Z", "57300@s.whatsapp.net", { comprador: "Beto", confirmado_via: "sticker_admin" }),
    act("a3", "33", "liberado", "2026-10-20T12:00:00Z", "bot:vencimiento", { motivo: "vencimiento", minutos: 30, comprador: "Caro" }),
    act("a4", "45", "cancelado", "2026-10-19T12:00:00Z", "panel:op@efaat.com", { estadoAnterior: "pagado", comprador: "Dani", origen: "manual" }),
    act("a5", null, "tabla_reiniciada", "2026-10-18T12:00:00Z", "panel", {})
];

const AUDITORIA = [
    { id: "x1", origen: "bot", accion: "reservar", numero: "07", grupo_nombre: "Sorteos Ana", contacto_nombre: "Ana Pérez", contacto_telefono: "573001112233",
      estado_anterior: "libre", estado_nuevo: "reservado", motivo: null, observaciones: null, metodo_pago: null, resultado: "ok", codigo: null, operador_email: null, creado_en: "2026-10-22T19:05:09Z" },
    { id: "x2", origen: "manual", accion: "liberar", numero: "45", grupo_nombre: null, contacto_nombre: "Dani", contacto_telefono: null,
      estado_anterior: "pagado", estado_nuevo: "libre", motivo: "Pago duplicado", observaciones: null, metodo_pago: null, resultado: "ok", codigo: null, operador_email: "op@efaat.com", creado_en: "2026-10-19T12:00:00Z" },
    { id: "x3", origen: "manual", accion: "reservar", numero: "33", grupo_nombre: null, contacto_nombre: null, contacto_telefono: null,
      estado_anterior: "reservado", estado_nuevo: null, motivo: "x", observaciones: null, metodo_pago: null, resultado: "rechazado", codigo: "no_disponible", operador_email: "op@efaat.com", creado_en: "2026-10-20T11:00:00Z" }
];

const ARCHIVO = [
    { id: "r1", numero: "07", estado: "pagado", nombre_evento: "Sorteo anterior", motivo: "reinicio_programacion", archivado_en: "2026-10-15T05:00:00Z",
      fila: { comprador: "Eva", telefono: "573009998877", grupo_nombre: "Sorteos Ana", fecha_reserva: "2026-10-14", hora_reserva: "20:00:00", fecha_pago: "2026-10-14", hora_pago: "21:00:00" } }
];

const estadoReal = n => n.estado;
const sinAuditoria = { auditoria: [], auditoriaDisponible: false, actividad: ACTIVIDAD, archivo: [] };
const conAuditoria = { auditoria: AUDITORIA, auditoriaDisponible: true, actividad: ACTIVIDAD, archivo: ARCHIVO };

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("estado actual: ceros conservados, datos reales de la fila y libres sin movimientos fuera", () => {
    const filas = H.construirHistorial(NUMEROS, sinAuditoria, estadoReal);
    assert.deepStrictEqual(filas.map(f => f.numero), ["07", "12", "33", "45"]);
    const f07 = filas[0];
    assert.strictEqual(f07.cliente, "Ana Pérez");
    assert.strictEqual(f07.contacto, "573001112233");
    assert.strictEqual(f07.grupo, "Sorteos Ana");
    assert.deepStrictEqual(f07.reserva, { fecha: "2026-10-22", hora: "14:05:09" });
    assert.strictEqual(f07.pago, null);
    // Nombre/contacto alternativos (nombre, contacto) cuando faltan comprador/teléfono.
    assert.strictEqual(filas[1].cliente, "Beto");
    assert.strictEqual(filas[1].contacto, "Beto WA");
});

prueba("un número libre con movimientos no hereda datos de la reserva anterior", () => {
    const f33 = H.construirHistorial(NUMEROS, sinAuditoria, estadoReal).find(f => f.numero === "33");
    assert.strictEqual(f33.estado, "libre");
    assert.strictEqual(f33.cliente, null);
    assert.strictEqual(f33.reserva, null);
    assert.strictEqual(f33.eventos[0].cliente, "Caro");
    assert.deepStrictEqual(f33.eventos[0].detalles, ["Venció tras 30 min sin pago"]);
    assert.strictEqual(f33.eventos[0].origen, "automático · reserva vencida");
});

prueba("sin auditoría: toda la actividad por número, nada de eventos sin número", () => {
    const filas = H.construirHistorial(NUMEROS, sinAuditoria, estadoReal);
    const todos = filas.flatMap(f => f.eventos);
    assert.strictEqual(todos.length, 4);
    assert.ok(todos.every(e => e.fuente === "actividad"));
    const pago = filas.find(f => f.numero === "12").eventos[0];
    assert.strictEqual(pago.origen, "sticker del administrador");
});

prueba("con auditoría: se descarta la actividad duplicada, se conserva la no auditada", () => {
    const filas = H.construirHistorial(NUMEROS, conAuditoria, estadoReal);
    const ev = n => filas.find(f => f.numero === n).eventos.map(e => `${e.fuente}:${e.titulo}`);
    assert.deepStrictEqual(ev("07"), ["auditoria:Reserva", "archivo:Archivado al reiniciar la tabla"]);
    assert.deepStrictEqual(ev("12"), ["actividad:Pago registrado"]);       // sticker: no auditado
    assert.deepStrictEqual(ev("33"), ["actividad:Liberación", "auditoria:Reserva"]); // vencimiento + intento rechazado
    assert.deepStrictEqual(ev("45"), ["auditoria:Liberación"]);            // panel: solo auditoría
});

prueba("auditoría: estados, operador, motivo y rechazos tal como se registraron", () => {
    const filas = H.construirHistorial(NUMEROS, conAuditoria, estadoReal);
    const lib = filas.find(f => f.numero === "45").eventos[0];
    assert.strictEqual(lib.origen, "panel · op@efaat.com");
    assert.strictEqual(lib.estadoAnterior, "pagado");
    assert.strictEqual(lib.estadoNuevo, "libre");
    assert.deepStrictEqual(lib.detalles, ["Motivo: Pago duplicado"]);
    const rech = filas.find(f => f.numero === "33").eventos.find(e => e.fuente === "auditoria");
    assert.strictEqual(rech.resultado, "rechazado");
    assert.ok(rech.detalles.includes("Código: no_disponible"));
});

prueba("archivo: el ciclo anterior queda como movimiento, con sus datos reales", () => {
    const arch = H.construirHistorial(NUMEROS, conAuditoria, estadoReal).find(f => f.numero === "07").eventos[1];
    assert.strictEqual(arch.cliente, "Eva");
    assert.strictEqual(arch.estadoAnterior, "pagado");
    assert.deepStrictEqual(arch.detalles, ["Sorteo: Sorteo anterior", "Reservado el 2026-10-14 20:00:00", "Pagado el 2026-10-14 21:00:00"]);
});

prueba("eventos ordenados del más reciente al más antiguo", () => {
    for (const f of H.construirHistorial(NUMEROS, conAuditoria, estadoReal)) {
        const ens = f.eventos.map(e => e.en);
        assert.deepStrictEqual(ens, [...ens].sort().reverse());
    }
});

const FILAS = H.construirHistorial(NUMEROS, conAuditoria, estadoReal);
const filtrar = parcial => H.filtrarHistorial(FILAS, { ...H.FILTROS_HISTORIAL_VACIOS, ...parcial }).map(f => f.numero);

prueba("búsqueda por número: exacta con ceros, «7» encuentra «07»", () => {
    assert.deepStrictEqual(filtrar({ texto: "07" }), ["07"]);
    assert.deepStrictEqual(filtrar({ texto: "7" }), ["07"]);
    assert.deepStrictEqual(filtrar({ texto: "45" }), ["45"]);
});

prueba("búsqueda por nombre (sin tildes) y por contacto (también de movimientos)", () => {
    assert.deepStrictEqual(filtrar({ texto: "perez" }), ["07"]);
    assert.deepStrictEqual(filtrar({ texto: "eva" }), ["07"]);          // cliente del ciclo archivado
    assert.deepStrictEqual(filtrar({ texto: "300 111 2233" }), ["07"]); // teléfono completo con espacios
    assert.deepStrictEqual(filtrar({ texto: "300 111" }), []);          // un trozo de teléfono no basta
    assert.deepStrictEqual(filtrar({ texto: "beto wa" }), ["12"]);
    assert.deepStrictEqual(filtrar({ texto: "nadie" }), []);
});

prueba("filtros por estado, grupo y fecha (Colombia)", () => {
    assert.deepStrictEqual(filtrar({ estado: "pagado" }), ["12"]);
    assert.deepStrictEqual(filtrar({ estado: "libre" }), ["33", "45"]);
    assert.deepStrictEqual(filtrar({ grupo: "Grupo B" }), ["12"]);
    assert.deepStrictEqual(filtrar({ fecha: "2026-10-21" }), ["12"]);
    // 2026-10-15T05:00Z = 15/10 a las 00:00 en Bogotá (archivo del 07).
    assert.deepStrictEqual(filtrar({ fecha: "2026-10-15" }), ["07"]);
    assert.deepStrictEqual(filtrar({ estado: "reservado", grupo: "Grupo B" }), []);
    assert.deepStrictEqual(H.gruposDelHistorial(FILAS), ["Grupo B", "Sorteos Ana"]);
});

// Cliente de Supabase simulado para obtenerEventosHistorial.
function crearCliente({ faltan = [] } = {}) {
    const consultas = [];
    return {
        consultas,
        from(tabla) {
            const q = { tabla, ops: [], filtros: [] };
            consultas.push(q);
            const b = {
                select(c) { q.ops.push("select"); q.columnas = c; return b; },
                eq(c, v) { q.filtros.push([c, v]); return b; },
                order() { return b; },
                limit() { return b; },
                then(ok, ko) {
                    const r = faltan.includes(tabla)
                        ? { data: null, error: { message: `relation "public.${tabla}" does not exist` } }
                        : { data: [{ id: tabla }], error: null };
                    return Promise.resolve(r).then(ok, ko);
                }
            };
            for (const w of ["insert", "update", "upsert", "delete"]) b[w] = () => { q.ops.push(w); return b; };
            return b;
        }
    };
}

prueba("obtenerEventosHistorial: solo lee, filtra por usuario y tabla", async () => {
    clienteGlobal = crearCliente();
    const r = await obtenerEventosHistorial(TABLA, U);
    assert.strictEqual(r.auditoriaDisponible, true);
    assert.deepStrictEqual(clienteGlobal.consultas.map(q => q.tabla).sort(), ["reservas_archivo", "reservas_auditoria"]);
    for (const q of clienteGlobal.consultas) {
        assert.deepStrictEqual(q.ops, ["select"]);
        assert.deepStrictEqual(q.filtros, [["usuario_id", U], ["tabla", TABLA]]);
    }
    assert.ok(!/operador_id|solicitud_id|\berror\b/.test(clienteGlobal.consultas.find(q => q.tabla === "reservas_auditoria").columnas));
});

prueba("obtenerEventosHistorial: sin 032/030 aplicadas devuelve vacío y auditoría no disponible", async () => {
    clienteGlobal = crearCliente({ faltan: ["reservas_auditoria", "reservas_archivo"] });
    const avisar = console.warn;
    console.warn = () => {};
    const r = await obtenerEventosHistorial(TABLA, U);
    console.warn = avisar;
    assert.deepStrictEqual(r, { auditoria: [], auditoriaDisponible: false, archivo: [] });
});

prueba("la sección no consulta Supabase ni escribe: recibe los datos de useTablaPrecio", () => {
    const src = fs.readFileSync(path.join(FRONT, "components/tablas/HistorialNumeros.tsx"), "utf8");
    assert.ok(!/supabase|\.from\(|fetch\(/.test(src));
    assert.ok(!/onMarcarPagado|onLiberar|onReservar/.test(src), "el historial es de solo lectura");
});

// ---- Búsqueda única: la misma consulta filtra historial y cuadrícula ----

const coinc = parcial => {
    const r = H.numerosCoincidentes(NUMEROS, FILAS, { ...H.FILTROS_HISTORIAL_VACIOS, ...parcial }, estadoReal);
    return r && [...r].sort();
};

prueba("cuadrícula: sin filtros -> null (se ven todos); limpiar restaura null", () => {
    assert.strictEqual(coinc({}), null);
    assert.strictEqual(coinc({ texto: "   " }), null);
    assert.deepStrictEqual(coinc({ texto: "07" }), ["07"]);
    assert.strictEqual(H.numerosCoincidentes(NUMEROS, FILAS, H.FILTROS_HISTORIAL_VACIOS, estadoReal), null);
});

prueba("cuadrícula e historial dan el mismo resultado para la misma consulta", () => {
    for (const q of [{ texto: "7" }, { texto: "perez" }, { texto: "300 111" }, { estado: "pagado" }, { grupo: "Grupo B" }, { fecha: "2026-10-21" }, { texto: "eva", grupo: "Sorteos Ana" }]) {
        assert.deepStrictEqual(coinc(q), filtrar(q), JSON.stringify(q));
    }
});

prueba("cuadrícula: el filtro de estado incluye números libres sin historial", () => {
    // 00 está libre y sin movimientos: no sale en el historial, sí en la cuadrícula.
    assert.deepStrictEqual(coinc({ estado: "libre" }), ["00", "33", "45"]);
    assert.deepStrictEqual(filtrar({ estado: "libre" }), ["33", "45"]);
    // «0» es el número 00 sin su cero inicial (nunca un trozo de teléfono).
    assert.deepStrictEqual(coinc({ texto: "0" }), ["00"]);
});

prueba("el filtro de estado no recorta los movimientos de un número", () => {
    const [f45] = H.filtrarHistorial(FILAS, { ...H.FILTROS_HISTORIAL_VACIOS, estado: "libre", texto: "45" });
    const completo = FILAS.find(f => f.numero === "45");
    assert.deepStrictEqual(f45.eventos, completo.eventos);
    // Un número antes pagado y hoy libre aparece con «todos» (no se pierde).
    assert.ok(filtrar({ texto: "dani" }).includes("45"));
    assert.ok(!filtrar({ texto: "dani", estado: "pagado" }).includes("45"));
});

prueba("aislamiento: la cuadrícula solo devuelve números de la tabla recibida", () => {
    const otraTabla = H.construirHistorial([fila("99", { estado: "pagado", comprador: "Ana Pérez" })], sinAuditoria, estadoReal);
    const r = H.numerosCoincidentes(NUMEROS, otraTabla, { ...H.FILTROS_HISTORIAL_VACIOS, texto: "ana" }, estadoReal);
    assert.ok(!r.has("99"));
});

prueba("un solo buscador: sin FiltrosBar, la cuadrícula no filtra por su cuenta y el estado vive en la vista", () => {
    const leer = r => fs.readFileSync(path.join(FRONT, r), "utf8");
    assert.ok(!fs.existsSync(path.join(FRONT, "components/tablas/FiltrosBar.tsx")));
    const vista = leer("components/tablas/TablaPrecioView.tsx");
    assert.ok(!/FiltrosBar|busqueda/.test(vista));
    assert.strictEqual((vista.match(/useState<FiltrosHistorial>/g) || []).length, 1);
    assert.ok(/coincidentes=\{coincidentes\}/.test(vista) && /filtros=\{filtros\}/.test(vista) && /onFiltrosChange=\{setFiltros\}/.test(vista));
    const grid = leer("components/tablas/Grid.tsx");
    assert.ok(!/busqueda|toLowerCase|includes\(termino/.test(grid), "Grid no debe tener búsqueda propia");
    const hist = leer("components/tablas/HistorialNumeros.tsx");
    assert.ok(!/useState<FiltrosHistorial>/.test(hist), "el historial no guarda una búsqueda propia");
    assert.strictEqual((hist.match(/type="search"/g) || []).length, 1);
    // El buscador va antes de los filtros de estado, grupo y fecha.
    const pos = ['type="search"', "Filtrar por estado actual", "Filtrar por grupo", "Filtrar por fecha"].map(t => hist.indexOf(t));
    assert.ok(pos.every(p => p > 0));
    assert.deepStrictEqual([...pos].sort((a, b) => a - b), pos);
});

prueba("fila: muestra la hora ORIGINAL de reserva (no la del pago), sin convertir zona horaria", () => {
    const f12 = FILAS.find(f => f.numero === "12");   // reservado 09:00:00, pagado 10:30:00
    assert.strictEqual(H.etiquetaReserva(f12.reserva), "Reserva: 2026-10-21 09:00");
    const f07 = FILAS.find(f => f.numero === "07");   // 14:05:09 hora de Colombia, tal cual
    assert.strictEqual(H.etiquetaReserva(f07.reserva), "Reserva: 2026-10-22 14:05");
    // Movimientos posteriores (archivo, auditoría) no cambian la hora de reserva.
    assert.ok(f07.eventos.length > 0);
    assert.strictEqual(H.etiquetaReserva({ fecha: "2026-10-22", hora: "5:07:00" }), "Reserva: 2026-10-22 05:07");
});

prueba("fila: sin hora registrada -> «Hora no registrada»; sin reserva actual -> nada", () => {
    assert.strictEqual(H.etiquetaReserva({ fecha: "2026-10-22", hora: null }), "Reserva: 2026-10-22 · Hora no registrada");
    assert.strictEqual(H.etiquetaReserva({ fecha: "2026-10-22", hora: "" }), "Reserva: 2026-10-22 · Hora no registrada");
    assert.strictEqual(H.etiquetaReserva(FILAS.find(f => f.numero === "33").reserva), null);
    const src = fs.readFileSync(path.join(FRONT, "components/tablas/HistorialNumeros.tsx"), "utf8");
    assert.ok(/\{etiquetaReserva\(fila\.reserva\) \|\| ""\}/.test(src), "la fila usa la hora de reserva");
    assert.ok(!/etiquetaReserva\(fila\.pago\)/.test(src));
});

// ---- Teléfono, contacto e identidad (caso «3113731880») ----------------

const MAMA = "m-0000-mama", LUIS = "l-0000-luis", PEDRO = "p-0000-pedro";
const TEL = "3113731880";

const NUMS_MAMA = [
    // Reserva actual con su teléfono (formato canónico de usuarios.telefono).
    fila("14", { estado: "reservado", comprador: "Mamá", contacto: TEL, telefono: TEL, usuario_global_id: MAMA, grupo_nombre: "Rifas" }),
    // Reservada cuando su identidad solo tenía LID: la fila no tiene teléfono.
    fila("23", { estado: "pagado", comprador: "Mamá", contacto: "204899612345678@lid", telefono: "204899612345678@lid", usuario_global_id: MAMA, fecha_pago: "2026-10-20" }),
    // JID con prefijo 57 y dispositivo.
    fila("31", { estado: "en_proceso", comprador: "Mamá", contacto: "573113731880:12@s.whatsapp.net", telefono: null, usuario_global_id: MAMA }),
    // Otras personas con teléfono o LID parecidos.
    fila("40", { estado: "reservado", comprador: "Luis", contacto: "3113731881", telefono: "3113731881", usuario_global_id: LUIS }),
    fila("77", { estado: "reservado", comprador: "Pedro", contacto: "98311373188012@lid", telefono: "98311373188012@lid", usuario_global_id: PEDRO }),
    fila("88", { estado: "reservado", comprador: "José Núñez", contacto: "3009990000", telefono: "3009990000", usuario_global_id: "j-1" }),
    fila("52"), fila("61"), fila("09")
];

const AUDIT_MAMA = [{
    id: "am1", origen: "bot", accion: "reservar", numero: "61", grupo_nombre: "Rifas", contacto_nombre: "Mamá", contacto_telefono: null,
    contacto_id: MAMA, estado_anterior: "libre", estado_nuevo: "reservado", motivo: null, observaciones: null, metodo_pago: null,
    resultado: "ok", codigo: null, operador_email: null, creado_en: "2026-10-18T15:00:00Z"
}];
const ARCH_MAMA = [{
    id: "rm1", numero: "52", estado: "pagado", nombre_evento: "Anterior", motivo: "reinicio_programacion", archivado_en: "2026-10-15T05:00:00Z",
    fila: { comprador: "Mamá", telefono: "204899612345678@lid", usuario_global_id: MAMA }
}];

const fuentesMama = (extra = {}) => ({ auditoria: AUDIT_MAMA, auditoriaDisponible: true, actividad: [], archivo: ARCH_MAMA, ...extra });
const FILAS_MAMA = H.construirHistorial(NUMS_MAMA, fuentesMama(), estadoReal);
const buscar = (texto, extra = {}) => H.filtrarHistorial(FILAS_MAMA, { ...H.FILTROS_HISTORIAL_VACIOS, texto, ...extra }).map(f => f.numero);
const buscarGrid = (texto, extra = {}) => [...(H.numerosCoincidentes(NUMS_MAMA, FILAS_MAMA, { ...H.FILTROS_HISTORIAL_VACIOS, texto, ...extra }, estadoReal) || [])].sort();

const TODOS_MAMA = ["14", "23", "31", "52", "61"];

prueba("telefonoCanonico: misma regla que el backend; LID y nombres no son teléfonos", () => {
    for (const v of [TEL, "573113731880", "+57 3113731880", "+57-311-373-1880", "(311) 373-1880", "311 373 1880", "573113731880:12@s.whatsapp.net", "573113731880_1@s.whatsapp.net"]) {
        assert.strictEqual(H.telefonoCanonico(v), TEL, v);
    }
    assert.strictEqual(H.telefonoCanonico("204899612345678@lid"), null);
    assert.strictEqual(H.telefonoCanonico("Mamá"), null);
    assert.strictEqual(H.telefonoCanonico("311"), null);
    assert.strictEqual(H.telefonoCanonico(null), null);
});

prueba("tipoConsulta: 1-3 dígitos = número de tabla; teléfono nunca se toma por número", () => {
    assert.deepStrictEqual(H.tipoConsulta("7"), { tipo: "numero", valor: "7" });
    assert.deepStrictEqual(H.tipoConsulta("07"), { tipo: "numero", valor: "07" });
    assert.deepStrictEqual(H.tipoConsulta("+57 311-373-1880"), { tipo: "telefono", valor: TEL });
    assert.strictEqual(H.tipoConsulta("mamá").tipo, "texto");
    assert.strictEqual(H.tipoConsulta("   ").tipo, "vacia");
});

prueba("3113731880 con y sin +57, espacios, guiones y paréntesis: todos los números de la mamá", () => {
    for (const q of [TEL, "573113731880", "+57 3113731880", "+57-311-373-1880", "(311) 373-1880", " 311 373 1880 "]) {
        assert.deepStrictEqual(buscar(q), TODOS_MAMA, q);
    }
});

prueba("varios números del mismo contacto, con estados distintos, unidos por la identidad real", () => {
    const filas = H.filtrarHistorial(FILAS_MAMA, { ...H.FILTROS_HISTORIAL_VACIOS, texto: TEL });
    assert.deepStrictEqual(filas.map(f => `${f.numero}:${f.estado}`), ["14:reservado", "23:pagado", "31:en_proceso", "52:libre", "61:libre"]);
    // 23 no tiene teléfono en la fila: sale por usuario_global_id = el de la 14.
    assert.strictEqual(FILAS_MAMA.find(f => f.numero === "23").busqueda[0].telefonos.length, 0);
});

prueba("contactos distintos con teléfonos parecidos o LID que contiene los dígitos: no se mezclan", () => {
    assert.ok(!buscar(TEL).includes("40"), "3113731881 es otra persona");
    assert.ok(!buscar(TEL).includes("77"), "un LID con esos dígitos no es ese teléfono");
    assert.deepStrictEqual(buscar("3113731881"), ["40"]);
    assert.deepStrictEqual(buscar("311373"), []);   // trozo: ni teléfono ni número
});

prueba("sin teléfono en ninguna fila: el directorio de contactos lo aporta por identidad", () => {
    const sinTel = NUMS_MAMA.map(n => n.usuario_global_id === MAMA ? { ...n, contacto: "204899612345678@lid", telefono: "204899612345678@lid" } : n);
    const sinDirectorio = H.construirHistorial(sinTel, fuentesMama(), estadoReal);
    assert.deepStrictEqual(H.filtrarHistorial(sinDirectorio, { ...H.FILTROS_HISTORIAL_VACIOS, texto: TEL }).map(f => f.numero), []);
    const conDirectorio = H.construirHistorial(sinTel, fuentesMama({ contactos: [{ id: MAMA, nombre: "Mamá", telefono: TEL }, { id: "otra", nombre: "X", telefono: "3001112222" }] }), estadoReal);
    assert.deepStrictEqual(H.filtrarHistorial(conDirectorio, { ...H.FILTROS_HISTORIAL_VACIOS, texto: TEL }).map(f => f.numero), TODOS_MAMA);
    // Una identidad del directorio que no aparece en esta tabla no añade nada.
    assert.deepStrictEqual(H.filtrarHistorial(conDirectorio, { ...H.FILTROS_HISTORIAL_VACIOS, texto: "3001112222" }).map(f => f.numero), []);
});

prueba("nombre con y sin tildes (también trae los números de la misma identidad)", () => {
    assert.deepStrictEqual(buscar("mama"), TODOS_MAMA);
    assert.deepStrictEqual(buscar("Mamá"), TODOS_MAMA);
    assert.deepStrictEqual(buscar("jose nunez"), ["88"]);
    assert.deepStrictEqual(buscar("JOSÉ NÚÑEZ"), ["88"]);
});

prueba("número de tabla: 7 y 07 encuentran 07; 9 y 09 encuentran 09; 00 exacto", () => {
    const nums = [fila("00"), fila("07"), fila("70"), fila("09"), fila("90")];
    const g = q => [...H.numerosCoincidentes(nums, [], { ...H.FILTROS_HISTORIAL_VACIOS, texto: q }, estadoReal)].sort();
    assert.deepStrictEqual(g("7"), ["07"]);
    assert.deepStrictEqual(g("07"), ["07"]);
    assert.deepStrictEqual(g("00"), ["00"]);
    assert.deepStrictEqual(g("0"), ["00"]);
    assert.deepStrictEqual(g("9"), ["09"]);
});

prueba("filtros de estado, grupo y fecha se aplican sobre el resultado sin perder coincidencias", () => {
    assert.deepStrictEqual(buscar(TEL, { estado: "pagado" }), ["23"]);
    assert.deepStrictEqual(buscar(TEL, { estado: "libre" }), ["52", "61"]);
    assert.deepStrictEqual(buscar(TEL, { grupo: "Rifas" }), ["14", "61"]);
    assert.deepStrictEqual(buscar(TEL, { fecha: "2026-10-20" }), ["23"]);
    // Limpiar la búsqueda restaura el resultado sin consulta.
    assert.deepStrictEqual(buscar(""), FILAS_MAMA.map(f => f.numero));
});

prueba("cuadrícula e historial: mismo resultado en todas las consultas de teléfono, nombre y número", () => {
    for (const q of [TEL, "+57 311-373-1880", "3113731881", "311373", "mama", "jose", "14", "7", "0"]) {
        const h = buscar(q).filter(n => FILAS_MAMA.some(f => f.numero === n));
        const g = buscarGrid(q).filter(n => FILAS_MAMA.some(f => f.numero === n));
        assert.deepStrictEqual(g, h, q);
    }
    assert.deepStrictEqual(buscarGrid("9"), ["09"]);   // libre sin historial: solo en la cuadrícula
});

prueba("aislamiento: otra tabla de precio u otro cliente con la misma identidad no aporta números", () => {
    // Las filas de otra tabla/cliente nunca llegan a esta lista (obtenerTabla
    // filtra usuario_id + tabla); aunque compartan identidad o teléfono, solo
    // se devuelven números de la lista recibida.
    const otraTabla = H.construirHistorial([fila("99", { estado: "pagado", comprador: "Mamá", telefono: TEL, usuario_global_id: MAMA })], sinAuditoria, estadoReal);
    const r = H.numerosCoincidentes(NUMS_MAMA, otraTabla, { ...H.FILTROS_HISTORIAL_VACIOS, texto: TEL }, estadoReal);
    assert.ok(!r.has("99"));
    assert.deepStrictEqual(buscar(TEL), TODOS_MAMA);
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLA  ${n}\n        ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas correctas`);
process.exit(fallos ? 1 : 0);
