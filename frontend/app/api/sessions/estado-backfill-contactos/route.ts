import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy delgado hacia GET /sessions/active/estado-backfill-contactos del
// backend — solo lectura, para hacer polling del progreso del escaneo sin
// volver a dispararlo.
export async function GET() {

    try {

        const res = await fetch(`${API}/sessions/active/estado-backfill-contactos`, {
            headers: botApiHeaders()
        });

        const data = await res.json();

        return NextResponse.json(data, { status: res.status });

    } catch (error) {

        console.error(error);

        const mensaje = error instanceof Error ? error.message : "Error desconocido";

        return NextResponse.json(
            { success: false, error: mensaje },
            { status: 500 }
        );

    }

}
