import type { CSSProperties } from "react";
import type { TablaDisenoConfig } from "./disenoTypes";

// Traduce un TablaDisenoConfig a variables CSS aplicadas sobre el
// contenedor de la tabla (Grid). Se heredan a los descendientes (Leyenda,
// NumeroCard) — un solo lugar decide el mapeo config -> variable.
//
// Cada color de celda es independiente (fondo/borde/texto propios, nunca
// derivados unos de otros) — ver disenoTypes.ts / la auditoría.
export function cssVarsFromConfig(config: TablaDisenoConfig): CSSProperties {
    return {
        "--efaat-tabla-table-bg": config.theme.tableBg,
        "--efaat-tabla-text": config.theme.text,
        "--efaat-tabla-border": config.theme.border,
        "--efaat-tabla-accent": config.theme.accent,

        "--efaat-tabla-available-bg": config.cells.available.bg,
        "--efaat-tabla-available-border": config.cells.available.border,
        "--efaat-tabla-available-text": config.cells.available.text,

        "--efaat-tabla-reserved-bg": config.cells.reserved.bg,
        "--efaat-tabla-reserved-border": config.cells.reserved.border,
        "--efaat-tabla-reserved-text": config.cells.reserved.text,

        "--efaat-tabla-pagado-bg": config.cells.pagado.bg,
        "--efaat-tabla-pagado-border": config.cells.pagado.border,
        "--efaat-tabla-pagado-text": config.cells.pagado.text,

        "--efaat-tabla-cell-radius": `${config.grid.radius}px`,
        "--efaat-tabla-cell-gap": `${config.grid.spacing}px`,
        "--efaat-tabla-cell-border-width": `${config.grid.borderWidth}px`,
        "--efaat-tabla-cell-font-size": `${config.numbers.size}px`,
        "--efaat-tabla-cell-font-weight": String(config.numbers.weight)
    } as CSSProperties;
}
