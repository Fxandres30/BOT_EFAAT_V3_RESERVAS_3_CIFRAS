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

            {/* Progreso */}

            <EventoProgress

                reservados={evento.reservados ?? 0}

                total={evento.cantidad_numeros ?? 100}

                horaCierre={evento.hora_cierre}

            />

            {/* Estadísticas */}

            <div className="overviewStats">

                <div>

                    <Ticket size={16}/>

                    <span>{evento.reservados}</span>

                </div>

                <div>

                    <CheckCircle2 size={16}/>

                    <span>{evento.pagados}</span>

                </div>

                <div>

                    <AlertTriangle size={16}/>

                    <span>{evento.pendientes}</span>

                </div>

                <div>

                    <Circle size={16}/>

                    <span>{evento.libres}</span>

                </div>

            </div>

            {/* Información */}

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

                    <strong>{evento.hora_liberacion}</strong>

                </div>

                <div>

                    <Hash size={15}/>

                    <span>{evento.cifras} cifras</span>

                </div>

            </div>

        </section>

    );

}