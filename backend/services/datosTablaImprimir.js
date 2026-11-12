// ==========================================================================
// datosTablaImprimir.js — datos con los que se pinta la IMAGEN de una tabla
// (la página /tablas/imprimir/[precio] del panel, TablaImprimible): solo
// número + estado de la cuadrícula del cliente dueño, más el diseño. Nunca
// nombre/teléfono/contacto: esa imagen se difunde a un grupo completo.
//
// La usan GET /tablas/imprimir-datos (routes/tablas.js) y la captura de
// Puppeteer de compartirTabla.js, que la entrega a la página directamente
// (sin enlace firmado).
// ==========================================================================

const supabase = require("../lib/supabase");
// Precio -> tabla física SEGÚN EL CLIENTE (tablas_cliente, migración 027;
// sin ella, la configuración base de siempre).
const { obtenerConfiguracionCliente } = require("../bot/funciones/eventos/tablasCliente");
const tablaEventoRepo = require("../automation/repo/tablaEvento");
// Motor único de rifas (12/11/2026): los números de la imagen son los de la
// RIFA (tabla_id) del sorteo, la misma fuente que Reservas. La rifa sale del
// evento (eventos_bot.tabla_id, firmado en el token) o se pasa explícita;
// nunca del precio. Con MOTOR_RIFAS=legado, como siempre (tablas_cliente).
const { motorNuevo } = require("../rifas/motor");
const { esUuid } = require("../rifas/formato");
const { disenoDelEvento } = require("../sorteos/repo");
const { normalizarConfigDiseno } = require("../sorteos/disenoTabla");

// `disenoSorteo` (opcional): config.diseno del sorteo programado que se va a
// publicar. Permite capturar ANTES de que exista su evento, con el mismo
// resultado que leerlo por el evento.
// -> { ok: true, data } | { ok: false, status, error }
// `tablaId` (opcional): la rifa explícita (motor nuevo).
async function datosTablaImprimir(usuarioId, precio, eventoId = null, { disenoSorteo = null, tablaId = null } = {}) {

    const fuente = await fuenteDeLaImagen(usuarioId, precio, eventoId, tablaId);
    if (!fuente.ok) return fuente;
    const config = fuente.config;

    let numeros;
    try {
        numeros = await tablaEventoRepo.obtenerNumeros(fuente.fuente, usuarioId);
    } catch (e) {
        return { ok: false, status: 409, error: `No se pudieron leer los números de la tabla: ${e.message}` };
    }
    const { numerosDisponibles, numerosOcupados, numerosPagados } = numeros;

    // Estilo: el guardado en el SORTEO programado de ese evento (el mismo
    // que se vio en la vista previa); si el evento no viene de un sorteo
    // programado, el diseño activo de la tabla de ese precio. Sin diseño o
    // si no es válido: null (la página usa el de por defecto).
    let diseno;

    if (disenoSorteo) {
        diseno = disenoSorteo.config ?? null;
    } else if (eventoId) {
        const r = await disenoDelEvento(usuarioId, eventoId);
        if (r.ok && r.data) diseno = r.data.config ?? null;
    }

    if (diseno === undefined) {
        const { data: visual } = await supabase
            .from("tabla_configuracion_visual")
            .select("config")
            .eq("usuario_id", usuarioId)
            .eq("precio", precio)
            .maybeSingle();
        diseno = visual?.config;
    }

    return {
        ok: true,
        data: {
            numerosDisponibles,
            numerosOcupados,
            numerosPagados,
            cifras: config.cifras,
            cantidad: config.cantidad,
            diseno: normalizarConfigDiseno(diseno)
        }
    };

}

// De dónde salen los números de la imagen.
// -> { ok: true, fuente, config: { cifras, cantidad } } | { ok: false, status, error }
async function fuenteDeLaImagen(usuarioId, precio, eventoId, tablaId) {

    if (!motorNuevo()) {
        const config = await obtenerConfiguracionCliente(usuarioId, precio);
        if (!config) return { ok: false, status: 404, error: "No existe una tabla configurada para este precio." };
        return { ok: true, fuente: config.tabla, config };
    }

    let rifaId = esUuid(tablaId) ? tablaId : null;

    if (!rifaId && eventoId) {
        const { data, error } = await supabase.from("eventos_bot").select("tabla_id")
            .eq("usuario_id", usuarioId).eq("id", eventoId).maybeSingle();
        if (error) return { ok: false, status: 500, error: "No se pudo leer el sorteo de la imagen." };
        rifaId = esUuid(data?.tabla_id) ? data.tabla_id : null;
    }

    if (!rifaId) {
        return { ok: false, status: 409, error: "No se puede saber qué tabla mostrar: el sorteo no tiene una rifa (tabla_id) asignada." };
    }

    const { data: rifa, error } = await supabase.from("tablas_rifas").select("id, precio, cifras, cantidad")
        .eq("usuario_id", usuarioId).eq("id", rifaId).maybeSingle();
    if (error) return { ok: false, status: 500, error: "No se pudo leer la tabla del sorteo." };
    if (!rifa) return { ok: false, status: 404, error: "La tabla de este sorteo no existe en la cuenta." };
    if (precio && Number(rifa.precio) !== Number(precio)) {
        return { ok: false, status: 409, error: `La tabla del sorteo es de $${rifa.precio}, no de $${precio}.` };
    }

    return { ok: true, fuente: { tablaId: rifa.id }, config: { cifras: rifa.cifras, cantidad: rifa.cantidad } };

}

module.exports = { datosTablaImprimir };
