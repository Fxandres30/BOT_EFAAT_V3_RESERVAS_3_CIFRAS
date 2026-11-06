"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

// ¿Abierta como aplicación instalada (no como pestaña del navegador)?
function enAppInstalada(): boolean {
  if (typeof window === "undefined") return false;
  const modo = ["standalone", "fullscreen", "minimal-ui"].some(
    (m) => window.matchMedia?.(`(display-mode: ${m})`).matches
  );
  // iOS (Safari) no siempre informa display-mode.
  const ios = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return modo || ios;
}

// La landing sigue siendo pública en el navegador normal, con o sin sesión.
// Solo dentro de la aplicación instalada (p. ej. instalaciones antiguas cuyo
// start_url aún es "/") y con sesión guardada se entra directo al panel.
export default function RedireccionAppInstalada() {

  const router = useRouter();

  useEffect(() => {
    if (!enAppInstalada()) return;
    let vigente = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vigente && data.session) router.replace("/sesiones");
    });
    return () => { vigente = false; };
  }, [router]);

  return null;

}
