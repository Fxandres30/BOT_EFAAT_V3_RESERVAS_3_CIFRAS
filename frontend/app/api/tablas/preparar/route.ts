import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST { precio } — estado real de la cuadrícula del cliente y, si no tiene
// ninguna fila, su inicialización segura (backend/routes/tablas.js). El
// backend saca el cliente del token; aquí solo se reenvía el precio.
const PRECIO = /^\d{1,7}$/;

export async function POST(req: Request) {
    const datos = await leerCuerpo(req);
    const precio = String(datos.precio ?? "");
    if (!PRECIO.test(precio)) {
        return NextResponse.json({ ok: false, motivo: "parametros_invalidos" }, { status: 400 });
    }
    return reenviarAlBot(req, `/tablas/${precio}/preparar`, { metodo: "POST", cuerpo: {}, timeoutMs: 20000 });
}
