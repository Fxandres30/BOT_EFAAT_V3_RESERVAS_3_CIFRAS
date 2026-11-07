// Lógica PURA de selección entre plantillas ya habilitadas (Fase 5.4).
// Nunca decide negocio, nunca consulta Supabase: solo recibe datos ya
// leídos y devuelve cuál plantilla usar (o ninguna, para caer al
// comportamiento de fallback existente).
//
// aleatorio (FASE O4, opcional): fuente del azar. Por defecto Math.random,
// exactamente como siempre; el llamador puede pasar una función que lo
// registre para dárselo igual a la comparación en sombra.
function seleccionarPlantilla(config, habilitadas, aleatorio = Math.random) {

    if (!Array.isArray(habilitadas) || habilitadas.length === 0) {
        return { plantilla: null, nuevoIndiceRotacion: null };
    }

    const modo = config?.modo_seleccion || "aleatorio";

    if (modo === "fijo") {

        const fija = habilitadas.find(p => p.id === config.plantilla_fija_id);

        // Si la plantilla fija ya no existe o fue deshabilitada, es una
        // configuración corrupta: no se sustituye por otra automáticamente,
        // se cae al fallback existente (Gemini / mensaje fijo).
        return { plantilla: fija || null, nuevoIndiceRotacion: null };

    }

    if (modo === "rotacion") {

        const total = habilitadas.length;

        const base = Number.isInteger(config?.rotacion_indice) ? config.rotacion_indice : 0;

        const indiceActual = ((base % total) + total) % total;

        const siguiente = (indiceActual + 1) % total;

        return { plantilla: habilitadas[indiceActual], nuevoIndiceRotacion: siguiente };

    }

    // aleatorio (modo por defecto)
    const indiceAleatorio = Math.floor(aleatorio() * habilitadas.length);

    return { plantilla: habilitadas[indiceAleatorio], nuevoIndiceRotacion: null };

}

module.exports = {
    seleccionarPlantilla
};
