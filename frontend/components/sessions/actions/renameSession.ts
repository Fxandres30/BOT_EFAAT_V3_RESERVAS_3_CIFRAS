import { updateSession } from "@/services/sessions/updateSession";

export async function renameSession(

    sessionId: string,

    nombre: string

) {

    if (!nombre.trim()) {

        throw new Error("Nombre inválido");

    }

    return updateSession(

        sessionId,

        {

            nombre: nombre.trim()

        }

    );

}