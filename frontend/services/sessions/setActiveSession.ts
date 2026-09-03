export async function setActiveSession(sessionId: string) {
    const res = await fetch("/api/sessions/active", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
    });

    const text = await res.text();

    console.log("Status:", res.status);
    console.log("Respuesta:", text);

    if (!res.ok) {
        throw new Error(text);
    }

    return JSON.parse(text);
}