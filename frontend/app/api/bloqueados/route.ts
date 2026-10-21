import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// GET y POST /bloqueados del backend — panel «Bloqueados».
export async function GET(req: Request) {
    const usuarioId = new URL(req.url).searchParams.get("usuarioId");
    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta usuarioId." }, { status: 400 });
    }
    return reenviarAlBot(req, `/bloqueados?usuarioId=${encodeURIComponent(usuarioId)}`);
}

export async function POST(req: Request) {
    return reenviarAlBot(req, "/bloqueados", { metodo: "POST", cuerpo: await leerCuerpo(req) });
}
