// ==========================================================================
// evaluarMiembro.js — decisión PURA (sin Supabase, sin WhatsApp) de qué
// hacer con UN miembro de UN grupo en el control de inactividad.
//
// Orden de las reglas (la primera que aplica decide):
//   1. Cuenta del propio bot / propietario / administrador / protegido
//      -> "excluido" (nunca se expulsa).
//   2. Identidad faltante, no registrada o ambigua -> "omitido" (ante la
//      duda, nunca se expulsa).
//   3. Sin registro de seguimiento -> "omitido" (no se puede medir).
//   4. Días desde la referencia = max(última compra confirmada, inicio del
//      seguimiento). Menos de `dias` -> "conservar"; `dias` o más ->
//      "candidato".
//
// El inicio del seguimiento es desde cuándo CONSTA que el miembro está en el
// grupo: su compra confirmada más antigua conocida, o la primera vez que el
// control lo vio, o su reingreso. Así nadie cumple 15 días "sin comprar"
// solo porque el control acaba de empezar a medir.
// ==========================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

function aFecha(valor) {

    if (!valor) return null;

    const fecha = valor instanceof Date ? valor : new Date(valor);

    return Number.isNaN(fecha.getTime()) ? null : fecha;

}

function evaluarMiembro({
    esCuentaBot = false,
    esPropietario = false,
    rolAdmin = null,
    esProtegido = false,
    identidad = { estado: "datos_insuficientes" },
    seguimiento = null,
    seguimientoNuevo = false,
    reingreso = false,
    ahora = new Date(),
    dias = 15
}) {

    if (esCuentaBot) return { decision: "excluido", motivo: "cuenta_del_bot" };

    if (esPropietario) return { decision: "excluido", motivo: "propietario_del_grupo" };

    if (rolAdmin === "admin" || rolAdmin === "superadmin") return { decision: "excluido", motivo: "administrador" };

    if (esProtegido) return { decision: "excluido", motivo: "protegido_por_configuracion" };

    if (identidad?.estado === "ambigua") return { decision: "omitido", motivo: "identidad_ambigua" };

    if (identidad?.estado === "no_registrada") return { decision: "omitido", motivo: "identidad_no_registrada" };

    // Solo LID o solo teléfono, sin que ni el participante ni "usuarios" los
    // vinculen: podría existir OTRA fila de usuarios de la misma persona con
    // sus compras -> no se puede afirmar que no compró.
    if (identidad?.estado === "incompleta") return { decision: "omitido", motivo: "identidad_incompleta" };

    if (identidad?.estado !== "ok" || !identidad?.usuarioGlobalId) return { decision: "omitido", motivo: "datos_insuficientes" };

    if (!seguimiento) return { decision: "omitido", motivo: "sin_registro_de_seguimiento" };

    const ultimaCompra = aFecha(seguimiento.ultima_compra_en);
    const desde = aFecha(seguimiento.seguimiento_desde);

    if (!desde && !ultimaCompra) return { decision: "omitido", motivo: "fechas_invalidas" };

    const referencia = [ultimaCompra, desde].filter(Boolean).reduce((a, b) => (a > b ? a : b));

    const diasSinCompra = Math.floor((ahora.getTime() - referencia.getTime()) / DIA_MS);

    const cumplePlazoEn = new Date(referencia.getTime() + dias * DIA_MS);

    const base = { ultimaCompra, referencia, diasSinCompra, cumplePlazoEn };

    // Fecha en el futuro (reloj desfasado) -> nunca expulsar.
    if (diasSinCompra < 0) return { ...base, decision: "conservar", motivo: "fecha_en_el_futuro" };

    if (diasSinCompra < dias) {

        let motivo;

        if (seguimientoNuevo) motivo = "seguimiento_iniciado";
        else if (reingreso) motivo = "reingreso_al_grupo";
        else if (ultimaCompra && ultimaCompra >= referencia) motivo = "compra_reciente";
        else motivo = "en_periodo_de_gracia";

        return { ...base, decision: "conservar", motivo };

    }

    return {
        ...base,
        decision: "candidato",
        motivo: ultimaCompra
            ? `sin_compra_confirmada_hace_${diasSinCompra}_dias`
            : `sin_compras_confirmadas_en_${diasSinCompra}_dias_de_seguimiento`
    };

}

module.exports = {
    evaluarMiembro,
    DIA_MS
};
