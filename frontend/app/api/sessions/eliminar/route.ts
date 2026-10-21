import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// Eliminar una sesión propia: DELETE /sessions/propias/:id del backend, que
// desconecta el socket, borra la fila y la carpeta de credenciales (antes
// el panel solo borraba la fila en Supabase y el bot seguía conectado).
export async function POST(req: Request) {
    const { sessionId } = await leerCuerpo(req);
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Falta sessionId." }, { status: 400 });
    }
    return reenviarAlBot(req, `/sessions/propias/${encodeURIComponent(String(sessionId))}`, { metodo: "DELETE", timeoutMs: 30000 });
}
