// Huella de lo que pinta la imagen de una tabla: qué números están libres,
// ocupados y pagados. MISMO algoritmo que el backend
// (backend/sorteos/capturaProgramada.js → huellaNumeros): sha256 del JSON
// { d, o, p } con cada lista como texto y ordenada. Así el panel y el
// servidor comprueban con la misma regla que una imagen corresponde a la
// tabla real; cualquier número, reserva, pago o bloqueo que cambie la
// imagen cambia la huella.

export interface NumerosTabla {
    numerosDisponibles: string[];
    numerosOcupados: string[];
    numerosPagados: string[];
}

const orden = (lista: readonly (string | number)[] | null | undefined) => [...(lista || [])].map(String).sort();

// Mismo texto que JSON.stringify en Node para este objeto (orden de claves fijo).
export function textoHuella(numeros: NumerosTabla): string {
    return JSON.stringify({
        d: orden(numeros?.numerosDisponibles),
        o: orden(numeros?.numerosOcupados),
        p: orden(numeros?.numerosPagados)
    });
}

export async function huellaNumeros(numeros: NumerosTabla): Promise<string> {
    const datos = new TextEncoder().encode(textoHuella(numeros));
    const resumen = await crypto.subtle.digest("SHA-256", datos);
    return [...new Uint8Array(resumen)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Números de la tabla tal como los pinta la imagen, desde las filas del
// panel: misma regla que el backend (automation/repo/tablaEvento.obtenerNumeros):
// libre = disponible; cualquier otro estado (reservado, pagado, bloqueado,
// en proceso) = ocupado; pagado además en «pagados».
export function numerosDeFilas(filas: readonly { numero: string; estado: string }[]): NumerosTabla {
    const ordenadas = [...filas].sort((a, b) => a.numero.localeCompare(b.numero));
    return {
        numerosDisponibles: ordenadas.filter(f => f.estado === "libre").map(f => f.numero),
        numerosOcupados: ordenadas.filter(f => f.estado !== "libre").map(f => f.numero),
        numerosPagados: ordenadas.filter(f => f.estado === "pagado").map(f => f.numero)
    };
}
