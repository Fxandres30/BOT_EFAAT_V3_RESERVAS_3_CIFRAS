import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// Intervención manual sobre un número (backend/routes/tablas.js). El
// backend saca el cliente y el operador del token de la sesión; aquí solo
// se validan la forma de la ruta y se reenvían los campos permitidos de
// cada acción (nunca usuarioId, operador ni estado).

const PRECIO = /^\d{1,7}$/;
const NUMERO = /^\d{1,4}$/;

const CAMPOS: Record<string, string[]> = {
    reservar: ["contactoId", "nuevoContacto", "eventoId", "motivo", "observaciones", "solicitudId"],
    pagar: ["metodoPago", "observaciones", "motivo", "solicitudId"],
    liberar: ["confirmar", "motivo", "observaciones", "solicitudId"]
};

const invalido = () => NextResponse.json({ ok: false, motivo: "parametros_invalidos", mensaje: "Parámetros inválidos." }, { status: 400 });

// GET ?precio=&numero= — contexto del número.
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const precio = searchParams.get("precio") || "";
    const numero = searchParams.get("numero") || "";
    if (!PRECIO.test(precio) || !NUMERO.test(numero)) return invalido();
    return reenviarAlBot(req, `/tablas/${precio}/numeros/${numero}`);
}

// POST { precio, numero, accion, ...campos de la acción }
export async function POST(req: Request) {
    const datos = await leerCuerpo(req);
    const precio = String(datos.precio ?? "");
    const numero = String(datos.numero ?? "");
    const accion = String(datos.accion ?? "");
    if (!PRECIO.test(precio) || !NUMERO.test(numero) || !CAMPOS[accion]) return invalido();
    const cuerpo = Object.fromEntries(CAMPOS[accion].filter((c) => datos[c] !== undefined).map((c) => [c, datos[c]]));
    return reenviarAlBot(req, `/tablas/${precio}/numeros/${numero}/${accion}`, { metodo: "POST", cuerpo, timeoutMs: 20000 });
}
