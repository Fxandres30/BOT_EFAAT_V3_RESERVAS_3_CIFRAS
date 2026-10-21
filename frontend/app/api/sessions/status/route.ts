import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /sessions/status/:id del backend.
export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
        return NextResponse.json({ success: false, error: "Falta el parámetro id." }, { status: 400 });
    }
    return reenviarAlBot(req, `/sessions/status/${encodeURIComponent(id)}`, { timeoutMs: 10000 });
}
