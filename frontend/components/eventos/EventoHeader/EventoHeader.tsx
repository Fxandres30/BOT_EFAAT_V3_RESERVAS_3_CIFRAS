import "./EventoHeader.css";

export default function EventoHeader(){

    return(

        <header className="eventoHeader">

            <div>

                <h1>

                    🎯 Eventos

                </h1>

                <p>

                    Administra todos los eventos activos del sistema.

                </p>

            </div>

            <button>

                + Nuevo Evento

            </button>

        </header>

    );

}