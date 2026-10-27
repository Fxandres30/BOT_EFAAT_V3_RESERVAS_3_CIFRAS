import { NextResponse } from "next/server";
import { botApiHeaders } from "@/lib/botApi";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Proxy estricto hacia backend /sorteos/* (sorteos programados, plantillas
// y cuentas de pago). Reenvía el "Authorization: Bearer <access_token>" de
// Supabase Auth del navegador y añade el token de servicio (solo servidor).
// El backend valida la sesión y saca el usuario DEL TOKEN: este proxy no
// envía ni decide ningún usuarioId. Rutas fuera de la lista blanca -> 404.

const CABECERAS = { "Cache-Control": "no-store" };
const BOT_API_HOST = (() => { try { return new URL(API).host; } catch { return "BOT_API_URL inválida"; } })();

// Registro (servidor del panel) de cada respuesta fallida del backend, con su
// categoría. Nunca incluye tokens, sesiones ni datos de clientes.
function categoriaFallo(status: number, motivo: string): string {
    if (motivo === "respuesta_invalida") return status === 404 ? "ruta inexistente en el backend (¿backend sin este código?)" : "respuesta no JSON del backend";
    if (motivo === "TOKEN_SERVICIO_NO_CONFIGURADO") return "configuración: el backend no tiene token de servicio";
    if (motivo === "NO_AUTORIZADO") return "configuración: token de servicio distinto entre panel y backend";
    if (motivo === "sin_sesion" || motivo === "sesion_invalida") return "autenticación: sesión del usuario rechazada";
    if (motivo === "migracion_pendiente") return "base de datos: falta una migración";
    if (motivo === "error_supabase") return "base de datos: error al consultar";
    if (status >= 500) return "error interno del backend";
    return "solicitud rechazada";
}

function registrarFallo(metodo: string, camino: string, status: number, datos: { motivo?: string; code?: string }) {
    const motivo = datos?.motivo || datos?.code || "desconocido";
    const log = status >= 500 || status === 401 || motivo === "respuesta_invalida" ? console.error : console.warn;
    log(`❌ [PROXY SORTEOS] ${metodo} ${camino} → HTTP ${status} · ${motivo} · ${categoriaFallo(status, motivo)}`);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function destino(metodo: Metodo, ruta: string[]): string | null {

    const [a, b, c] = ruta;

    if (ruta.length === 0) return metodo === "GET" || metodo === "POST" ? "" : null;

    if (ruta.length === 1) {
        if (a === "grupos") return metodo === "GET" ? "/grupos" : null;
        // Sorteos activos de cualquier origen (bot o panel).
        if (a === "activos") return metodo === "GET" ? "/activos" : null;
        // Programados con estados, impacto y acciones permitidas.
        if (a === "gestion") return metodo === "GET" ? "/gestion" : null;
        // Sorteos en los grupos (activos y recientes) para administrarlos.
        if (a === "eventos") return metodo === "GET" ? "/eventos" : null;
        if (a === "plantillas" || a === "cuentas" || a === "loterias") return metodo === "GET" || metodo === "POST" ? `/${a}` : null;
        if (UUID.test(a)) return metodo === "GET" || metodo === "PUT" ? `/${a}` : null;
        return null;
    }

    if (ruta.length === 2) {
        if (a === "activos" && UUID.test(b)) return metodo === "GET" || metodo === "PUT" ? `/activos/${b}` : null;
        if (a === "loterias" && UUID.test(b)) return metodo === "PATCH" || metodo === "DELETE" ? `/${a}/${b}` : null;
        if ((a === "plantillas" || a === "cuentas") && UUID.test(b)) return metodo === "PATCH" ? `/${a}/${b}` : null;
        if (UUID.test(a) && b === "vista-previa") return metodo === "GET" ? `/${a}/vista-previa` : null;
        if (UUID.test(a) && b === "detalle") return metodo === "GET" ? `/${a}/detalle` : null;
        if (UUID.test(a) && (b === "confirmar" || b === "cancelar" || b === "eliminar" || b === "archivar")) return metodo === "POST" ? `/${a}/${b}` : null;
        return null;
    }

    if (ruta.length === 3 && a === "loterias" && UUID.test(b) && c === "horario") {
        return metodo === "GET" ? `/loterias/${b}/horario` : null;
    }

    // Cerrar, reabrir, desactivar, cancelar o eliminar un sorteo en los grupos.
    if (ruta.length === 3 && a === "eventos" && UUID.test(b) && c === "accion") {
        return metodo === "POST" ? `/eventos/${b}/accion` : null;
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

    if (metodo !== "GET" && metodo !== "DELETE") {
        const texto = await req.text();
        if (texto.length > 64 * 1024) return NextResponse.json({ ok: false, motivo: "demasiado_grande" }, { status: 413, headers: CABECERAS });
        cuerpo = texto || "{}";
    }

    try {

        // Parámetros reenviados: la fecha del horario y el precio de los
        // sorteos activos (solo dígitos).
        const params = new URL(req.url).searchParams;
        const fecha = params.get("fecha");
        const precio = params.get("precio");
        const consulta = camino.endsWith("/horario") && fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
            ? `?fecha=${fecha}`
            : camino === "/activos" && precio && /^\d{1,7}$/.test(precio) ? `?precio=${precio}` : "";

        const res = await fetch(`${API}/sorteos${camino}${consulta}`, {
            method: metodo,
            headers: botApiHeaders({ Authorization: autorizacion, "Content-Type": "application/json" }),
            body: cuerpo,
            cache: "no-store",
            signal: AbortSignal.timeout(20000)
        });

        const datos = await res.json().catch(() => ({ ok: false, motivo: "respuesta_invalida" }));
        if (!res.ok) registrarFallo(metodo, camino, res.status, datos);
        return NextResponse.json(datos, { status: res.status, headers: CABECERAS });

    } catch (error) {

        console.error(`❌ [PROXY SORTEOS] ${metodo} ${camino} → backend no disponible (${BOT_API_HOST}): ${(error as Error)?.name || "error"}`);
        return NextResponse.json({ ok: false, motivo: "backend_no_disponible" }, { status: 502, headers: CABECERAS });

    }

}

type Contexto = { params: Promise<{ ruta?: string[] }> };

export async function GET(req: Request, { params }: Contexto) { return reenviar("GET", req, params); }
export async function POST(req: Request, { params }: Contexto) { return reenviar("POST", req, params); }
export async function PUT(req: Request, { params }: Contexto) { return reenviar("PUT", req, params); }
export async function PATCH(req: Request, { params }: Contexto) { return reenviar("PATCH", req, params); }
export async function DELETE(req: Request, { params }: Contexto) { return reenviar("DELETE", req, params); }
