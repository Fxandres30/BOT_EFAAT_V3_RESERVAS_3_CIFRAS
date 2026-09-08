// ==========================================================================
// tablaInicial.js — construye el TEXTO real de INITIAL_TABLE (Fase 5).
//
// Función pura: no toca Supabase, no envía nada. Recibe la lista de
// números disponibles YA RESUELTA por repo/tablaEvento.js y devuelve el
// mismo texto que ya usa la respuesta conversacional "disponibilidad" de
// bot/funciones/consultas/resolverConsulta.js (mismas reglas de
// bot/ai/gramatica.js: singular solo si cantidad===1, plural en cualquier
// otro caso incluido cero; lista entre paréntesis separada por " - ").
//
// Duplicado a propósito, NO importado desde bot/ai/gramatica.js: el
// Automation Engine nunca requiere nada de bot/ (ver cabecera de
// repo/tablaEvento.js) — es la misma frontera que ya obliga a
// repo/reservasActividad.js a no reutilizar bot/funciones/reservas/. Si
// bot/ai/gramatica.js cambia su formato de disponibilidad, este archivo
// debe actualizarse a mano para seguir coincidiendo.
// ==========================================================================

function construirTextoTablaInicial(numerosDisponibles) {

    const lista = Array.isArray(numerosDisponibles) ? numerosDisponibles : [];

    if (lista.length === 0) {
        return "No quedan números disponibles.";
    }

    const cantidad = lista.length;
    const singular = cantidad === 1;

    const numeroNumeros = singular ? "número" : "números";
    const disponibleDisponibles = singular ? "disponible" : "disponibles";
    const capitalizado = numeroNumeros.charAt(0).toUpperCase() + numeroNumeros.slice(1);

    const listaFormateada = `( ${lista.join(" - ")} )`;

    return `${capitalizado} ${disponibleDisponibles} (${cantidad}): ${listaFormateada}`;

}

module.exports = { construirTextoTablaInicial };
