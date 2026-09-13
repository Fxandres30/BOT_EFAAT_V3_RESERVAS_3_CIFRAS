import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy del botón "Compartir" real del panel — mismo patrón que
// /api/sessions/connect. Toda la lógica real (imagen + texto + WhatsApp)
// vive en el backend (services/compartirTabla.js); este proxy solo
// reenvía la solicitud del admin ya autenticado en el panel.
export async function POST(req: Request) {

    try {

        const { precio, usuarioId } = await req.json();

        const res = await fetch(`${API}/tablas/compartir`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ precio, usuarioId })
        });

        const data = await res.json();

        return NextResponse.json(data, { status: res.status });

    } catch (error: unknown) {

        return NextResponse.json(
            { enviado: false, motivo: error instanceof Error ? error.message : "Error interno del servidor." },
            { status: 500 }
        );

    }

}
