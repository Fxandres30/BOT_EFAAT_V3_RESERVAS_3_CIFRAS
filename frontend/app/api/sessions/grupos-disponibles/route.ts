import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /sessions/:id/grupos-disponibles del backend (Fase 4D). El backend
// comprueba que la sesión sea del usuario (exigirSesionPropia). Leer los
// grupos de WhatsApp puede tardar: 30 s.
export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
        return NextResponse.json({ success: false, error: "Falta el parámetro id." }, { status: 400 });
    }
    return reenviarAlBot(req, `/sessions/${encodeURIComponent(id)}/grupos-disponibles`, { timeoutMs: 30000 });
}
