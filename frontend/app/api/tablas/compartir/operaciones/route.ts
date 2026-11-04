import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// Operaciones de «Compartir tabla» (backend/routes/tablas.js,
// services/operacionesCompartir.js): progreso real y cancelación. El
// backend saca el cliente del token; aquí solo se valida la forma.
//   GET  ?id=<uuid>      — progreso de una operación
//   GET  ?precio=<n>     — envío en curso y recientes de esa tabla
//   POST { id }          — cancelar (idempotente)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRECIO = /^\d{1,7}$/;
const invalido = () => NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });

export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id !== null) {
        if (!UUID.test(id)) return invalido();
        return reenviarAlBot(req, `/tablas/compartir/operaciones/${id}`);
    }
    const precio = params.get("precio") || "";
    if (!PRECIO.test(precio)) return invalido();
    return reenviarAlBot(req, `/tablas/compartir/operaciones?precio=${precio}`);
}

export async function POST(req: Request) {
    const { id } = await leerCuerpo(req);
    if (typeof id !== "string" || !UUID.test(id)) return invalido();
    return reenviarAlBot(req, `/tablas/compartir/operaciones/${id}/cancelar`, { metodo: "POST", cuerpo: {} });
}
