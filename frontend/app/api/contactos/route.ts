import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /contactos del backend. El backend identifica al usuario por su
// sesión (Authorization) y comprueba que los datos sean suyos.
export async function GET(req: Request) {
    const usuarioId = new URL(req.url).searchParams.get("usuarioId");
    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta el parámetro usuarioId." }, { status: 400 });
    }
    return reenviarAlBot(req, `/contactos?usuarioId=${encodeURIComponent(usuarioId)}`, { timeoutMs: 20000 });
}
