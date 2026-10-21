import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /sessions/active del backend (elegir la sesión que procesa el bot).
export async function POST(req: Request) {
    const { sessionId } = await leerCuerpo(req);
    return reenviarAlBot(req, "/sessions/active", { metodo: "POST", cuerpo: { sessionId }, timeoutMs: 20000 });
}
