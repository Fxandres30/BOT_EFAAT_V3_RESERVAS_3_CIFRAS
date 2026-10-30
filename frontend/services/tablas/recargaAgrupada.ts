// Agrupa recargas de la tabla. Realtime avisa UNA vez por fila cambiada (y
// otra por cada fila de actividad): sin agrupar, una operación sobre 20
// números dispararía decenas de recargas completas de la tabla. Módulo puro.
//
// - Las señales seguidas se juntan en una sola recarga tras `esperaMs` de calma.
// - Nunca hay dos recargas a la vez: si llega una señal durante una recarga,
//   se hace UNA más al terminar (para no quedarse con datos viejos).

export function crearRecargaAgrupada(recargar: () => Promise<unknown>, esperaMs = 300) {

    let temporizador: ReturnType<typeof setTimeout> | null = null;
    let enCurso = false;
    let pendiente = false;
    let cancelada = false;

    async function ejecutar() {

        temporizador = null;

        if (cancelada) return;
        if (enCurso) { pendiente = true; return; }

        enCurso = true;

        try {
            await recargar();
        } catch {
            /* quien recarga ya informa su error */
        } finally {
            enCurso = false;
            if (pendiente && !cancelada) { pendiente = false; senal(); }
        }

    }

    function senal() {
        if (cancelada) return;
        if (temporizador) clearTimeout(temporizador);
        temporizador = setTimeout(ejecutar, esperaMs);
    }

    function cancelar() {
        cancelada = true;
        if (temporizador) clearTimeout(temporizador);
        temporizador = null;
    }

    return { senal, cancelar };

}
