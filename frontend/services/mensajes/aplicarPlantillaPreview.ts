// Espejo del lado cliente de backend/bot/ai/plantillaMensaje.js (aplicarPlantilla),
// usado SOLO para la previsualización visual del editor con datos de EJEMPLO.
// La sustitución real en producción la hace siempre el backend con datos reales.

const MOSTRAR_POR_VARIABLE: Record<string, string> = {
    cliente: "mostrar_nombre",
    evento: "mostrar_evento",
    numeros_solicitados: "mostrar_numeros_solicitados",
    numeros_reservados: "mostrar_numeros_reservados",
    numeros_ocupados: "mostrar_numeros_ocupados",
    numeros_disponibles: "mostrar_numeros_disponibles",
    fecha: "mostrar_fecha",
    hora: "mostrar_hora",
    precio: "mostrar_precio"
};

export function aplicarPlantillaPreview(
    plantilla: string,
    variables: Record<string, string>,
    mostrar: Record<string, boolean>
): string {

    if (!plantilla || !plantilla.trim()) return "";

    return plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, nombre) => {

        const campoMostrar = MOSTRAR_POR_VARIABLE[nombre];

        if (campoMostrar && mostrar[campoMostrar] === false) {
            return "";
        }

        return variables[nombre] !== undefined ? variables[nombre] : "";

    });

}
