// Lo que decide cómo sale la imagen de la tabla: la ventana (tamaño del número
// en vw y margen por breakpoint) y la columna del panel (ancho de la
// cuadrícula). «Compartir» los toma de la pantalla de Tablas; fuera de ella,
// la copia oculta de la vista previa y el Chromium del servidor usan los
// mismos para que la imagen sea igual, sin ningún ancho fijo.
export interface PerfilCaptura {
    ventana: number;
    contenido: number;
}

// <main> es la misma columna en todas las páginas del panel (DashboardLayout).
export function medirPerfilCaptura(): PerfilCaptura {

    const ventana = window.innerWidth;
    const main = document.querySelector("main");
    if (!main) return { ventana, contenido: ventana };

    const estilo = getComputedStyle(main);

    return {
        ventana,
        contenido: Math.round(main.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight))
    };

}
