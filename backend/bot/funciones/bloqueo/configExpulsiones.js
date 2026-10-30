// ==========================================================================
// configExpulsiones.js — configuración de la expulsión de bloqueados.
//
// ACTIVACIÓN SEGURA (por defecto NUNCA se expulsa a nadie):
//
//   BLOQUEO_EXPULSION_MODO sin definir   desactivado: el bloqueo se registra y
//                                        las tareas quedan pendientes, pero
//                                        no se procesan. Así un despliegue
//                                        por otro motivo no arranca nada.
//   BLOQUEO_EXPULSION_MODO=desactivado   igual.
//   BLOQUEO_EXPULSION_MODO=simulacion    procesa cada tarea: lee la lista real
//                                        de participantes, identifica, revisa
//                                        permisos y registra qué haría
//                                        ("simulado"). NUNCA llama a
//                                        groupParticipantsUpdate.
//   BLOQUEO_EXPULSION_MODO=real          expulsa SOLO si además
//                                        BLOQUEO_EXPULSION_CONFIRMAR=SI. Sin
//                                        esa segunda variable se degrada a
//                                        simulación y lo deja en el log.
//
// Otras variables (opcionales):
//   BLOQUEO_EXPULSION_INTERVALO_MS   30000   cada cuánto revisa el worker
//   BLOQUEO_EXPULSION_LEASE_SEGUNDOS   120   vida del lease de una tarea
//   BLOQUEO_EXPULSION_MAX_INTENTOS       5   reintentos automáticos por tarea
//   BLOQUEO_EXPULSION_ESPERA_MS      60000   espera base (x2 por intento)
//   BLOQUEO_EXPULSION_ESPERA_MAX_MS 1800000  tope de la espera
//   BLOQUEO_EXPULSION_LOTE              10   tareas por pasada
// ==========================================================================

function numero(nombre, porDefecto, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {

    const valor = Number(process.env[nombre]);

    if (process.env[nombre] === undefined || process.env[nombre] === "" || !Number.isFinite(valor) || valor < min || valor > max) return porDefecto;

    return valor;

}

function leerConfigExpulsiones() {

    const modoPedido = String(process.env.BLOQUEO_EXPULSION_MODO || "").trim().toLowerCase();
    const confirmado = String(process.env.BLOQUEO_EXPULSION_CONFIRMAR || "").trim().toUpperCase() === "SI";

    let modo;
    let avisoModo = null;

    if (!modoPedido || modoPedido === "desactivado") {
        modo = "desactivado";
    } else if (modoPedido === "real" && confirmado) {
        modo = "real";
    } else if (modoPedido === "real") {
        modo = "simulacion";
        avisoModo = "BLOQUEO_EXPULSION_MODO=real sin BLOQUEO_EXPULSION_CONFIRMAR=SI — se ejecuta en SIMULACIÓN";
    } else {
        modo = "simulacion";
        if (modoPedido !== "simulacion") avisoModo = `BLOQUEO_EXPULSION_MODO="${modoPedido}" no reconocido — se ejecuta en SIMULACIÓN`;
    }

    return {
        modo,
        avisoModo,
        intervaloMs: numero("BLOQUEO_EXPULSION_INTERVALO_MS", 30 * 1000, { min: 5 * 1000 }),
        leaseSegundos: numero("BLOQUEO_EXPULSION_LEASE_SEGUNDOS", 120, { min: 30, max: 3600 }),
        maxIntentos: numero("BLOQUEO_EXPULSION_MAX_INTENTOS", 5, { min: 1, max: 20 }),
        esperaBaseMs: numero("BLOQUEO_EXPULSION_ESPERA_MS", 60 * 1000, { min: 0 }),
        esperaMaxMs: numero("BLOQUEO_EXPULSION_ESPERA_MAX_MS", 30 * 60 * 1000, { min: 0 }),
        lote: numero("BLOQUEO_EXPULSION_LOTE", 10, { min: 1, max: 100 })
    };

}

// Segunda barrera: se relee el ENTORNO inmediatamente antes de la única
// llamada de expulsión, ignorando la config que haya recibido la pasada.
function expulsionesRealesConfirmadas() {
    return leerConfigExpulsiones().modo === "real";
}

// Espera antes del próximo reintento automático (intentos ya hechos >= 1).
function esperaParaIntento(intentos, config) {
    const espera = config.esperaBaseMs * Math.pow(2, Math.max(0, intentos - 1));
    return Math.min(espera, config.esperaMaxMs);
}

module.exports = {
    leerConfigExpulsiones,
    expulsionesRealesConfirmadas,
    esperaParaIntento
};
