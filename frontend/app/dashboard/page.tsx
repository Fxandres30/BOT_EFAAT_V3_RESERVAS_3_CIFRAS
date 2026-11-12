import { redirect } from "next/navigation";

import { RUTA_INICIO } from "@/lib/navegacion";

// El dashboard genérico (datos hardcodeados, sin conexión real) fue
// retirado de la navegación en Fase 5.2. Esta ruta se conserva solo para
// no romper enlaces antiguos (login, marcadores) y redirige a la sección de inicio (Reservas).
export default function DashboardPage() {
  redirect(RUTA_INICIO);
}
