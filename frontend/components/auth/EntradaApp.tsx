"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSesion } from "@/hooks/useSesion";
import { RUTA_INICIO } from "@/lib/navegacion";
import PantallaCarga from "./PantallaCarga";

// Punto de entrada de la aplicación instalada (start_url del manifest).
// Lee la sesión persistida de Supabase Auth (supabase-js la renueva si el
// token caducó) y lleva directo al panel o al login, sin pasar por la
// landing. Una sesión revocada en el servidor la detecta el panel al validar
// el usuario (getUser → session_not_found → cierre local → /login).
export default function EntradaApp() {

  const router = useRouter();
  const sesion = useSesion();

  useEffect(() => {
    if (sesion === "con_sesion") router.replace(RUTA_INICIO);
    else if (sesion === "sin_sesion") router.replace("/login");
  }, [sesion, router]);

  return <PantallaCarga texto="Abriendo EFAAT360…" />;

}
