import "./EventoProgress.css";

interface Props {

    reservados: number;

    total: number;

    horaCierre: string;

}

export default function EventoProgress({

    reservados,

    total,

    horaCierre

}: Props) {

    const porcentaje =
        total > 0
            ? (reservados / total) * 100
            : 0;

    return (

        <section className="eventoProgress">

            <div className="progressHeader">

                <span>

                    {reservados} / {total} números

                </span>

                <strong>

                    {porcentaje.toFixed(0)}%

                </strong>

            </div>

            <div className="progressBar">

                <div

                    className="progressFill"

                    style={{

                        width:`${porcentaje}%`

                    }}

                />

            </div>

            <div className="progressFooter">

                <span>

                    Cierra a las

                </span>

                <strong>

                    🔒 {horaCierre}

                </strong>

            </div>

        </section>

    );

}
