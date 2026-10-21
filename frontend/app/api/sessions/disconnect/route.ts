import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /sessions/disconnect del backend.
export async function POST(req: Request) {
    const { sessionId } = await leerCuerpo(req);
    return reenviarAlBot(req, "/sessions/disconnect", { metodo: "POST", cuerpo: { sessionId }, timeoutMs: 20000 });
}
