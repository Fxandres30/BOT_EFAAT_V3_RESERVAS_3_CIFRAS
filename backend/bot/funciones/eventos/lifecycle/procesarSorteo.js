// ==========================================================================
// procesarSorteo.js — evalúa UNA vez un sorteo lógico (todas sus filas de
// eventos_bot, una por grupo) y, si corresponde, cierra TODOS sus grupos.
//
//   - La tabla real del sorteo se lee una sola vez (sorteoReal.js): nunca
//     100 números por grupo ni contadores sumados entre filas.
//   - Motivo "hora": alguna fila del sorteo alcanzó su hora de cierre (mismo
//     criterio de siempre, verificarHoraCierre.js sin cambios). El cierre es
//     del sorteo, no del grupo: se cierran todos sus grupos.
//   - Motivo "pagados": TODOS los números únicos están pagados.
//   - Cada grupo se cierra de forma independiente (cerrarFilaDeEvento): si
//     uno falla queda activo y registra su error; los demás siguen. Un grupo
//     ya cerrado (activo=false) nunca se vuelve a tocar, y uno con fallos
//     repetidos espera entre reintentos (esperaAntesDeReintentar).
//   - Este flujo NO envía mensajes: el aviso de cierre (CLOSE_MESSAGE) lo
//     envía el Scheduler con su propia clave idempotente, así que reintentar
//     el cierre de un grupo nunca duplica mensajes.
// ==========================================================================

const { verificarHoraCierre } = require("./verificarHoraCierre");
const { cerrarFilaDeEvento, esperaAntesDeReintentar } = require("./cerrarEvento");
const { estadoDelSorteo } = require("../sorteoReal");
const { sincronizarContadores } = require("../../reservas/actualizarEvento");

async function procesarSorteo({ sock, filas, ahora = Date.now() }) {

    const activas = (filas || []).filter(f => f && f.activo);

    if (!activas.length) return { accion: "nada", resultados: [] };

    const representante = activas[0];

    let motivo = activas.some(f => verificarHoraCierre(f)) ? "hora" : null;
    let estado = null;

    // La tabla se lee aunque haya motivo "hora": así los contadores que ve el
    // panel quedan al día con el estado final del sorteo.
    estado = await estadoDelSorteo(representante);

    if (estado.ok) {

        await sincronizarContadores(activas, estado);

        if (!motivo && estado.completo) motivo = "pagados";

    } else {

        console.log(`❌ No se pudo leer la tabla del sorteo ${representante.identidad_evento_real || representante.id}: ${estado.error} — no se cierra por pagos en este ciclo.`);

    }

    if (!motivo) return { accion: "continuar", estado, resultados: [] };

    console.log(`🔒 Cerrando sorteo ${representante.nombre_evento || ""} (${motivo}) en ${activas.length} grupo(s)...`);

    const resultados = [];

    for (const fila of activas) {

        const espera = esperaAntesDeReintentar(fila, ahora);

        if (espera > 0) {
            resultados.push({ eventoId: fila.id, grupoId: fila.grupo_id, resultado: "en_espera", esperaMs: espera });
            continue;
        }

        const cerrado = await cerrarFilaDeEvento({
            sock,
            fila,
            motivo: activas.length > 1 ? `${motivo} (sorteo en ${activas.length} grupos)` : motivo
        });

        resultados.push({ eventoId: fila.id, grupoId: fila.grupo_id, resultado: cerrado ? "cerrado" : "fallido" });

    }

    return { accion: "cerrar", motivo, estado, resultados };

}

module.exports = {
    procesarSorteo
};
