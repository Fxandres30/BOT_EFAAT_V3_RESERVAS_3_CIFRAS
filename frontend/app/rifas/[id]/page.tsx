import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import RifaDetalle from "@/components/rifas/RifaDetalle";

interface Props {
    params: Promise<{ id: string }>;
}

// Una rifa por su tabla_id (UUID). El backend comprueba que sea del cliente
// de la sesión; una ajena responde igual que una inexistente.
export default async function RifaPage({ params }: Props) {
    const { id } = await params;
    return (
        <DashboardLayout>
            <RifaDetalle tablaId={id} />
        </DashboardLayout>
    );
}
