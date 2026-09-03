import "./EventoCard.css";

import EventoHeader from "./Header/EventoHeader";
import EventoOverview from "./Overview/EventoOverview";
import EventoPremios from "./Premios/EventoPremios";

interface Props {

    evento: any;

}

export default function EventoCard({

    evento

}: Props) {

    return (

        <article className="eventoCard">

            {/* Encabezado */}

            <EventoHeader
                evento={evento}
            />

            {/* Resumen */}

            <EventoOverview
                evento={evento}
            />

            {/* Premios */}

            <EventoPremios
    premios={evento?.premios ?? []}
/>

        </article>

    );

}