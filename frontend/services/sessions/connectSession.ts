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