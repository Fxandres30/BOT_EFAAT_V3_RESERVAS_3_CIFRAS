import "./EventosPage.css";

import EventoHeader from "../EventoHeader/EventoHeader";
import EventoGrid from "../EventoGrid/EventoGrid";

export default function EventosPage() {

    return (

        <section className="eventosPage">

            <EventoHeader />

            <EventoGrid />

        </section>

    );

}