// ==========================================================================
// Lecturas sobre el sorteo ANTERIOR de un grupo, para decidir qué hace un
// anuncio de WhatsApp (deteccion/decisionAnuncio.js). Solo leen.
// ==========================================================================

"use strict";

// ¿El evento existente ya terminó? "cerrado" = cerrarEvento() ya lo marcó
// (activo=false / estado "cerrado"); "lleno" = este sorteo no tiene ningún
// número libre (sorteoSinNumerosLibres: su propia lectura, separada de la
// disponibilidad que se le muestra al cliente, que también cuenta los
// ocupados de otros sorteos). Ante un error o una tabla sin filas no se puede
// afirmar que esté lleno -> null (se mantiene el comportamiento de siempre).
// verificarEventoLleno() no se usa: cuenta por evento_id y no ve las reservas
// hechas en los otros grupos del mismo sorteo real.
async function estadoTerminado(evento, { sorteoSinNumerosLibres }) {
    if (evento.activo === false || evento.estado === "cerrado") return "cerrado";
    try {
        if (await sorteoSinNumerosLibres(evento) === true) return "lleno";
    } catch (err) {
        console.error("⚠️ No se pudo verificar si el sorteo está lleno (se sigue el flujo normal):", err?.message);
    }
    return null;
}

// ¿El sorteo de esta fila ya tiene números reservados o pagados (o en
// proceso)? Un sorteo así tiene historial que conservar: un anuncio de OTRO
// sorteo nunca reescribe su fila. Ante un error de lectura se responde que sí
// (lo seguro: se crea una fila nueva y la anterior queda intacta).
async function sorteoTieneNumeros(evento, { db }) {
    // Motor nuevo: números ocupados de ESTE sorteo en su rifa. Ante la duda, sí.
    if (require("../../../../rifas/motor").motorNuevo()) {
        if (!evento?.identidad_evento_real) return false;
        const filas = await require("../../../../rifas/bot").leerFilas(evento, { estados: ["reservado", "en_proceso", "pagado", "bloqueado"] });
        if (filas === null) return true;
        return filas.some(f => f.identidad_evento_real === evento.identidad_evento_real);
    }
    if (!evento?.identidad_evento_real || !evento?.tabla || !evento?.usuario_id) return false;
    try {
        const { data, error } = await db
            .from(evento.tabla)
            .select("numero")
            .eq("usuario_id", evento.usuario_id)
            .eq("identidad_evento_real", evento.identidad_evento_real)
            .neq("estado", "libre")
            .limit(1);
        if (error) return true;
        return (data || []).length > 0;
    } catch {
        return true;
    }
}

module.exports = { estadoTerminado, sorteoTieneNumeros };
