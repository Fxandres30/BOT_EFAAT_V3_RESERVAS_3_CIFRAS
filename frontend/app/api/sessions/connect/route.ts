import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /sessions/connect del backend. Arrancar WhatsApp puede tardar unos
// segundos; con 30 s sin respuesta el panel recibe 504 y deja de esperar.
export async function POST(req: Request) {
    const { sessionId } = await leerCuerpo(req);
    return reenviarAlBot(req, "/sessions/connect", { metodo: "POST", cuerpo: { sessionId }, timeoutMs: 30000 });
}
