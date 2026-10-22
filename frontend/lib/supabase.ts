import { createClient } from "@supabase/supabase-js";

import { destinoEnlaceRecuperacion } from "@/lib/auth/recuperacion";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase =
  createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        // Igual que el valor por defecto, salvo un enlace de recuperación
        // fuera de /restablecer-contrasena: no abre sesión en esa página
        // (el login entraría directo al panel sin pedir la contraseña nueva).
        // ReenvioRecuperacion lo lleva a su pantalla.
        detectSessionInUrl: (url, params) =>
          !destinoEnlaceRecuperacion(url.href) &&
          Boolean(params.access_token || params.error || params.error_description || params.error_code)
      }
    }
  );
