import { reenviarAlBot } from "@/lib/botApi";

// GET /tablas/contactos/buscar del backend — buscador de contactos de la
// reserva manual. Solo el directorio del cliente de la sesión (el backend lo
// saca del token).
export async function GET(req: Request) {
    const q = (new URL(req.url).searchParams.get("q") || "").slice(0, 80);
    return reenviarAlBot(req, `/tablas/contactos/buscar?q=${encodeURIComponent(q)}`, { timeoutMs: 20000 });
}
