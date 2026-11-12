"use client";

import { useSyncExternalStore } from "react";

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

// ---------------------------------------------------------------------------
// Estado de la sesión, COMPARTIDO por toda la pestaña.
//
// Antes cada componente que usaba el hook empezaba en «cargando» y volvía a
// leer la sesión. Como cada página monta su propio DashboardLayout, cada
// cambio de sección mostraba la pantalla de carga completa. Ahora la sesión
// se lee una vez y se escucha con UNA suscripción a Supabase Auth; los
// montajes siguientes reciben el estado ya conocido al instante.
//
// - «cargando» solo existe en el arranque, hasta la primera respuesta. Una
//   vez conocido el estado, nunca se vuelve a «cargando».
// - TOKEN_REFRESHED / SIGNED_IN con sesión no cambian nada visible (siguen en
//   «con_sesion»); el usuario se vuelve a fijar por si cambió de cuenta.
// - SIGNED_OUT (también desde otra pestaña, o renovación imposible) pasa a
//   «sin_sesion» y la guardia del panel manda a /login como antes.
// ---------------------------------------------------------------------------

let estado: EstadoSesion = "cargando";
const oyentes = new Set<() => void>();
let iniciado = false;
// Cuenta eventos de Supabase Auth: si llega alguno antes que la lectura
// inicial, esa lectura ya está desfasada y se descarta.
let eventos = 0;

function aplicar(sesionId: string | null) {
    fijarUsuario(sesionId);
    const nuevo: EstadoSesion = sesionId ? "con_sesion" : "sin_sesion";
    if (nuevo === estado) return;
    estado = nuevo;
    oyentes.forEach((fn) => fn());
}

function iniciar() {

    if (iniciado || typeof window === "undefined") return;
    iniciado = true;

    const vistos = eventos;
    supabase.auth.getSession().then(({ data }) => {
        if (eventos !== vistos) return;
        aplicar(data.session?.user?.id ?? null);
    });

    // Suscripción única para toda la vida de la pestaña.
    supabase.auth.onAuthStateChange((_evento, sesion) => {
        eventos++;
        aplicar(sesion?.user?.id ?? null);
    });

}

function suscribir(fn: () => void) {
    iniciar();
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
}

const leerEstado = () => estado;
// En el servidor y al hidratar: «cargando» (la sesión vive en el navegador).
const estadoServidor = (): EstadoSesion => "cargando";

// Estado de la sesión de Supabase Auth en el navegador (la misma sesión
// persistida que ya usa todo el panel). Se actualiza en vivo: iniciar o
// cerrar sesión — también desde otra pestaña — cambia el estado.
export function useSesion(): EstadoSesion {
    return useSyncExternalStore(suscribir, leerEstado, estadoServidor);
}
