"use client";

import "./Topbar.css";

interface TopbarProps{

    onToggleSidebar:()=>void;

}

// El usuario y "Cerrar sesión" viven únicamente en el Sidebar (Fase 5.4)
// para tener una sola salida clara y consistente — no se duplica aquí.
export default function Topbar({

    onToggleSidebar

}:TopbarProps){

    return(

        <header className="topbar">

            <div className="topbarLeft">

                <button
                    className="menuButton"
                    onClick={onToggleSidebar}
                >

                    ☰

                </button>

                <div className="welcome">

                    <h2>

                        EFAAT

                    </h2>

                    <span>

                        Panel de administración

                    </span>

                </div>

            </div>

        </header>

    );

}
