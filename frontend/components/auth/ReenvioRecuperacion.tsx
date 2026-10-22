"use client";

import { useEffect } from "react";

import { destinoEnlaceRecuperacion } from "@/lib/auth/recuperacion";

// Si el enlace del correo de recuperación cae en otra página (Supabase manda
// al Site URL cuando el redirectTo no está en su lista permitida), se reenvía
// a /restablecer-contrasena con el enlace intacto. Sin enlace: no hace nada.
export default function ReenvioRecuperacion() {

  useEffect(() => {
    const destino = destinoEnlaceRecuperacion(window.location.href);
    if (destino) window.location.replace(destino);
  }, []);

  return null;

}
