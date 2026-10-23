import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// PUT /tablas/compartir/destinos del backend — guarda los grupos de
// «Compartir» de una tabla (sin enviar nada).
export async function PUT(req: Request) {
    const { precio, grupos } = await leerCuerpo(req);
    return reenviarAlBot(req, "/tablas/compartir/destinos", { metodo: "PUT", cuerpo: { precio, grupos } });
}
