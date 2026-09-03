import "./EventoHeader.css";

import {

    Clock3,
    CircleDollarSign,
    CheckCircle2,
    Database,
    Hash,
    Ticket

} from "lucide-react";

interface Props {

    evento:any;

}

// Solo presentación: mapea el estado REAL del evento a una clase de color.
// No cambia el valor ni la lógica; si el estado es desconocido usa el
// estilo neutro.
function claseEstado(estado?:string){

    const e = (estado || "").toLowerCase();

    if (e === "abierto") return "estado-abierto";

    if (e === "cerrado") return "estado-cerrado";

    return "estado-neutro";

}

export default function EventoHeader({

    evento

}:Props){

    return(

        <header className="eventoHeader">

            <div className="eventoHeaderLeft">

                <div className={`eventoEstado ${claseEstado(evento.estado)}`}>

                    <CheckCircle2 size={13}/>

                    <span>

                        {evento.estado?.toUpperCase()}

                    </span>

                </div>

                <h2>

                    🎯 {evento.nombre_evento}

                </h2>

                <div className="eventoMeta">

                    <span>

                        <Database size={13}/>

                        {evento.tabla}

                    </span>

                    <span>

                        <Hash size={13}/>

                        {evento.cifras} cifras

                    </span>

                    <span>

                        <Ticket size={13}/>

                        {evento.cantidad_numeros} números

                    </span>

                </div>

            </div>

            <div className="eventoHeaderRight">

                <div className="headerBadge">

                    <CircleDollarSign size={15}/>

                    <div className="headerBadgeText">

                        <small>Valor</small>

                        <span>${evento.valor}</span>

                    </div>

                </div>

                <div className="headerBadge">

                    <Clock3 size={15}/>

                    <div className="headerBadgeText">

                        <small>Sorteo</small>

                        <span>{evento.hora_fin}</span>

                    </div>

                </div>

            </div>

        </header>

    );

}
