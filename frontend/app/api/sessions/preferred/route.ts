import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /sessions/preferred del backend (marcar la sesión principal).
export async function POST(req: Request) {
    const { sessionId } = await leerCuerpo(req);
    return reenviarAlBot(req, "/sessions/preferred", { metodo: "POST", cuerpo: { sessionId }, timeoutMs: 15000 });
}
