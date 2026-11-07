import { Suspense } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import MensajesPage from "@/components/mensajes/MensajesPage/MensajesPage";

export default function Page() {
  return (
    <DashboardLayout>
      {/* MensajesPage lee ?vista=, ?tipo= y ?categoria= (useSearchParams): límite de Suspense. */}
      <Suspense fallback={null}>
        <MensajesPage />
      </Suspense>
    </DashboardLayout>
  );
}
