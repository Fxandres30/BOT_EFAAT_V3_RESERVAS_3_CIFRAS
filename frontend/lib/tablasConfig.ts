// Única fuente de verdad en el frontend para "qué tabla física corresponde
// a cada precio". Espejo explícito de
// backend/bot/funciones/eventos/configEvento.js — si cambia allá, debe
// cambiar aquí también. No crear otra copia de este mapa en ningún otro
// archivo del frontend.

export interface TablaConfig {
    tabla: string;
    cifras: number;
    cantidad: number;
}

export const PRECIOS_VALIDOS = [1000, 1500, 2000, 3000, 5000, 10000, 15000] as const;

export type PrecioValido = (typeof PRECIOS_VALIDOS)[number];

export const TABLAS_CONFIG: Record<number, TablaConfig> = {
    1000: { tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
    1500: { tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
    2000: { tabla: "reservas_dos_cifras", cifras: 2, cantidad: 100 },
    3000: { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
    5000: { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
    10000: { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 },
    15000: { tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 }
};

export function obtenerTablaConfig(precio: number): TablaConfig | null {
    return TABLAS_CONFIG[precio] || null;
}
