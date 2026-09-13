import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy de solo lectura — usado ÚNICAMENTE por la página
// /tablas/imprimir/[precio] (Puppeteer, backend), nunca por el panel
// admin real. El backend valida el token firmado; este proxy no decide
// nada de autorización, solo reenvía.
export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);

    const precio = searchParams.get("precio");
    const token = searchParams.get("token");

    const res = await fetch(`${API}/tablas/imprimir-datos?precio=${precio}&token=${encodeURIComponent(token || "")}`);

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}
