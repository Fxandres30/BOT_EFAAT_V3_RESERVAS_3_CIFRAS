import { PageHeader } from "@/components/ui/PageHeader";

import EventoGrid from "../EventoGrid/EventoGrid";

import styles from "./EventosPage.module.css";

export default function EventosPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Eventos"
        description="Sorteos detectados por el bot en cada grupo, con su estado, cierre y progreso de reservas."
      />

      <EventoGrid />
    </div>
  );
}
