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
//   eliminar: solo sin ninguna actividad; archivar: oculta sin borrar
//   (ver administracion.js).
// ==========================================================================

const repo = require("./repo");
const loterias = require("./loterias");
const { validarSorteo, validarPlantilla, fechaSorteoDe, instanteBogota, identidadDelSorteo } = require("./validar");
const { normalizarConfigDiseno } = require("./disenoTabla");
const reinicioTabla = require("./reinicioTabla");
const reservasAnticipadas = require("./reservasAnticipadas");
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
const tablasCliente = require("../bot/funciones/eventos/tablasCliente");
// Sorteo ACTIVO de una tabla, sea cual sea su origen (bot o panel).
const gestionEventos = require("./gestionEventos");
const sorteosActivos = require("./sorteosActivos");
const administracion = require("./administracion");

const ESTADOS_EDITABLES = ["borrador", "programado"];

// Reloj inyectable (las pruebas fijan la hora; en producción, la real).
const reloj = { ahora: () => new Date() };

function falla(motivo, extra = {}) {
    return { ok: false, motivo, ...extra };
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
            identidad_evento_real: identidadDelSorteo(usuarioId, config)
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
    // «Sorteo instantáneo»: se publica al confirmarlo, así que conflictos y
    // reinicio se revisan para AHORA, no para cuando se guardó el borrador.
    const momentoPublicacion = sorteo.config.publicacion_inmediata ? reloj.ahora() : new Date(sorteo.publicar_en);

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

    // Reinicio OPCIONAL de la tabla (solo si el sorteo lo pidió). Nunca se
    // hace al programar: el publicador lo hace al publicar (un minuto antes
    // del anuncio) volviendo a validar la tabla. Aquí solo se muestra qué se
    // liberaría HOY (se archiva, no se borra) o por qué no sería posible.
    let reinicio = null;

    if (sorteo.config.tabla?.reiniciar) {
        const rr = await reinicioTabla.revisarReinicio(usuarioId, sorteo);
        if (!rr.ok) {
            reinicio = { posible: false, huella: null, liberables: 0, protegidos: 0, conservados: 0, liberar_bloqueados: false, se_liberarian: [], se_conservan: [], bloqueos: [] };
            bloqueos.push(rr.motivo === "migracion_pendiente"
                ? "El reinicio seguro de la tabla todavía no está disponible (falta la migración 030). Edita el sorteo y elige «Conservar la tabla actual», o espera a que se active."
                : "No pudimos revisar la tabla para reiniciarla. Inténtalo de nuevo en unos minutos.");
        } else {
            reinicio = rr.data;
            const diferido = !reinicio.posible
                ? await reinicioDiferible(usuarioId, reinicio, rr.porSorteo, momentoPublicacion)
                : null;
            if (diferido) {
                reinicio = diferido;
                avisos.push(`La tabla se reiniciará al publicar (${legible(momentoPublicacion)}), cuando el sorteo actual ya haya cerrado (${legible(new Date(diferido.cierra_antes))}). Hasta entonces sus reservas y pagos no se tocan; al publicar se archivan (no se borran).`);
            } else if (!reinicio.posible) {
                bloqueos.push(`No se puede reiniciar la tabla: ${reinicio.bloqueos.join("; ")}. Nada se modificó. Espera a que ese sorteo cierre o edita el sorteo y elige «Conservar la tabla actual».`);
            } else {
                avisos.push(`La tabla se reiniciará al publicar (${legible(momentoPublicacion)}), no ahora: programar no modifica ningún número. En ese momento se vuelve a revisar la tabla; si hay reservas nuevas, pagos en proceso o un sorteo activo, no se reinicia ni se publica.`);
            }
            if (reinicio.posible || reinicio.diferido) reinicio = { ...reinicio, al_publicar: true };
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
        ? { numerosDisponibles: [...numeros.numerosDisponibles, ...numeros.numerosOcupados].sort(), numerosOcupados: [], numerosPagados: [] }
        : numeros;

    const autorizados = await repo.gruposAutorizados(usuarioId);
    const setAutorizados = new Set((autorizados.data || []).map(g => g.grupo_id));

    // Conflictos de grupo EN LA FECHA DE PUBLICACIÓN (no solo activo=true):
    // un sorteo actual que habrá cerrado para entonces no bloquea.
    const publicarEn = momentoPublicacion;
    const cierreNuevo = sorteo.config.hora_cierre ? instanteBogota(fecha, sorteo.config.hora_cierre) : null;

    const grupos = [];
    for (const g of sorteo.grupos) {
        if (g.estado === "cancelado") continue;
        const r = await revisarGrupo({
            usuarioId, grupoId: g.grupo_id, identidad: sorteo.identidad_evento_real, autorizados: setAutorizados,
            publicarEn, ahora: reloj.ahora(), sorteoId: sorteo.id, cierreNuevo,
            sustituir: sorteo.config.sustituir_activo === true
        });
        // Instantáneo con «Sustituir»: el sorteo abierto del grupo se cierra
        // AL PUBLICAR (publicador), no hay que esperar a nada: se puede
        // publicar ya, avisando de la sustitución.
        const sustituyeAhora = sorteo.config.publicacion_inmediata === true && sorteo.config.sustituir_activo === true
            && !r.bloqueo && !!r.espera && (r.conflictos || []).length > 0;
        grupos.push({
            grupo_id: g.grupo_id,
            nombre: g.grupo_nombre,
            estado: g.estado,
            bloqueo: r.bloqueo,
            // "bloqueado" (conflicto real en la fecha de publicación),
            // "programado" (depende de que el sorteo actual cierre antes) o
            // "listo" (nada pendiente).
            estado_previo: r.bloqueo ? "bloqueado" : r.espera && !sustituyeAhora ? "programado" : "listo",
            motivo: r.bloqueo || r.espera || null,
            ...(sustituyeAhora ? { sustituira: true } : {})
        });
        if (r.bloqueo) bloqueos.push(`${g.grupo_nombre || g.grupo_id}: ${r.bloqueo}`);
        if (sustituyeAhora) avisos.push(`${g.grupo_nombre || g.grupo_id}: ${r.espera}`);
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
            // Opción elegida en el formulario («Conservar la tabla actual» o
            // «Reiniciar la tabla antes de publicar») y si ya se hizo.
            tabla_al_publicar: {
                reiniciar: sorteo.config.tabla?.reiniciar === true,
                liberar_bloqueados: sorteo.config.tabla?.liberar_bloqueados === true,
                reiniciado_en: sorteo.config.tabla?.reiniciado_en || null
            },
            publicacion: publicacion.texto,
            recordatorios: recordatorios.map(r => ({ minutos_antes_cierre: r.minutos_antes_cierre, texto: r.texto })),
            aviso_cierre: avisoCierre?.texto || null,
            tabla: tabla.resumen,
            grupos,
            bloqueos,
            avisos,
            variables: VARIABLES,
            estado_publicacion: estadoPublicacion,
            publicacion_inmediata: sorteo.config.publicacion_inmediata === true,
            puede_confirmar: sorteo.estado === "borrador" && bloqueos.length === 0
        }
    };

}

// Exige confirmación explícita y la MISMA versión que se vio en la vista
// previa: si alguien editó entretanto, la confirmación no vale.
// Perfil de la captura (ventana y columna del panel donde se revisó la vista
// previa): con él, la imagen que se genere sin panel abierto sale igual que
// «Compartir» en ese dispositivo. Solo enteros en rango; si no, sin perfil.
function perfilCapturaValido(captura) {
    const ventana = Number(captura?.ventana);
    const contenido = Number(captura?.contenido);
    if (!Number.isInteger(ventana) || !Number.isInteger(contenido)) return null;
    if (ventana < 280 || ventana > 3840 || contenido < 200 || contenido > ventana) return null;
    return { ventana, contenido };
}

async function confirmar(usuarioId, id, { version, confirmacion, reinicio, captura } = {}) {

    if (confirmacion !== true) return falla("confirmacion_requerida");

    const previa = await vistaPrevia(usuarioId, id);
    if (!previa.ok) return previa;

    if (previa.data.version !== Number(version)) return falla("version_cambiada", { version_actual: previa.data.version });
    if (previa.data.estado !== "borrador") return falla("estado_invalido", { estado: previa.data.estado });
    // Un sorteo instantáneo no se programa: se publica con publicarAhora.
    if (previa.data.publicacion_inmediata) return falla("validacion", { errores: [{ campo: "publicacion_inmediata", mensaje: "Es un sorteo instantáneo: se publica con «Publicar ahora» (sección Sorteo instantáneo)." }] });
    if (previa.data.bloqueos.length) return falla("bloqueado", { bloqueos: previa.data.bloqueos });
    if (new Date(previa.data.publicar_en).getTime() <= reloj.ahora().getTime()) return falla("validacion", { errores: [{ campo: "publicar_en", mensaje: "La hora de publicación ya pasó. Edita el sorteo." }] });

    const cambios = {
        estado: "programado",
        confirmado_en: new Date().toISOString(),
        confirmado_version: Number(version)
    };

    const perfil = perfilCapturaValido(captura);
    if (perfil) {
        const actual = await repo.obtenerSorteo(usuarioId, id);
        if (!actual.ok) return actual;
        cambios.config = { ...actual.data.config, captura: perfil };
    }

    // Reinicio elegido: programar NUNCA modifica la tabla. Solo se anota,
    // con la confirmación expresa del usuario, que el publicador lo haga al
    // publicar (publicador.prepararPublicacion), donde se vuelve a validar.
    if (previa.data.reinicio?.al_publicar) {
        if (reinicio?.confirmado !== true) return falla("confirmacion_reinicio_requerida");
        const actual = await repo.obtenerSorteo(usuarioId, id);
        if (!actual.ok) return actual;
        const base = cambios.config || actual.data.config;
        cambios.config = { ...base, tabla: { ...base.tabla, reiniciar_al_publicar: true, reiniciado_en: null } };
    }

    const r = await repo.actualizarSorteoSi(usuarioId, id, { version: Number(version), estados: ["borrador"] }, cambios);

    if (!r.ok) return r.motivo === "conflicto" ? falla("version_cambiada") : r;

    return repo.obtenerSorteo(usuarioId, id);

}

// ---------------------------------------------------- sorteo instantáneo ---
// Un sorteo creado con publicacion_inmediata se publica AL CONFIRMARLO, con
// el MISMO publicador de los programados (publicador.tick: guardar el
// evento, imagen de la tabla con el diseño del sorteo, texto, abrir el grupo
// y «Compartir» protegido contra duplicados). No hay un publicador aparte:
// solo se adelanta su ciclo a este momento en vez de esperar al siguiente.
//
// Doble clic o reintento: la confirmación está condicionada a la versión y
// al estado «borrador», así que solo una petición publica; las demás
// devuelven el estado real del sorteo. Cada grupo se envía una sola vez
// (clave sorteo-<id>-publicacion-<n> del ExecutionGuard).

const instantaneo = {
    _socketDe: socketActivoDeSesion,
    // Dependencias del publicador (null = las reales). Las pruebas las sustituyen.
    _deps: null
};

function socketActivoDeSesion(usuarioId) {
    return require("../services/baileys/manager").getSocketActivoDe(usuarioId);
}

// Estado por grupo tras publicar, en el idioma del panel.
function resumenPublicacion(sorteo) {
    const grupos = (sorteo.grupos || []).filter(g => g.estado !== "cancelado").map(g => ({
        grupo_id: g.grupo_id,
        nombre: g.grupo_nombre || null,
        estado: g.estado,
        error: g.ultimo_error || null
    }));
    const cuenta = (e) => grupos.filter(g => g.estado === e).length;
    return {
        sorteo_id: sorteo.id,
        estado: sorteo.estado,
        publicados: cuenta("publicado"),
        fallidos: cuenta("fallido"),
        en_revision: cuenta("requiere_revision"),
        pendientes: cuenta("pendiente") + cuenta("publicando"),
        grupos
    };
}

// `imagen`: la captura que el panel hizo y mostró en la vista previa con
// capturarTabla (la de «Compartir»). Se valida como la de «Compartir» ANTES
// de tocar nada y se envía tal cual: no se genera otra. Sin `imagen` (panel
// anterior) el publicador la captura con la misma función en Chromium.
async function publicarAhora(usuarioId, id, { version, confirmacion, reinicio, imagen, captura } = {}) {

    if (confirmacion !== true) return falla("confirmacion_requerida");

    let imagenPanel = null;
    if (imagen !== undefined) {
        imagenPanel = require("../services/destinosCompartir").imagenPng(imagen);
        if (!imagenPanel) return falla("imagen_invalida", { mensaje: "La imagen de la tabla no es un PNG válido: no se publicó nada." });
    }

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;
    if (actual.data.config?.publicacion_inmediata !== true) {
        return falla("validacion", { errores: [{ campo: "publicacion_inmediata", mensaje: "Este sorteo es programado: se publica a su hora." }] });
    }

    // Ya confirmado (otra pestaña, doble clic o reintento tras un corte):
    // no se publica otra vez, se devuelve cómo va.
    if (actual.data.estado !== "borrador") return { ok: true, data: { ...resumenPublicacion(actual.data), repetido: true } };

    // Sin el WhatsApp de ESTE cliente no se toca nada: ni confirmar ni crear el evento.
    const sock = instantaneo._socketDe(usuarioId);
    if (!sock) return falla("sin_sesion_activa");
    const puedeActuar = instantaneo._deps?.puedeActuar || require("../services/baileys/propiedadSesion").puedeActuar;
    if (!puedeActuar(sock)) return falla("sesion_no_disponible");

    const previa = await vistaPrevia(usuarioId, id);
    if (!previa.ok) return previa;

    if (previa.data.version !== Number(version)) return falla("version_cambiada", { version_actual: previa.data.version });
    if (previa.data.bloqueos.length) return falla("bloqueado", { bloqueos: previa.data.bloqueos });
    // Publicar YA: si algún grupo tendría que esperar a que cierre el sorteo
    // actual (o la tabla solo se podría reiniciar después), no es inmediato.
    if (previa.data.estado_publicacion !== "listo") {
        const espera = [
            ...previa.data.grupos.filter(g => g.estado_previo === "programado").map(g => `${g.nombre || g.grupo_id}: ${g.motivo}`),
            ...(previa.data.reinicio?.diferido ? ["La tabla solo se podría reiniciar cuando cierre el sorteo actual."] : [])
        ];
        return falla("no_inmediato", { mensaje: "No se puede publicar ahora sin esperar a otro sorteo. Elige «Sustituir el sorteo activo», cierra el actual o prográmalo.", bloqueos: espera });
    }

    const ahora = reloj.ahora();
    const cambios = {
        estado: "programado",
        confirmado_en: ahora.toISOString(),
        confirmado_version: Number(version),
        publicar_en: ahora.toISOString()
    };

    // Los reintentos de este sorteo se capturan en el servidor: con el mismo perfil.
    const perfil = perfilCapturaValido(captura);
    if (perfil) cambios.config = { ...actual.data.config, captura: perfil };

    if (previa.data.reinicio?.al_publicar) {
        if (reinicio?.confirmado !== true) return falla("confirmacion_reinicio_requerida");
        const base = cambios.config || actual.data.config;
        cambios.config = { ...base, tabla: { ...base.tabla, reiniciar_al_publicar: true, reiniciado_en: null } };
    }

    const r = await repo.actualizarSorteoSi(usuarioId, id, { version: Number(version), estados: ["borrador"] }, cambios);
    if (!r.ok) {
        if (r.motivo !== "conflicto") return r;
        // Otra petición lo confirmó en este instante: su estado, sin repetir.
        const ya = await repo.obtenerSorteo(usuarioId, id);
        return ya.ok ? { ok: true, data: { ...resumenPublicacion(ya.data), repetido: true } } : ya;
    }

    // El ciclo del publicador, ahora (lo que haría el siguiente tick).
    const publicador = require("./publicador");
    let deps = instantaneo._deps;
    if (imagenPanel) {
        const base = deps || publicador.dependenciasReales();
        deps = {
            ...base,
            capturarImagen: (precio, uid, eventoId, contexto) =>
                contexto?.sorteoId === id ? imagenPanel : base.capturarImagen(precio, uid, eventoId, contexto)
        };
    }
    try {
        await publicador.tick(sock, { ahora, deps });
    } catch (err) {
        console.error("❌ [SORTEO INSTANTÁNEO] error en la publicación:", err?.message);
    }

    const final = await repo.obtenerSorteo(usuarioId, id);
    if (!final.ok) return final;

    return { ok: true, data: resumenPublicacion(final.data) };

}

// Imagen que se enviará, generada EN EL SERVIDOR con la misma función que
// usa la publicación (compartirTabla.capturarImagenTabla, que ejecuta en
// Chromium el capturarTabla de «Compartir»). Solo la pide el panel anterior
// (el nuevo captura en la vista previa). Mismos datos
// (números de la vista previa + diseño guardado en el sorteo). Comprueba,
// antes de publicar, que el servidor puede producirla. No envía ni escribe.
async function probarImagen(usuarioId, id) {

    const s = await repo.obtenerSorteo(usuarioId, id);
    if (!s.ok) return s;

    const previa = await vistaPrevia(usuarioId, id);
    if (!previa.ok) return previa;

    const d = previa.data;
    const datos = {
        numerosDisponibles: d.numeros.numerosDisponibles,
        numerosOcupados: d.numeros.numerosOcupados,
        numerosPagados: d.numeros.numerosPagados,
        cifras: s.data.cifras,
        cantidad: d.cantidad_numeros,
        diseno: normalizarConfigDiseno(d.diseno?.config ?? null)
    };

    const capturar = instantaneo._deps?.capturarImagen || require("../services/compartirTabla").capturarImagenTabla;

    try {
        const png = await capturar(Number(s.data.config.valor), usuarioId, null, { datos });
        if (!Buffer.isBuffer(png) || !png.length) return falla("error_imagen", { mensaje: "El servidor no devolvió ninguna imagen." });
        return { ok: true, data: { imagen: `data:image/png;base64,${png.toString("base64")}`, bytes: png.length } };
    } catch (err) {
        return falla("error_imagen", { mensaje: `El servidor no pudo generar la imagen de la tabla: ${err?.message || err}` });
    }

}

// Grupos para el formulario + resumen para explicar una lista vacía.
async function gruposParaFormulario(usuarioId) {

    const [autorizados, resumen] = await Promise.all([repo.gruposAutorizados(usuarioId), repo.resumenGrupos(usuarioId)]);
    if (!autorizados.ok) return autorizados;
    if (!resumen.ok) return resumen;

    return { ok: true, data: autorizados.data, meta: resumen.data };

}

// Reservas anticipadas del sorteo (D3). mensaje(n) decide si la operación
// las afecta: devuelve el texto del rechazo, o null si no. Si no se pueden
// contar, se rechaza igual (falla cerrado).
async function bloqueoPorAnticipadas(usuarioId, sorteo, mensaje) {
    const r = await reservasAnticipadas.anticipadasDelSorteo(usuarioId, sorteo);
    if (!r.ok) return falla("error_supabase");
    if (!r.total) return null;
    const texto = mensaje(r.total);
    return texto ? falla("reservas_anticipadas", { mensaje: texto, cantidad: r.total }) : null;
}

async function editar(usuarioId, id, entrada = {}) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    if (!ESTADOS_EDITABLES.includes(actual.data.estado)) return falla("estado_invalido", { estado: actual.data.estado });
    if (actual.data.grupos.some(g => !["pendiente", "cancelado"].includes(g.estado))) return falla("ya_publicado");
    if (Number(entrada.version) !== actual.data.version) return falla("version_cambiada", { version_actual: actual.data.version });

    const p = await prepararSorteo(usuarioId, entrada);
    if (!p.ok) return p;

    // Con reservas anticipadas, nada que cambie a qué sorteo o tabla
    // pertenecen (identidad = nombre, hora, valor y fecha; tabla; grupos;
    // reinicio al publicar): quedarían huérfanas sin aviso (D3).
    const bloqueoAnticipadas = await bloqueoPorAnticipadas(usuarioId, actual.data, (anteriores) => {
        const gruposAntes = actual.data.grupos.filter(g => g.estado !== "cancelado").map(g => g.grupo_id).sort().join(",");
        const gruposDespues = p.grupos.map(g => g.grupo_id).sort().join(",");
        const cambia = p.fila.identidad_evento_real !== actual.data.identidad_evento_real
            || p.fila.tabla !== actual.data.tabla
            || gruposAntes !== gruposDespues
            || reservasAnticipadas.reinicioPendiente(p.fila.config);
        return cambia
            ? `No se puede cambiar el nombre, la fecha, la hora, el valor, la tabla, los grupos ni pedir el reinicio de la tabla: el sorteo tiene ${anteriores} reserva(s) anticipada(s). Libéralas antes desde Tablas o conserva esos datos.`
            : null;
    });
    if (bloqueoAnticipadas) return bloqueoAnticipadas;

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

// Cancelar, eliminar, archivar y el detalle: sorteos/administracion.js.

const REINTENTO_MANUAL = "reintento manual solicitado";

// Reintento MANUAL de un grupo en revisión (p. ej. no se supo si el anuncio
// llegó): el administrador decide; nunca se reintenta solo.
async function reintentarGrupo(usuarioId, id, grupoId) {

    const actual = await repo.obtenerSorteo(usuarioId, id);
    if (!actual.ok) return actual;

    const g = actual.data.grupos.find(x => x.grupo_id === grupoId);
    if (!g) return falla("no_encontrado");
    if (g.estado !== "requiere_revision" && g.estado !== "fallido") return falla("estado_invalido", { estado: g.estado });
    if (actual.data.estado === "cancelado") return falla("estado_invalido", { estado: "cancelado" });
    if (actual.data.archivado_en) return falla("estado_invalido", { estado: "archivado" });

    // Ya pedido y todavía sin tomar por el publicador (doble clic): nada más.
    if (g.estado === "fallido" && g.ultimo_error === REINTENTO_MANUAL) {
        return { ok: true, data: actual.data, aviso: "El reintento ya estaba pedido; se publicará en el próximo ciclo." };
    }

    // Condicionado al estado leído: un doble clic (o una cancelación a la
    // vez) no suma dos reintentos ni revive un grupo cancelado.
    const marcado = await repo.marcarGrupoSi(usuarioId, g.id, [g.estado], {
        estado: "fallido",
        ultimo_error: REINTENTO_MANUAL,
        intentos: 0,
        reintentos_manuales: (Number(g.reintentos_manuales) || 0) + 1
    });
    if (!marcado.ok) return marcado;
    if (!marcado.data) return falla("conflicto");

    await repo.registrarHistorial(usuarioId, id, "reintentar", "pedido", { grupo_id: g.grupo_id, grupo_nombre: g.grupo_nombre || null, estado_previo: g.estado });

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

// Sorteos activos (eventos_bot) de cualquier origen: listar, abrir y editar
// los campos seguros. Siempre con el usuario del token.
const activos = {
    listar: (usuarioId, opciones) => sorteosActivos.listar(usuarioId, opciones),
    obtener: (usuarioId, id) => sorteosActivos.obtener(usuarioId, id),
    editar: (usuarioId, id, entrada) => sorteosActivos.editar(usuarioId, id, entrada, { ahora: reloj.ahora(), resolverDiseno })
};

// Sorteos ya en los grupos (eventos_bot): cerrar, reabrir, desactivar (en
// un grupo o en todos), cancelar y eliminar (lógico). Ver gestionEventos.js.
const socketActivoDe = (usuarioId) => require("../services/baileys/manager").getSocketActivoDe(usuarioId);
const eventos = {
    listar: (usuarioId) => gestionEventos.listar(usuarioId, { ahora: reloj.ahora() }),
    aplicar: (usuarioId, id, entrada) => gestionEventos.aplicar(usuarioId, id, entrada, { ahora: reloj.ahora(), socketDe: eventos._socketDe })
};
eventos._socketDe = socketActivoDe;

// Administración de las programaciones (estados, detalle, cancelar,
// eliminar, archivar), con el reloj del servicio.
const cancelar = (usuarioId, id) => administracion.cancelar(usuarioId, id, { ahora: reloj.ahora() });
const eliminar = (usuarioId, id, entrada) => administracion.eliminar(usuarioId, id, entrada, { ahora: reloj.ahora() });
const archivar = (usuarioId, id, entrada) => administracion.archivar(usuarioId, id, entrada, { ahora: reloj.ahora() });
const gestion = (usuarioId) => administracion.listar(usuarioId, { ahora: reloj.ahora() });
const detalle = (usuarioId, id) => administracion.detalle(usuarioId, id, { ahora: reloj.ahora() });

module.exports = {
    activos,
    eventos,
    instantaneo,
    publicarAhora,
    probarImagen,
    crearSorteo,
    vistaPrevia,
    confirmar,
    editar,
    cancelar,
    eliminar,
    archivar,
    gestion,
    detalle,
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
    perfilCapturaValido,
    _reloj: reloj
};
