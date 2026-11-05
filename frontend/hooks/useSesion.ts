"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { borrarInstantaneas } from "@/services/tablas/instantaneaIndice";

export type EstadoSesion = "cargando" | "con_sesion" | "sin_sesion";

// Usuario de la sesión leída en el navegador (sin consultar al servidor).
// Se fija ANTES de pasar a «con_sesion»: lo que DashboardLayout monta ya lo
// encuentra (el índice de Reservas lo usa para su instantánea).
let usuarioSesion: string | null = null;
export const usuarioSesionLocal = () => usuarioSesion;

// Sin sesión: ninguna instantánea del índice de Reservas sobrevive. Con
// sesión: solo la del usuario actual (cambio de cuenta, también desde otra
// pestaña). Solo borra claves propias de esa instantánea.
export function fijarUsuario(id: string | null) {
    if (id !== usuarioSesion || id === null) borrarInstantaneas(id);
    usuarioSesion = id;
}

// Estado de la sesión de Supabase Auth en el navegador (la misma sesión
// persistida que ya usa todo el panel). Se actualiza en vivo: iniciar o
// cerrar sesión — también desde otra pestaña — cambia el estado.
export function useSesion(): EstadoSesion {

    const [estado, setEstado] = useState<EstadoSesion>("cargando");

    useEffect(() => {

        let vigente = true;

        supabase.auth.getSession().then(({ data }) => {
            fijarUsuario(data.session?.user?.id ?? null);
            if (vigente) setEstado(data.session ? "con_sesion" : "sin_sesion");
        });

        const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
            fijarUsuario(sesion?.user?.id ?? null);
            if (vigente) setEstado(sesion ? "con_sesion" : "sin_sesion");
        });

        return () => {
            vigente = false;
            data.subscription.unsubscribe();
        };

    }, []);

    return estado;

}
