"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import "./DashboardLayout.css";

import Sidebar from "../Sidebar/Sidebar";
import Topbar from "../Topbar/Topbar";
import { useSesion } from "@/hooks/useSesion";
import { inicializarCliente } from "@/services/tablas/inicializarCliente";

interface Props{

    children:React.ReactNode;

}

export default function DashboardLayout({

    children

}:Props){

    const [sidebarOpen,setSidebarOpen]=useState(false);

    // Guardia de sesión: toda página privada usa este layout. Sin sesión de
    // Supabase Auth -> /login. Mientras se comprueba no se muestra nada del
    // área privada.
    const sesion=useSesion();
    const router=useRouter();

    useEffect(()=>{

        if(sesion==="sin_sesion"){

            router.replace("/login");

        }

        // Primer acceso: configuraciones de tablas y cuadrícula del cliente
        // (idempotente, en segundo plano; el backend usa el token).
        if(sesion==="con_sesion"){

            inicializarCliente();

        }

    },[sesion,router]);

    function toggleSidebar(){

        setSidebarOpen(!sidebarOpen);

    }

    function closeSidebar(){

        setSidebarOpen(false);

    }

    if(sesion!=="con_sesion"){

        return null;

    }

    return(

        <div className="layout">

            <Sidebar

                open={sidebarOpen}

                onClose={closeSidebar}

            />

            {

                sidebarOpen && (

                    <div

                        className="overlay"

                        onClick={closeSidebar}

                    />

                )

            }

            <div className="content">

                <Topbar

                    onToggleSidebar={toggleSidebar}

                />

                <main>

                    {children}

                </main>

            </div>

        </div>

    );

}