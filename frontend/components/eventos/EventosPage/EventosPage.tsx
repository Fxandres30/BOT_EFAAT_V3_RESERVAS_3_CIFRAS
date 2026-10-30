import { PageHeader } from "@/components/ui/PageHeader";

import EventoGrid from "../EventoGrid/EventoGrid";
import AccionesCrearSorteo from "@/components/sorteos/AccionesCrearSorteo";

import styles from "./EventosPage.module.css";

export default function EventosPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Eventos"
        description="Centro de control de tus sorteos: los detectados en WhatsApp, los programados ya publicados y los publicados al momento, una sola vez cada uno, con su estado y sus acciones."
        actions={<AccionesCrearSorteo />}
      />

      <EventoGrid />
    </div>
  );
}
