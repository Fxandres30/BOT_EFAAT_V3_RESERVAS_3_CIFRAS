import { reenviarAlBot } from "@/lib/botApi";

// POST /sessions/active/backfill-contactos del backend: dispara el escaneo
// completo de contactos sobre la sesión activa (el progreso se consulta
// aparte, en estado-backfill-contactos).
export async function POST(req: Request) {
    return reenviarAlBot(req, "/sessions/active/backfill-contactos", { metodo: "POST", timeoutMs: 30000 });
}
