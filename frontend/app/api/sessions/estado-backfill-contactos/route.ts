import { reenviarAlBot } from "@/lib/botApi";

// GET /sessions/active/estado-backfill-contactos del backend — solo lectura,
// para el polling del progreso del escaneo.
export async function GET(req: Request) {
    return reenviarAlBot(req, "/sessions/active/estado-backfill-contactos", { timeoutMs: 10000 });
}
