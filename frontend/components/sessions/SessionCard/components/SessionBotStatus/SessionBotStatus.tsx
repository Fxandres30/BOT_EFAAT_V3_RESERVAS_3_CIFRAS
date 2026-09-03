import "./SessionBotStatus.css";

type Props = {

    activa: boolean;

    principal: boolean;

};

// Preferida y Activa son conceptos independientes (Fase 5.1: failover):
// una sesión puede ser la preferida del usuario sin ser la que el BOT
// está usando ahora mismo (porque hubo failover a otra), y viceversa.
export default function SessionBotStatus({

    activa,

    principal

}: Props) {

    return (

        <div className="session-bot-status">

            {activa && (

                <div className="session-badge bot-active">

                    🤖 BOT ACTIVO

                </div>

            )}

            {principal && (

                <div className="session-badge bot-principal">

                    ⭐ PREFERIDA

                </div>

            )}

            {!activa && !principal && (

                <div className="session-badge bot-waiting">

                    En espera

                </div>

            )}

        </div>

    );

}