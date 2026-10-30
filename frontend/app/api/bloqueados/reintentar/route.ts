import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /bloqueados/:id/reintentar del backend — botón «Reintentar».
export async function POST(req: Request) {
    const { id } = await leerCuerpo(req);
    if (!id) {
        return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    }
    return reenviarAlBot(req, `/bloqueados/${encodeURIComponent(String(id))}/reintentar`, { metodo: "POST", cuerpo: {} });
}
