import { Badge } from "@/components/ui/Badge";
import { ETIQUETA_ORIGEN, type OrigenEvento } from "./centroEventos";

// Cómo llegó el sorteo a los grupos: detectado en WhatsApp, programado o
// publicado al momento. Sin dato (backend sin responder) no se muestra nada.
export default function OrigenEventoBadge({ origen }: { origen?: OrigenEvento | null }) {
    if (!origen) return null;
    const e = ETIQUETA_ORIGEN[origen];
    return <Badge tone={e.tono} size="sm" title={e.detalle}>{e.texto}</Badge>;
}
