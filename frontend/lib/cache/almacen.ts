import { useCallback, useSyncExternalStore } from "react";

// Caché en memoria del panel (UX-09): una sola para todo el navegador.
//
// - Solo memoria: nada se guarda en localStorage (son datos de clientes) y
//   recargar la página empieza de cero.
// - Las claves llevan el usuario de la sesión; al cambiar de usuario o
//   cerrar sesión se vacía entera (lib/cache/sesion.ts).
// - Control de versiones: cada lectura toma un número al EMPEZAR y solo se
//   guarda si es más reciente que la última guardada. Una respuesta vieja
//   que llega tarde nunca pisa una más nueva.
// - Es una optimización de lectura: el servidor sigue validando cada
//   reserva, pago o liberación con su estado real.

interface Entrada {
    datos?: unknown;
    // Número de la lectura cuyos datos están guardados.
    aplicada: number;
    validoHasta: number;
    enCurso: Promise<unknown> | null;
}

// Cambia al vaciar: lo que llegue de una lectura anterior se descarta.
let generacion = 0;
let ultimaLectura = 0;
const entradas = new Map<string, Entrada>();
const oyentes = new Map<string, Set<() => void>>();

function avisar(clave: string) {
    oyentes.get(clave)?.forEach((fn) => fn());
}

export function leer<T>(clave: string | null): T | undefined {
    return clave ? (entradas.get(clave)?.datos as T | undefined) : undefined;
}

// Datos de `clave`. Sin `forzar`: los guardados si siguen vigentes, o la
// lectura que ya esté en curso (dos componentes que piden lo mismo hacen
// UNA solicitud). Con `forzar`: siempre una lectura nueva (tras un cambio
// real); devuelve lo más reciente que haya cuando termina.
export function cargar<T>(
    clave: string,
    cargador: () => Promise<T>,
    { forzar = false, vigenciaMs = 0 }: { forzar?: boolean; vigenciaMs?: number } = {}
): Promise<T> {

    let entrada = entradas.get(clave);
    if (!entrada) {
        entrada = { aplicada: 0, validoHasta: 0, enCurso: null };
        entradas.set(clave, entrada);
    }

    if (!forzar) {
        if (entrada.datos !== undefined && entrada.validoHasta > Date.now()) return Promise.resolve(entrada.datos as T);
        if (entrada.enCurso) return entrada.enCurso as Promise<T>;
    }

    const lectura = ++ultimaLectura;
    const gen = generacion;

    const promesa: Promise<T> = cargador().then((datos) => {

        const actual = entradas.get(clave);

        // Otra sesión de usuario: no se guarda nada.
        if (gen !== generacion || !actual) return datos;

        if (lectura > actual.aplicada) {
            actual.datos = datos;
            actual.aplicada = lectura;
            actual.validoHasta = Date.now() + vigenciaMs;
            avisar(clave);
            return datos;
        }

        // Llegó tarde: ya hay datos de una lectura que empezó después.
        return actual.datos as T;

    }).finally(() => {
        const actual = entradas.get(clave);
        if (actual?.enCurso === promesa) actual.enCurso = null;
    });

    entrada.enCurso = promesa;
    return promesa;

}

// La próxima lectura sin `forzar` irá al servidor; mientras, se conservan
// los datos que hay.
export function invalidar(coincide: (clave: string) => boolean) {
    for (const [clave, entrada] of entradas) {
        if (coincide(clave)) entrada.validoHasta = 0;
    }
}

// Cambio de usuario o cierre de sesión.
export function vaciar() {
    generacion++;
    entradas.clear();
    for (const clave of oyentes.keys()) avisar(clave);
}

export function suscribir(clave: string, fn: () => void): () => void {
    let lista = oyentes.get(clave);
    if (!lista) oyentes.set(clave, lista = new Set());
    lista.add(fn);
    return () => {
        lista.delete(fn);
        if (lista.size === 0) oyentes.delete(clave);
    };
}

// Datos de `clave` en un componente; se vuelve a pintar cuando cambian.
export function useDato<T>(clave: string | null): T | undefined {

    const alCambiar = useCallback(
        (fn: () => void) => (clave ? suscribir(clave, fn) : () => {}),
        [clave]
    );

    return useSyncExternalStore(alCambiar, () => leer<T>(clave), () => undefined);

}
