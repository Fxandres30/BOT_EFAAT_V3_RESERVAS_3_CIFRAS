import type { Metadata } from "next";

import Landing from "@/components/landing/Landing";

// "/" es la landing comercial pública. Antes redirigía a /login; el panel
// sigue entrando por /login y /register sin cambios.
export const metadata: Metadata = {
  title: "EFAAT — Automatiza tus sorteos de WhatsApp",
  description:
    "Reservas automáticas y respuestas en el grupo: los participantes consultan sus números reservados, sus pagos pendientes y los números disponibles. Sorteos programados desde un solo panel. Solicita una prueba gratuita de 3 días."
};

export default function Home() {
  return <Landing />;
}
