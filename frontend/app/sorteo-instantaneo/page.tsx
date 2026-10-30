import { Suspense } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import SorteoInstantaneoPage from "@/components/sorteos/SorteoInstantaneoPage";

export default function Page() {
    return (
        <DashboardLayout>
            {/* SorteoInstantaneoPage lee ?nuevo= (useSearchParams): límite de Suspense. */}
            <Suspense fallback={null}>
                <SorteoInstantaneoPage />
            </Suspense>
        </DashboardLayout>
    );
}
