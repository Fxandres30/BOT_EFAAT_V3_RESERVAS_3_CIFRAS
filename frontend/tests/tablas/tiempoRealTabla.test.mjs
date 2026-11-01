// ==========================================================================
// PRUEBAS (frontend) — tiempo real y sincronización de /tablas/:precio.
//
// abrirTabla (hooks/useTablaPrecio.ts) REAL con lecturas y canales de
// Realtime falsos en memoria. Comprueba, contando consultas y renders:
//   - carga inicial sin el historial; el historial al pedirlo;
//   - operación propia: solo se releen los números operados, sin recarga
//     completa, y su eco no vuelve a pintar;
//   - aviso externo: se aplica la fila recibida, sin consultas;
//   - repetidos y fuera de orden; lectura vieja frente a aviso nuevo;
//   - avisos de otra tabla física y de otro cliente: sin efecto;
//   - corte de canal / sin red -> «desactualizada»; al volver, validación y
//     el cambio perdido aparece;
//   - dos pestañas: cada una aplica el aviso por su cuenta;
//   - al cerrar no quedan canales, oyentes ni actualizaciones.
//
//     node frontend/tests/tablas/tiempoRealTabla.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const TABLA = "5k_15k_reservas_2_cifras";
const U = "usuario-a";
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ base falsa ---

const db = {};
const lecturas = [];
function reiniciarBase() {
    db.numeros = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: U, comprador: null }));
    db.evento = { id: "ev1", tabla: TABLA, valor: 5000, nombre_evento: "Chontico", activo: true };
    db.actividad = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, usuario_id: U, tabla: TABLA, numero: "01", tipo: "reservado", detalle: {}, creado_en: new Date(Date.parse("2026-10-31T10:00:00Z") - i * 60000).toISOString() }));
    db.auditoria = [{ id: "r1", numero: "01", accion: "reservar", creado_en: "2026-10-31T10:00:00Z" }];
    db.archivo = [];
    db.retraso = 0;
    lecturas.length = 0;
}
const copia = (x) => JSON.parse(JSON.stringify(x));
const contar = (tipo) => lecturas.filter(l => l.tipo === tipo).length;
async function demora() { if (db.retraso) await dormir(db.retraso); }

const servicios = {
    "@/services/tablas/obtenerTabla": {
        obtenerTabla: async () => { lecturas.push({ tipo: "tabla" }); const r = copia(db.numeros); await demora(); return r; },
        obtenerNumerosTabla: async (tabla, uid, numeros) => {
            lecturas.push({ tipo: "numeros", numeros });
            const r = copia(db.numeros.filter(n => numeros.includes(n.numero)));
            await demora();
            return r;
        }
    },
    "@/services/tablas/obtenerEventoActivo": { obtenerEventoActivo: async () => { lecturas.push({ tipo: "evento" }); return copia(db.evento); } },
    "@/services/tablas/obtenerActividad": {
        obtenerActividad: async (t, u, limite) => { lecturas.push({ tipo: "actividad", limite }); return copia(db.actividad.slice(0, limite)); },
        obtenerActividadDesde: async (t, u, desde, limite) => { lecturas.push({ tipo: "actividadDesde", desde }); return copia(db.actividad.filter(a => a.creado_en >= desde).slice(0, limite)); }
    },
    "@/services/tablas/obtenerHistorial": {
        LIMITE_HISTORIAL: 1000,
        obtenerEventosHistorial: async (t, u, desde) => {
            lecturas.push({ tipo: desde ? "historialDesde" : "historial", desde });
            const aud = desde?.auditoria ? db.auditoria.filter(a => a.creado_en >= desde.auditoria) : db.auditoria;
            return { auditoria: copia(aud), auditoriaDisponible: true, archivo: copia(db.archivo) };
        }
    },
    "@/services/tablas/prepararCuadricula": { prepararCuadricula: async () => ({ ok: true, estado: "completa" }), diagnosticar: () => ({ tipo: "lista" }) },
    "@/services/contactos/obtenerContactos": { obtenerContactos: async () => { lecturas.push({ tipo: "contactos" }); return { contactos: [] }; } },
    "@/services/tablas/tablasCliente": { obtenerTablaConfigCliente: async () => ({ tabla: TABLA, cifras: 2, cantidad: 100 }) },
    "@/services/auth/getUser": { getUser: async () => ({ data: { user: { id: U } } }) },
    "@/services/tablas/reservaManual": {},
    "@/services/tablas/reiniciarTabla": {},
    "@/services/tablas/pagoLote": {}
};

// ---------------------------------------------------- Realtime falso ---

const canalesAbiertos = new Set();
const supabase = {
    channel(nombre) {
        const canal = {
            nombre, binds: [], estadoCb: null,
            on(tipo, cfg, cb) { this.binds.push({ cfg, cb }); return this; },
            subscribe(cb) { this.estadoCb = cb; canalesAbiertos.add(this); queueMicrotask(() => cb("SUBSCRIBED")); return this; },
            estado(s) { this.estadoCb?.(s); }
        };
        return canal;
    },
    removeChannel(c) { canalesAbiertos.delete(c); }
};

// Como Supabase: se entrega a los canales cuyo filtro coincide (los DELETE, sin filtro).
function emitir(table, aviso) {
    for (const c of canalesAbiertos) for (const b of c.binds) {
        if (b.cfg.table !== table) continue;
        if (b.cfg.event !== "*" && b.cfg.event !== aviso.eventType) continue;
        const [col, val] = (b.cfg.filter || "").split("=eq.");
        if (aviso.eventType !== "DELETE" && col && String(aviso.new?.[col]) !== val) continue;
        b.cb({ schema: "public", table, errors: null, old: {}, new: {}, ...aviso });
    }
}

const oyentesVentana = new Map();
globalThis.window = {
    addEventListener(t, fn) { oyentesVentana.set(t, [...(oyentesVentana.get(t) || []), fn]); },
    removeEventListener(t, fn) { oyentesVentana.set(t, (oyentesVentana.get(t) || []).filter(f => f !== fn)); }
};
const dispararVentana = (t) => (oyentesVentana.get(t) || []).forEach(fn => fn());

// --------------------------------------------------------- módulo real ---

function cargarTs(rutaAbs, cache) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        if (servicios[spec]) return servicios[spec];
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

const { abrirTabla } = cargarTs(path.join(FRONT, "hooks/useTablaPrecio.ts"), new Map());

// Vista falsa: cuenta cada actualización de estado (= un render de la pantalla).
function crearVista() {
    const v = { renders: 0, numeros: [], actividad: [], historial: null, evento: null, desactualizada: false, error: null, loading: true, historialCargado: false };
    const set = (k) => (x) => { v.renders++; v[k] = x; };
    v.vista = {
        setNumeros: set("numeros"), setEventoActivo: set("evento"), setActividad: set("actividad"), setEventosHistorial: set("historial"),
        setContactos: () => {}, setHistorialCargado: set("historialCargado"), setDiagnostico: () => {}, setError: (e) => { v.error = e; },
        setLoading: (l) => { v.loading = l; }, setDesactualizada: (d) => { v.desactualizada = d; }
    };
    return v;
}

function abrir({ historial = false } = {}) {
    const v = crearVista();
    const control = abrirTabla({ precio: 5000, usuarioId: U, config: { tabla: TABLA, cifras: 2, cantidad: 100 }, historialPedido: () => historial, vista: v.vista });
    return { v, control };
}

const aviso = (numero, cambios, commit = new Date().toISOString(), tipo = "UPDATE") => {
    const f = db.numeros.find(n => n.numero === numero);
    Object.assign(f, cambios);
    return { eventType: tipo, new: copia(f), commit_timestamp: commit };
};

let ok = 0;
async function prueba(nombre, fn) { reiniciarBase(); await fn(); ok++; console.log(`✔ ${nombre}`); }

// ------------------------------------------------------------- pruebas ---

await prueba("entrada: cuadrícula + evento + 15 de actividad; validación ligera al conectar; sin historial", async () => {
    const { v, control } = abrir();
    await dormir(50);
    assert.strictEqual(v.loading, false);
    assert.strictEqual(v.numeros.length, 100);
    assert.strictEqual(v.actividad.length, 15, "solo «Actividad reciente»");
    assert.strictEqual(contar("historial") + contar("historialDesde") + contar("contactos"), 0, "historial sin pedir");
    assert.strictEqual(contar("tabla"), 2, "carga + validación al conectar los 3 canales");
    assert.strictEqual(contar("actividad"), 1);
    assert.ok(contar("actividadDesde") <= 1, "la validación pide solo la actividad nueva");
    assert.strictEqual(canalesAbiertos.size, 3);
    for (const c of canalesAbiertos) assert.ok(c.binds.every(b => b.cfg.filter === `usuario_id=eq.${U}`), "cada canal filtra por el usuario");
    control.cerrar();
});

await prueba("historial: se pide aparte (1000 de actividad + auditoría + archivo + directorio), una sola vez", async () => {
    const { v, control } = abrir();
    await dormir(50);
    control.cargarHistorial(); control.cargarHistorial();
    await dormir(30);
    assert.strictEqual(contar("historial"), 1);
    assert.strictEqual(contar("contactos"), 1);
    assert.strictEqual(v.actividad.length, 30);
    assert.strictEqual(v.historialCargado, true);
    assert.strictEqual(v.historial.auditoria.length, 1);
    control.cerrar();
});

await prueba("operación propia: solo se releen los números operados; el eco no vuelve a pintar", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    const antes = v.numeros;
    // El servidor ya cambió 05 y 06 (lote) y responde: se releen esos dos.
    const ecos = [aviso("05", { estado: "reservado", comprador: "Ana" }), aviso("06", { estado: "reservado", comprador: "Ana" })];
    await control.trasOperacion(["05", "06"]);
    assert.deepStrictEqual(lecturas.map(l => l.tipo), ["numeros"], "sin recarga completa");
    assert.deepStrictEqual(lecturas[0].numeros, ["05", "06"]);
    assert.strictEqual(v.numeros[5].estado, "reservado");
    assert.strictEqual(v.numeros.filter((n, i) => n !== antes[i]).length, 2, "solo cambian dos objetos");
    const renders = v.renders;
    ecos.forEach(e => emitir(TABLA, e));
    assert.strictEqual(v.renders, renders, "el eco trae lo mismo: ningún render");
    await dormir(1700);
    assert.strictEqual(lecturas.length, 1, "sin historial abierto, el eco no pide nada");
    control.cerrar();
});

await prueba("aviso externo: la fila recibida se aplica sin consultas; repetido y fuera de orden sin efecto", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    const e2 = aviso("70", { estado: "pagado", comprador: "Bot" }, "2026-10-31T12:00:02Z");
    emitir(TABLA, e2);
    assert.strictEqual(v.numeros[70].estado, "pagado");
    const renders = v.renders;
    emitir(TABLA, e2);
    assert.strictEqual(v.renders, renders, "repetido: sin render");
    emitir(TABLA, { eventType: "UPDATE", new: { ...e2.new, estado: "reservado" }, commit_timestamp: "2026-10-31T12:00:01Z" });
    assert.strictEqual(v.numeros[70].estado, "pagado", "uno más viejo no pisa al nuevo");
    await dormir(400);
    assert.strictEqual(lecturas.length, 0, "ninguna consulta");
    control.cerrar();
});

await prueba("ráfaga de 20 avisos: 20 filas aplicadas, cero consultas", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    for (let i = 80; i < 100; i++) emitir(TABLA, aviso(String(i), { estado: "reservado", comprador: "Bot" }));
    assert.ok(v.numeros.slice(80).every(n => n.estado === "reservado"));
    await dormir(400);
    assert.strictEqual(lecturas.length, 0);
    control.cerrar();
});

await prueba("lectura vieja frente a aviso nuevo: gana el aviso", async () => {
    const { v, control } = abrir();
    await dormir(50);
    db.retraso = 80;
    aviso("10", { estado: "reservado" });
    const lectura = control.trasOperacion(["10"]);           // lee «reservado»...
    await dormir(20);
    emitir(TABLA, aviso("10", { estado: "pagado" }));          // ...y mientras tanto se paga
    await lectura;
    assert.strictEqual(v.numeros[10].estado, "pagado", "la lectura que empezó antes no pisa el aviso");
    control.cerrar();
});

await prueba("aviso incompleto: se relee solo ese número", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    const f = db.numeros.find(n => n.numero === "33");
    f.estado = "pagado";
    const incompleta = copia(f);
    delete incompleta.comprador;
    emitir(TABLA, { eventType: "UPDATE", new: incompleta, commit_timestamp: new Date().toISOString() });
    await dormir(10);
    assert.deepStrictEqual(lecturas.map(l => [l.tipo, l.numeros]), [["numeros", ["33"]]]);
    assert.strictEqual(v.numeros[33].estado, "pagado");
    control.cerrar();
});

await prueba("aviso viejo e incompleto: no se relee", async () => {
    const { v, control } = abrir();
    await dormir(50);
    emitir(TABLA, aviso("44", { estado: "pagado" }, "2026-10-31T12:00:02Z"));
    lecturas.length = 0;
    const viejo = copia(db.numeros.find(n => n.numero === "44"));
    delete viejo.comprador;
    emitir(TABLA, { eventType: "UPDATE", new: { ...viejo, estado: "reservado" }, commit_timestamp: "2026-10-31T12:00:01Z" });
    await dormir(20);
    assert.strictEqual(lecturas.length, 0);
    assert.strictEqual(v.numeros[44].estado, "pagado");
    control.cerrar();
});

await prueba("aislamiento: otro cliente, otra tabla física y borrados ajenos no consultan ni pintan", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    const renders = v.renders;
    emitir(TABLA, { eventType: "UPDATE", new: { id: 999, numero: "05", estado: "pagado", usuario_id: "otro" } });   // el filtro lo frena
    for (const c of canalesAbiertos) for (const b of c.binds) if (b.cfg.table === TABLA) b.cb({ eventType: "UPDATE", new: { id: 998, numero: "05", estado: "pagado", usuario_id: "otro" } }); // y si llegara
    emitir(TABLA, { eventType: "DELETE", old: { id: 5000 } });
    emitir("eventos_bot", { eventType: "UPDATE", new: { id: "ev9", usuario_id: U, tabla: "reservas_dos_cifras" } });
    emitir("reservas_actividad", { eventType: "INSERT", new: { id: "x1", usuario_id: U, tabla: "reservas_dos_cifras", numero: "05", creado_en: new Date().toISOString() } });
    await dormir(400);
    assert.strictEqual(lecturas.length, 0);
    assert.strictEqual(v.renders, renders);
    assert.strictEqual(v.numeros[5].estado, "libre");
    control.cerrar();
});

await prueba("evento activo de ESTA tabla: solo se relee el evento", async () => {
    const { v, control } = abrir();
    await dormir(50);
    lecturas.length = 0;
    db.evento = { ...db.evento, nombre_evento: "Nuevo" };
    emitir("eventos_bot", { eventType: "UPDATE", new: { ...db.evento, usuario_id: U } });
    await dormir(400);
    assert.deepStrictEqual(lecturas.map(l => l.tipo), ["evento"]);
    assert.strictEqual(v.evento.nombre_evento, "Nuevo");
    control.cerrar();
});

await prueba("actividad nueva: se añade arriba sin descargar nada; con historial, la auditoría nueva se pide con ventana", async () => {
    const { v, control } = abrir({ historial: true });
    await dormir(80);
    lecturas.length = 0;
    const nueva = { id: "nueva", usuario_id: U, tabla: TABLA, numero: "05", tipo: "pagado", detalle: {}, creado_en: new Date().toISOString() };
    db.actividad.unshift(nueva);
    db.auditoria.unshift({ id: "r2", numero: "05", accion: "pagar", creado_en: new Date().toISOString() });
    emitir("reservas_actividad", { eventType: "INSERT", new: nueva });
    emitir("reservas_actividad", { eventType: "INSERT", new: nueva });
    assert.strictEqual(v.actividad[0].id, "nueva");
    assert.strictEqual(v.actividad.filter(a => a.id === "nueva").length, 1, "sin duplicado");
    await dormir(1700);
    assert.deepStrictEqual(lecturas.map(l => l.tipo), ["historialDesde"], "una consulta, solo lo nuevo");
    assert.ok(lecturas[0].desde.auditoria, "con fecha de corte");
    assert.strictEqual(v.historial.auditoria[0].id, "r2");
    control.cerrar();
});

await prueba("corte de Realtime: «desactualizada»; al reconectar se valida y aparece el cambio perdido", async () => {
    const { v, control } = abrir();
    await dormir(50);
    const [canal] = [...canalesAbiertos];
    canal.estado("CHANNEL_ERROR");
    assert.strictEqual(v.desactualizada, true);
    aviso("75", { estado: "pagado", comprador: "Offline" });   // cambio sin aviso: se pierde
    assert.strictEqual(v.numeros[75].estado, "libre");
    lecturas.length = 0;
    canal.estado("SUBSCRIBED");
    await dormir(30);
    assert.strictEqual(v.numeros[75].estado, "pagado", "recuperado");
    assert.strictEqual(v.desactualizada, false);
    assert.strictEqual(contar("tabla"), 1, "una validación");
    control.cerrar();
});

await prueba("sin red (offline/online): «desactualizada» hasta validar de nuevo", async () => {
    const { v, control } = abrir();
    await dormir(50);
    dispararVentana("offline");
    assert.strictEqual(v.desactualizada, true);
    aviso("40", { estado: "reservado" });
    dispararVentana("online");
    await dormir(30);
    assert.strictEqual(v.numeros[40].estado, "reservado");
    assert.strictEqual(v.desactualizada, false);
    control.cerrar();
});

await prueba("dos pestañas: cada una aplica el aviso; ninguna recarga", async () => {
    const a = abrir(), b = abrir();
    await dormir(50);
    lecturas.length = 0;
    emitir(TABLA, aviso("12", { estado: "pagado", comprador: "Admin A" }));
    assert.strictEqual(a.v.numeros[12].estado, "pagado");
    assert.strictEqual(b.v.numeros[12].estado, "pagado");
    await dormir(400);
    assert.strictEqual(lecturas.length, 0);
    a.control.cerrar(); b.control.cerrar();
});

await prueba("cerrar: sin canales, sin oyentes y sin actualizaciones después", async () => {
    const { v, control } = abrir();
    await dormir(50);
    control.cerrar();
    assert.strictEqual(canalesAbiertos.size, 0);
    assert.strictEqual((oyentesVentana.get("online") || []).length, 0);
    assert.strictEqual((oyentesVentana.get("offline") || []).length, 0);
    const renders = v.renders;
    emitir(TABLA, aviso("01", { estado: "pagado" }));
    await dormir(50);
    assert.strictEqual(v.renders, renders);
});

console.log(`\n${ok} pruebas OK`);
