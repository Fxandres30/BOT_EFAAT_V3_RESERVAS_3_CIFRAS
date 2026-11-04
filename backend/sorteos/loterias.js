// ==========================================================================
// sorteos/loterias.js — Calendario de loterías (migración 025).
//
// Un catálogo POR CLIENTE, compartido por todos sus sorteos. Cada función
// recibe el usuarioId del TOKEN y filtra por él: una lotería ajena se
// comporta como inexistente.
//
// Configuración inicial: los 42 sorteos del listado del administrador con
// días, horas, reglas de domingo/festivos y frecuencia (catalogoBase.js). Es
// la copia inicial de CADA cliente: lo que edita queda solo en su calendario
// y puede volver a ella con «Restaurar». Lo que el listado no dice (festivos
// de muchos sorteos) queda «sin_regla»: no se inventa.
// ==========================================================================

const supabase = require("../lib/supabase");
const { horarioPara, proximoSorteo } = require("./calendario");
const { CATALOGO_BASE, NOTA_SIEMBRA_ANTIGUA, claveDe, baseDe, copiaBase } = require("./catalogoBase");

const TABLA = "loterias_catalogo";
const GLOBAL = "loterias_catalogo_global";            // migración 026
const OFRECIDAS = "loterias_catalogo_ofrecidas";        // migración 026
const COLUMNAS_BASE = "id, nombre, modalidad, categoria, dias, hora, horas_por_dia, regla_festivo, hora_festivo, notas, activo, creado_en, actualizado_en";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const CATEGORIAS = new Set(["chance", "tradicional"]);
const REGLAS_FESTIVO = new Set(["sin_regla", "no_se_juega", "hora_habitual", "hora_especial"]);
const FRECUENCIAS = new Set(["semanal", "mensual"]);

// Configuración inicial completa (42 sorteos con horarios): catalogoBase.js.
// Se conserva el nombre antiguo para quien lo importe.
const CATALOGO_INICIAL = CATALOGO_BASE;

// --------------------------------------------- columna frecuencia (044) ---
// La migración 044 añade «frecuencia». Sin ella todo sigue funcionando: la
// columna se omite y la frecuencia se deduce de la configuración inicial
// (solo el Extra de Colombia es mensual). Se vuelve a comprobar cada 10 min
// para que aplicar la 044 no exija reiniciar el backend.
let frecuenciaDisponible = null;
let frecuenciaRevisadaEn = 0;
const REVISAR_FRECUENCIA_MS = 10 * 60 * 1000;

const faltaColumnaFrecuencia = (error) => !!error && ["42703", "PGRST204"].includes(error.code) && /frecuencia/i.test(error.message || "");
const columnas = (con) => (con ? `${COLUMNAS_BASE}, frecuencia` : COLUMNAS_BASE);
const frecuenciaDeducida = (f) => baseDe(f)?.frecuencia || "semanal";

function sinFrecuencia(x) {
    if (Array.isArray(x)) return x.map(sinFrecuencia);
    const { frecuencia, ...resto } = x || {};
    void frecuencia;
    return resto;
}

// Ejecuta consulta(con) con la columna si existe; si la base responde que no
// existe, repite sin ella. exige(conColumna=false) -> error a devolver cuando
// lo pedido no se puede guardar sin la columna (antes de escribir nada).
async function conFrecuencia(consulta, { exige } = {}) {

    if (frecuenciaDisponible === false && Date.now() - frecuenciaRevisadaEn > REVISAR_FRECUENCIA_MS) frecuenciaDisponible = null;

    if (frecuenciaDisponible !== false) {
        const r = await consulta(true);
        if (!faltaColumnaFrecuencia(r.error)) {
            if (!r.error) frecuenciaDisponible = true;
            return r;
        }
        frecuenciaDisponible = false;
        frecuenciaRevisadaEn = Date.now();
    }

    const bloqueo = exige ? exige() : null;
    if (bloqueo) return { bloqueo };
    return consulta(false);

}

const faltaTabla = (error) => error?.code === "42P01" || error?.code === "PGRST205";

function resultado(data, error) {
    if (!error) return { ok: true, data };
    const sinTabla = faltaTabla(error);
    const motivo = sinTabla ? "migracion_pendiente" : error.code === "23505" ? "nombre_duplicado" : "error_supabase";
    // Error real al log del servidor (código y mensaje de la base; sin datos
    // de clientes). Al panel solo llega el motivo.
    if (motivo !== "nombre_duplicado") console.error(`❌ [LOTERIAS] ${motivo}: ${error.code || "sin código"} ${error.message || ""}`.trim());
    return {
        ok: false,
        motivo,
        ...(sinTabla ? { migracion: "025" } : {}),
        error: error.message
    };
}

const hhmm = (h) => (h ? String(h).slice(0, 5) : null);

// Postgres devuelve time como "14:30:00": el panel trabaja con "HH:MM".
function normalizar(f) {
    if (!f) return f;
    const porDia = {};
    for (const [d, h] of Object.entries(f.horas_por_dia || {})) porDia[d] = hhmm(h);
    const { usuario_id, origen_global_id, ...resto } = f;
    void usuario_id; void origen_global_id;
    return {
        ...resto,
        dias: (f.dias || []).map(Number).sort(),
        hora: hhmm(f.hora),
        hora_festivo: hhmm(f.hora_festivo),
        horas_por_dia: porDia,
        frecuencia: FRECUENCIAS.has(f.frecuencia) ? f.frecuencia : frecuenciaDeducida(f),
        etiqueta: f.modalidad ? `${f.nombre} ${f.modalidad}` : f.nombre,
        // Tiene configuración inicial a la que volver («Restaurar»).
        restaurable: !!baseDe(f)
    };
}

function validar(entrada = {}, { parcial = false } = {}) {

    const errores = [];
    const datos = {};
    const tiene = (k) => !parcial || Object.prototype.hasOwnProperty.call(entrada, k);
    const hora = (v) => (v === null || v === undefined || v === "" ? null : String(v).trim());

    if (tiene("nombre")) {
        datos.nombre = String(entrada.nombre ?? "").trim().slice(0, 60);
        if (!datos.nombre) errores.push({ campo: "nombre", mensaje: "Indica el nombre de la lotería." });
    }
    if (tiene("modalidad")) datos.modalidad = String(entrada.modalidad ?? "").trim().slice(0, 30);
    if (tiene("categoria")) {
        datos.categoria = String(entrada.categoria ?? "chance");
        if (!CATEGORIAS.has(datos.categoria)) errores.push({ campo: "categoria", mensaje: "Categoría inválida." });
    }
    if (tiene("dias")) {
        const dias = Array.isArray(entrada.dias) ? [...new Set(entrada.dias.map(Number))].sort() : [];
        if (dias.some(d => !Number.isInteger(d) || d < 1 || d > 7)) errores.push({ campo: "dias", mensaje: "Días inválidos." });
        datos.dias = dias;
    }
    if (tiene("hora")) {
        datos.hora = hora(entrada.hora);
        if (datos.hora && !HORA.test(datos.hora)) errores.push({ campo: "hora", mensaje: "Hora inválida (HH:MM, 24 h)." });
    }
    if (tiene("horas_por_dia")) {
        const porDia = {};
        for (const [d, h] of Object.entries(entrada.horas_por_dia || {})) {
            const v = hora(h);
            if (!v) continue;
            if (!/^[1-7]$/.test(d) || !HORA.test(v)) errores.push({ campo: "horas_por_dia", mensaje: "Hora por día inválida." });
            else porDia[d] = v.slice(0, 5);
        }
        datos.horas_por_dia = porDia;
    }
    if (tiene("regla_festivo")) {
        datos.regla_festivo = String(entrada.regla_festivo ?? "sin_regla");
        if (!REGLAS_FESTIVO.has(datos.regla_festivo)) errores.push({ campo: "regla_festivo", mensaje: "Regla de festivos inválida." });
    }
    if (tiene("hora_festivo")) {
        datos.hora_festivo = hora(entrada.hora_festivo);
        if (datos.hora_festivo && !HORA.test(datos.hora_festivo)) errores.push({ campo: "hora_festivo", mensaje: "Hora de festivo inválida." });
    }
    if (datos.regla_festivo === "hora_especial" && !datos.hora_festivo && !parcial) {
        errores.push({ campo: "hora_festivo", mensaje: "La regla «hora especial» necesita la hora de los festivos." });
    }
    if (tiene("frecuencia")) {
        datos.frecuencia = String(entrada.frecuencia ?? "semanal");
        if (!FRECUENCIAS.has(datos.frecuencia)) errores.push({ campo: "frecuencia", mensaje: "Frecuencia inválida (semanal o mensual)." });
    }
    if (tiene("notas")) datos.notas = String(entrada.notas ?? "").trim().slice(0, 500) || null;
    if (tiene("activo")) datos.activo = entrada.activo !== false;

    return { errores, datos };

}

// Campos de la configuración inicial que se escriben en el calendario del
// cliente (al sembrar, completar o restaurar).
const CAMPOS_BASE = ["nombre", "modalidad", "categoria", "dias", "hora", "horas_por_dia", "regla_festivo", "hora_festivo", "notas", "frecuencia"];
const camposBase = (b) => Object.fromEntries(CAMPOS_BASE.map(c => [c, b[c]]));

// Inserta entradas de la configuración inicial que el cliente no tiene. La
// restricción única (usuario_id, nombre, modalidad) evita duplicados aunque
// dos peticiones lleguen a la vez.
async function insertarBase(usuarioId, bases) {

    if (!bases.length) return { ok: true, data: 0 };
    const filas = bases.map(b => ({ usuario_id: usuarioId, activo: true, ...camposBase(b) }));
    const r = await conFrecuencia((con) => supabase.from(TABLA).upsert(con ? filas : sinFrecuencia(filas), { onConflict: "usuario_id,nombre,modalidad", ignoreDuplicates: true }));
    if (r.error && r.error.code !== "23505") return resultado(null, r.error);
    return { ok: true, data: filas.length };

}

// Sin la migración 026: si el calendario está vacío se siembra la
// configuración inicial COMPLETA (42 sorteos con horarios).
async function sembrarSinGlobal(usuarioId) {

    const { count, error } = await supabase.from(TABLA).select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);
    if (error) return resultado(null, error);
    if (count) return { ok: true, data: 0, sinGlobal: true };

    const r = await insertarBase(usuarioId, CATALOGO_BASE);
    return r.ok ? { ...r, sinGlobal: true } : r;

}

// Con la migración 026: SINCRONIZACIÓN SEGURA con el catálogo global. Cada
// vez que el cliente abre su calendario se le copian solo las entradas
// globales que NUNCA se le ofrecieron (la primera vez: todas). Queda
// registrado qué se le ofreció, así:
//   - lo que editó no se sobrescribe (nunca se actualizan sus copias);
//   - lo que eliminó no vuelve (ya consta como ofrecido);
//   - una entrada global nueva le llega una vez, salvo que ya tenga una
//     propia con el mismo nombre y modalidad (entonces solo se marca).
const CAMPOS_COPIA = ["nombre", "modalidad", "categoria", "dias", "hora", "horas_por_dia", "regla_festivo", "hora_festivo", "notas"];

async function copiarEntradas(filas) {

    const subir = (lote) => conFrecuencia((con) => supabase.from(TABLA).upsert(con ? lote : sinFrecuencia(lote), { onConflict: "usuario_id,origen_global_id", ignoreDuplicates: true }));

    const { error } = await subir(filas);
    if (!error) return { ok: true };
    if (error.code !== "23505") return resultado(null, error);

    // Choque por nombre (el cliente creó una igual en paralelo): una a una.
    for (const fila of filas) {
        const r = await subir([fila]);
        if (r.error && r.error.code !== "23505") return resultado(null, r.error);
    }
    return { ok: true };

}

async function sincronizarDesdeGlobal(usuarioId) {

    const global = await supabase.from(GLOBAL).select(`id, ${CAMPOS_COPIA.join(", ")}`).eq("activo", true);
    if (global.error) return faltaTabla(global.error) ? sembrarSinGlobal(usuarioId) : resultado(null, global.error);

    const ofrecidas = await supabase.from(OFRECIDAS).select("global_id").eq("usuario_id", usuarioId);
    if (ofrecidas.error) return faltaTabla(ofrecidas.error) ? sembrarSinGlobal(usuarioId) : resultado(null, ofrecidas.error);

    const yaOfrecidas = new Set((ofrecidas.data || []).map(o => o.global_id));
    const nuevas = (global.data || []).filter(g => !yaOfrecidas.has(g.id));
    if (!nuevas.length) return { ok: true, data: 0 };

    const propias = await supabase.from(TABLA).select("nombre, modalidad, origen_global_id").eq("usuario_id", usuarioId);
    if (propias.error) return resultado(null, propias.error);

    const yaTiene = new Set((propias.data || []).map(claveDe));
    const yaCopiadas = new Set((propias.data || []).map(f => f.origen_global_id).filter(Boolean));

    // La frecuencia no está en la 026: sale de la configuración inicial.
    const filas = nuevas
        .filter(g => !yaCopiadas.has(g.id) && !yaTiene.has(claveDe(g)))
        .map(g => ({ usuario_id: usuarioId, origen_global_id: g.id, activo: true, ...Object.fromEntries(CAMPOS_COPIA.map(c => [c, g[c]])), frecuencia: frecuenciaDeducida(g) }));

    if (filas.length) {
        const copia = await copiarEntradas(filas);
        if (!copia.ok) return copia;
    }

    const marcas = nuevas.map(g => ({ usuario_id: usuarioId, global_id: g.id }));
    const { error } = await supabase.from(OFRECIDAS).upsert(marcas, { onConflict: "usuario_id,global_id", ignoreDuplicates: true });
    if (error) return resultado(null, error);

    return { ok: true, data: filas.length };

}

// Fila sembrada por la versión antigua (27 nombres sin horario) que el
// cliente NUNCA tocó: nota de siembra y ningún dato de horario.
const esSiembraAntigua = (f) =>
    f.notas === NOTA_SIEMBRA_ANTIGUA
    && !f.hora && !f.hora_festivo
    && !(f.dias || []).length
    && !Object.keys(f.horas_por_dia || {}).length
    && (f.regla_festivo || "sin_regla") === "sin_regla"
    && !!baseDe(f);

// Completa con la configuración inicial las filas de la siembra antigua.
// El UPDATE repite las condiciones (nota y hora vacía): si el cliente la
// editó entre la lectura y la escritura, no se pisa. Sin la 026, la siembra
// antigua nunca ofreció los 15 sorteos tradicionales: se agregan en ese mismo
// momento (una sola vez; después ya no quedan filas antiguas).
// Nombre de la fuente (p. ej. «La Caribeña» en vez de «Caribeña») al
// completar o restaurar. Si el cliente ya tiene otra lotería con ese nombre
// (restricción única), se conserva el nombre actual: nunca se duplica ni falla.
async function conNombreBase(ejecutar, cambios, actual, base) {
    if (!base || actual.nombre === base.nombre) return ejecutar(cambios);
    const r = await ejecutar({ ...cambios, nombre: base.nombre });
    const duplicado = r?.error?.code === "23505" || r?.motivo === "nombre_duplicado";
    return duplicado ? ejecutar(cambios) : r;
}

const sinNombre = (b) => {
    const { nombre, modalidad, ...resto } = camposBase(b);
    void nombre; void modalidad;
    return resto;
};

async function completarSiembraAntigua(usuarioId, filas, { agregarTradicionales }) {

    const pendientes = filas.filter(esSiembraAntigua);
    if (!pendientes.length) return { ok: true, data: 0 };

    for (const f of pendientes) {
        const b = baseDe(f);
        const cambios = { ...sinNombre(b), actualizado_en: new Date().toISOString() };
        const r = await conNombreBase((c) => conFrecuencia((con) => supabase.from(TABLA)
            .update(con ? c : sinFrecuencia(c))
            .eq("usuario_id", usuarioId)
            .eq("id", f.id)
            .eq("notas", NOTA_SIEMBRA_ANTIGUA)
            .is("hora", null)), cambios, f, b);
        if (r.error) return resultado(null, r.error);
    }

    let agregadas = 0;
    if (agregarTradicionales && !filas.some(f => f.categoria === "tradicional")) {
        const tiene = new Set(filas.map(claveDe));
        const r = await insertarBase(usuarioId, CATALOGO_BASE.filter(b => b.categoria === "tradicional" && !tiene.has(claveDe(b))));
        if (!r.ok) return r;
        agregadas = r.data;
    }

    console.log(`🗓️ [LOTERIAS] calendario completado: ${pendientes.length} sin horario + ${agregadas} tradicionales`);
    return { ok: true, data: pendientes.length + agregadas };

}

async function leerPropias(usuarioId) {
    return conFrecuencia((con) => supabase.from(TABLA).select(columnas(con)).eq("usuario_id", usuarioId).order("nombre", { ascending: true }));
}

const conProximo = (f, ahora) => {
    const p = proximoSorteo(f, ahora);
    return { ...f, proximo: p.data, proximo_nota: p.data ? null : p.nota };
};

async function listar(usuarioId, { ahora = new Date() } = {}) {

    const siembra = await sincronizarDesdeGlobal(usuarioId);
    if (!siembra.ok) return siembra;

    let { data, error } = await leerPropias(usuarioId);
    if (error) return resultado(null, error);

    const completado = await completarSiembraAntigua(usuarioId, data || [], { agregarTradicionales: !!siembra.sinGlobal });
    if (!completado.ok) return completado;
    if (completado.data) {
        ({ data, error } = await leerPropias(usuarioId));
        if (error) return resultado(null, error);
    }

    const orden = (f) => `${f.categoria}|${f.nombre}|${f.modalidad}`;
    return {
        ok: true,
        data: (data || []).map(normalizar).map(f => conProximo(f, ahora)).sort((a, b) => orden(a).localeCompare(orden(b), "es"))
    };

}

async function obtener(usuarioId, id) {

    if (!UUID.test(id || "")) return { ok: false, motivo: "no_encontrado" };

    const { data, error } = await conFrecuencia((con) => supabase.from(TABLA).select(columnas(con)).eq("usuario_id", usuarioId).eq("id", id).maybeSingle());
    if (error) return resultado(null, error);
    if (!data) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: normalizar(data) };

}

// Sin la 044 la frecuencia no se guarda: solo se acepta la que ya se deduce.
const bloqueoFrecuencia = (pedida, fila) => () => (pedida && pedida !== frecuenciaDeducida(fila)
    ? { ok: false, motivo: "migracion_pendiente", migracion: "044", errores: [{ campo: "frecuencia", mensaje: "Para cambiar la frecuencia falta aplicar la migración 044." }] }
    : null);

async function crear(usuarioId, entrada) {

    const { errores, datos } = validar(entrada);
    if (errores.length) return { ok: false, motivo: "validacion", errores };

    const fila = { ...datos, usuario_id: usuarioId };
    const r0 = await conFrecuencia(
        (con) => supabase.from(TABLA).insert(con ? fila : sinFrecuencia(fila)).select(columnas(con)).single(),
        { exige: bloqueoFrecuencia(datos.frecuencia, datos) }
    );
    if (r0.bloqueo) return r0.bloqueo;
    const r = resultado(r0.data, r0.error);
    return r.ok ? { ok: true, data: normalizar(r0.data) } : r;

}

async function escribir(usuarioId, id, datos, filaActual) {

    const cambios = { ...datos, actualizado_en: new Date().toISOString() };
    const r0 = await conFrecuencia(
        (con) => supabase.from(TABLA)
            .update(con ? cambios : sinFrecuencia(cambios))
            .eq("usuario_id", usuarioId)
            .eq("id", id)
            .select(columnas(con))
            .maybeSingle(),
        { exige: bloqueoFrecuencia(datos.frecuencia, { ...filaActual, ...datos }) }
    );
    if (r0.bloqueo) return r0.bloqueo;

    const r = resultado(r0.data, r0.error);
    if (!r.ok) return r;
    if (!r0.data) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: normalizar(r0.data) };

}

async function actualizar(usuarioId, id, entrada) {

    const actual = await obtener(usuarioId, id);
    if (!actual.ok) return actual;

    const { errores, datos } = validar(entrada, { parcial: true });
    const regla = datos.regla_festivo ?? actual.data.regla_festivo;
    const horaFestivo = "hora_festivo" in datos ? datos.hora_festivo : actual.data.hora_festivo;
    if (regla === "hora_especial" && !horaFestivo) errores.push({ campo: "hora_festivo", mensaje: "La regla «hora especial» necesita la hora de los festivos." });
    if (errores.length) return { ok: false, motivo: "validacion", errores };

    // Una frecuencia que no cambia no exige la 044.
    if (datos.frecuencia === actual.data.frecuencia) delete datos.frecuencia;

    return escribir(usuarioId, id, datos, actual.data);

}

// Vuelve UNA lotería de SU calendario a la configuración inicial (horarios,
// días, reglas, frecuencia y notas; queda activa). Solo la del cliente.
async function restaurar(usuarioId, id) {

    const actual = await obtener(usuarioId, id);
    if (!actual.ok) return actual;

    const b = baseDe(actual.data);
    if (!b) return { ok: false, motivo: "sin_configuracion_inicial" };

    return conNombreBase((c) => escribir(usuarioId, id, c, actual.data), { ...sinNombre(b), activo: true }, actual.data, b);

}

// Restaura TODO su calendario a la configuración inicial: las 42 entradas
// vuelven a sus valores (las que eliminó se agregan de nuevo). Las loterías
// que el cliente creó y no están en la configuración inicial se conservan.
async function restaurarTodo(usuarioId) {

    const { data, error } = await leerPropias(usuarioId);
    if (error) return resultado(null, error);

    const propias = new Map((data || []).map(f => [claveDe(f), f]));
    let restauradas = 0;

    for (const b of CATALOGO_BASE) {
        const f = propias.get(claveDe(b));
        if (!f) continue;
        const cambios = { ...sinNombre(b), activo: true, actualizado_en: new Date().toISOString() };
        const r = await conNombreBase((c) => conFrecuencia((con) => supabase.from(TABLA).update(con ? c : sinFrecuencia(c)).eq("usuario_id", usuarioId).eq("id", f.id)), cambios, f, b);
        if (r.error) return resultado(null, r.error);
        restauradas++;
    }

    const faltan = CATALOGO_BASE.filter(b => !propias.has(claveDe(b)));
    const agregadas = await insertarBase(usuarioId, faltan);
    if (!agregadas.ok) return agregadas;

    const base = new Set(CATALOGO_BASE.map(claveDe));
    const conservadas = (data || []).filter(f => !base.has(claveDe(f))).length;

    return { ok: true, data: { restauradas, agregadas: faltan.length, conservadas } };

}

// Elimina una entrada del calendario DEL CLIENTE (nunca la del catálogo
// global ni la de otro cliente). Los sorteos que la usaban conservan su copia
// del nombre.
async function eliminar(usuarioId, id) {

    if (!UUID.test(id || "")) return { ok: false, motivo: "no_encontrado" };

    const { data, error } = await supabase.from(TABLA).delete().eq("usuario_id", usuarioId).eq("id", id).select("id");
    if (error) return resultado(null, error);
    if (!data || !data.length) return { ok: false, motivo: "no_encontrado" };
    return { ok: true, data: { id } };

}

async function horario(usuarioId, id, fecha) {

    const loteria = await obtener(usuarioId, id);
    if (!loteria.ok) return loteria;

    const r = horarioPara(loteria.data, String(fecha || ""));
    return r.ok ? { ok: true, data: { ...r.data, loteria: loteria.data.etiqueta } } : r;

}

// Solo para pruebas: olvida la detección de la columna frecuencia.
function _reiniciarDeteccion() {
    frecuenciaDisponible = null;
    frecuenciaRevisadaEn = 0;
}

module.exports = {
    CATALOGO_INICIAL,
    CATALOGO_BASE,
    copiaBase,
    listar,
    obtener,
    crear,
    actualizar,
    restaurar,
    restaurarTodo,
    eliminar,
    horario,
    _reiniciarDeteccion
};
