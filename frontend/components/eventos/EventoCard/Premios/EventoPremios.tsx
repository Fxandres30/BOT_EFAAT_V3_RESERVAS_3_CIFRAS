import "./EventoPremios.css";

import {
    Trophy,
    Medal,
    Gift
} from "lucide-react";

interface Props {
    premios: any[] | null;
}

export default function EventoPremios({
    premios
}: Props) {

    if (!Array.isArray(premios) || premios.length === 0) {
        return null;
    }

    const obtenerIcono = (tipo: string) => {

        switch (tipo) {

            case "dos_ultimas_cifras":
                return <Trophy size={16} />;

            case "dos_primeras_cifras":
                return <Medal size={16} />;

            case "dos_centro":
                return <Medal size={16} />;

            case "bono":
                return <Gift size={16} />;

            default:
                return <Gift size={16} />;

        }

    };

    return (

        <section className="eventoPremios">

            <div className="premiosHeader">
                <span>🏆 Premios</span>
                <span className="premiosCount">{premios.length}</span>
            </div>

            <div className="premiosLista">

                {premios.map((premio, index) => (

                    <div
                        key={index}
                        className="premioItem"
                    >

                        <div className="premioNombre">

                            {obtenerIcono(premio.tipo)}

                            <span>
                                {premio.nombre}
                            </span>

                        </div>

                        <strong>
                            ${premio.premio.toLocaleString("es-CO")}
                        </strong>

                    </div>

                ))}

            </div>

        </section>

    );

}