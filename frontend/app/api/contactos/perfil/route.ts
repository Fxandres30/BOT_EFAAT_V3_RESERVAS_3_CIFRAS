import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /contactos/:id del backend.
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const usuarioId = searchParams.get("usuarioId");

    if (!id || !usuarioId) {
        return NextResponse.json({ success: false, error: "Faltan parámetros (id, usuarioId)." }, { status: 400 });
    }

    const res = await fetch(
        `${API}/contactos/${encodeURIComponent(id)}?usuarioId=${encodeURIComponent(usuarioId)}`
    );

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}
