// ¿Lo que muestra la tabla sigue al día con el servidor? (UX-09). Módulo
// puro: lo usa hooks/useTablaPrecio.ts con sus canales de Realtime.
//
// Regla: los datos cuentan como SINCRONIZADOS solo si se leyeron con TODOS
// los canales de tiempo real conectados (y la red disponible) desde ANTES
// de empezar la lectura y sin cortes hasta terminarla. Así ningún cambio
// queda entre la lectura y el aviso en tiempo real.
//
// - Un canal que se corta (CHANNEL_ERROR, TIMED_OUT, CLOSED) o la red que se
//   cae -> «perdida»: mientras tanto se pueden haber perdido cambios.
// - Al volver todos los canales y la red -> «validando» y una lectura nueva
//   en el acto; al terminar bien -> «sincronizada».
// - Si esa lectura falla -> «perdida» y se reintenta sola.
//
// Mientras no esté «sincronizada», el panel no deja operar con lo que se ve
// (las reglas de cada operación siguen en el servidor, que es quien decide).

import { crearRecargaAgrupada } from "./recargaAgrupada";

export type EstadoSincronizacion = "validando" | "sincronizada" | "perdida";

export const MENSAJE_SIN_SINCRONIZAR = "La tabla no está sincronizada con el servidor: lo que ves puede estar desactualizado. Espera a que se valide para operar.";

interface Opciones {
    canales: string[];
    // Lectura completa de la tabla (la que guarda la caché).
    leer: () => Promise<unknown>;
    alCambiar: (estado: EstadoSincronizacion) => void;
    enLinea?: boolean;
    // Sin conexión en tiempo real a tiempo: se lee igualmente para mostrar
    // algo, pero queda «perdida».
    esperaInicialMs?: number;
    reintentoMs?: number;
    esperaMs?: number;
}

export function crearSincronizacion({ canales, leer, alCambiar, enLinea = true, esperaInicialMs = 4000, reintentoMs = 5000, esperaMs }: Opciones) {

    const estados = new Map<string, string>();
    let enRed = enLinea;
    let conectado = false;
    // Cambia en cada conexión y en cada corte: una lectura empezada en otra
    // época no puede dar los datos por sincronizados.
    let epoca = 0;
    let estado: EstadoSincronizacion = "validando";
    let cerrada = false;
    let reintento: ReturnType<typeof setTimeout> | null = null;

    function poner(nuevo: EstadoSincronizacion) {
        if (cerrada || nuevo === estado) return;
        estado = nuevo;
        alCambiar(nuevo);
    }

    async function validar() {

        const desde = epoca;
        const conectadoAlEmpezar = conectado;

        try {
            await leer();
        } catch (e) {
            if (!cerrada && conectado && epoca === desde) {
                poner("perdida");
                programarReintento();
            }
            throw e;
        }

        if (conectadoAlEmpezar && conectado && epoca === desde) poner("sincronizada");

    }

    const recarga = crearRecargaAgrupada(validar, esperaMs);

    function programarReintento() {
        if (reintento || cerrada) return;
        reintento = setTimeout(() => {
            reintento = null;
            if (conectado && estado !== "sincronizada") recarga.ahora();
        }, reintentoMs);
    }

    function evaluar() {

        if (cerrada) return;

        const todos = enRed && canales.every((c) => estados.get(c) === "SUBSCRIBED");

        if (todos) {
            if (!conectado) {
                conectado = true;
                epoca++;
                poner("validando");
                recarga.ahora();
            }
            return;
        }

        // Aún conectándose por primera vez: nada se ha perdido todavía.
        const fallo = conectado || !enRed || [...estados.values()].some((s) => s !== "SUBSCRIBED");

        if (fallo) {
            conectado = false;
            epoca++;
            poner("perdida");
        }

    }

    const inicial = setTimeout(() => {
        if (conectado || cerrada) return;
        poner("perdida");
        recarga.ahora();
    }, esperaInicialMs);

    return {

        estado: () => estado,

        // Estado de un canal (callback de .subscribe()).
        canal(nombre: string, status: string) {
            estados.set(nombre, status);
            evaluar();
        },

        // Eventos online/offline del navegador.
        red(disponible: boolean) {
            enRed = disponible;
            evaluar();
        },

        // Cambio recibido en tiempo real: recarga agrupada.
        senal() {
            recarga.senal();
        },

        // «Validar ahora»: lectura inmediata (solo sincroniza si hay conexión).
        validarAhora() {
            recarga.ahora();
        },

        cerrar() {
            cerrada = true;
            clearTimeout(inicial);
            if (reintento) clearTimeout(reintento);
            recarga.cancelar();
        }

    };

}
