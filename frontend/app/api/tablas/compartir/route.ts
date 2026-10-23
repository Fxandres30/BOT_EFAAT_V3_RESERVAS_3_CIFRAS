import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /tablas/compartir del backend — botón «Compartir». Lleva la captura
// PNG de la tabla (data URL; el backend la valida). Enviarla a varios grupos
// puede tardar: 120 s antes de dar por perdida la respuesta (504; el envío
// podría haber ocurrido igual: la misma solicitudId nunca reenvía a un
// grupo ya hecho).
export async function POST(req: Request) {
    const { precio, usuarioId, solicitudId, grupos, texto, guardar_destinos, imagen } = await leerCuerpo(req);
    return reenviarAlBot(req, "/tablas/compartir", { metodo: "POST", cuerpo: { precio, usuarioId, solicitudId, grupos, texto, guardar_destinos, imagen }, timeoutMs: 120000 });
}
