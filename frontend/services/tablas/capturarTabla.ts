import { toPng } from "html-to-image";

// Captura de la CUADRÍCULA de números de la pantalla Tablas
// (components/tablas/Grid.tsx: el mismo `div` que ve el administrador, con
// sus colores, bordes y diseño) como PNG en data URL, para «Compartir
// tabla». No incluye la leyenda, ni filtros, botones o estadísticas: son
// solo para administración.
//
// La cara de cada celda solo pinta número + estado (NumeroCard): ningún
// nombre ni teléfono aparece en la imagen (el `title` no se dibuja).

// Vercel limita el cuerpo de una petición a ~4,5 MB; el PNG va en base64
// dentro del JSON. El backend vuelve a validar (tipo, firma y tamaño).
export const MAX_DATA_URL = 4_000_000;

const TRANSPARENTE = new Set(["", "transparent", "rgba(0, 0, 0, 0)"]);

// La cuadrícula es transparente: el fondo del diseño está en su contenedor.
function fondoDe(elemento: HTMLElement): string {
    for (let el: HTMLElement | null = elemento; el; el = el.parentElement) {
        const fondo = getComputedStyle(el).backgroundColor;
        if (!TRANSPARENTE.has(fondo)) return fondo;
    }
    return "#ffffff";
}

export async function capturarTabla(elemento: HTMLElement | null): Promise<string> {

    if (!elemento) throw new Error("No se encontró la tabla en pantalla.");

    // Mismo margen interior que la tarjeta de la tabla en el panel: las
    // sombras de las celdas del borde no quedan cortadas. Solo se aplica a
    // la copia que se captura; la página no cambia.
    const margen = elemento.parentElement ? parseFloat(getComputedStyle(elemento.parentElement).paddingLeft) || 16 : 16;
    const ancho = elemento.offsetWidth;
    const alto = elemento.offsetHeight;

    const dataUrl = await toPng(elemento, {
        // Nítida en móviles sin pasar el límite de tamaño.
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: fondoDe(elemento),
        width: ancho + margen * 2,
        height: alto + margen * 2,
        style: {
            margin: "0",
            padding: `${margen}px`,
            boxSizing: "content-box",
            width: `${ancho}px`,
            height: `${alto}px`
        }
    });

    if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("No se pudo generar la imagen de la tabla.");
    if (dataUrl.length > MAX_DATA_URL) throw new Error("La imagen de la tabla es demasiado grande para enviarla.");

    return dataUrl;

}
