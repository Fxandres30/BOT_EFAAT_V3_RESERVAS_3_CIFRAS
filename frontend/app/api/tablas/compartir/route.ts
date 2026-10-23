import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /tablas/compartir del backend — botón «Compartir». Generar la
// imagen de la tabla y enviarla puede tardar: 120 s antes de dar por
// perdida la respuesta (504; el envío podría haber ocurrido igual: la misma
// solicitudId nunca reenvía a un grupo ya hecho).
export async function POST(req: Request) {
    const { precio, usuarioId, solicitudId, grupos, texto, guardar_destinos } = await leerCuerpo(req);
    return reenviarAlBot(req, "/tablas/compartir", { metodo: "POST", cuerpo: { precio, usuarioId, solicitudId, grupos, texto, guardar_destinos }, timeoutMs: 120000 });
}
