import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// Configuración por defecto — a propósito replica el look actual de la
// cuadrícula (blanco / rosa-600 / esmeralda-600, ver estadoVisual.ts) para
// que una tabla que nunca se ha personalizado se vea exactamente igual
// que antes de esta fase.
export const DEFAULT_TABLA_DISENO_CONFIG: TablaDisenoConfig = {
    theme: {
        pageBg: "#F6F8FC",
        tableBg: "#FFFFFF",
        text: "#0F172A",
        border: "#E5E7EB",
        accent: "#2563EB"
    },
    cells: {
        available: { bg: "#FFFFFF", border: "#E5E7EB", text: "#374151" },
        reserved: { bg: "#F43F5E", border: "#F43F5E", text: "#FFFFFF" },
        pagado: { bg: "#10B981", border: "#10B981", text: "#FFFFFF" }
    },
    numbers: { size: 20, weight: 700 },
    grid: { radius: 8, spacing: 8, borderWidth: 1 }
};

export interface TablaDisenoPreset {
    key: string;
    nombre: string;
    config: TablaDisenoConfig;
}

// Presets — inspirados en la referencia visual (index (3).html), adaptados
// a la paleta de EFAAT. Viven como catálogo estático del frontend (no hay
// presets reales persistidos hoy — ver auditoría): "aplicar" un preset
// copia esta configuración a la tabla o a un diseño guardado, nunca la
// referencia por id.
export const TABLA_DISENO_PRESETS: TablaDisenoPreset[] = [
    {
        key: "efaat",
        nombre: "EFAAT",
        config: DEFAULT_TABLA_DISENO_CONFIG
    },
    {
        key: "clasico",
        nombre: "Clásico",
        config: {
            theme: { pageBg: "#F3ECD8", tableBg: "#D8C36A", text: "#2B2210", border: "#B89A4F", accent: "#8A6A1F" },
            cells: {
                available: { bg: "#E8F2DF", border: "#9FC98A", text: "#2B2210" },
                reserved: { bg: "#FBE9B0", border: "#D9A521", text: "#5C3D00" },
                pagado: { bg: "#D9E9FB", border: "#5B8FC9", text: "#1C3A5C" }
            },
            numbers: { size: 18, weight: 700 },
            grid: { radius: 8, spacing: 6, borderWidth: 1 }
        }
    },
    {
        key: "oscuro",
        nombre: "Oscuro",
        config: {
            theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
            cells: {
                available: { bg: "#12151A", border: "#20242C", text: "#F2F5FA" },
                reserved: { bg: "#332B12", border: "#FFE066", text: "#FFE066" },
                pagado: { bg: "#12222B", border: "#5AD1FF", text: "#5AD1FF" }
            },
            numbers: { size: 18, weight: 600 },
            grid: { radius: 8, spacing: 6, borderWidth: 1 }
        }
    },
    {
        key: "elegante",
        nombre: "Elegante",
        config: {
            theme: { pageBg: "#0A0C10", tableBg: "#12151B", text: "#EEF1F6", border: "#242A35", accent: "#D4AF6A" },
            cells: {
                available: { bg: "#171B23", border: "#242A35", text: "#EEF1F6" },
                reserved: { bg: "#3A331F", border: "#A8822F", text: "#F4C247" },
                pagado: { bg: "#1C2E3F", border: "#3D7DC7", text: "#4DA3FF" }
            },
            numbers: { size: 18, weight: 600 },
            grid: { radius: 9, spacing: 6, borderWidth: 1 }
        }
    },
    {
        key: "whatsapp",
        nombre: "WhatsApp",
        config: {
            theme: { pageBg: "#E9EDEF", tableBg: "#FFFFFF", text: "#111B21", border: "#D1D7DB", accent: "#25D366" },
            cells: {
                available: { bg: "#F0F2F5", border: "#C7CCD1", text: "#111B21" },
                reserved: { bg: "#FFF2CC", border: "#E0AC07", text: "#6B4E00" },
                pagado: { bg: "#D7F7E3", border: "#25D366", text: "#0B5A2E" }
            },
            numbers: { size: 18, weight: 700 },
            grid: { radius: 10, spacing: 6, borderWidth: 1 }
        }
    }
];

export function clonarConfig(config: TablaDisenoConfig): TablaDisenoConfig {
    return JSON.parse(JSON.stringify(config));
}
