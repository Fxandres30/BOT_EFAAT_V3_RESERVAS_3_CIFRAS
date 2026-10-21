import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /contactos/:id del backend.
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const usuarioId = searchParams.get("usuarioId");
    if (!id || !usuarioId) {
        return NextResponse.json({ success: false, error: "Faltan parámetros (id, usuarioId)." }, { status: 400 });
    }
    return reenviarAlBot(req, `/contactos/${encodeURIComponent(id)}?usuarioId=${encodeURIComponent(usuarioId)}`);
}
