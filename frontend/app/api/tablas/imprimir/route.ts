import { NextResponse } from "next/server";
import { llamarBot } from "@/lib/llamarBot";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy de solo lectura — usado ÚNICAMENTE por la página
// /tablas/imprimir/[precio] (Puppeteer, backend), nunca por el panel
// admin real. El backend valida el token firmado; este proxy no decide
// nada de autorización, solo reenvía (sin cabeceras de servicio: la
// autorización es el token firmado de la URL), con límite de espera.
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const precio = searchParams.get("precio");
    const token = searchParams.get("token");

    const { status, cuerpo } = await llamarBot(
        `${API}/tablas/imprimir-datos?precio=${encodeURIComponent(precio || "")}&token=${encodeURIComponent(token || "")}`,
        {},
        { timeoutMs: 15000 }
    );

    return NextResponse.json(cuerpo, { status });

}
