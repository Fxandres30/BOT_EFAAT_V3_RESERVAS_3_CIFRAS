import { toPng } from "html-to-image";

// Captura del `div` REAL de la tabla de números de la pantalla Tablas
// (components/tablas/Grid.tsx, el mismo que ve el administrador, con sus
// colores y diseño) como PNG en data URL, para «Compartir tabla».
//
// La cara de cada celda solo pinta número + estado (NumeroCard): ningún
// nombre ni teléfono aparece en la imagen (el `title` no se dibuja).

// Vercel limita el cuerpo de una petición a ~4,5 MB; el PNG va en base64
// dentro del JSON. El backend vuelve a validar (tipo, firma y tamaño).
export const MAX_DATA_URL = 4_000_000;

export async function capturarTabla(elemento: HTMLElement | null): Promise<string> {

    if (!elemento) throw new Error("No se encontró la tabla en pantalla.");

    const fondo = getComputedStyle(elemento).backgroundColor;

    const dataUrl = await toPng(elemento, {
        // Nítida en móviles sin pasar el límite de tamaño.
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: fondo && fondo !== "rgba(0, 0, 0, 0)" ? fondo : "#ffffff"
    });

    if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("No se pudo generar la imagen de la tabla.");
    if (dataUrl.length > MAX_DATA_URL) throw new Error("La imagen de la tabla es demasiado grande para enviarla.");

    return dataUrl;

}
