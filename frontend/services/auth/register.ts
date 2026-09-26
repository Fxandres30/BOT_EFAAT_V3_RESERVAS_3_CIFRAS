import { supabase } from "@/lib/supabase";

// Registro con Supabase Auth. El nombre se guarda en la metadata del usuario
// (auth.users.raw_user_meta_data.nombre) — sin tabla de perfil propia.
// La confirmación de correo es obligatoria (configuración de Supabase): el
// enlace del correo vuelve a /login, donde supabase-js recoge la sesión.
export async function register(
    nombre: string,
    email: string,
    password: string
){

    return await supabase.auth.signUp({

        email,
        password,

        options: {
            data: { nombre },
            emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined
        }

    });

}
