import { fetchConSesion } from "@/lib/fetchConSesion";

export async function disconnectSession(sessionId: string) {

    const res = await fetchConSesion("/api/sessions/disconnect", {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify({

            sessionId

        })

    });

    console.log("STATUS:", res.status);

    const texto = await res.text();

    console.log(texto);

    return texto;

}