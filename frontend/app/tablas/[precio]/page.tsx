import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import TablaPrecioView from "@/components/tablas/TablaPrecioView";
import RedireccionMotorRifas from "@/components/rifas/RedireccionMotorRifas";

interface Props {
    params: Promise<{
        precio: string;
    }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /tablas/1500 → la tabla de ese precio (motor de siempre).
// /tablas/<tabla_id> → la MISMA pantalla sobre esa rifa (motor de rifas
// independientes): sus propios números, reservas, pagos e historial.
export default async function TablaPage({ params }: Props) {

    const { precio } = await params;
    const tablaId = UUID.test(precio) ? precio : null;

    return (

        <DashboardLayout>

            {tablaId ? (
                <TablaPrecioView precio={0} tablaId={tablaId} />
            ) : (
                <>
                    <RedireccionMotorRifas precio={Number(precio)} />
                    <TablaPrecioView precio={Number(precio)} />
                </>
            )}

        </DashboardLayout>

    );

}
