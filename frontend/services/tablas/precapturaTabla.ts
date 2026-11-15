// ==========================================================================
// PRE-CAPTURA DE LA IMAGEN DE UNA TABLA (14/11/2026, opción B aprobada).
//
// La imagen de «Compartir» / «Cambiar grupos» es una tarea larga del navegador
// (≈0,8 s en escritorio, varios segundos en móviles lentos) que el generador
// único no permite acortar. Aquí se GUARDA la última imagen generada junto con
// la CLAVE exacta de lo que pinta: los números (libres, ocupados, pagados, en
// el orden de la cuadrícula), el diseño y el ancho. Quien comparte vuelve a
// calcular la clave con la tabla que hay en pantalla en ESE momento:
//   - misma clave  -> se usa esa imagen (es idéntica a generarla ahora: el
//                     mismo generador con la misma entrada);
//   - otra clave   -> se genera ahora, como antes (la anterior no se usa jamás).
// Cualquier reserva, pago, liberación, bloqueo, cambio de diseño o de ancho
// cambia la clave: una imagen desactualizada nunca se comparte.
//
// Módulo puro (sin React ni red): el cuándo preparar la imagen por adelantado
// lo decide components/tablas/usePrecapturaTabla.ts.
// ==========================================================================

export interface EntradaPrecaptura {
    numeros: { numerosDisponibles: string[]; numerosOcupados: string[]; numerosPagados: string[] };
    diseno?: unknown;
    anchoContenido?: number | null;
}

export interface ImagenPrecaptura {
    imagen: string;
    huella: string;
}

// TODO lo que decide los píxeles de la imagen (y nada más).
export function claveImagen(e: EntradaPrecaptura): string {
    return JSON.stringify({
        d: e.numeros.numerosDisponibles,
        o: e.numeros.numerosOcupados,
        p: e.numeros.numerosPagados,
        diseno: e.diseno ?? null,
        ancho: e.anchoContenido ?? null
    });
}

export interface Precaptura<E extends EntradaPrecaptura, I extends ImagenPrecaptura> {
    /** La imagen EXACTA de esta entrada: la preparada (o en curso) si su clave
     *  coincide; si no, se genera ahora. */
    obtener(entrada: E): Promise<I>;
    /** ¿No hay imagen (ni en curso) para esta entrada? */
    falta(entrada: E): boolean;
    /** Duración (ms) de la última generación terminada; null si no hubo ninguna. */
    ultimaDuracion(): number | null;
}

export function crearPrecaptura<E extends EntradaPrecaptura, I extends ImagenPrecaptura>(
    generar: (entrada: E) => Promise<I>,
    reloj: () => number = () => performance.now()
): Precaptura<E, I> {

    // Una sola imagen: la de la última entrada pedida.
    let actual: { clave: string; promesa: Promise<I> } | null = null;
    let duracion: number | null = null;

    function iniciar(entrada: E, clave: string): Promise<I> {
        const inicio = reloj();
        const registro: { clave: string; promesa: Promise<I> } = { clave, promesa: Promise.resolve(null as unknown as I) };
        registro.promesa = generar(entrada).then(
            (imagen) => { duracion = reloj() - inicio; return imagen; },
            (error) => {
                // Una generación fallida nunca queda guardada: la próxima vuelve a intentarlo.
                if (actual === registro) actual = null;
                throw error;
            }
        );
        actual = registro;
        return registro.promesa;
    }

    return {
        obtener(entrada) {
            const clave = claveImagen(entrada);
            if (actual && actual.clave === clave) return actual.promesa;
            return iniciar(entrada, clave);
        },
        falta(entrada) {
            return !(actual && actual.clave === claveImagen(entrada));
        },
        ultimaDuracion() {
            return duracion;
        }
    };

}
