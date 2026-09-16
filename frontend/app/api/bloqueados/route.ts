import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /bloqueados y POST /bloqueados del backend —
// panel "Bloqueados" (bloqueo automático de WhatsApp).

export async function GET(req: Request) {

    const { searchParams } = new URL(req.url);
    const usuarioId = searchParams.get("usuarioId");

    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta usuarioId." }, { status: 400 });
    }

    const res = await fetch(`${API}/bloqueados?usuarioId=${encodeURIComponent(usuarioId)}`);
    const data = await res.json();

    return NextResponse.json(data, { status: res.status });

}

export async function POST(req: Request) {

    try {

        const body = await req.json();

        const res = await fetch(`${API}/bloqueados`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        return NextResponse.json(data, { status: res.status });

    } catch (error) {

        const mensaje = error instanceof Error ? error.message : "Error desconocido";

        return NextResponse.json(
            { ok: false, motivo: "error_interno", error: mensaje },
            { status: 500 }
        );

    }

}
