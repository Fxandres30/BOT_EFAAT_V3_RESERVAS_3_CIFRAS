import { PageHeader } from "@/components/ui/PageHeader";

import AutomatizacionNav from "./AutomatizacionNav";

/**
 * Cabecera común de las pantallas de Automatización: título + navegación.
 * Puramente presentacional.
 */
export default function AutomatizacionHeader() {
  return (
    <>
      <PageHeader
        title="Automatización"
        description="Configura la automatización grupo por grupo. Los datos del sorteo (nombre, valor, premios, cierre) siempre salen del anuncio que EFAAT detecta en el grupo."
      />
      <AutomatizacionNav />
    </>
  );
}
