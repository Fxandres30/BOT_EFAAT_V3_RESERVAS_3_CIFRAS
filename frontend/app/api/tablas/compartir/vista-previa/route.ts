import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /tablas/compartir/vista-previa del backend — imagen real de la tabla,
// texto y grupos para «Compartir». No envía nada. La captura tarda.
export async function GET(req: Request) {
    const precio = new URL(req.url).searchParams.get("precio") || "";
    if (!/^\d{1,7}$/.test(precio)) return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    return reenviarAlBot(req, `/tablas/compartir/vista-previa?precio=${precio}`, { timeoutMs: 60000 });
}
