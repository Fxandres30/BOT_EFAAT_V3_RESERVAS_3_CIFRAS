// Control del estado «Procesando…» de un botón de sesión. Puro (sin React):
// lo usa useSession y se prueba aparte con temporizadores falsos.
//
// Garantías:
//   - una sola acción a la vez: iniciar() devuelve false si ya hay una en
//     curso (un doble clic no duplica la operación);
//   - SIEMPRE termina: con error (al instante), con la confirmación del
//     bot (cambio de estado de la sesión en Supabase) o, si esa
//     confirmación no llega, al vencer la espera máxima;
//   - después de terminar se puede reintentar.

import type { ResultadoAccion } from "./accionSesion";

export interface EstadoControl {
    cargando: boolean;
    error: string | null;   // mensaje para mostrar; null si no hubo error
    aviso: string | null;   // la acción se envió pero no llegó confirmación
}

// Cuánto se espera la confirmación del bot (el cambio de estado de la
// sesión) después de que el bot aceptó la acción.
export const ESPERA_CONFIRMACION_MS = 45000;

export const AVISO_SIN_CONFIRMACION = "El bot recibió la orden, pero el estado de la sesión todavía no cambió. Revisa la sesión en unos segundos o vuelve a intentarlo.";

export function crearControlAccion({
    alCambiar,
    esperaConfirmacionMs = ESPERA_CONFIRMACION_MS,
    programar = (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown,
    cancelar = (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)
}: {
    alCambiar: (estado: EstadoControl) => void;
    esperaConfirmacionMs?: number;
    programar?: (fn: () => void, ms: number) => unknown;
    cancelar?: (t: unknown) => void;
}) {

    let enCurso = false;
    let temporizador: unknown = null;

    function limpiarTemporizador() {
        if (temporizador !== null) {
            cancelar(temporizador);
            temporizador = null;
        }
    }

    function terminar(error: string | null, aviso: string | null = null) {
        limpiarTemporizador();
        enCurso = false;
        alCambiar({ cargando: false, error, aviso });
    }

    return {

        enCurso: () => enCurso,

        // false = ya hay una acción en curso: no se envía otra.
        iniciar(): boolean {
            if (enCurso) return false;
            enCurso = true;
            alCambiar({ cargando: true, error: null, aviso: null });
            return true;
        },

        // Respuesta del bot a la acción. Con error termina al instante; con
        // éxito espera la confirmación (o el vencimiento de la espera).
        resultado(r: ResultadoAccion) {
            if (!enCurso) return;
            if (!r.ok) {
                terminar(r.mensaje);
                return;
            }
            limpiarTemporizador();
            temporizador = programar(() => terminar(null, AVISO_SIN_CONFIRMACION), esperaConfirmacionMs);
        },

        // El estado de la sesión cambió (Supabase en tiempo real).
        confirmado() {
            if (enCurso) terminar(null);
        },

        // Al desmontar el componente: no dejar temporizadores vivos.
        destruir() {
            limpiarTemporizador();
            enCurso = false;
        }

    };

}

export type ControlAccion = ReturnType<typeof crearControlAccion>;
