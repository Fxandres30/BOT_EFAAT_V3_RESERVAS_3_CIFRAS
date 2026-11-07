import { Suspense } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import CentroAutomatizaciones from "@/components/automatizacion/CentroAutomatizaciones/CentroAutomatizaciones";

export default function Page() {
  return (
    <DashboardLayout>
      {/* CentroAutomatizaciones lee ?vista=, ?grupo= y ?editar= (useSearchParams): límite de Suspense. */}
      <Suspense fallback={null}>
        <CentroAutomatizaciones />
      </Suspense>
    </DashboardLayout>
  );
}
