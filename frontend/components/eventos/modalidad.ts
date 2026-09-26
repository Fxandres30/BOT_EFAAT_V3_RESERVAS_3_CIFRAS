// Clasificación de eventos para la página Eventos. Todo se DERIVA de las
// columnas que ya existen en eventos_bot (cifras, valor, estado, activo) —
// no hay columna nueva ni datos inventados.

export type Modalidad = "dos" | "tres_pago" | "tres_gratis";

export type Fase = "activo" | "programado" | "finalizado";

export interface ModalidadInfo {
    id: Modalidad;
    titulo: string;
    rango: string;
    cantidad: number;
    tipo: "PAGOS" | "GRATUITOS";
}

export const MODALIDADES: ModalidadInfo[] = [
    { id: "dos", titulo: "2 CIFRAS", rango: "00–99", cantidad: 100, tipo: "PAGOS" },
    { id: "tres_pago", titulo: "3 CIFRAS", rango: "000–999", cantidad: 1000, tipo: "PAGOS" },
    { id: "tres_gratis", titulo: "GRATIS 3 CIFRAS", rango: "000–999", cantidad: 1000, tipo: "GRATUITOS" }
];

export function infoModalidad(id: Modalidad): ModalidadInfo {
    return MODALIDADES.find((m) => m.id === id) || MODALIDADES[0];
}

function valorNumerico(valor: unknown): number | null {
    if (valor === null || valor === undefined || valor === "") return null;
    const n = Number(String(valor).replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : null;
}

// 3 cifras = cifras 3 (o 1000 números). Gratis = 3 cifras sin valor o con
// valor 0. Todo lo demás (incluidos TODOS los eventos actuales) = 2 cifras.
export function modalidadDe(evento: { cifras?: number | null; cantidad_numeros?: number | null; valor?: unknown }): Modalidad {
    const esTres = evento?.cifras === 3 || evento?.cantidad_numeros === 1000;
    if (!esTres) return "dos";
    const valor = valorNumerico(evento?.valor);
    return !valor ? "tres_gratis" : "tres_pago";
}

// finalizado: cerrado por el bot (estado "cerrado" / activo=false).
// programado: solo si el estado lo dice explícitamente — hoy el bot no
//   crea eventos programados; NO se deduce por fecha (fecha_evento se
//   guarda en UTC y un sorteo nocturno parecería "de mañana").
// activo: el resto.
export function faseDe(evento: { estado?: string | null; activo?: boolean | null }): Fase {
    const estado = (evento?.estado || "").toLowerCase();
    if (estado === "cerrado" || estado === "finalizado" || evento?.activo === false) return "finalizado";
    if (estado === "programado") return "programado";
    return "activo";
}
