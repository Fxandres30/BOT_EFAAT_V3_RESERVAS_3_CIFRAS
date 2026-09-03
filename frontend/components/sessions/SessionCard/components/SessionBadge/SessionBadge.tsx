"use client";

import "./SessionBadge.css";

interface Props {

    principal: boolean;

}

export default function SessionBadge({

    principal

}: Props) {

    if (!principal) return null;

    return (

        <span className="session-badge">

            ⭐ Preferida

        </span>

    );

}