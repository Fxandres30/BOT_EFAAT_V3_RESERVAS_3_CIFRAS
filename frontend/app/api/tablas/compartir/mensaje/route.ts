import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// PUT /tablas/compartir/mensaje del backend — cambia EL mensaje de
// publicación del sorteo activo de la tabla (el mismo de «Editar»). No envía nada.
export async function PUT(req: Request) {
    const { precio, plantilla, base_plantilla } = await leerCuerpo(req);
    return reenviarAlBot(req, "/tablas/compartir/mensaje", { metodo: "PUT", cuerpo: { precio, plantilla, base_plantilla } });
}
