import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

const MAX_BYTES = 2048;

// Ingestión de visitas (lo llama lib/analitica/tracker.ts). Proxy delgado
// hacia POST /analitica/recolectar del backend, igual que el resto de
// app/api/*. Solo escribe: NUNCA devuelve datos, como mucho el session_id
// del propio navegador. La validación estricta y el rate limiting ocurren
// en el backend.

function vacio(status = 204) {
    return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {

    // Solo mismo origen: otros sitios no pueden inyectar visitas desde el
    // navegador de sus usuarios.
    const origin = req.headers.get("origin");
    const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();

    if (origin) {
        let hostOrigen = "";
        try {
            hostOrigen = new URL(origin).host.toLowerCase();
        } catch {
            return vacio(403);
        }
        if (hostOrigen !== host) return vacio(403);
    } else {
        const sitio = req.headers.get("sec-fetch-site");
        if (sitio && sitio !== "same-origin") return vacio(403);
    }

    if (Number(req.headers.get("content-length") || 0) > MAX_BYTES) return vacio(413);

    const texto = await req.text();
    if (texto.length > MAX_BYTES) return vacio(413);

    let evento: unknown;
    try {
        evento = JSON.parse(texto);
    } catch {
        return vacio(400);
    }

    try {

        const res = await fetch(`${API}/analitica/recolectar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                evento,
                contexto: {
                    user_agent: (req.headers.get("user-agent") || "").slice(0, 512),
                    x_forwarded_for: (req.headers.get("x-forwarded-for") || "").slice(0, 1024)
                }
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(5000)
        });

        if (res.status === 200) {
            const datos = await res.json();
            return NextResponse.json({ s: datos?.s }, { headers: { "Cache-Control": "no-store" } });
        }

        if (res.status === 202) return vacio();
        if (res.status === 429) return vacio(429);
        if (res.status >= 500 || res.status === 404) return vacio(502);

        return vacio(400);

    } catch {

        return vacio(502);

    }

}
