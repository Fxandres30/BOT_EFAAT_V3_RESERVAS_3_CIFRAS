// ==========================================================================
// configInactividad.js — configuración del control de 15 días sin compra.
//
// ACTIVACIÓN SEGURA (por defecto NUNCA se expulsa a nadie):
//
//   INACTIVIDAD_MODO=desactivado   no corre nada.
//   INACTIVIDAD_MODO=simulacion    (POR DEFECTO) evalúa y registra qué
//                                  pasaría, sin expulsar.
//   INACTIVIDAD_MODO=real          expulsa SOLO si además
//                                  INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI.
//                                  Sin esa segunda variable, "real" se
//                                  degrada a simulación y lo deja en el log.
//
// Otras variables (todas opcionales):
//   INACTIVIDAD_DIAS                 15   días sin compra confirmada
//   INACTIVIDAD_HORA_BOGOTA          10   hora (0-23, Bogotá) desde la que
//                                         puede correr la evaluación diaria
//   INACTIVIDAD_INTERVALO_MS    3600000   cada cuánto revisa el worker
//   INACTIVIDAD_HORAS_ENTRE_EJECUCIONES 20  mínimo entre dos evaluaciones
//   INACTIVIDAD_MAX_EXPULSIONES      10   tope de expulsiones por ejecución
//   INACTIVIDAD_REINTENTOS            2   reintentos por expulsión fallida
//                                         transitoria (no por permisos)
//   INACTIVIDAD_LOCK_MINUTOS        120   una ejecución 'en_curso' más vieja
//                                         se considera abandonada (crash)
//   INACTIVIDAD_RETENCION_DIAS       90   días que se conserva la bitácora
//                                         inactividad_evaluaciones (0 = siempre)
//   INACTIVIDAD_GRUPOS                    lista de JIDs (coma) para limitar el
//                                         control a esos grupos
//   INACTIVIDAD_PROTEGIDOS                teléfonos o LIDs (coma) que nunca
//                                         se evalúan para expulsión
// ==========================================================================

function numero(nombre, porDefecto, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {

    const valor = Number(process.env[nombre]);

    if (!Number.isFinite(valor) || valor < min || valor > max) return porDefecto;

    return valor;

}

function lista(nombre) {

    return String(process.env[nombre] || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

}

// Solo dígitos y sin sufijo (@lid, @s.whatsapp.net, :dispositivo).
function idPlano(valor) {
    return String(valor || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function leerConfigInactividad() {

    const modoPedido = String(process.env.INACTIVIDAD_MODO || "simulacion").trim().toLowerCase();
    const confirmado = String(process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES || "").trim().toUpperCase() === "SI";

    let modo;
    let avisoModo = null;

    if (modoPedido === "desactivado") {
        modo = "desactivado";
    } else if (modoPedido === "real" && confirmado) {
        modo = "real";
    } else if (modoPedido === "real") {
        modo = "simulacion";
        avisoModo = "INACTIVIDAD_MODO=real sin INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI — se ejecuta en SIMULACIÓN";
    } else {
        modo = "simulacion";
        if (modoPedido !== "simulacion") avisoModo = `INACTIVIDAD_MODO="${modoPedido}" no reconocido — se ejecuta en SIMULACIÓN`;
    }

    return {
        modo,
        avisoModo,
        dias: numero("INACTIVIDAD_DIAS", 15, { min: 1, max: 365 }),
        horaBogota: numero("INACTIVIDAD_HORA_BOGOTA", 10, { min: 0, max: 23 }),
        intervaloMs: numero("INACTIVIDAD_INTERVALO_MS", 60 * 60 * 1000, { min: 60 * 1000 }),
        horasEntreEjecuciones: numero("INACTIVIDAD_HORAS_ENTRE_EJECUCIONES", 20, { min: 1, max: 24 * 30 }),
        maxExpulsiones: numero("INACTIVIDAD_MAX_EXPULSIONES", 10, { min: 0, max: 500 }),
        reintentos: numero("INACTIVIDAD_REINTENTOS", 2, { min: 0, max: 5 }),
        lockMinutos: numero("INACTIVIDAD_LOCK_MINUTOS", 120, { min: 5, max: 24 * 60 }),
        retencionDias: numero("INACTIVIDAD_RETENCION_DIAS", 90, { min: 0, max: 3650 }),
        gruposPermitidos: lista("INACTIVIDAD_GRUPOS"),
        protegidos: new Set(lista("INACTIVIDAD_PROTEGIDOS").map(idPlano).filter(Boolean))
    };

}

module.exports = {
    leerConfigInactividad,
    idPlano
};
