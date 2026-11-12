// ==========================================================================
// rifas/repositorio.js — ÚNICA puerta del backend al motor de rifas (050).
//
// Reglas (docs/rifas/MOTOR_RIFAS.md §2):
//   1. Toda lectura y escritura lleva usuario_id Y tabla_id. El precio nunca
//      identifica una rifa.
//   2. Solo se escribe con las funciones rifa_* (transaccionales, auditadas
//      en reservas_auditoria). Nada de update/insert directos.
//   3. usuarioId SIEMPRE lo decide el servidor (token del panel o dueño de
//      la sesión de WhatsApp). Aquí se exige un UUID y nada más: validar de
//      quién es la petición es trabajo del llamador.
//
// Las funciones devuelven lo mismo que rifa_*: { ok: true, ... } o
// { ok: false, motivo, ... }. Un fallo de conexión o de Supabase se informa
// como { ok: false, motivo: "error_supabase", error } — nunca se lanza, para
// que el bot y el panel respondan siempre algo.
// ==========================================================================

const { esUuid, aEnteros, filaLegado } = require("./formato");

// Perezoso: las pruebas inyectan su cliente en require.cache antes de usarlo.
const db = () => require("../lib/supabase");

const ORIGENES = new Set(["bot", "manual", "sistema", "migracion"]);
const MAX_NUMEROS = 1000;

const rechazo = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

// Actor de la operación (quién y por qué), tal como lo espera rifa_*.
function actor({ origen = "manual", operadorId = null, operadorEmail = null, solicitudId = null, motivo = null } = {}) {
    if (!ORIGENES.has(origen)) throw new Error(`origen inválido: ${origen}`);
    const a = { origen };
    if (operadorId) a.operador_id = operadorId;
    if (operadorEmail) a.operador_email = operadorEmail;
    if (solicitudId) a.solicitud_id = String(solicitudId).slice(0, 80);
    if (motivo) a.motivo = String(motivo).slice(0, 500);
    return a;
}

async function llamar(funcion, args) {
    try {
        const { data, error } = await db().rpc(funcion, args);
        if (error) {
            console.error(`❌ [RIFAS] ${funcion}: ${error.message}`);
            return rechazo("error_supabase", { error: error.message, codigo: error.code });
        }
        if (!data || typeof data !== "object") return rechazo("respuesta_vacia");
        return data;
    } catch (e) {
        console.error(`❌ [RIFAS] ${funcion}: ${e.message}`);
        return rechazo("error_supabase", { error: e.message });
    }
}

// Validación común: cliente y rifa con forma de UUID (falla cerrado).
function idsValidos(usuarioId, tablaId) {
    if (!esUuid(usuarioId)) return rechazo("sin_cliente");
    if (tablaId !== undefined && !esUuid(tablaId)) return rechazo("rifa_no_encontrada");
    return null;
}

// Números pedidos -> enteros. Los textos inválidos ("7a", "123" en una rifa
// de 2 cifras) se devuelven aparte; nunca se mandan al motor.
function prepararNumeros(numeros, rifa) {
    const { numeros: validos, invalidos } = aEnteros(numeros, rifa ? { cifras: rifa.cifras } : {});
    if (validos.length > MAX_NUMEROS) return { error: rechazo("demasiados_numeros", { maximo: MAX_NUMEROS }) };
    return { validos, invalidos };
}

// ---------------------------------------------------------------- lecturas

async function obtenerRifa(usuarioId, tablaId) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return null;
    const { data, error } = await db()
        .from("tablas_rifas")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("id", tablaId)
        .maybeSingle();
    if (error) throw new Error(`[RIFAS] obtenerRifa: ${error.message}`);
    return data || null;
}

// Rifas del cliente con sus conteos (vista rifas_resumen). Sin las
// archivadas, salvo que se pidan.
async function listarRifas(usuarioId, { incluirArchivadas = false } = {}) {
    if (!esUuid(usuarioId)) return [];
    let q = db().from("rifas_resumen").select("*").eq("usuario_id", usuarioId);
    if (!incluirArchivadas) q = q.is("archivada_en", null);
    const { data, error } = await q.order("creado_en", { ascending: true });
    if (error) throw new Error(`[RIFAS] listarRifas: ${error.message}`);
    return data || [];
}

// Números de UNA rifa del cliente. Opcional: solo algunos números o estados.
// { rifa, filas } con filas en la forma de las cuadrículas antiguas.
async function leerNumeros(usuarioId, tablaId, { numeros = null, estados = null } = {}) {
    const rifa = await obtenerRifa(usuarioId, tablaId);
    if (!rifa) return { rifa: null, filas: [] };
    let q = db().from("numeros_rifa").select("*")
        .eq("usuario_id", usuarioId)
        .eq("tabla_id", tablaId);
    if (numeros) {
        const { numeros: validos } = aEnteros(numeros, { cifras: rifa.cifras, cantidad: rifa.cantidad });
        if (validos.length === 0) return { rifa, filas: [] };
        q = q.in("numero", validos);
    }
    if (estados) q = q.in("estado", estados);
    const filas = [];
    // Hasta 10.000 números por rifa: se lee por páginas (PostgREST corta en 1000).
    for (let desde = 0; ; desde += 1000) {
        const { data, error } = await q.order("numero", { ascending: true }).range(desde, desde + 999);
        if (error) throw new Error(`[RIFAS] leerNumeros: ${error.message}`);
        filas.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return { rifa, filas: filas.map(f => filaLegado(f, rifa)) };
}

// Números de un titular (teléfono, LID/LIB o persona) en UNA rifa. Es la
// lectura de «mis números», «debo», «pagué» del bot.
async function numerosDelTitular(usuarioId, tablaId, { telefono = null, lid = null, usuarioGlobalId = null } = {}, { estados = ["reservado", "en_proceso", "pagado"] } = {}) {
    const condiciones = [];
    if (telefono) condiciones.push(`telefono.eq.${telefono}`);
    if (lid) condiciones.push(`lid.eq.${lid}`, `lib.eq.${lid}`);
    if (usuarioGlobalId && esUuid(usuarioGlobalId)) condiciones.push(`usuario_global_id.eq.${usuarioGlobalId}`);
    if (condiciones.length === 0) return { rifa: null, filas: [] };
    // Los valores van en un filtro or() de PostgREST: se rechaza lo que
    // pueda romper la sintaxis (comas, paréntesis) en vez de escaparlo.
    if (condiciones.some(c => /[,()]/.test(c.split(".eq.")[1]))) return { rifa: null, filas: [] };
    const rifa = await obtenerRifa(usuarioId, tablaId);
    if (!rifa) return { rifa: null, filas: [] };
    const { data, error } = await db().from("numeros_rifa").select("*")
        .eq("usuario_id", usuarioId)
        .eq("tabla_id", tablaId)
        .in("estado", estados)
        .or(condiciones.join(","))
        .order("numero", { ascending: true });
    if (error) throw new Error(`[RIFAS] numerosDelTitular: ${error.message}`);
    return { rifa, filas: (data || []).map(f => filaLegado(f, rifa)) };
}

// Vínculos de un grupo (del cliente) y de una rifa.
async function rifasDelGrupo(usuarioId, grupoId) {
    if (!esUuid(usuarioId) || !grupoId) return [];
    const { data, error } = await db().from("grupos_rifa").select("*")
        .eq("usuario_id", usuarioId).eq("grupo_id", grupoId).eq("activo", true);
    if (error) throw new Error(`[RIFAS] rifasDelGrupo: ${error.message}`);
    return data || [];
}

async function gruposDeRifa(usuarioId, tablaId) {
    if (idsValidos(usuarioId, tablaId)) return [];
    const { data, error } = await db().from("grupos_rifa").select("*")
        .eq("usuario_id", usuarioId).eq("tabla_id", tablaId).eq("activo", true);
    if (error) throw new Error(`[RIFAS] gruposDeRifa: ${error.message}`);
    return data || [];
}

// Historial de reinicios (numeros_rifa_archivo) de una rifa.
async function leerArchivo(usuarioId, tablaId, { ciclo = null, limite = 1000 } = {}) {
    if (idsValidos(usuarioId, tablaId)) return [];
    let q = db().from("numeros_rifa_archivo").select("*")
        .eq("usuario_id", usuarioId).eq("tabla_id", tablaId);
    if (ciclo != null) q = q.eq("ciclo", ciclo);
    const { data, error } = await q.order("archivado_en", { ascending: false }).limit(limite);
    if (error) throw new Error(`[RIFAS] leerArchivo: ${error.message}`);
    return data || [];
}

// ---------------------------------------------------------------- escrituras

async function crearRifa(usuarioId, { nombre, precio, cifras = 2, cantidad = null, config = {}, codigo = null }, quien) {
    if (!esUuid(usuarioId)) return rechazo("sin_cliente");
    const total = cantidad ?? 10 ** Number(cifras);
    return llamar("rifa_crear", {
        p_usuario: usuarioId, p_nombre: nombre, p_precio: precio, p_cifras: cifras,
        p_cantidad: total, p_config: config || {}, p_codigo: codigo || null, p_actor: quien || actor()
    });
}

// datos: comprador, contacto, telefono, lid, lib, usuario_global_id,
//        grupo_id, grupo_nombre, evento_id, identidad_evento_real, observaciones
async function reservar(usuarioId, tablaId, numeros, datos, quien, { todoONada = false, rifa = null } = {}) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    const p = prepararNumeros(numeros, rifa);
    if (p.error) return p.error;
    if (p.validos.length === 0) return rechazo("sin_numeros", { invalidos: p.invalidos });
    const r = await llamar("rifa_reservar", {
        p_usuario: usuarioId, p_tabla: tablaId, p_numeros: p.validos,
        p_datos: datos || {}, p_actor: quien || actor({ origen: "bot" }), p_todo_o_nada: Boolean(todoONada)
    });
    return p.invalidos.length ? { ...r, invalidos: p.invalidos } : r;
}

// datos.titular = { telefono, lid, usuario_global_id }: solo números de ese titular.
async function pagar(usuarioId, tablaId, numeros, datos, quien, { rifa = null } = {}) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    const p = prepararNumeros(numeros, rifa);
    if (p.error) return p.error;
    if (p.validos.length === 0) return rechazo("sin_numeros", { invalidos: p.invalidos });
    return llamar("rifa_pagar", { p_usuario: usuarioId, p_tabla: tablaId, p_numeros: p.validos, p_datos: datos || {}, p_actor: quien || actor() });
}

// opciones: { incluirPagados, incluirBloqueados }
// reservadoAntesDe / identidadEventoReal: condiciones que la BASE comprueba con
// la fila bloqueada (050): nunca se libera una reserva nueva hecha entre la
// lectura del llamador y la liberación (vencimientos).
async function liberar(usuarioId, tablaId, numeros, datos, quien, { incluirPagados = false, incluirBloqueados = false, reservadoAntesDe = null, identidadEventoReal = null, rifa = null } = {}) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    const p = prepararNumeros(numeros, rifa);
    if (p.error) return p.error;
    if (p.validos.length === 0) return rechazo("sin_numeros", { invalidos: p.invalidos });
    return llamar("rifa_liberar", {
        p_usuario: usuarioId, p_tabla: tablaId, p_numeros: p.validos, p_datos: datos || {}, p_actor: quien || actor(),
        p_opciones: {
            incluir_pagados: Boolean(incluirPagados), incluir_bloqueados: Boolean(incluirBloqueados),
            ...(reservadoAntesDe ? { reservado_antes_de: new Date(reservadoAntesDe).toISOString() } : {}),
            ...(identidadEventoReal ? { identidad_evento_real: String(identidadEventoReal) } : {})
        }
    });
}

async function bloquear(usuarioId, tablaId, numeros, quien, { hasta = null, rifa = null } = {}) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    const p = prepararNumeros(numeros, rifa);
    if (p.error) return p.error;
    if (p.validos.length === 0) return rechazo("sin_numeros", { invalidos: p.invalidos });
    return llamar("rifa_bloquear", { p_usuario: usuarioId, p_tabla: tablaId, p_numeros: p.validos, p_actor: quien || actor(), p_hasta: hasta });
}

// Solo ESTA rifa: archiva sus ocupados, la deja libre y sube el ciclo.
async function reiniciar(usuarioId, tablaId, confirmacion, quien) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    return llamar("rifa_reiniciar", { p_usuario: usuarioId, p_tabla: tablaId, p_confirmacion: confirmacion, p_actor: quien || actor() });
}

// cambios: nombre, codigo, activa, visible, config, precio, cifras, cantidad
async function actualizar(usuarioId, tablaId, cambios, quien) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    return llamar("rifa_actualizar", { p_usuario: usuarioId, p_tabla: tablaId, p_cambios: cambios || {}, p_actor: quien || actor() });
}

const conRifa = (funcion) => async (usuarioId, tablaId, quien) => {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    return llamar(funcion, { p_usuario: usuarioId, p_tabla: tablaId, p_actor: quien || actor() });
};

const archivar = conRifa("rifa_archivar");
const restaurar = conRifa("rifa_restaurar");
const eliminar = conRifa("rifa_eliminar");

async function vincularGrupo(usuarioId, grupoId, tablaId, { predeterminada = false } = {}, quien) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    if (!grupoId) return rechazo("sin_grupo");
    return llamar("rifa_vincular_grupo", { p_usuario: usuarioId, p_grupo: grupoId, p_tabla: tablaId, p_predeterminada: Boolean(predeterminada), p_actor: quien || actor() });
}

async function desvincularGrupo(usuarioId, grupoId, tablaId, quien) {
    const malo = idsValidos(usuarioId, tablaId);
    if (malo) return malo;
    if (!grupoId) return rechazo("sin_grupo");
    return llamar("rifa_desvincular_grupo", { p_usuario: usuarioId, p_grupo: grupoId, p_tabla: tablaId, p_actor: quien || actor() });
}

// Rifa de un mensaje de WhatsApp: código → (precio, solo entre las
// vinculadas) → única → predeterminada. Nunca por precio fuera de los
// vínculos ni al azar: si no queda una, { ok: false, motivo: ambigua | sin_rifa | ... }.
async function resolver(usuarioId, grupoId, { codigo = null, precio = null } = {}) {
    if (!esUuid(usuarioId)) return rechazo("sin_cliente");
    if (!grupoId) return rechazo("sin_grupo");
    const p = precio == null || precio === "" ? null : Number(precio);
    return llamar("rifa_resolver", {
        p_usuario: usuarioId, p_grupo: grupoId, p_codigo: codigo || null,
        p_precio: Number.isInteger(p) && p > 0 ? p : null
    });
}

module.exports = {
    actor,
    // lecturas
    obtenerRifa, listarRifas, leerNumeros, numerosDelTitular, rifasDelGrupo, gruposDeRifa, leerArchivo,
    // escrituras
    crearRifa, reservar, pagar, liberar, bloquear, reiniciar, actualizar, archivar, restaurar, eliminar,
    vincularGrupo, desvincularGrupo, resolver,
    MAX_NUMEROS
};
