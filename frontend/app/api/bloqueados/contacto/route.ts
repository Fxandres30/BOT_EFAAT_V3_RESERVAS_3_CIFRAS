import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /bloqueados/contacto del backend — badge
// "🚫 CONTACTO BLOQUEADO" del detalle de contacto.
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const usuarioId = searchParams.get("usuarioId");
    const telefono = searchParams.get("telefono");
    const lid = searchParams.get("lid");

    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta usuarioId." }, { status: 400 });
    }

    const params = new URLSearchParams({ usuarioId });
    if (telefono) params.set("telefono", telefono);
    if (lid) params.set("lid", lid);

    const res = await fetch(`${API}/bloqueados/contacto?${params.toString()}`);
    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}
