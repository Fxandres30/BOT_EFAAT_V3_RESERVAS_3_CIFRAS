// ==========================================================================
// compartirManual.js — «Compartir sorteo manual» del panel: el administrador
// pega el texto del anuncio, EFAAT lo analiza con el MISMO detector que usa
// el bot en los grupos (extraerEvento) y dice qué tabla le corresponde
// (configuración de tablas DEL CLIENTE) y si el sorteo activo de esa tabla
// es el que anuncia el texto.
//
// Aquí NO se envía ni se escribe nada: no se crea un sorteo programado ni un
// evento, no se tocan números, reservas ni pagos. El envío es el de siempre
// (POST /tablas/compartir con solicitudId: compartirEnGrupos, la captura del
// `div` de la tabla en el panel y el texto como pie de foto). Ese envío
// exige un sorteo activo en la tabla: sin él, las respuestas de los clientes
// en el grupo no se registrarían, así que tampoco se comparte.
// ==========================================================================

const { extraerEvento } = require("../bot/funciones/eventos/extraerEvento");
const { fechaSorteoAnunciado } = require("../bot/funciones/eventos/identidadEventoReal");
const { formatHora12 } = require("../bot/utils/formatHora");
const { normalizarTexto } = require("../bot/utils/normalizarTexto");

const precioDe = (valor) => {
    const p = Number(String(valor ?? "").replace(/[^\d]/g, ""));
    return p > 0 ? p : null;
};

const hora12 = (hhmm) => (hhmm ? formatHora12(hhmm) : null);

// Datos del anuncio tal como los leería el bot. `reconocido` = el texto
// tiene forma de anuncio; `faltantes` = lo que no está escrito (no se
// inventa).
function detectar(texto, ahora = new Date()) {

    const e = extraerEvento(texto);

    if (!e) return { reconocido: false, nombre: null, hora: null, hora_texto: null, hora_cierre: null, fecha: null, valor: null, premios: [], faltantes: ["nombre", "hora", "valor"] };

    return {
        reconocido: true,
        nombre: e.nombre,
        hora: e.hora,
        hora_texto: hora12(e.hora),
        hora_cierre: e.horaCierre,
        // La misma fecha que guardaría el bot al detectarlo ahora.
        fecha: e.hora ? fechaSorteoAnunciado(e.hora, e.horaCierre, ahora) : null,
        valor: precioDe(e.valor),
        premios: e.premios || [],
        faltantes: e.faltantes || []
    };

}

// Qué tabla usar. Nunca se elige en silencio una tabla que el texto no
// respalda: sin valor, con un valor sin tabla o con una tabla distinta de la
// del texto, el panel tiene que confirmarlo.
//   -> { precio | null, estado: detectado | elegido | distinto_del_texto | sin_valor | sin_tabla | elegido_invalido }
function elegirTabla(detectado, precios, precioElegido = null) {

    const disponibles = new Set(precios);
    const delTexto = detectado.valor;
    const elegido = precioDe(precioElegido);

    if (elegido !== null) {
        if (!disponibles.has(elegido)) return { precio: null, estado: "elegido_invalido" };
        if (delTexto === elegido) return { precio: elegido, estado: "detectado" };
        return { precio: elegido, estado: delTexto ? "distinto_del_texto" : "elegido" };
    }

    if (!delTexto) return { precio: null, estado: "sin_valor" };
    if (!disponibles.has(delTexto)) return { precio: null, estado: "sin_tabla" };

    return { precio: delTexto, estado: "detectado" };

}

const mismoNombre = (a, b) => normalizarTexto(String(a || "")).trim() === normalizarTexto(String(b || "")).trim();

// ¿El sorteo activo de la tabla es el que anuncia el texto? Se comparan los
// datos que el texto SÍ trae (lotería, hora y valor; la fecha solo si el
// sorteo la tiene). -> { estado: coincide | distinto | sin_datos, diferencias }
function compararConSorteo(detectado, evento) {

    const campos = [
        ["loteria", detectado.nombre, evento.nombre_evento, mismoNombre],
        ["hora", detectado.hora, evento.hora_fin, (a, b) => a === b],
        ["valor", detectado.valor, precioDe(evento.valor), (a, b) => a === b],
        ["fecha", detectado.fecha, evento.fecha_evento, (a, b) => a === b]
    ];

    const comparables = campos.filter(([campo, delTexto, delSorteo]) => delTexto && (delSorteo || campo !== "fecha"));
    // La fecha sola (siempre se calcula) no basta para decir que coincide.
    if (!comparables.some(([campo]) => campo !== "fecha")) return { estado: "sin_datos", diferencias: [] };

    const diferencias = comparables
        .filter(([, delTexto, delSorteo, igual]) => !igual(delTexto, delSorteo))
        .map(([campo, delTexto, delSorteo]) => ({
            campo,
            texto: campo === "hora" ? hora12(delTexto) : delTexto,
            sorteo: campo === "hora" ? hora12(delSorteo) : (delSorteo ?? null)
        }));

    return { estado: diferencias.length ? "distinto" : "coincide", diferencias };

}

// Lo que el administrador debe confirmar expresamente antes de «Compartir
// ahora» (el panel muestra una casilla por cada uno).
function confirmacionesNecesarias({ detectado, tabla, coincidencia }) {

    const lista = [];

    if (!detectado.reconocido) lista.push("texto_no_reconocido");
    else if (detectado.faltantes.length) lista.push("texto_incompleto");

    if (tabla.estado === "elegido" || tabla.estado === "distinto_del_texto") lista.push("tabla_" + tabla.estado);

    if (coincidencia?.estado === "distinto") lista.push("sorteo_distinto");
    if (coincidencia?.estado === "sin_datos" && detectado.reconocido) lista.push("sorteo_sin_comparar");

    return lista;

}

// Análisis completo con la lectura del sorteo inyectada (la ruta usa la de
// «Compartir»: tablaYEvento). Solo lectura.
async function analizar({ texto, precios, precioElegido = null, leerSorteo, gruposDelSorteo, ahora = new Date() }) {

    const detectado = detectar(texto, ahora);
    const tabla = elegirTabla(detectado, precios, precioElegido);

    if (!tabla.precio) {
        return { detectado, tabla, precios, sorteo: null, coincidencia: null, grupos_con_sorteo: [], confirmaciones: confirmacionesNecesarias({ detectado, tabla }), bloqueo: tabla.estado };
    }

    const evento = await leerSorteo(tabla.precio);

    if (!evento) {
        return { detectado, tabla, precios, sorteo: null, coincidencia: null, grupos_con_sorteo: [], confirmaciones: confirmacionesNecesarias({ detectado, tabla }), bloqueo: "sin_evento_activo" };
    }

    const coincidencia = compararConSorteo(detectado, evento);

    return {
        detectado,
        tabla,
        precios,
        sorteo: {
            id: evento.id,
            nombre: evento.nombre_evento || null,
            hora_fin: evento.hora_fin || null,
            hora_texto: hora12(evento.hora_fin),
            hora_cierre: evento.hora_cierre || null,
            fecha: evento.fecha_evento || null,
            valor: precioDe(evento.valor)
        },
        coincidencia,
        grupos_con_sorteo: await gruposDelSorteo(evento),
        confirmaciones: confirmacionesNecesarias({ detectado, tabla, coincidencia }),
        bloqueo: null
    };

}

module.exports = {
    detectar,
    elegirTabla,
    compararConSorteo,
    confirmacionesNecesarias,
    analizar
};
