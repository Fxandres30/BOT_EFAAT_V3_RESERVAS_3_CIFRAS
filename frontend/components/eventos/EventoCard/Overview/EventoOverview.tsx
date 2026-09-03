import "./EventoOverview.css";
import EventoProgress from "./Progress/EventoProgress";

import {
    Ticket,
    CheckCircle2,
    AlertTriangle,
    Circle,
    Lock,
    Clock3,
    TimerReset,
    Hash
} from "lucide-react";

interface Props {

    evento: any;

}

export default function EventoOverview({

    evento

}: Props) {

    return (

        <section className="eventoOverview">

            {/* 🎟️ Progreso */}

            <div className="overviewBlock">

                <span className="overviewBlockTitle">🎟️ Progreso</span>

                <EventoProgress

                    reservados={evento.reservados ?? 0}

                    total={evento.cantidad_numeros ?? 100}

                    horaCierre={evento.hora_cierre}

                />

            </div>

            {/* 🔢 Números */}

            <div className="overviewBlock">

                <span className="overviewBlockTitle">🔢 Números</span>

                <div className="overviewStats">

                    <div className="statItem stat-reservados">

                        <Ticket size={16}/>

                        <strong>{evento.reservados}</strong>

                        <span>Reservados</span>

                    </div>

                    <div className="statItem stat-pagados">

                        <CheckCircle2 size={16}/>

                        <strong>{evento.pagados}</strong>

                        <span>Pagados</span>

                    </div>

                    <div className="statItem stat-pendientes">

                        <AlertTriangle size={16}/>

                        <strong>{evento.pendientes}</strong>

                        <span>Pendientes</span>

                    </div>

                    <div className="statItem stat-libres">

                        <Circle size={16}/>

                        <strong>{evento.libres}</strong>

                        <span>Libres</span>

                    </div>

                </div>

            </div>

            {/* 🕐 Horarios */}

            <div className="overviewBlock">

                <span className="overviewBlockTitle">🕐 Horarios</span>

                <div className="overviewInfo">

                    <div>

                        <Clock3 size={15}/>

                        <span>Sorteo</span>

                        <strong>{evento.hora_fin}</strong>

                    </div>

                    <div>

                        <Lock size={15}/>

                        <span>Cierre</span>

                        <strong>{evento.hora_cierre}</strong>

                    </div>

                    <div>

                        <TimerReset size={15}/>

                        <span>Libera</span>

                        <strong>{evento.hora_liberacion || "—"}</strong>

                    </div>

                    <div>

                        <Hash size={15}/>

                        <span>Cifras</span>

                        <strong>{evento.cifras}</strong>

                    </div>

                </div>

            </div>

        </section>

    );

}
