import { NextResponse } from "next/server";
import { botApiHeadersDe } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy de solo lectura hacia backend GET /sessions/salud (estado real de
// las sesiones del usuario). Reenvía el Bearer de Supabase; el backend
// decide qué sesiones son del usuario.
export async function GET(req: Request) {

    if (!req.headers.get("authorization")) {
        return NextResponse.json({ ok: false, motivo: "sin_sesion" }, { status: 401 });
    }

    try {

        const res = await fetch(`${API}/sessions/salud`, {
            headers: botApiHeadersDe(req),
            cache: "no-store",
            signal: AbortSignal.timeout(10000)
        });

        const datos = await res.json().catch(() => ({ ok: false, motivo: "respuesta_invalida" }));

        return NextResponse.json(datos, { status: res.status, headers: { "Cache-Control": "no-store" } });

    } catch {

        return NextResponse.json({ ok: false, motivo: "backend_no_disponible" }, { status: 502 });

    }

}
