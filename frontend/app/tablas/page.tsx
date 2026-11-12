import { Ticket } from "lucide-react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import IndiceTablas from "@/components/tablas/IndiceTablas";
import AyudaContextual from "@/components/aprende/AyudaContextual";
import { PageHeader } from "@/components/ui/PageHeader";

// Índice real de tablas de reservas: los precios de la cuenta de la sesión
// (tablas_cliente, migración 027; sin ella, los precios base de
// lib/tablasConfig.ts). Ver components/tablas/IndiceTablas.tsx.
export default function TablasPage() {

    return (

        <DashboardLayout>

            <div className="max-w-6xl mx-auto min-w-0">

                <PageHeader
                    eyebrow="Operación"
                    icon={<Ticket size={18} />}
                    title="Reservas"
                    description="Elige una tabla de números por precio para ver sus reservas, pagos y el sorteo en curso."
                    actions={<AyudaContextual slug="tablas-de-precio" />}
                />

                <IndiceTablas />

            </div>

        </DashboardLayout>

    );

}
