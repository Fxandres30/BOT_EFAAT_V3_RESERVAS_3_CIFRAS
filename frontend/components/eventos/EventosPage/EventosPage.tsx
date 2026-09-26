import { PageHeader } from "@/components/ui/PageHeader";

import EventoGrid from "../EventoGrid/EventoGrid";
import { BotonCrearSorteo } from "../CrearSorteoModal/CrearSorteoModal";

import styles from "./EventosPage.module.css";

export default function EventosPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Eventos"
        description="Centro de administración de sorteos: 2 cifras, 3 cifras y gratis 3 cifras, con su estado, cierre y progreso de reservas."
        actions={<BotonCrearSorteo />}
      />

      <EventoGrid />
    </div>
  );
}
