import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import TablaPrecioView from "@/components/tablas/TablaPrecioView";

interface Props {
    params: Promise<{
        precio: string;
    }>;
}

export default async function TablaPage({ params }: Props) {

    const { precio } = await params;

    return (

        <DashboardLayout>

            <TablaPrecioView precio={Number(precio)} />

        </DashboardLayout>

    );

}
