import { ESTADOS_META_VISUAL, type EstadoVisual } from "./estadoVisual";

const ORDEN: EstadoVisual[] = ["libre", "reservado", "pagado"];

export default function Leyenda() {

    return (

        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 text-sm text-gray-600 px-1">

            {ORDEN.map((estado) => {

                const meta = ESTADOS_META_VISUAL[estado];

                return (
                    <span key={estado} className="flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${meta.dot}`} />
                        {meta.label}
                    </span>
                );

            })}

        </div>

    );

}
