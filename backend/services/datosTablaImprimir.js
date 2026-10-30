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
const { disenoDelEvento } = require("../sorteos/repo");
const { normalizarConfigDiseno } = require("../sorteos/disenoTabla");

// `disenoSorteo` (opcional): config.diseno del sorteo programado que se va a
// publicar. Permite capturar ANTES de que exista su evento, con el mismo
// resultado que leerlo por el evento.
// -> { ok: true, data } | { ok: false, status, error }
async function datosTablaImprimir(usuarioId, precio, eventoId = null, { disenoSorteo = null } = {}) {

    const config = await obtenerConfiguracionCliente(usuarioId, precio);

    if (!config) {
        return { ok: false, status: 404, error: "No existe una tabla configurada para este precio." };
    }

    const { numerosDisponibles, numerosOcupados, numerosPagados } = await tablaEventoRepo.obtenerNumeros(config.tabla, usuarioId);

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

module.exports = { datosTablaImprimir };
