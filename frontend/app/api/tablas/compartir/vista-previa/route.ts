import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /tablas/compartir/vista-previa del backend — texto y grupos para
// «Compartir». No envía nada. sin_imagen=1 (panel actual): la imagen es la
// captura del navegador. Sin él (panel anterior) el backend aún la genera.
export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    const precio = params.get("precio") || "";
    if (!/^\d{1,7}$/.test(precio)) return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    const sinImagen = params.get("sin_imagen") === "1" ? "&sin_imagen=1" : "";
    return reenviarAlBot(req, `/tablas/compartir/vista-previa?precio=${precio}${sinImagen}`, { timeoutMs: 60000 });
}
