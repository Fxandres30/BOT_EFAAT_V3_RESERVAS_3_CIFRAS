import { fetchConSesion } from "@/lib/fetchConSesion";

export async function setPreferredSession(sessionId: string) {
    const res = await fetchConSesion("/api/sessions/preferred", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
    });

    const text = await res.text();

    if (!res.ok) {
        throw new Error(text);
    }

    return JSON.parse(text);
}
