// ==========================================================================
// PRUEBAS (frontend) — vista unificada de grupos de Automatización
// (services/automatizacion/vistaGrupos.ts). Lógica pura, sin red.
//
//     node frontend/tests/automatizacion/vistaGrupos.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const V = cargarTs(path.join(FRONT, "services/automatizacion/vistaGrupos.ts"));

let total = 0;
let fallidas = 0;

function prueba(nombre, fn) {
    total++;
    try {
        fn();
        console.log(`✅ ${nombre}`);
    } catch (err) {
        fallidas++;
        console.log(`❌ ${nombre}\n   ${err.message}`);
    }
}

const A = "111@g.us";
const B = "222@g.us";
const C = "333@g.us";
const D = "444@g.us";

function sesion(estado, grupos = [], id = "s1") {
    return { sessionId: id, nombreSesion: `Sesión ${id}`, telefono: null, conectada: estado === "conectada", estado, grupos, error: null };
}

function auth(grupo, activo = true) {
    return { id: `a-${grupo}`, usuario_id: "u1", grupo_id: grupo, activo, creado_en: "", actualizado_en: "" };
}

function resultado(estado, offset, restanteMs = null) {
    return { offset, estado, etiqueta: estado, motivo: null, detalleTecnico: null, momento: null, restanteMs, registradoEn: null };
}

function fila(grupo, extra = {}) {
    return {
        config: {
            grupo_id: grupo, activo: true,
            mensaje_apertura: {}, mensaje_cierre: { activo: false, categoria: null },
            mensaje_actualizacion: { activo: true, categoria: null },
            recordatorios: { "60": { activo: true, categoria: null } },
            publicacion_inicial_tabla: { activo: false, hora: "07:00", dias_permitidos: {} },
            ...(extra.config || {})
        },
        nombre: extra.nombre ?? "Grupo registrado",
        evento: null, cierre: null, horaCierre: null, datosDisponibles: true,
        cicloAbierto: false, sesionNoActiva: extra.sesionNoActiva ?? false,
        programadosActivos: extra.programadosActivos ?? 1,
        pendientes: extra.pendientes ?? 0,
        recordatorios: extra.recordatorios ?? [],
        resumen: { proximo: null, ultimoEnviado: null }
    };
}

// ------------------------------------------------------------ identidad ---

prueba("une conexión, autorización y configuración por grupo_id sin duplicar", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "Rifas A" }, { id: B, nombre: "Rifas B" }])];
    const grupos = V.construirGruposVista(sesiones, [auth(A), auth(` ${C} `, false)], [fila(A), fila(D, { config: { activo: false } })]);
    assert.strictEqual(grupos.length, 4);
    const porId = Object.fromEntries(grupos.map((g) => [g.grupoId, g]));
    assert.strictEqual(porId[A].conexion, "conectado");
    assert.strictEqual(porId[A].estadoAutorizacion, "autorizado");
    assert.strictEqual(porId[A].estadoAutomatizacion, "activa");
    assert.strictEqual(porId[A].nombre, "Rifas A");
    assert.strictEqual(porId[A].nombreConfirmado, true);
    assert.strictEqual(porId[B].estadoAutorizacion, "no_autorizado");
    assert.strictEqual(porId[B].estadoAutomatizacion, "sin_configurar");
    assert.strictEqual(porId[C].estadoAutorizacion, "pausada");
    assert.strictEqual(porId[C].conexion, "no_visto");
    assert.strictEqual(porId[D].estadoAutomatizacion, "pausada");
    assert.strictEqual(porId[D].estadoAutorizacion, "no_autorizado");
});

prueba("un grupo no visto en vivo usa el último nombre registrado, nunca el ID técnico", () => {
    const grupos = V.construirGruposVista([sesion("conectada", [])], [auth(A)], [fila(A, { nombre: "Nombre viejo" })]);
    assert.strictEqual(grupos[0].nombre, "Nombre viejo");
    assert.strictEqual(grupos[0].nombreConfirmado, false);
    const sinNombre = V.construirGruposVista([sesion("conectada", [])], [auth(B)], [fila(B, { nombre: "Nombre desconocido" })]);
    assert.strictEqual(sinNombre[0].nombre, null);
});

prueba("sin consulta en vivo la conexión queda «comprobando», nunca desconectada", () => {
    const grupos = V.construirGruposVista(null, [auth(A)], []);
    assert.strictEqual(grupos[0].conexion, "comprobando");
    const resumen = V.resumirVista(grupos, false);
    assert.strictEqual(resumen.autorizadosConectados, null);
    assert.strictEqual(resumen.pendientes, null);
});

prueba("conexión: no verificable y sin sesión se distinguen", () => {
    assert.strictEqual(V.conexionVista(false, [sesion("no_verificable")]), "no_verificable");
    assert.strictEqual(V.conexionVista(false, [sesion("desconectada")]), "sin_sesion");
    assert.strictEqual(V.conexionVista(false, []), "sin_sesion");
});

// ------------------------------------------------------------ tipos ---

prueba("estadoTipos: apertura activa salvo false explícito; resto exige true", () => {
    const t = V.estadoTipos(fila(A).config);
    assert.deepStrictEqual(t, { apertura: true, recordatorios: true, actualizacion: true, cierre: false, tablaInicial: false });
    assert.strictEqual(V.estadoTipos({ ...fila(A).config, mensaje_apertura: { activo: false } }).apertura, false);
});

// ------------------------------------------------------------ filtros ---

prueba("filtros por autorización, conexión y pausa, y búsqueda por nombre o ID", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "Rifas A" }, { id: B, nombre: "Rifas B" }])];
    const grupos = V.construirGruposVista(sesiones, [auth(A), auth(C)], [fila(A, { config: { activo: false } })]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "autorizados", "").map((g) => g.grupoId).sort(), [A, C]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "por_autorizar", "").map((g) => g.grupoId), [B]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "sin_conexion", "").map((g) => g.grupoId), [C]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "pausados", "").map((g) => g.grupoId), [A]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "todos", "rifas b").map((g) => g.grupoId), [B]);
    assert.deepStrictEqual(V.filtrarGrupos(grupos, "todos", "333").map((g) => g.grupoId), [C]);
});

prueba("ordenarGrupos pone primero los autorizados y conectados", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "Zeta" }, { id: B, nombre: "Alfa" }])];
    const grupos = V.ordenarGrupos(V.construirGruposVista(sesiones, [auth(A), auth(C)], []));
    assert.deepStrictEqual(grupos.map((g) => g.grupoId), [A, C, B]);
});

// ------------------------------------------------------------ resumen ---

prueba("resumirVista cuenta solo datos reales", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "A" }])];
    const grupos = V.construirGruposVista(sesiones, [auth(A), auth(B), auth(C, false)], [
        fila(A, { programadosActivos: 2, pendientes: 1 }),
        fila(B, { config: { activo: false }, programadosActivos: 0 })
    ]);
    const r = V.resumirVista(grupos, true);
    assert.strictEqual(r.autorizados, 2);
    assert.strictEqual(r.autorizacionesPausadas, 1);
    assert.strictEqual(r.autorizadosConectados, 1);
    assert.strictEqual(r.visiblesEnWhatsApp, 1);
    assert.strictEqual(r.activas, 1);
    assert.strictEqual(r.pausadas, 1);
    assert.strictEqual(r.programados, 2);
    assert.strictEqual(r.pendientes, 1);
});

prueba("proximosEnvios ordena por cercanía y omite grupos en pausa", () => {
    const filas = [
        fila(A, { nombre: "A", recordatorios: [{ clave: "60", categoria: null, activo: true, resultado: resultado("programado", 60, 50000) }, { clave: "10", categoria: null, activo: true, resultado: resultado("enviado", 10) }] }),
        fila(B, { nombre: "B", recordatorios: [{ clave: "30", categoria: null, activo: true, resultado: resultado("proximo", 30, 1000) }] }),
        fila(C, { nombre: "C", config: { activo: false }, recordatorios: [{ clave: "5", categoria: null, activo: true, resultado: resultado("programado", 5, 10) }] })
    ];
    const lista = V.proximosEnvios(filas);
    assert.deepStrictEqual(lista.map((p) => `${p.nombre}:${p.offset}`), ["B:30", "A:60"]);
});

// ------------------------------------------------------------ avisos ---

prueba("avisos: WhatsApp sin vincular / desconectado", () => {
    assert.ok(V.avisosAutomatizacion([], []).some((a) => a.id === "sin-whatsapp"));
    assert.ok(V.avisosAutomatizacion([], [sesion("desconectada")]).some((a) => a.id === "whatsapp-desconectado"));
    assert.deepStrictEqual(V.avisosAutomatizacion([], null), []);
});

prueba("avisos: autorizados no vistos solo con consulta completa", () => {
    const completas = [sesion("conectada", [])];
    const g1 = V.construirGruposVista(completas, [auth(A)], []);
    assert.ok(V.avisosAutomatizacion(g1, completas).some((a) => a.id === "autorizados-no-vistos"));
    const incompletas = [sesion("conectada", [], "s1"), sesion("no_verificable", [], "s2")];
    const g2 = V.construirGruposVista(incompletas, [auth(A)], []);
    assert.ok(!V.avisosAutomatizacion(g2, incompletas).some((a) => a.id === "autorizados-no-vistos"));
});

prueba("avisos: automatización activa sin autorización, errores y por autorizar", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "A" }, { id: B, nombre: "B" }])];
    const grupos = V.construirGruposVista(sesiones, [], [
        fila(A, { recordatorios: [{ clave: "60", categoria: null, activo: true, resultado: resultado("error", 60) }] })
    ]);
    const ids = V.avisosAutomatizacion(grupos, sesiones).map((a) => a.id);
    assert.ok(ids.includes("activa-sin-autorizar"));
    assert.ok(ids.includes("errores-envio"));
    assert.ok(ids.includes("por-autorizar"));
});

// ------------------------------------------------- capacidad de envío ---

prueba("tieneErrorEnvio detecta errores de cualquier tipo de mensaje, no solo recordatorios", () => {
    assert.strictEqual(V.tieneErrorEnvio(fila(A)), false);
    assert.strictEqual(V.tieneErrorEnvio({ ...fila(A), acciones: [{ estado: "ok", tipo_accion: "OPEN_MESSAGE" }, { estado: "error", tipo_accion: "UPDATE_MESSAGE" }] }), true);
    assert.strictEqual(V.tieneErrorEnvio(fila(A, { recordatorios: [{ clave: "60", categoria: null, activo: true, resultado: resultado("error", 60) }] })), true);
    assert.strictEqual(V.tieneErrorEnvio(null), false);
});

prueba("avisos: un error de actualización también aparece", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "A" }])];
    const grupos = V.construirGruposVista(sesiones, [auth(A)], [{ ...fila(A), acciones: [{ estado: "error", tipo_accion: "UPDATE_MESSAGE" }] }]);
    assert.ok(V.avisosAutomatizacion(grupos, sesiones).some((a) => a.id === "errores-envio"));
});

prueba("puedeEnviar exige activa + autorizado + conectado; el resumen separa activas sin envío", () => {
    const sesiones = [sesion("conectada", [{ id: A, nombre: "A" }, { id: B, nombre: "B" }])];
    const grupos = V.construirGruposVista(sesiones, [auth(A), auth(C)], [fila(A), fila(B), fila(C), fila(D, { config: { activo: false } })]);
    const porId = Object.fromEntries(grupos.map((g) => [g.grupoId, g]));
    assert.strictEqual(V.puedeEnviar(porId[A]), true);
    assert.strictEqual(V.puedeEnviar(porId[B]), false); // sin autorización
    assert.strictEqual(V.puedeEnviar(porId[C]), false); // no aparece en WhatsApp
    assert.strictEqual(V.puedeEnviar(porId[D]), false); // en pausa
    const r = V.resumirVista(grupos, true);
    assert.strictEqual(r.activas, 3);
    assert.strictEqual(r.operativas, 1);
    assert.strictEqual(r.activasSinEnvio, 2);
    const comprobando = V.resumirVista(V.construirGruposVista(null, [auth(A)], [fila(A)]), true);
    assert.strictEqual(comprobando.operativas, null);
});

prueba("puedeEnviarFila y motivoSinEnvio (Centro de control)", () => {
    assert.strictEqual(V.puedeEnviarFila({ config: { activo: true }, conexion: "conectado", autorizado: true }), true);
    assert.strictEqual(V.puedeEnviarFila({ config: { activo: true }, conexion: "no_visto", autorizado: true }), false);
    assert.strictEqual(V.puedeEnviarFila({ config: { activo: true }, conexion: "conectado", autorizado: false }), false);
    assert.strictEqual(V.puedeEnviarFila({ config: { activo: true }, conexion: "comprobando", autorizado: true }), null);
    assert.strictEqual(V.motivoSinEnvio("conectado", false), "El grupo no está autorizado.");
    assert.strictEqual(V.motivoSinEnvio("no_visto", true), "El grupo no aparece en tu WhatsApp.");
    assert.strictEqual(V.motivoSinEnvio("conectado", true), null);
});

console.log(`\n${total - fallidas}/${total} pruebas correctas`);
if (fallidas > 0) process.exit(1);
