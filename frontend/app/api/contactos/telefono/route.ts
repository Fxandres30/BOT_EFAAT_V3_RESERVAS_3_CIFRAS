import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// POST /contactos/:id/telefono del backend — botón «Agregar teléfono».
export async function POST(req: Request) {
    const { id, telefono } = await leerCuerpo(req);
    if (!id || !telefono) {
        return NextResponse.json({ ok: false, motivo: "faltan_parametros" }, { status: 400 });
    }
    return reenviarAlBot(req, `/contactos/${encodeURIComponent(String(id))}/telefono`, { metodo: "POST", cuerpo: { telefono } });
}
