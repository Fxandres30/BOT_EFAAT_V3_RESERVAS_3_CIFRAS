import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia POST /contactos/:id/telefono del backend — botón
// "Agregar teléfono" del panel de Contactos.
export async function POST(req: Request) {

    try {

        const { id, telefono } = await req.json();

        if (!id || !telefono) {
            return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
        }

        const res = await fetch(`${API}/contactos/${encodeURIComponent(id)}/telefono`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ telefono })
        });

        const data = await res.json();

        return NextResponse.json(data, { status: res.status });

    } catch (error) {

        console.error(error);

        const mensaje = error instanceof Error ? error.message : "Error desconocido";

        return NextResponse.json(
            { ok: false, motivo: "error_interno", error: mensaje },
            { status: 500 }
        );

    }

}
