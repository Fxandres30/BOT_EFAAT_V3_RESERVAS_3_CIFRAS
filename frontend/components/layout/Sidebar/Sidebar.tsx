"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import "./Sidebar.css";

import { getUser } from "@/services/auth/getUser";
import { logout } from "@/services/auth/logout";

interface SidebarProps{

    open:boolean;

    onClose:()=>void;

}

export default function Sidebar({

    open,

    onClose

}:SidebarProps){

    const pathname=usePathname();

    const [email, setEmail] = useState<string | null>(null);
    const [cerrando, setCerrando] = useState(false);

    useEffect(() => {

        async function cargar() {
            const { data } = await getUser();
            setEmail(data.user?.email || null);
        }

        cargar();

    }, []);

    async function cerrarSesion() {

        setCerrando(true);

        await logout();

        // Recarga completa (no solo navegación de Next.js): garantiza que
        // no quede ningún estado ni acceso visual al panel en memoria.
        window.location.href = "/login";

    }

    const menu=[

        {
            titulo:"EFAAT",
            items:[
                {
                    href:"/sesiones",
                    icon:"📱",
                    label:"Sesiones"
                },
                {
                    href:"/tablas",
                    icon:"🎟️",
                    label:"Reservas"
                },
                {
                    href:"/mensajes",
                    icon:"✏️",
                    label:"Mensajes"
                },
                {
                    href:"/chats",
                    icon:"💬",
                    label:"Chats"
                },
                {
                    href:"/eventos",
                    icon:"🎯",
                    label:"Eventos"
                }
            ]
        }

    ];

    return(

        <aside

            className={

                open

                    ? "sidebar open"

                    : "sidebar"

            }

        >

            <div className="sidebarHeader">

                <div className="logoCircle">

                    E

                </div>

                <div>

                    <h2>

                        EFAAT

                    </h2>

                    <span>

                        Bot Manager

                    </span>

                </div>

            </div>

            {

                menu.map(grupo=>(

                    <div

                        key={grupo.titulo}

                        className="menuGroup"

                    >

                        <p className="menuTitle">

                            {grupo.titulo}

                        </p>

                        {

                            grupo.items.map(item=>(

                                <Link

                                    key={item.href}

                                    href={item.href}

                                    onClick={onClose}

                                    className={

                                        pathname===item.href

                                        ? "menuItem active"

                                        : "menuItem"

                                    }

                                >

                                    <span>

                                        {item.icon}

                                    </span>

                                    <span>

                                        {item.label}

                                    </span>

                                </Link>

                            ))

                        }

                    </div>

                ))

            }

            <div className="sidebarFooter">

                <div className="sidebarUser">

                    <span className="sidebarUserIcon">👤</span>

                    <span className="sidebarUserEmail">
                        {email || "Sin sesión"}
                    </span>

                </div>

                <button
                    className="sidebarLogout"
                    disabled={cerrando}
                    onClick={cerrarSesion}
                >
                    🚪 {cerrando ? "Cerrando sesión..." : "Cerrar sesión"}
                </button>

            </div>

        </aside>

    );

}