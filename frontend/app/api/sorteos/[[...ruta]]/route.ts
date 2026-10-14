import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy estricto hacia backend /sorteos/* (sorteos programados, plantillas
// y cuentas de pago). Reenvía el "Authorization: Bearer <access_token>" de
// Supabase Auth del navegador y añade el token de servicio (solo servidor).
// El backend valida la sesión y saca el usuario DEL TOKEN: este proxy no
// envía ni decide ningún usuarioId. Rutas fuera de la lista blanca -> 404.

const CABECERAS = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Metodo = "GET" | "POST" | "PUT" | "PATCH";

function destino(metodo: Metodo, ruta: string[]): string | null {

    const [a, b, c] = ruta;

    if (ruta.length === 0) return metodo === "GET" || metodo === "POST" ? "" : null;

    if (ruta.length === 1) {
        if (a === "grupos") return metodo === "GET" ? "/grupos" : null;
        if (a === "plantillas" || a === "cuentas" || a === "loterias") return metodo === "GET" || metodo === "POST" ? `/${a}` : null;
        if (UUID.test(a)) return metodo === "GET" || metodo === "PUT" ? `/${a}` : null;
        return null;
    }

    if (ruta.length === 2) {
        if ((a === "plantillas" || a === "cuentas" || a === "loterias") && UUID.test(b)) return metodo === "PATCH" ? `/${a}/${b}` : null;
        if (UUID.test(a) && b === "vista-previa") return metodo === "GET" ? `/${a}/vista-previa` : null;
        if (UUID.test(a) && (b === "confirmar" || b === "cancelar")) return metodo === "POST" ? `/${a}/${b}` : null;
        return null;
    }

    if (ruta.length === 3 && a === "loterias" && UUID.test(b) && c === "horario") {
        return metodo === "GET" ? `/loterias/${b}/horario` : null;
    }

    if (ruta.length === 3 && UUID.test(a) && b === "grupos" && c === "reintentar") {
        return metodo === "POST" ? `/${a}/grupos/reintentar` : null;
    }

    return null;

}

async function reenviar(metodo: Metodo, req: Request, params: Promise<{ ruta?: string[] }>) {

    const { ruta = [] } = await params;
    const camino = destino(metodo, ruta);
    const autorizacion = req.headers.get("authorization");

    if (camino === null) return NextResponse.json({ ok: false, motivo: "no_encontrado" }, { status: 404, headers: CABECERAS });
    if (!autorizacion) return NextResponse.json({ ok: false, motivo: "sin_sesion" }, { status: 401, headers: CABECERAS });

    let cuerpo: string | undefined;

    if (metodo !== "GET") {
        const texto = await req.text();
        if (texto.length > 64 * 1024) return NextResponse.json({ ok: false, motivo: "demasiado_grande" }, { status: 413, headers: CABECERAS });
        cuerpo = texto || "{}";
    }

    try {

        // Único parámetro de consulta reenviado: la fecha del horario.
        const fecha = new URL(req.url).searchParams.get("fecha");
        const consulta = camino.endsWith("/horario") && fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `?fecha=${fecha}` : "";

        const res = await fetch(`${API}/sorteos${camino}${consulta}`, {
            method: metodo,
            headers: botApiHeaders({ Authorization: autorizacion, "Content-Type": "application/json" }),
            body: cuerpo,
            cache: "no-store",
            signal: AbortSignal.timeout(20000)
        });

        const datos = await res.json().catch(() => ({ ok: false, motivo: "respuesta_invalida" }));
        return NextResponse.json(datos, { status: res.status, headers: CABECERAS });

    } catch {

        return NextResponse.json({ ok: false, motivo: "backend_no_disponible" }, { status: 502, headers: CABECERAS });

    }

}

type Contexto = { params: Promise<{ ruta?: string[] }> };

export async function GET(req: Request, { params }: Contexto) { return reenviar("GET", req, params); }
export async function POST(req: Request, { params }: Contexto) { return reenviar("POST", req, params); }
export async function PUT(req: Request, { params }: Contexto) { return reenviar("PUT", req, params); }
export async function PATCH(req: Request, { params }: Contexto) { return reenviar("PATCH", req, params); }
