// ==========================================================================
// procesarSorteo.js — evalúa UNA vez un sorteo lógico (todas sus filas de
// eventos_bot, una por grupo) y, si corresponde, cierra TODOS sus grupos.
//
//   - La tabla real del sorteo se lee una sola vez (sorteoReal.js): nunca
//     100 números por grupo ni contadores sumados entre filas.
//   - Motivo "hora": alguna fila del sorteo alcanzó su cierre (fecha y hora
//     de Colombia, verificarHoraCierre.js). El cierre es del sorteo, no del
//     grupo: se cierran todos sus grupos. Un cierre atrasado de un día
//     anterior se recupera; si su grupo ya tiene otro sorteo vigente, solo
//     se marca la fila (el grupo de WhatsApp sigue abierto para el nuevo).
//   - Motivo "pagados": TODOS los números únicos están pagados.
//   - Cada grupo se cierra de forma independiente (cerrarFilaDeEvento): si
//     uno falla queda activo y registra su error; los demás siguen. Un grupo
//     ya cerrado (activo=false) nunca se vuelve a tocar, y uno con fallos
//     repetidos espera entre reintentos (esperaAntesDeReintentar).
//   - Este flujo NO envía mensajes: el aviso de cierre (CLOSE_MESSAGE) lo
//     envía el Scheduler con su propia clave idempotente, así que reintentar
//     el cierre de un grupo nunca duplica mensajes.
// ==========================================================================

const { verificarHoraCierre, cierreAtrasado } = require("./verificarHoraCierre");
const { cerrarFilaDeEvento, esperaAntesDeReintentar } = require("./cerrarEvento");
const { estadoDelSorteo } = require("../sorteoReal");
const { sincronizarContadores } = require("../../reservas/actualizarEvento");
const { finDelEvento } = require("../../../../shared/eventos/estadosGestion");

// Grupos donde OTRO sorteo (no estas filas) sigue vigente: no cerrado, no
// terminado y sin haber llegado a su cierre. Al recuperar el cierre de un
// sorteo atrasado, ese grupo de WhatsApp es del sorteo nuevo: no se cierra.
function gruposConOtroSorteoVigente(filas, todas, ahora) {
    const propias = new Set(filas);
    return new Set((todas || [])
        .filter(o => o && !propias.has(o) && o.activo && !finDelEvento(o) && !verificarHoraCierre(o, ahora))
        .map(o => o.grupo_id));
}

// todas: las filas activas del cliente en este ciclo (workerEventos), para
// saber si un grupo sigue en uso por otro sorteo.
async function procesarSorteo({ sock, filas, todas = [], ahora = Date.now() }) {

    const momento = new Date(ahora);

    // Una fila que el cierre o la administración ya terminaron (cierre_estado
    // "cerrado", cancelado, desactivado...) no se procesa aunque un reintento
    // antiguo la haya dejado con activo=true: nunca se cierra dos veces ni se
    // toca su grupo, que puede ser ya el de otro sorteo.
    const activas = (filas || []).filter(f => f && f.activo && !finDelEvento(f));

    if (!activas.length) return { accion: "nada", resultados: [] };

    const representante = activas[0];

    let motivo = activas.some(f => verificarHoraCierre(f, momento)) ? "hora" : null;
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
    const ocupados = gruposConOtroSorteoVigente(activas, todas, momento);

    // Cierre recuperado: su hora pasó un día anterior (el proceso estaba
    // desconectado). Se cierra igual, marcado, y sin aviso tardío.
    const recuperado = motivo === "hora" && activas.some(f => cierreAtrasado(f, momento));

    for (const fila of activas) {

        const espera = esperaAntesDeReintentar(fila, ahora);

        if (espera > 0) {
            resultados.push({ eventoId: fila.id, grupoId: fila.grupo_id, resultado: "en_espera", esperaMs: espera });
            continue;
        }

        const grupoEnUso = ocupados.has(fila.grupo_id);
        const detalle = [
            activas.length > 1 ? `sorteo en ${activas.length} grupos` : null,
            recuperado ? `recuperado: cierre pendiente del ${fila.fecha_evento ? String(fila.fecha_evento).slice(0, 10) : "día anterior"}` : null,
            grupoEnUso ? "grupo en uso por otro sorteo: no se cerró en WhatsApp" : null
        ].filter(Boolean);

        const cerrado = await cerrarFilaDeEvento({
            sock,
            fila,
            motivo: detalle.length ? `${motivo} (${detalle.join("; ")})` : motivo,
            cerrarGrupo: !grupoEnUso
        });

        resultados.push({ eventoId: fila.id, grupoId: fila.grupo_id, resultado: cerrado ? "cerrado" : "fallido", ...(grupoEnUso ? { grupoEnUso: true } : {}), ...(recuperado ? { recuperado: true } : {}) });

    }

    return { accion: "cerrar", motivo, estado, resultados };

}

module.exports = {
    procesarSorteo
};
