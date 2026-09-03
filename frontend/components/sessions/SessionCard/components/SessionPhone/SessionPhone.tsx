"use client";

import "./SessionPhone.css";

import { FaPhoneAlt } from "react-icons/fa";

interface Props {

    telefono: string;

}

export default function SessionPhone({

    telefono

}: Props) {

    const conectado = telefono && telefono !== "Sin conectar";

    return (

        <div className={`phone-box ${conectado ? "connected" : "empty"}`}>

            <FaPhoneAlt />

            <span>

                {telefono || "Sin conectar"}

            </span>

        </div>

    );

}