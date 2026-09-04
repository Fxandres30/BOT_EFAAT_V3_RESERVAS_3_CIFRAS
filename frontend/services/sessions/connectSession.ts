export async function connectSession(sessionId: string) {

    const res = await fetch(

        "/api/sessions/connect",

        {

            method: "POST",

            headers: {

                "Content-Type":"application/json"

            },

            body: JSON.stringify({

                sessionId

            })

        }

    );

    return await res.json();

}

// La sesión ya no existe en Supabase (fila eliminada). El backend nunca
// llegó a arrancar Baileys para ese id.
export function isSessionNotFound(res: any) {

    return res?.success === false && res?.code === "SESSION_NOT_FOUND";

}