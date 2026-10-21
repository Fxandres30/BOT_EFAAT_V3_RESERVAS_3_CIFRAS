import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /bloqueados/:id/desbloquear del backend — botón «Desbloquear».
export async function POST(req: Request) {
    const { id, usuarioId } = await leerCuerpo(req);
    if (!id || !usuarioId) {
        return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    }
    return reenviarAlBot(req, `/bloqueados/${encodeURIComponent(String(id))}/desbloquear`, { metodo: "POST", cuerpo: { usuarioId } });
}
