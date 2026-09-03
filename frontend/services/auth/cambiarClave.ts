import { supabase } from "@/lib/supabase";

export async function cambiarClave(nuevaClave: string) {
  return await supabase.auth.updateUser({
    password: nuevaClave,
  });
}