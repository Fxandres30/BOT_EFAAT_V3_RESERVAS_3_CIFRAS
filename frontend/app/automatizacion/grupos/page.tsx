import { Suspense } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import GruposAutomatizacion from "@/components/automatizacion/GruposAutomatizacion/GruposAutomatizacion";

export default function Page() {
  return (
    <DashboardLayout>
      {/* GruposAutomatizacion lee ?filtro= (useSearchParams): límite de Suspense. */}
      <Suspense fallback={null}>
        <GruposAutomatizacion />
      </Suspense>
    </DashboardLayout>
  );
}
