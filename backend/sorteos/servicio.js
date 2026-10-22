// ==========================================================================
// sorteos/servicio.js — casos de uso del panel para sorteos programados,
// plantillas y cuentas de pago. Cada función recibe el usuarioId del TOKEN.
//
// Ciclo de un sorteo:
//   crear (borrador) -> vista previa -> confirmar (programado; exige la
//   versión vista) -> el publicador lo publica a su hora -> publicado.
//   editar: solo antes de publicar en ningún grupo; sube la versión y vuelve
//   a borrador (hay que revisar la vista previa y confirmar otra vez).
//   cancelar: nunca deshace lo ya publicado; cancela lo pendiente.
// ==========================================================================

const repo = require("./repo");
const loterias = require("./loterias");
const { validarSorteo, validarPlantilla, fechaSorteoDe, instanteBogota } = require("./validar");
const { normalizarConfigDiseno } = require("./disenoTabla");
const reinicioTabla = require("./reinicioTabla");
const tablaEvento = require("../automation/repo/tablaEvento");
const { mensajePublicacion, mensajeRecordatorio, mensajeAvisoCierre, VARIABLES } = require("./mensajes");
const { revisarTabla, revisarGrupo, cierresDeIdentidades, legible } = require("./disponibilidad");

// ¿El reinicio que HOY no es posible lo será al publicar? Solo si lo único
// que lo impide son números de sorteos activos cuyo cierre (conocido) llega
// antes de la publicación: entonces se hará al publicar, cuando ya estén
// cerrados (la 030 vuelve a decidir en ese momento; nunca toca uno activo).
async function reinicioDiferible(usuarioId, reinicio, porSorteo, publicarEn) {

    const protegidos = (porSorteo || []).filter(g => String(g.clase).startsWith("protegido"));
    if (!protegidos.length || protegidos.some(g => g.clase !== "protegido_activo" || !g.identidad)) return null;

    const r = await cierresDeIdentidades(usuarioId, protegidos.map(g => g.identidad), reloj.ahora());
    if (!r.ok) return null;

    let ultimo = null;
    for (const g of protegidos) {
        const c = r.cierres.get(g.identidad);
        if (!c || c.getTime() >= publicarEn.getTime()) return null;
        if (!ultimo || c > ultimo) ultimo = c;
    }

    return { ...reinicio, diferido: true, cierra_antes: ultimo.toISOString() };

}
const { crearIdentidadEventoReal } = require("../bot/funciones/eventos/identidadEventoReal");
const tablasCliente = require("../bot/funciones/eventos/tablasCliente");

const ESTADOS_EDITABLES = ["borrador", "programado"];

// Reloj inyectable (las pruebas fijan la hora; en producción, la real).
const reloj = { ahora: () => new Date() };

function falla(motivo, extra = {}) {
    return { ok: false, motivo, ...extra };
}

function identidadDe(usuarioId, config) {
    return crearIdentidadEventoReal({
        usuario_id: usuarioId,
        nombre_evento: config.nombre,
        hora_fin: config.hora_fin,
        valor: config.valor,
        // La fecha en que se JUEGA (puede ser posterior a la publicación).
        fecha_evento: fechaSorteoDe(config)
    });
}

// Copia del diseño de tabla elegido (ver disenoTabla.js). "biblioteca" solo
// acepta diseños DEL USUARIO; "actual" copia el diseño activo de esa tabla.
async function resolverDiseno(usuarioId, eleccion, precio) {

    const e = eleccion || { origen: "actual" };

    if (e.origen === "preset") return { ok: true, diseno: e };

    if (e.origen === "biblioteca") {
        const d = await repo.obtenerDisenoPropio(usuarioId, e.diseno_id);
        if (!d.ok && d.motivo !== "migracion_pendiente") return falla(d.motivo, { error: d.error });
        const config = d.ok && d.data ? normalizarConfigDiseno(d.data.config) : null;
        if (!config) return { ok: true, error: { campo: "diseno", mensaje: "Ese diseño no existe en tu biblioteca o no es válido." } };
        return { ok: true, diseno: { ...e, nombre: d.data.nombre, config } };
    }

    const v = await repo.obtenerConfigVisual(usuarioId, precio);
    const config = v.ok && v.data ? normalizarConfigDiseno(v.data.config) : null;
    return { ok: true, diseno: { origen: "actual", diseno_id: v.ok && v.data ? v.data.diseno_origen_id : null, nombre: null, config } };

}

// Valida todo lo que depende de datos del cliente: grupos autorizados,
// cuentas activas propias y plantilla propia.
async function prepararSorteo(usuarioId, entrada) {

    const v = validarSorteo(entrada, { ahora: reloj.ahora() });
    const errores = [...v.errores];

    // La tabla física sale de la configuración DE ESTE cliente
    // (tablas_cliente); validarSorteo solo conoce los precios base.
    let tablaCliente = null;
    if (v.tabla) {
        tablaCliente = await tablasCliente.obtenerConfiguracionCliente(usuarioId, v.config.valor);
        if (!tablaCliente) errores.push({ campo: "valor", mensaje: "Ese valor no tiene una tabla de números configurada en tu cuenta." });
    }

    const autorizados = await repo.gruposAutorizados(usuarioId);
    if (!autorizados.ok) return falla(autorizados.motivo, { error: autorizados.error });

    const porId = new Map(autorizados.data.map(g => [g.grupo_id, g]));
    const noAutorizados = v.config.grupos.filter(g => !porId.has(g));
    if (noAutorizados.length) errores.push({ campo: "grupos", mensaje: `Grupos no autorizados: ${noAutorizados.length}.` });

    if (v.config.loteria_id) {
        const loteria = await loterias.obtener(usuarioId, v.config.loteria_id);
        if (!loteria.ok && loteria.motivo !== "no_encontrado") return falla(loteria.motivo, { error: loteria.error, migracion: loteria.migracion });
        if (!loteria.ok) errores.push({ campo: "loteria_id", mensaje: "La lotería no existe en tu calendario." });
    }

    const cuentas = await repo.cuentasActivasPorId(usuarioId, v.config.cuentas);
    if (!cuentas.ok) return falla(cuentas.motivo, { error: cuentas.error });
    if (cuentas.data.length !== v.config.cuentas.length) {
        errores.push({ campo: "cuentas", mensaje: "Alguna cuenta de pago no existe o está inactiva." });
    }

    let plantillaId = null;
    if (entrada.plantilla_id) {
        const plantilla = await repo.obtenerPlantilla(usuarioId, entrada.plantilla_id);
        if (!plantilla.ok) errores.push({ campo: "plantilla_id", mensaje: "La plantilla no existe." });
        else plantillaId = plantilla.data.id;
    }

    const diseno = await resolverDiseno(usuarioId, v.config.diseno, v.config.valor);
    if (!diseno.ok) return diseno;
    if (diseno.error) errores.push(diseno.error);

    if (errores.length) return falla("validacion", { errores });

    // Las cuentas se COPIAN: editarlas después no altera este sorteo.
    const cuentasSnapshot = v.config.cuentas
        .map(id => cuentas.data.find(c => c.id === id))
        .map(({ id, nombre, tipo, titular, numero, instrucciones }) => ({ id, nombre, tipo, titular, numero, instrucciones }));

    const config = { ...v.config, diseno: diseno.diseno, cantidad_numeros: tablaCliente.cantidad };

    return {
        ok: true,
        fila: {
            config,
            cuentas_snapshot: cuentasSnapshot,
            plantilla_id: plantillaId,
            tabla: tablaCliente.tabla,
            cifras: tablaCliente.cifras,
            cantidad_numeros: tablaCliente.cantidad,
            publicar_en: config.publicar_en,
            identidad_evento_real: identidadDe(usuarioId, config)
        },
        grupos: v.config.grupos.map(g => porId.get(g))
    };

}

async function crearSorteo(usuarioId, entrada) {

    const p = await prepararSorteo(usuarioId, entrada);
    if (!p.ok) return p;

    const creado = await repo.crearSorteo(usuarioId, { ...p.fila, estado: "borrador", version: 1 });
    if (!creado.ok) return creado;

    const grupos = await repo.reemplazarGrupos(usuarioId, creado.data.id, p.grupos);
    if (!grupos.ok) return grupos;

    return repo.obtenerSorteo(usuarioId, creado.data.id);

}

async function vistaPrevia(usuarioId, id) {

    const s = await repo.obtenerSorteo(usuarioId, id);
    if (!s.ok) return s;

    const sorteo = s.data;
    // Fecha en que se JUEGA (variable {{fecha}}); la publicación puede ser antes.
    const fecha = fechaSorteoDe(sorteo.config, sorteo.publicar_en);

    const publicacion = mensajePublicacion(sorteo.config, sorteo.cuentas_snapshot, { fecha });
    const recordatorios = (sorteo.config.recordatorios || []).map(r => ({
        minutos_antes_cierre: r.minutos_antes_cierre,
        ...mensajeRecordatorio(sorteo.config, r, sorteo.cuentas_snapshot, { fecha })
    }));
    const avisoCierre = sorteo.config.mensajes?.aviso_cierre
        ? mensajeAvisoCierre(sorteo.config, sorteo.cuentas_snapshot, { fecha })
        : null;

    const bloqueos = [];
    const avisos = [];

    const desconocidas = new Set([
        ...publicacion.desconocidas,
        ...recordatorios.flatMap(r => r.desconocidas),
        ...(avisoCierre?.desconocidas || [])
    ]);
    if (desconocidas.size) avisos.push(`Variables desconocidas que se enviarán tal cual: ${[...desconocidas].map(v => `{{${v}}}`).join(", ")}.`);

    // Sin cuenta de pago los clientes no saben dónde pagar: no se programa.
    if (!sorteo.cuentas_snapshot?.length) bloqueos.push("Selecciona al menos una cuenta de pago (puedes crearla desde el formulario del sorteo).");
    if (sorteo.config.reservas?.liberar_no_pagados) {
        avisos.push(`Las reservas no pagadas se liberarán automáticamente a los ${sorteo.config.reservas.vencimiento_minutos} minutos. Un cliente que ya transfirió pero cuyo pago no se ha confirmado podría perder su número.`);
    }

    // Reinicio OPCIONAL de la tabla (solo si el sorteo lo pidió): qué se
    // liberaría (se archiva, no se borra) o por qué no es posible.
    let reinicio = null;

    if (sorteo.config.tabla?.reiniciar) {
        const rr = await reinicioTabla.revisarReinicio(usuarioId, sorteo);
        if (!rr.ok) {
            reinicio = { posible: false, huella: null, liberables: 0, protegidos: 0, conservados: 0, liberar_bloqueados: false, se_liberarian: [], se_conservan: [], bloqueos: [] };
            bloqueos.push(rr.motivo === "migracion_pendiente"
                ? "El reinicio seguro de la tabla todavía no está disponible (falta la migración 030). Edita el sorteo y elige «Conservar tabla», o espera a que se active."
                : "No pudimos revisar la tabla para reiniciarla. Inténtalo de nuevo en unos minutos.");
        } else {
            reinicio = rr.data;
            const diferido = !reinicio.posible
                ? await reinicioDiferible(usuarioId, reinicio, rr.porSorteo, new Date(sorteo.publicar_en))
                : null;
            if (diferido) {
                reinicio = diferido;
                avisos.push(`La tabla se reiniciará al publicar (${legible(new Date(sorteo.publicar_en))}), cuando el sorteo actual ya haya cerrado (${legible(new Date(diferido.cierra_antes))}). Hasta entonces sus reservas y pagos no se tocan; al publicar se archivan (no se borran).`);
            } else if (!reinicio.posible) {
                bloqueos.push(`No se puede reiniciar la tabla: ${reinicio.bloqueos.join("; ")}. Nada se modificó. Espera a que ese sorteo cierre o edita el sorteo y elige «Conservar tabla».`);
            }
        }
    }

    const seReiniciara = !!reinicio?.posible || !!reinicio?.diferido;

    const tabla = await revisarTabla({
        usuarioId, tabla: sorteo.tabla, cifras: sorteo.cifras, cantidad: sorteo.cantidad_numeros, identidad: sorteo.identidad_evento_real, seReiniciara
    });
    bloqueos.push(...tabla.bloqueos);
    avisos.push(...tabla.avisos);

    // Números para pintar la tabla de la vista previa: la MISMA fuente que la
    // imagen que se comparte (tablaEvento.obtenerNumeros: solo número y si
    // está libre). Con reinicio, como quedaría después de reiniciar.
    const numeros = await tablaEvento.obtenerNumeros(sorteo.tabla, usuarioId);
    const numerosVista = seReiniciara
        ? { numerosDisponibles: [...numeros.numerosDisponibles, ...numeros.numerosOcupados].sort(), numerosOcupados: [] }
        : numeros;

    const autorizados = await repo.gruposAutorizados(usuarioId);
    const setAutorizados = new Set((autorizados.data || []).map(g => g.grupo_id));

    // Conflictos de grupo EN LA FECHA DE PUBLICACIÓN (no solo activo=true):
    // un sorteo actual que habrá cerrado para entonces no bloquea.
    const publicarEn = new Date(sorteo.publicar_en);
    const cierreNuevo = sorteo.config.hora_cierre ? instanteBogota(fecha, sorteo.config.hora_cierre) : null;

    const grupos = [];
    for (const g of sorteo.grupos) {
        if (g.estado === "cancelado") continue;
        const r = await revisarGrupo({
            usuarioId, grupoId: g.grupo_id, identidad: sorteo.identidad_evento_real, autorizados: setAutorizados,
            publicarEn, ahora: reloj.ahora(), sorteoId: sorteo.id, cierreNuevo
        });
        grupos.push({
            grupo_id: g.grupo_id,
            nombre: g.grupo_nombre,
            estado: g.estado,
            bloqueo: r.bloqueo,
            // "bloqueado" (conflicto real en la fecha de publicación),
            // "programado" (depende de que el sorteo actual cierre antes) o
            // "listo" (nada pendiente).
            estado_previo: r.bloqueo ? "bloqueado" : r.espera ? "programado" : "listo",
            motivo: r.bloqueo || r.espera || null
        });
        if (r.bloqueo) bloqueos.push(`${g.grupo_nombre || g.grupo_id}: ${r.bloqueo}`);
    }

    const estadoPublicacion = bloqueos.length
        ? "bloqueado"
        : (reinicio?.diferido || grupos.some(g => g.estado_previo === "programado")) ? "programado" : "listo";

    return {
        ok: true,
        data: {
            id: sorteo.id,
            version: sorteo.version,
            estado: sorteo.estado,
            publicar_en: sorteo.publicar_en,
            fecha_sorteo: fecha,
            hora_fin: sorteo.config.hora_fin,
            hora_cierre: sorteo.config.hora_cierre,
            diseno: sorteo.config.diseno || { origen: "actual", diseno_id: null, nombre: null, config: null },
            numeros: numerosVista,
            cantidad_numeros: sorteo.cantidad_numeros,
            tabla_fisica: sorteo.tabla,
            cuentas: sorteo.cuentas_snapshot || [],
            reinicio,
            publicacion: publicacion.texto,
            recordatorios: recordatorios.map(r => ({ minutos_antes_cierre: r.minutos_antes_cierre, texto: r.texto })),
            aviso_cierre: avisoCierre?.texto || null,
            tabla: tabla.resumen,
            grupos,
            bloqueos,
            avisos,
            variables: VARIABLES,
            estado_publicacion: estadoPublicacion,
            puede_confirmar: sorteo.estado === "borrador" && bloqueos.length === 0
        }
    };

}

// Exige confirmación explícita y la MISMA versión que se vio en la vista
// previa: si alguien editó entretanto, la confirmación no vale.
async function confirmar(usuarioId, id, { version, confirmacion, reinicio } = {}) {

    if (confirmacion !== true) return falla("confirmacion_requerida");

    const previa = await vistaPrevia(usuarioId, id);
    if (!previa.ok) return previa;

    if (previa.data.version !== Number(version)) return falla("version_cambiada", { version_actual: previa.data.version });
    if (previa.data.estado !== "borrador") return falla("estado_invalido", { estado: previa.data.estado });
    if (previa.data.bloqueos.length) return falla("bloqueado", { bloqueos: previa.data.bloqueos });
    if (new Date(previa.data.publicar_en).getTime() <= reloj.ahora().getTime()) return falla("validacion", { errores: [{ campo: "publicar_en", mensaje: "La hora de publicación ya pasó. Edita el sorteo." }] });

    // Reinicio: SOLO con confirmación expresa y la MISMA huella de la vista
    // previa. La base lo hace en una transacción (archiva y libera) o no hace
    // nada; si la tabla cambió entretanto, se pide revisar otra vez.
    if (previa.data.reinicio?.posible && previa.data.reinicio.liberables > 0) {
        if (reinicio?.confirmado !== true || reinicio?.huella !== previa.data.reinicio.huella) {
            return falla("confirmacion_reinicio_requerida");
        }
        const r = await reinicioTabla.aplicarReinicio(usuarioId, { id, tabla: previa.data.tabla_fisica, liberarBloqueados: previa.data.reinicio.liberar_bloqueados }, reinicio.huella);
        if (!r.ok) return falla(r.motivo, { bloqueos: r.bloqueos || [] });
    }

    // Reinicio DIFERIDO: hoy la tabla tiene números del sorteo actual (que
    // cierra antes de la publicación). No se toca nada ahora; se confirma
    // expresamente que se haga al publicar, y queda anotado en el sorteo.
    const cambios = {
        estado: "programado",
        confirmado_en: new Date().toISOString(),
        confirmado_version: Number(version)
    };

    if (previa.data.reinicio?.diferido) {
        if (reinicio?.confirmado !== true || reinicio?.diferido !== true) return falla("confirmacion_reinicio_requerida");
        const actual = await repo.obtenerSorteo(usuarioId, id);
        if (!actual.ok) return actual;
        cambios.config = { ...actual.data.config, tabla: { ...actual.data.config.tabla, reiniciar_al_publicar: true } };
    }

    const r = await repo.actualizarSorteoSi(usuarioId, id, { version: Number(version), estados: ["borrador"] }, cambios);

    if (!r.ok) return r.motivo === "conflicto" ? falla("version_cambiada") : r;

    return repo.obtenerSorteo(usuarioId, id);

}

// Grupos para el formulario + resumen para explicar una lista vacía.
async function gruposParaFormulario(usuarioId) {

    const [autorizados, resumen] = await Promise.all([repo.gruposAutorizados(usuarioId), repo.resumenGrupos(usuarioId)]);
    if (!autorizados.ok) return autorizados;
    if (!resumen.ok) return resumen;

    return { ok: true, data: autorizados.data, meta: resumen.data };

}

async function editar(usuarioId, id, entrada = {}) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    if (!ESTADOS_EDITABLES.includes(actual.data.estado)) return falla("estado_invalido", { estado: actual.data.estado });
    if (actual.data.grupos.some(g => !["pendiente", "cancelado"].includes(g.estado))) return falla("ya_publicado");
    if (Number(entrada.version) !== actual.data.version) return falla("version_cambiada", { version_actual: actual.data.version });

    const p = await prepararSorteo(usuarioId, entrada);
    if (!p.ok) return p;

    // Vuelve a borrador: la confirmación anterior era de otra versión. El
    // publicador solo publica estado 'programado' con confirmado_version =
    // version, así que una tarea "vieja" nunca se ejecuta.
    const r = await repo.actualizarSorteoSi(usuarioId, id, { version: actual.data.version, estados: ESTADOS_EDITABLES }, {
        ...p.fila,
        version: actual.data.version + 1,
        estado: "borrador",
        confirmado_en: null,
        confirmado_version: null
    });

    if (!r.ok) return r.motivo === "conflicto" ? falla("version_cambiada") : r;

    const grupos = await repo.reemplazarGrupos(usuarioId, id, p.grupos);
    if (!grupos.ok) return grupos;

    return repo.obtenerSorteo(usuarioId, id);

}

async function cancelar(usuarioId, id) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const { estado } = actual.data;

    if (estado === "cancelado") return actual;

    // Grupos todavía no publicados: se cancelan (el publicador solo toma
    // 'pendiente'/'fallido', así que ya no se publicarán).
    for (const g of actual.data.grupos) {
        if (g.estado === "pendiente" || g.estado === "fallido") {
            await repo.marcarGrupo(usuarioId, g.id, { estado: "cancelado" });
        }
    }

    const publicados = actual.data.grupos.filter(g => g.estado === "publicado").length;

    if (ESTADOS_EDITABLES.includes(estado)) {
        const r = await repo.actualizarSorteoSi(usuarioId, id, { estados: ESTADOS_EDITABLES }, { estado: "cancelado", cancelado_en: new Date().toISOString() });
        if (!r.ok && r.motivo !== "conflicto") return r;
    }

    const final = await repo.obtenerSorteo(usuarioId, id);
    if (!final.ok) return final;

    return {
        ok: true,
        data: final.data,
        // Lo ya publicado NO se deshace: el sorteo sigue vivo en esos grupos
        // y se cierra con las reglas normales.
        aviso: publicados ? `Ya estaba publicado en ${publicados} grupo(s): ahí sigue activo hasta su cierre.` : null
    };

}

// Reintento MANUAL de un grupo en revisión (p. ej. no se supo si el anuncio
// llegó): el administrador decide; nunca se reintenta solo.
async function reintentarGrupo(usuarioId, id, grupoId) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const g = actual.data.grupos.find(x => x.grupo_id === grupoId);
    if (!g) return falla("no_encontrado");
    if (g.estado !== "requiere_revision" && g.estado !== "fallido") return falla("estado_invalido", { estado: g.estado });
    if (actual.data.estado === "cancelado") return falla("estado_invalido", { estado: "cancelado" });

    await repo.marcarGrupo(usuarioId, g.id, {
        estado: "fallido",
        ultimo_error: "reintento manual solicitado",
        intentos: 0,
        reintentos_manuales: (Number(g.reintentos_manuales) || 0) + 1
    });

    if (["publicado", "publicado_parcial", "fallido"].includes(actual.data.estado)) {
        await repo.actualizarSorteoSi(usuarioId, id, { estados: ["publicado", "publicado_parcial", "fallido"] }, { estado: "publicando" });
    }

    return repo.obtenerSorteo(usuarioId, id);

}

// ----------------------------------------------------------- plantillas ---

async function crearPlantilla(usuarioId, entrada) {
    const v = validarPlantilla(entrada);
    if (!v.ok) return falla("validacion", { errores: v.errores });
    return repo.crearPlantilla(usuarioId, { nombre: v.nombre, config: v.config });
}

async function actualizarPlantilla(usuarioId, id, entrada) {
    if (entrada.activa === false && Object.keys(entrada).length === 1) {
        return repo.actualizarPlantilla(usuarioId, id, { activa: false });
    }
    const v = validarPlantilla(entrada);
    if (!v.ok) return falla("validacion", { errores: v.errores });
    return repo.actualizarPlantilla(usuarioId, id, { nombre: v.nombre, config: v.config });
}

// ------------------------------------------------------ cuentas de pago ---

const TIPOS_CUENTA = new Set(["nequi", "daviplata", "bancolombia", "llave", "otro"]);

function validarCuenta(entrada = {}, { parcial = false } = {}) {

    const errores = [];
    const cuenta = {};
    const t = (v, max) => String(v ?? "").trim().slice(0, max);

    if (!parcial || entrada.nombre !== undefined) {
        cuenta.nombre = t(entrada.nombre, 80);
        if (!cuenta.nombre) errores.push({ campo: "nombre", mensaje: "La cuenta necesita un nombre." });
    }
    if (!parcial || entrada.numero !== undefined) {
        cuenta.numero = t(entrada.numero, 60);
        if (!cuenta.numero) errores.push({ campo: "numero", mensaje: "Indica el número o llave de la cuenta." });
    }
    if (!parcial || entrada.tipo !== undefined) {
        cuenta.tipo = TIPOS_CUENTA.has(entrada.tipo) ? entrada.tipo : "otro";
    }
    if (entrada.titular !== undefined) cuenta.titular = t(entrada.titular, 120) || null;
    if (entrada.instrucciones !== undefined) cuenta.instrucciones = t(entrada.instrucciones, 500) || null;
    if (entrada.activa !== undefined) cuenta.activa = entrada.activa === true;

    return { ok: errores.length === 0, errores, cuenta };

}

async function crearCuenta(usuarioId, entrada) {
    const v = validarCuenta(entrada);
    if (!v.ok) return falla("validacion", { errores: v.errores });
    return repo.crearCuenta(usuarioId, v.cuenta);
}

async function actualizarCuenta(usuarioId, id, entrada) {
    const v = validarCuenta(entrada, { parcial: true });
    if (!v.ok) return falla("validacion", { errores: v.errores });
    if (!Object.keys(v.cuenta).length) return falla("validacion", { errores: [{ campo: "*", mensaje: "Nada que actualizar." }] });
    return repo.actualizarCuenta(usuarioId, id, v.cuenta);
}

module.exports = {
    crearSorteo,
    vistaPrevia,
    confirmar,
    editar,
    cancelar,
    reintentarGrupo,
    listarSorteos: repo.listarSorteos,
    obtenerSorteo: repo.obtenerSorteo,
    gruposAutorizados: repo.gruposAutorizados,
    gruposParaFormulario,
    loterias,
    listarPlantillas: repo.listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    listarCuentas: repo.listarCuentas,
    crearCuenta,
    actualizarCuenta,
    _reloj: reloj
};
