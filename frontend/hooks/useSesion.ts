"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

export type EstadoSesion = "cargando" | "con_sesion" | "sin_sesion";

// Estado de la sesión de Supabase Auth en el navegador (la misma sesión
// persistida que ya usa todo el panel). Se actualiza en vivo: iniciar o
// cerrar sesión — también desde otra pestaña — cambia el estado.
export function useSesion(): EstadoSesion {

    const [estado, setEstado] = useState<EstadoSesion>("cargando");

    useEffect(() => {

        let vigente = true;

        supabase.auth.getSession().then(({ data }) => {
            if (vigente) setEstado(data.session ? "con_sesion" : "sin_sesion");
        });

        const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
            if (vigente) setEstado(sesion ? "con_sesion" : "sin_sesion");
        });

        return () => {
            vigente = false;
            data.subscription.unsubscribe();
        };

    }, []);

    return estado;

}
