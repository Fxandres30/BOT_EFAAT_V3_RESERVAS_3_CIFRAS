import type { TablaDisenoConfig } from "./disenoTypes";
import styles from "./DisenoThumbnail.module.css";

interface Props {
    config: TablaDisenoConfig;
}

// Miniatura REAL (no un icono genérico): muestra cómo se ven las 3 celdas
// (Disponible / Reservado / Pagado) con la configuración exacta del
// diseño — mismos valores que se aplicarían a la tabla real.
export default function DisenoThumbnail({ config }: Props) {

    const celdas: Array<{ key: keyof TablaDisenoConfig["cells"]; label: string }> = [
        { key: "available", label: "12" },
        { key: "reserved", label: "27" },
        { key: "pagado", label: "45" }
    ];

    return (

        <div
            className={styles.thumb}
            style={{
                background: config.theme.tableBg,
                borderColor: config.theme.border
            }}
        >

            {celdas.map((c) => {

                const color = config.cells[c.key];

                return (
                    <span
                        key={c.key}
                        className={styles.cell}
                        style={{
                            background: color.bg,
                            borderColor: color.border,
                            borderWidth: config.grid.borderWidth,
                            borderRadius: config.grid.radius,
                            color: color.text,
                            fontWeight: config.numbers.weight
                        }}
                    >
                        {c.label}
                    </span>
                );

            })}

        </div>

    );

}
