import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /sessions/:id/grupos-disponibles del backend
// (Fase 4D) — mismo patrón exacto que app/api/sessions/status/route.ts.
// No agrega autenticación propia: el "id" que llega aquí ya sale de una
// consulta a Supabase filtrada por usuario_id (ver
// services/automatizacion/gruposDisponibles.ts), igual que status/connect/
// disconnect ya confían en que el frontend solo pide sus propias sesiones.
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ success: false, error: "Falta el parámetro id." }, { status: 400 });
    }

    const res = await fetch(`${API}/sessions/${encodeURIComponent(id)}/grupos-disponibles`);

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}
