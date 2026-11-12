import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy estricto hacia backend /rifas/* (motor de rifas independientes).
// Reenvía el "Authorization: Bearer <access_token>" del navegador y añade el
// token de servicio (solo servidor). El backend saca el cliente DEL TOKEN:
// este proxy no envía ni decide ningún usuarioId. Fuera de la lista → 404.

const CABECERAS = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// JID de grupo de WhatsApp (…@g.us).
const GRUPO = /^[0-9-]{5,40}@g\.us$/;

type Metodo = "GET" | "POST" | "PATCH" | "DELETE";

const OPERACIONES = new Set(["reservar", "pagar", "liberar", "bloquear", "reiniciar", "archivar", "restaurar", "grupos"]);

function destino(metodo: Metodo, ruta: string[]): string | null {
    const [a, b, c] = ruta;
    if (ruta.length === 0) return metodo === "GET" || metodo === "POST" ? "" : null;
    if (ruta.length === 1) {
        if (a === "modo") return metodo === "GET" ? "/modo" : null;
        if (a === "avisos") return metodo === "GET" ? "/avisos" : null;
        if (UUID.test(a)) return metodo === "GET" || metodo === "PATCH" || metodo === "DELETE" ? `/${a}` : null;
        return null;
    }
    if (ruta.length === 2 && UUID.test(a)) {
        if (b === "archivo") return metodo === "GET" ? `/${a}/archivo` : null;
        if (OPERACIONES.has(b)) return metodo === "POST" ? `/${a}/${b}` : null;
        return null;
    }
    if (ruta.length === 3 && UUID.test(a) && b === "grupos" && GRUPO.test(c)) {
        return metodo === "DELETE" ? `/${a}/grupos/${encodeURIComponent(c)}` : null;
    }
    return null;
}

async function reenviar(metodo: Metodo, req: Request, params: Promise<{ ruta?: string[] }>) {
    const { ruta = [] } = await params;
    const camino = destino(metodo, ruta.map(decodeURIComponent));
    const autorizacion = req.headers.get("authorization");

    if (camino === null) return NextResponse.json({ ok: false, motivo: "no_encontrado" }, { status: 404, headers: CABECERAS });
    if (!autorizacion) return NextResponse.json({ ok: false, motivo: "sin_sesion" }, { status: 401, headers: CABECERAS });

    let cuerpo: string | undefined;
    if (metodo === "POST" || metodo === "PATCH") {
        const texto = await req.text();
        if (texto.length > 64 * 1024) return NextResponse.json({ ok: false, motivo: "demasiado_grande" }, { status: 413, headers: CABECERAS });
        cuerpo = texto || "{}";
    }

    const consulta = camino === "" && new URL(req.url).searchParams.get("archivadas") === "1" ? "?archivadas=1" : "";

    try {
        const res = await fetch(`${API}/rifas${camino}${consulta}`, {
            method: metodo,
            headers: botApiHeaders({
                Authorization: autorizacion,
                "Content-Type": "application/json",
                ...(req.headers.get("x-solicitud-id") ? { "x-solicitud-id": req.headers.get("x-solicitud-id")!.slice(0, 80) } : {})
            }),
            body: cuerpo,
            cache: "no-store",
            signal: AbortSignal.timeout(20000)
        });
        const datos = await res.json().catch(() => ({ ok: false, motivo: "respuesta_invalida" }));
        if (!res.ok) console.warn(`❌ [PROXY RIFAS] ${metodo} ${camino} → HTTP ${res.status} · ${datos?.motivo || "desconocido"}`);
        return NextResponse.json(datos, { status: res.status, headers: CABECERAS });
    } catch (error) {
        console.error(`❌ [PROXY RIFAS] ${metodo} ${camino} → backend no disponible: ${(error as Error)?.name || "error"}`);
        if ((error as Error)?.name === "TimeoutError") return NextResponse.json({ ok: false, motivo: "tiempo_agotado" }, { status: 504, headers: CABECERAS });
        return NextResponse.json({ ok: false, motivo: "backend_no_disponible" }, { status: 502, headers: CABECERAS });
    }
}

type Contexto = { params: Promise<{ ruta?: string[] }> };

export async function GET(req: Request, { params }: Contexto) { return reenviar("GET", req, params); }
export async function POST(req: Request, { params }: Contexto) { return reenviar("POST", req, params); }
export async function PATCH(req: Request, { params }: Contexto) { return reenviar("PATCH", req, params); }
export async function DELETE(req: Request, { params }: Contexto) { return reenviar("DELETE", req, params); }
