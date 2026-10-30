import { useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { vaciar } from "./almacen";

// Usuario de la sesión, compartido por todo el panel (UX-09). Antes cada
// hook y la barra lateral pedían supabase.auth.getUser() — una consulta al
// servidor de autenticación cada uno, en cada pantalla. Ahora se valida UNA
// vez por sesión; la autorización real sigue en la RLS y en el backend, que
// comprueban el token en cada solicitud.
//
// Al cambiar el usuario (cerrar sesión, entrar con otra cuenta, también
// desde otra pestaña) se vacía la caché y se avisa a los hooks para que
// cierren sus suscripciones y lean con el usuario nuevo.

let usuario: Promise<User | null> | null = null;
// undefined = todavía no se conoce la sesión inicial.
let idActual: string | null | undefined;
let cambios = 0;
const oyentes = new Set<() => void>();
let escuchando = false;

function escuchar() {

    if (escuchando || typeof window === "undefined") return;
    escuchando = true;

    supabase.auth.onAuthStateChange((evento, sesion) => {

        const id = sesion?.user?.id ?? null;

        if (idActual !== undefined && id !== idActual) {
            usuario = null;
            vaciar();
            cambios++;
            oyentes.forEach((fn) => fn());
        } else if (evento === "USER_UPDATED") {
            // Mismo usuario con datos nuevos (p. ej. el correo).
            usuario = null;
        }

        idActual = id;

    });

}

export function usuarioActual(): Promise<User | null> {

    escuchar();

    if (!usuario) {
        const lectura: Promise<User | null> = supabase.auth.getUser().then(({ data, error }) => {
            // Sin sesión o sin respuesta: no se guarda, la próxima vez se reintenta.
            if (error || !data.user) {
                if (usuario === lectura) usuario = null;
                return null;
            }
            return data.user;
        });
        usuario = lectura;
    }

    return usuario;

}

function suscribir(fn: () => void) {
    escuchar();
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
}

// Cambia cada vez que cambia el usuario de la sesión: los hooks lo ponen en
// sus dependencias para empezar de cero.
export function useCambiosUsuario(): number {
    return useSyncExternalStore(suscribir, () => cambios, () => 0);
}
