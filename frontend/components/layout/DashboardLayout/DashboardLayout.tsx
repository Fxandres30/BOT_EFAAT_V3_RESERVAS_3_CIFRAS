"use client";

import { useState } from "react";

import "./DashboardLayout.css";

import Sidebar from "../Sidebar/Sidebar";
import Topbar from "../Topbar/Topbar";

interface Props{

    children:React.ReactNode;

}

export default function DashboardLayout({

    children

}:Props){

    const [sidebarOpen,setSidebarOpen]=useState(false);

    function toggleSidebar(){

        setSidebarOpen(!sidebarOpen);

    }

    function closeSidebar(){

        setSidebarOpen(false);

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