import { CheckCircle2, Clock, DollarSign, CircleDot, Lock, Percent } from "lucide-react";

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

    const tarjetas = [
        { label: "Total", valor: stats.total, icon: null, color: "bg-gray-900 text-white" },
        { label: "Disponibles", valor: stats.disponibles, icon: CheckCircle2, color: "bg-emerald-500 text-white" },
        { label: "Reservados", valor: stats.reservados, icon: Clock, color: "bg-amber-500 text-white" },
        { label: "Pagados", valor: stats.pagados, icon: DollarSign, color: "bg-red-600 text-white" },
        { label: "En proceso", valor: stats.enProceso, icon: CircleDot, color: "bg-sky-500 text-white" },
        { label: "Bloqueados", valor: stats.bloqueados, icon: Lock, color: "bg-slate-700 text-white" },
        { label: "Ocupación", valor: `${stats.ocupacion}%`, icon: Percent, color: "bg-indigo-600 text-white" }
    ];

    return (

        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2 sm:gap-3">

            {tarjetas.map((t) => (

                <div key={t.label} className={`min-w-0 rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow ${t.color}`}>

                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs opacity-80 truncate">{t.label}</p>
                        {t.icon && <t.icon size={16} className="opacity-80 shrink-0" />}
                    </div>

                    <p className="text-xl sm:text-2xl font-bold mt-1 truncate">{t.valor}</p>

                </div>

            ))}

        </div>

    );

}
