"use client";

import "./DashboardCards.css";

import {

    DashboardCardsProps

} from "../types";

export default function DashboardCards({

    resumen

}: DashboardCardsProps) {

    const cards = [

        {
            icon: "🤖",
            titulo: "Bots Online",
            valor: resumen.bots,
            color: "green"
        },

        {
            icon: "📱",
            titulo: "Sesiones",
            valor: resumen.sesiones,
            color: "blue"
        },

        {
            icon: "🎯",
            titulo: "Eventos",
            valor: resumen.eventos,
            color: "orange"
        },

        {
            icon: "🎟",
            titulo: "Reservas",
            valor: resumen.reservas,
            color: "purple"
        },

        {
            icon: "👥",
            titulo: "Clientes",
            valor: resumen.clientes,
            color: "cyan"
        },

        {
            icon: "💬",
            titulo: "Chats",
            valor: resumen.chats,
            color: "pink"
        },

        {
            icon: "📦",
            titulo: "Grupos",
            valor: resumen.grupos,
            color: "yellow"
        },

        {
            icon: "💰",
            titulo: "Ventas",
            valor: resumen.ventas,
            color: "success"
        }

    ];

    return (

        <>
            <h2 className="dashboard-title">

                Resumen General

            </h2>

            <div className="cards">

                {

                    cards.map((card,index)=>(

                        <div
                            key={index}
                            className={`card ${card.color}`}
                        >

                            <span className="icon">

                                {card.icon}

                            </span>

                            <h3>

                                {card.valor}

                            </h3>

                            <small>

                                {card.titulo}

                            </small>

                        </div>

                    ))

                }

            </div>

        </>

    );

}