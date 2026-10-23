import { Percent } from "lucide-react";

import { ESTADOS_META_VISUAL } from "./estadoVisual";

interface Stats {
    total: number;
    disponibles: number;
    reservados: number;
    pagados: number;
    enProceso: number;
    bloqueados: number;
    ocupacion: number;
}

interface Props {
    stats: Stats;
}

export default function StatsBar({ stats }: Props) {

    // "Reservados" agrupa también en_proceso/bloqueado: de cara al
    // usuario son números que no están disponibles ni pagados todavía.
    const reservadosVisual = stats.reservados + stats.enProceso + stats.bloqueados;

    const tarjetas = [
        {
            label: "Disponibles",
            valor: stats.disponibles,
            meta: ESTADOS_META_VISUAL.libre
        },
        {
            label: "Reservados",
            valor: reservadosVisual,
            meta: ESTADOS_META_VISUAL.reservado
        },
        {
            label: "Pagados",
            valor: stats.pagados,
            meta: ESTADOS_META_VISUAL.pagado
        }
    ];

    return (

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">

            {tarjetas.map((t) => {

                const Icon = t.meta.icon;

                return (

                    <div key={t.label} className={`min-w-0 rounded-xl border px-3 py-2 sm:px-3.5 sm:py-2.5 ${t.meta.badge}`}>

                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium opacity-80 truncate">{t.label}</p>
                            <Icon size={15} className="opacity-70 shrink-0" />
                        </div>

                        <p className="text-lg sm:text-xl font-bold leading-tight mt-0.5 truncate">{t.valor}</p>

                    </div>

                );

            })}

            <div className="min-w-0 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 sm:px-3.5 sm:py-2.5">

                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium opacity-80 truncate">Ocupación</p>
                    <Percent size={15} className="opacity-70 shrink-0" />
                </div>

                <p className="text-lg sm:text-xl font-bold leading-tight mt-0.5 truncate">{stats.ocupacion}%</p>

            </div>

        </div>

    );

}
