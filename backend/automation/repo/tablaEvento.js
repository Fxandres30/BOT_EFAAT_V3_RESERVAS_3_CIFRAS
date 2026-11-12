// ==========================================================================
// repo/tablaEvento.js — SOLO LECTURA de los números de la tabla de un
// sorteo para la IMAGEN (publicar, Compartir, imprimir) y la vista previa.
//
// 12/11/2026 — motor único de rifas: los números salen de
// rifas/numerosSorteo.js, la MISMA fuente que Reservas: numeros_rifa por
// usuario_id + tabla_id (MOTOR_RIFAS=nuevo). La cuadrícula física antigua
// (evento.tabla) solo con MOTOR_RIFAS=legado. Nunca se importa nada de bot/
// (frontera del Automation Engine): rifas/ no es bot/.
// ==========================================================================

const numerosSorteo = require("../../rifas/numerosSorteo");
const { motorNuevo } = require("../../rifas/motor");

// obtenerNumeros(fuente, usuarioId) -> { numerosDisponibles, numerosOcupados, numerosPagados }
//   fuente: el sorteo programado, la fila de eventos_bot o { tablaId, tabla }
//           (un texto suelto es una cuadrícula antigua: solo motor legado).
// numerosPagados ⊂ numerosOcupados (la imagen los pinta como «Pagado»).
//
// SEGURIDAD: usuarioId (el dueño) es OBLIGATORIO. Con el motor de rifas,
// sin tabla_id se LANZA un error: nunca se pinta la tabla de otra rifa.
async function obtenerNumeros(fuente, usuarioId) {

    const f = numerosSorteo.fuenteDe(fuente);

    // Motor legado: como siempre, sin dueño o sin tabla no hay números.
    if (!motorNuevo() && (!f.tabla || !usuarioId)) {
        return { numerosDisponibles: [], numerosOcupados: [], numerosPagados: [] };
    }

    if (!usuarioId) throw Object.assign(new Error("Sin dueño de la rifa no se leen números."), { code: "sin_cliente" });

    const { numerosDisponibles, numerosOcupados, numerosPagados } = await numerosSorteo.numerosImagen(usuarioId, f);
    return { numerosDisponibles, numerosOcupados, numerosPagados };

}

module.exports = { obtenerNumeros };
