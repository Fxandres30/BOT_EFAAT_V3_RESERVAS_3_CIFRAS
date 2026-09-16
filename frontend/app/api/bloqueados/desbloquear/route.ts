import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia POST /bloqueados/:id/desbloquear del backend — botón
// "🔓 DESBLOQUEAR CONTACTO" del panel. id va en el body (no en la ruta),
// mismo criterio que /api/contactos/telefono.
export async function POST(req: Request) {

    try {

        const { id, usuarioId } = await req.json();

        if (!id || !usuarioId) {
            return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
        }

        const res = await fetch(`${API}/bloqueados/${encodeURIComponent(id)}/desbloquear`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usuarioId })
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
