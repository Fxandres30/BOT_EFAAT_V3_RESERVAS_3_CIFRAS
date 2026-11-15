import { toPng, getFontEmbedCSS } from "html-to-image";

// Fuentes de la imagen (latencia, 14/11/2026). toPng incrusta en CADA captura
// todas las @font-face de la página y las vuelve a descargar (cacheBust): 11
// archivos por clic. Aquí se calcula ese MISMO CSS (getFontEmbedCSS es la
// función que toPng usa por dentro, con las mismas opciones) una sola vez y se
// le entrega ya hecho: la imagen es idéntica. Se recalcula si cambian las hojas
// de estilo de la página o si falló.
let fuentes: { clave: string; css: Promise<string> } | null = null;

function cssDeFuentes(elemento: HTMLElement): Promise<string> {
    const clave = Array.from(document.styleSheets).map(s => s.href || "inline").join("|");
    if (!fuentes || fuentes.clave !== clave) {
        const css = getFontEmbedCSS(elemento, { cacheBust: true });
        const entrada = { clave, css };
        css.catch(() => { if (fuentes === entrada) fuentes = null; });
        fuentes = entrada;
    }
    return fuentes.css;
}

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

    const fontEmbedCSS = await cssDeFuentes(elemento);

    const dataUrl = await toPng(elemento, {
        fontEmbedCSS,
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
