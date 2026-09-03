import Link from "next/link";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import { PRECIOS_VALIDOS } from "@/lib/tablasConfig";

// Índice real de tablas de reservas: los precios y tablas físicas vienen
// exactamente de frontend/lib/tablasConfig.ts (espejo de
// backend/bot/funciones/eventos/configEvento.js), no de datos inventados.
export default function TablasPage() {

    return (

        <DashboardLayout>

            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 min-w-0">

                <div>
                    <h1 className="font-bold text-[clamp(1.5rem,4vw,1.875rem)]">Reservas</h1>
                    <p className="text-gray-500">
                        Selecciona una tabla de números por precio.
                    </p>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">

                    {PRECIOS_VALIDOS.map((precio) => (

                        <Link
                            key={precio}
                            href={`/tablas/${precio}`}
                            className="bg-white border rounded-2xl p-4 sm:p-6 text-center shadow hover:shadow-lg hover:border-blue-500 transition min-w-0"
                        >
                            <div className="text-xl sm:text-2xl font-bold truncate">
                                ${precio.toLocaleString("es-CO")}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                                Ver tabla
                            </div>
                        </Link>

                    ))}

                </div>

            </div>

        </DashboardLayout>

    );

}
