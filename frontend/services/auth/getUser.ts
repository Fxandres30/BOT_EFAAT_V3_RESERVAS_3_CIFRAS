import { usuarioActual } from "@/lib/cache/sesion";

// Usuario de la sesión: una validación con el servidor por sesión,
// compartida por todo el panel (lib/cache/sesion.ts).
export async function getUser(){

    return { data: { user: await usuarioActual() } };

}
