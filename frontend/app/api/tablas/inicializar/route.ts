import { reenviarAlBot } from "@/lib/botApi";

// POST /tablas/inicializar del backend — primer acceso del cliente: sus
// configuraciones de tablas y su cuadrícula. El backend saca el cliente del
// token de la sesión; aquí no se reenvía ningún cuerpo.
export async function POST(req: Request) {
    return reenviarAlBot(req, "/tablas/inicializar", { metodo: "POST", cuerpo: {}, timeoutMs: 20000 });
}
