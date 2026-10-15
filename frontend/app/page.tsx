import type { Metadata } from "next";

import Landing from "@/components/landing/Landing";

// "/" es la landing comercial pública. Antes redirigía a /login; el panel
// sigue entrando por /login y /register sin cambios.
export const metadata: Metadata = {
  title: "EFAAT — Automatiza tus sorteos de WhatsApp",
  description:
    "Reservas automáticas, respuestas en el grupo, consultas de disponibilidad y sorteos programados desde un solo panel. Prueba gratis 7 días."
};

export default function Home() {
  return <Landing />;
}
