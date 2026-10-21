import { NextResponse } from "next/server";
import { reenviarAlBot } from "@/lib/botApi";

// GET /bloqueados/contacto del backend — insignia «CONTACTO BLOQUEADO».
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const usuarioId = searchParams.get("usuarioId");
    const telefono = searchParams.get("telefono");
    const lid = searchParams.get("lid");
    if (!usuarioId) {
        return NextResponse.json({ success: false, error: "Falta usuarioId." }, { status: 400 });
    }
    const params = new URLSearchParams({ usuarioId });
    if (telefono) params.set("telefono", telefono);
    if (lid) params.set("lid", lid);
    return reenviarAlBot(req, `/bloqueados/contacto?${params.toString()}`);
}
