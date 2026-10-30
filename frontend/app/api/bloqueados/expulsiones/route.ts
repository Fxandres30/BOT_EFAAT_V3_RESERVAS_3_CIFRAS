import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /bloqueados/:id/expulsiones del backend — estado por grupo e historial.
export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
        return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    }
    return reenviarAlBot(req, `/bloqueados/${encodeURIComponent(id)}/expulsiones`);
}
