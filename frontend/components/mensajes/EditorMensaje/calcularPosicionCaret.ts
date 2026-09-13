// Calcula la posición en píxeles del cursor dentro de un <textarea>,
// relativa a su propio elemento — técnica estándar de "div espejo": se
// clona el estilo tipográfico real del textarea en un div oculto, se
// inserta un marcador en la posición del cursor y se mide su offset.
// Sin esto, el selector de variables no podría abrirse pegado al cursor.
const PROPIEDADES_A_COPIAR: (keyof CSSStyleDeclaration)[] = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "textTransform", "wordSpacing", "textIndent",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "boxSizing", "whiteSpace", "wordWrap", "wordBreak"
];

export function calcularPosicionCaret(textarea: HTMLTextAreaElement, posicion: number): { top: number; left: number } {

    const estilo = window.getComputedStyle(textarea);

    const espejo = document.createElement("div");
    const marcador = document.createElement("span");

    espejo.style.position = "absolute";
    espejo.style.visibility = "hidden";
    espejo.style.whiteSpace = "pre-wrap";
    espejo.style.overflowWrap = "break-word";
    espejo.style.width = `${textarea.clientWidth}px`;

    for (const propiedad of PROPIEDADES_A_COPIAR) {
        (espejo.style as unknown as Record<string, string>)[propiedad as string] = estilo[propiedad] as string;
    }

    const textoAntes = textarea.value.slice(0, posicion);
    const textoDespues = textarea.value.slice(posicion) || ".";

    espejo.appendChild(document.createTextNode(textoAntes));
    marcador.textContent = "|";
    espejo.appendChild(marcador);
    espejo.appendChild(document.createTextNode(textoDespues));

    document.body.appendChild(espejo);

    const top = marcador.offsetTop - textarea.scrollTop;
    const left = marcador.offsetLeft - textarea.scrollLeft;

    document.body.removeChild(espejo);

    const lineHeight = parseInt(estilo.lineHeight, 10) || 20;

    return {
        top: textarea.offsetTop + top + lineHeight,
        left: textarea.offsetLeft + Math.min(left, textarea.clientWidth - 10)
    };

}
