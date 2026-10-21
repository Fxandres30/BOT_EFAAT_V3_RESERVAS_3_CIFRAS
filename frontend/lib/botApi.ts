// Cabeceras para llamar al backend del bot desde las rutas API de Next
// (código de SERVIDOR únicamente).
//
// BOT_API_TOKEN no lleva el prefijo NEXT_PUBLIC_, así que Next nunca lo
// incluye en el bundle del navegador. Debe coincidir con SESSIONS_API_TOKEN
// del backend (ver backend/middleware/tokenServicio.js).
//
// Si el panel no tiene BOT_API_TOKEN pero el backend desplegado en la MISMA
// máquina (carpeta ../backend del repositorio) tiene SESSIONS_API_TOKEN en
// su .env, se usa ese valor: es el mismo secreto compartido. Nunca se loguea.
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { llamarBot } from "./llamarBot";

let descubierto: string | null | undefined;

function tokenDelBackend(): string | null {

    try {
        const texto = fs.readFileSync(path.join(process.cwd(), "..", "backend", ".env"), "utf8");
        const m = texto.match(/^\s*SESSIONS_API_TOKEN\s*=\s*(.+?)\s*$/m);
        return m ? m[1].replace(/^(['"])(.*)\1$/, "$2") || null : null;
    } catch {
        return null;
    }

}

function tokenServicio(): string | null {

    if (process.env.BOT_API_TOKEN) return process.env.BOT_API_TOKEN;

    if (descubierto === undefined) {
        descubierto = tokenDelBackend();
        if (descubierto) console.warn("⚠️ [PANEL] BOT_API_TOKEN no está en el entorno del panel: se usa SESSIONS_API_TOKEN de backend/.env (mismo servidor).");
        else console.error("❌ [PANEL] Sin token de servicio (BOT_API_TOKEN): el backend rechazará las peticiones. Ver docs/activacion/TOKEN_SERVICIO.md.");
    }

    return descubierto;

}

export function botApiHeaders(extra: Record<string, string> = {}): Record<string, string> {

    const token = tokenServicio();

    return token ? { ...extra, "x-service-token": token } : { ...extra };

}

// Igual que botApiHeaders, y además reenvía el "Authorization: Bearer" de la
// sesión de Supabase del navegador: el backend saca de ahí al usuario y
// comprueba que los datos pedidos sean suyos (nunca de un usuarioId enviado
// por el navegador).
export function botApiHeadersDe(req: Request, extra: Record<string, string> = {}): Record<string, string> {

    const autorizacion = req.headers.get("authorization");

    return botApiHeaders(autorizacion ? { ...extra, Authorization: autorizacion } : extra);

}

// Reenvía una petición del panel al backend del bot y devuelve la respuesta
// del bot, SIEMPRE con un límite de espera (ver lib/llamarBot.ts): nunca
// deja colgado al navegador. Mantiene las dos autenticaciones: el token de
// servicio (x-service-token) y la sesión del usuario (Authorization).
// Solo registra la ruta y el código de error, nunca cabeceras ni secretos.
export async function reenviarAlBot(
    req: Request,
    ruta: string,
    { metodo = "GET", cuerpo, timeoutMs }: { metodo?: string; cuerpo?: unknown; timeoutMs?: number } = {}
): Promise<NextResponse> {

    const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

    const { status, cuerpo: respuesta } = await llamarBot(`${API}${ruta}`, {
        method: metodo,
        headers: botApiHeadersDe(req, cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
    }, { timeoutMs });

    if (status >= 500 || status === 401) {
        const datos = (respuesta && typeof respuesta === "object" ? respuesta : {}) as Record<string, unknown>;
        console.error(`❌ [PANEL→BOT] ${metodo} ${ruta.split("?")[0]} → HTTP ${status}${datos.code || datos.motivo ? ` · ${datos.code || datos.motivo}` : ""}`);
    }

    return NextResponse.json(respuesta, { status, headers: { "Cache-Control": "no-store" } });

}

// Cuerpo JSON de la petición del navegador; {} si no es JSON válido.
export async function leerCuerpo(req: Request): Promise<Record<string, unknown>> {
    try {
        const datos = await req.json();
        return datos && typeof datos === "object" ? datos : {};
    } catch {
        return {};
    }
}
