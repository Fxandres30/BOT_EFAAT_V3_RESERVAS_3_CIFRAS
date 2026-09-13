// Espejo del lado cliente de backend/bot/ai/plantillaMensaje.js (aplicarPlantilla),
// usado SOLO para la previsualización visual del editor con datos de EJEMPLO.
// La sustitución real en producción la hace siempre el backend con datos reales.

import { formatHora12 } from "@/lib/formatHora";
import { resolverClaveCanonica } from "./catalogoVariablesGlobal";

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

        // El ejemplo específico del tipo de mensaje manda si existe. Si la
        // plantilla usa una variable GLOBAL que ese tipo no incluyó en su
        // "ejemplo" (p. ej. {{monto_pendiente}} en una plantilla de
        // reserva), se cae al ejemplo genérico del catálogo global en vez
        // de mostrar vacío — sigue siendo dato de ejemplo, nunca real (ver
        // sección 15 de la fase de implementación).
        let valor = variables[nombre];

        if (valor === undefined) {

            const info = resolverClaveCanonica(nombre);
            valor = info ? info.definicion.example : "";

        }

        // La hora se muestra al usuario en 12h (igual que el backend en
        // plantillaMensaje.js). El dato de ejemplo/almacenado no cambia.
        if (nombre === "hora" && valor) {
            return formatHora12(valor);
        }

        return valor;

    });

}
