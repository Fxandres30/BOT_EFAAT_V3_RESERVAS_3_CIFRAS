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

export default function EventoHeader({

    evento

}:Props){

    return(

        <header className="eventoHeader">

            <div className="eventoHeaderLeft">

                <div className="eventoEstado">

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

                        {evento.cantidad_numeros}

                    </span>

                </div>

            </div>

            <div className="eventoHeaderRight">

                <div className="headerBadge">

                    <CircleDollarSign size={15}/>

                    ${evento.valor}

                </div>

                <div className="headerBadge">

                    <Clock3 size={15}/>

                    {evento.hora_fin}

                </div>

            </div>

        </header>

    );

}