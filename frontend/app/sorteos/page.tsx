import { Suspense } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";

import SorteosPage from "@/components/sorteos/SorteosPage";

export default function Page() {

    return (

        <DashboardLayout>

            {/* SorteosPage lee ?vista= (useSearchParams): límite de Suspense. */}
            <Suspense fallback={null}>
                <SorteosPage />
            </Suspense>

        </DashboardLayout>

    );

}
