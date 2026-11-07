import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";

import AutomatizacionNav from "./AutomatizacionNav";

interface Props {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/**
 * Cabecera común de las pantallas de Automatización: título + navegación.
 * Puramente presentacional.
 */
export default function AutomatizacionHeader({
  title = "Automatización",
  description = "Controla qué grupos reciben mensajes automáticos, cuándo se envían y en qué estado están. Los textos se escriben en Mensajes; los datos del sorteo salen siempre del anuncio detectado en el grupo.",
  actions
}: Props) {
  return (
    <>
      <PageHeader eyebrow="Automatización" title={title} description={description} actions={actions} />
      <AutomatizacionNav />
    </>
  );
}
