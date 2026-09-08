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
        description="Configura el comportamiento del bot grupo por grupo. El sorteo (nombre, valor, premios, cierre) siempre lo decide la detección real del bot."
      />
      <AutomatizacionNav />
    </>
  );
}
