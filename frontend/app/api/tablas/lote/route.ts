import { NextResponse } from "next/server";
import { reenviarAlBot, leerCuerpo } from "@/lib/botApi";

// Operación sobre VARIOS números en una sola solicitud (backend
// POST /tablas/:precio/lote). El backend saca el cliente y el operador del
// token; aquí solo se valida la forma y se reenvían los campos permitidos
// de cada acción (nunca usuarioId, operador ni estado de destino).
const PRECIO = /^\d{1,7}$/;
const MAX_NUMEROS = 1000;

const CAMPOS: Record<string, string[]> = {
    reservar: ["numeros", "contactoId", "nuevoContacto", "eventoId", "sorteoProgramadoId", "grupoId", "sinSorteo", "motivo", "observaciones", "solicitudId"],
    pagar: ["numeros", "metodoPago", "observaciones", "motivo", "otrosSorteoAutorizados", "solicitudId"],
    liberar: ["numeros", "confirmar", "motivo", "observaciones", "otrosSorteoAutorizados", "solicitudId"]
};

const invalido = () => NextResponse.json({ ok: false, motivo: "parametros_invalidos", mensaje: "Parámetros inválidos." }, { status: 400 });

// POST { precio, accion, numeros, ...campos de la acción }
export async function POST(req: Request) {
    const datos = await leerCuerpo(req);
    const precio = String(datos.precio ?? "");
    const accion = String(datos.accion ?? "");
    const numeros = datos.numeros;
    if (!PRECIO.test(precio) || !CAMPOS[accion] || !Array.isArray(numeros) || numeros.length === 0 || numeros.length > MAX_NUMEROS) return invalido();
    const cuerpo = Object.fromEntries(CAMPOS[accion].filter((c) => datos[c] !== undefined).map((c) => [c, datos[c]]));
    return reenviarAlBot(req, `/tablas/${precio}/lote`, { metodo: "POST", cuerpo: { ...cuerpo, accion }, timeoutMs: 60000 });
}
