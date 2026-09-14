import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import BloqueadosPage from "@/components/bloqueados/BloqueadosPage/BloqueadosPage";

export default function Page() {
  return (
    <DashboardLayout>
      <BloqueadosPage />
    </DashboardLayout>
  );
}
