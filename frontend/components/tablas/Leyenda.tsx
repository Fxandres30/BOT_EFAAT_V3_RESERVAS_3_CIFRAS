import { ESTADOS_META_VISUAL, type EstadoVisual } from "./estadoVisual";
import type { TablaDisenoConfig } from "./disenoTypes";

const ORDEN: EstadoVisual[] = ["libre", "reservado", "pagado"];

// Mapea el estado visual (libre/reservado/pagado) a la clave de color de
// celda del diseño (available/reserved/pagado) — mismo mapeo que
// NumeroCard.tsx, para que el punto de la leyenda combine siempre con el
// color real de las celdas.
const CLAVE_DISENO: Record<EstadoVisual, keyof TablaDisenoConfig["cells"]> = {
    libre: "available",
    reservado: "reserved",
    pagado: "pagado"
};

interface Props {
    diseno?: TablaDisenoConfig;
}

export default function Leyenda({ diseno }: Props) {

    return (

        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 text-sm text-gray-600 px-1">

            {ORDEN.map((estado) => {

                const meta = ESTADOS_META_VISUAL[estado];
                const color = diseno?.cells[CLAVE_DISENO[estado]]?.border;

                return (
                    <span key={estado} className="flex items-center gap-2">
                        <span
                            className={color ? "h-3 w-3 rounded-full" : `h-3 w-3 rounded-full ${meta.dot}`}
                            style={color ? { background: color } : undefined}
                        />
                        {meta.label}
                    </span>
                );

            })}

        </div>

    );

}
