import type { Metadata } from "next";

import Landing from "@/components/landing/Landing";

// "/" es la landing comercial pública. Antes redirigía a /login; el panel
// sigue entrando por /login y /register sin cambios.
export const metadata: Metadata = {
  title: "EFAAT — Automatiza tus sorteos de WhatsApp",
  description:
    "Reservas automáticas, respuestas en el grupo, consulta de números propios y sorteos programados desde un solo panel. Solicita una prueba gratuita de 7 días."
};

export default function Home() {
  return <Landing />;
}
