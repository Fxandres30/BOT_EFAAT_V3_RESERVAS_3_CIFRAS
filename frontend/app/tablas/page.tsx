import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import IndiceTablas from "@/components/tablas/IndiceTablas";

// Índice real de tablas de reservas: los precios de la cuenta de la sesión
// (tablas_cliente, migración 027; sin ella, los precios base de
// lib/tablasConfig.ts). Ver components/tablas/IndiceTablas.tsx.
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

                <IndiceTablas />

            </div>

        </DashboardLayout>

    );

}
