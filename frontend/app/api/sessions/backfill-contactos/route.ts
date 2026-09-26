import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia POST /sessions/active/backfill-contactos del backend
// — mismo patrón que app/api/sessions/connect/route.ts. Dispara el escaneo
// completo real (Identity Scanner + import) sobre la sesión activa AHORA,
// en vez de esperar al escaneo periódico de 6h.
export async function POST() {

    try {

        const res = await fetch(`${API}/sessions/active/backfill-contactos`, {
            method: "POST",
            headers: botApiHeaders()
        });

        const text = await res.text();

        let data: unknown = null;

        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { success: false, error: text || "Respuesta inválida del backend." };
        }

        return NextResponse.json(data as object, { status: res.status });

    } catch (error) {

        console.error(error);

        const mensaje = error instanceof Error ? error.message : "Error desconocido";

        return NextResponse.json(
            { success: false, error: mensaje },
            { status: 500 }
        );

    }

}
