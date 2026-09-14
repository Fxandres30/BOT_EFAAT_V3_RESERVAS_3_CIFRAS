import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /contactos del backend — mismo patrón exacto que
// app/api/sessions/grupos-disponibles/route.ts. No agrega autenticación
// propia: usuarioId ya sale de supabase.auth en el navegador (mismo
// criterio que el resto del panel, ver services/tablas/obtenerTabla.ts).
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const usuarioId = searchParams.get("usuarioId");

    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta el parámetro usuarioId." }, { status: 400 });
    }

    const res = await fetch(`${API}/contactos?usuarioId=${encodeURIComponent(usuarioId)}`);

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}
