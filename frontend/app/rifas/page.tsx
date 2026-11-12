import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import MisRifas from "@/components/rifas/MisRifas";

// «Mis rifas»: motor de rifas independientes (cada rifa por su tabla_id).
export default function RifasPage() {
    return (
        <DashboardLayout>
            <MisRifas />
        </DashboardLayout>
    );
}
