// Selección de números del modo «Seleccionar» de Tablas. Módulo puro: vive
// fuera del estado de TablaPrecioView para que un clic no vuelva a dibujar
// toda la pantalla; solo la barra de selección, la cuadrícula (y de ella,
// la celda que cambió) y el historial, que se suscriben (useSyncExternalStore).
//
// Es solo una marca visual: no reserva nada ni consulta la base. El
// servidor vuelve a comprobar cada número al operar.

export interface EstadoSeleccion {
    activo: boolean;
    numeros: string[];
    conjunto: ReadonlySet<string>;
}

export function crearSeleccion() {

    let estado: EstadoSeleccion = { activo: false, numeros: [], conjunto: new Set() };
    // Mientras un lote se pone al día: no se selecciona sobre estados viejos.
    let bloqueada = false;
    const oyentes = new Set<() => void>();

    function poner(activo: boolean, numeros: string[]) {
        if (activo === estado.activo && numeros === estado.numeros) return;
        estado = { activo, numeros, conjunto: new Set(numeros) };
        oyentes.forEach(fn => fn());
    }

    return {

        obtener: (): EstadoSeleccion => estado,

        suscribir(fn: () => void) {
            oyentes.add(fn);
            return () => { oyentes.delete(fn); };
        },

        bloquear(valor: boolean) {
            bloqueada = valor;
        },

        activar: () => poner(true, []),
        salir: () => poner(false, []),
        limpiar: () => poner(estado.activo, estado.numeros.length === 0 ? estado.numeros : []),
        cambiar: (numeros: string[]) => poner(estado.activo, numeros),
        quitar: (numero: string) => poner(estado.activo, estado.numeros.filter(n => n !== numero)),

        alternar(numero: string) {
            if (bloqueada) return;
            poner(estado.activo, estado.conjunto.has(numero) ? estado.numeros.filter(n => n !== numero) : [...estado.numeros, numero]);
        }

    };

}

export type Seleccion = ReturnType<typeof crearSeleccion>;
