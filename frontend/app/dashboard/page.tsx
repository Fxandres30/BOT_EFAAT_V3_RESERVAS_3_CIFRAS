import { redirect } from "next/navigation";

// El dashboard genérico (datos hardcodeados, sin conexión real) fue
// retirado de la navegación en Fase 5.2. Esta ruta se conserva solo para
// no romper enlaces antiguos (login, marcadores) y redirige al panel real.
export default function DashboardPage() {
  redirect("/sesiones");
}
