import type { Metadata } from "next";

import EntradaApp from "@/components/auth/EntradaApp";

// /app: entrada de la aplicación instalada (start_url del manifest). Decide
// en el navegador, porque la sesión vive en el almacenamiento local.
export const metadata: Metadata = {
  title: "EFAAT360",
  robots: { index: false, follow: false }
};

export default function EntradaAplicacionPage() {
  return <EntradaApp />;
}
