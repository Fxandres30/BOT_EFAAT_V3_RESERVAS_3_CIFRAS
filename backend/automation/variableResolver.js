// ==========================================================================
// variableResolver.js — resuelve variables {nombre} dentro de un texto de
// mensaje, usando SOLO datos reales ya provistos por el llamador.
//
// Función pura: no toca Supabase, no toca Baileys, no inventa ningún
// valor. Si una variable del texto no está presente en `datos` (o es
// null/undefined), NO se reemplaza — queda tal cual en el resultado, y
// `completo: false` se lo señala al llamador para que decida no enviar un
// mensaje con una variable rota (ver automation/engine.js:
// enviarMensajeApertura, y Master Spec — "no inventar datos del sorteo").
// ==========================================================================

const PATRON_VARIABLE = /\{([a-zA-Z0-9_]+)\}/g;

// resolverVariables(texto, datos) -> { texto, completo, faltantes }
function resolverVariables(texto, datos = {}) {

    const faltantes = [];

    const resultado = String(texto ?? "").replace(PATRON_VARIABLE, (coincidenciaCompleta, nombreVariable) => {

        const tieneValor =
            Object.prototype.hasOwnProperty.call(datos, nombreVariable) &&
            datos[nombreVariable] !== null &&
            datos[nombreVariable] !== undefined;

        if (tieneValor) {
            return String(datos[nombreVariable]);
        }

        faltantes.push(nombreVariable);

        // Se deja SIN resolver a propósito — es la señal de "incompleto"
        // que usa el llamador, nunca se inventa un valor de reemplazo.
        return coincidenciaCompleta;

    });

    return {
        texto: resultado,
        completo: faltantes.length === 0,
        faltantes
    };

}

module.exports = {
    resolverVariables
};
