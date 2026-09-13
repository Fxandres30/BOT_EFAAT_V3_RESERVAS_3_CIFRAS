export interface ResultadoCompartir {
    enviado: boolean;
    motivo?: string;
}

// Botón "Compartir" real — dispara la MISMA función del backend
// (services/compartirTabla.js) que usa la automatización (INITIAL_TABLE),
// nunca una implementación paralela.
export async function compartirTabla(precio: number, usuarioId: string): Promise<ResultadoCompartir> {

    const res = await fetch("/api/tablas/compartir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precio, usuarioId })
    });

    return await res.json();

}
