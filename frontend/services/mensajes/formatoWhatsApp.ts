// Interpreta el formato de texto de WhatsApp (*negrita*, _cursiva_,
// ~tachado~, ```monoespaciado```) para que la vista previa del editor se
// vea como el mensaje final. Solo presentación: el texto que se guarda y
// que envía el backend no cambia.

export interface SegmentoWhatsApp {
    texto: string;
    negrita?: boolean;
    cursiva?: boolean;
    tachado?: boolean;
    mono?: boolean;
}

type Estilo = Omit<SegmentoWhatsApp, "texto">;

const PROPIEDAD: Record<string, keyof Estilo> = { "*": "negrita", "_": "cursiva", "~": "tachado" };

// Igual que WhatsApp: el marcador de apertura no puede ir seguido de un
// espacio, el de cierre no puede ir precedido de uno, y ninguno puede
// estar pegado a una letra o número por fuera. No cruza saltos de línea.
const ALNUM = /[\p{L}\p{N}]/u;

function buscarCierre(texto: string, marca: string, desde: number): number {

    for (let j = desde; j < texto.length; j++) {

        const c = texto[j];

        if (c === "\n") return -1;

        if (c === marca && j > desde && !/\s/.test(texto[j - 1])) {
            const siguiente = texto[j + 1];
            if (siguiente === undefined || !ALNUM.test(siguiente)) return j;
        }

    }

    return -1;

}

function segmentarInline(texto: string, estilo: Estilo, salida: SegmentoWhatsApp[]) {

    let buffer = "";
    let i = 0;

    const vaciar = () => {
        if (buffer) salida.push({ texto: buffer, ...estilo });
        buffer = "";
    };

    while (i < texto.length) {

        const c = texto[i];
        const prop = PROPIEDAD[c];

        if (prop && !estilo[prop]) {

            const anterior = i > 0 ? texto[i - 1] : "";
            const siguiente = texto[i + 1];
            const aperturaValida = (!anterior || !ALNUM.test(anterior)) && siguiente !== undefined && !/\s/.test(siguiente) && siguiente !== c;

            if (aperturaValida) {

                const cierre = buscarCierre(texto, c, i + 1);

                if (cierre > i + 1) {
                    vaciar();
                    segmentarInline(texto.slice(i + 1, cierre), { ...estilo, [prop]: true }, salida);
                    i = cierre + 1;
                    continue;
                }

            }

        }

        buffer += c;
        i++;

    }

    vaciar();

}

export function segmentarFormatoWhatsApp(texto: string): SegmentoWhatsApp[] {

    const salida: SegmentoWhatsApp[] = [];

    if (!texto) return salida;

    // ```bloque``` se respeta tal cual (sin formato interno), como WhatsApp.
    const partes = texto.split(/(```[\s\S]+?```)/g);

    for (const parte of partes) {

        if (!parte) continue;

        if (parte.startsWith("```") && parte.endsWith("```") && parte.length > 6) {
            salida.push({ texto: parte.slice(3, -3), mono: true });
            continue;
        }

        segmentarInline(parte, {}, salida);

    }

    return salida;

}
