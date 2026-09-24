import { NextResponse } from "next/server";

const API = process.env.BOT_API_URL || "http://127.0.0.1:4000";

// Lecturas del panel privado de analítica. Proxy estricto hacia backend
// /analitica/* — solo las rutas y parámetros de esta lista blanca. Reenvía
// el "Authorization: Bearer <access_token>" de Supabase Auth del
// navegador; el backend lo verifica y exige que el usuario esté en
// public.analitica_admins. Sin eso, todo responde 404.
//
//   GET /api/analitica-privada/verificar
//   GET /api/analitica-privada/resumen       ?preset&desde&hasta
//   GET /api/analitica-privada/activos
//   GET /api/analitica-privada/historial     ?preset&desde&hasta&limite&offset
//   GET /api/analitica-privada/sesiones/:id

const CABECERAS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

const PARAMETROS = ["preset", "desde", "hasta", "limite", "offset"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noEncontrado() {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CABECERAS });
}

function destino(ruta: string[]): string | null {
    if (ruta.length === 1 && ["verificar", "resumen", "activos", "historial"].includes(ruta[0])) return `/${ruta[0]}`;
    if (ruta.length === 2 && ruta[0] === "sesiones" && UUID.test(ruta[1])) return `/sesiones/${ruta[1]}`;
    return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ ruta: string[] }> }) {

    const { ruta } = await params;
    const camino = destino(ruta);
    const autorizacion = req.headers.get("authorization");

    if (!camino || !autorizacion) return noEncontrado();

    const entrada = new URL(req.url).searchParams;
    const salida = new URLSearchParams();

    for (const nombre of PARAMETROS) {
        const valor = entrada.get(nombre);
        if (valor !== null && valor.length <= 40) salida.set(nombre, valor);
    }

    const query = salida.toString();

    try {

        const res = await fetch(`${API}/analitica${camino}${query ? `?${query}` : ""}`, {
            headers: { Authorization: autorizacion },
            cache: "no-store",
            signal: AbortSignal.timeout(10000)
        });

        if (res.status === 404) return noEncontrado();

        const datos = await res.json().catch(() => null);
        return NextResponse.json(datos, { status: res.status, headers: CABECERAS });

    } catch {

        return NextResponse.json({ ok: false }, { status: 502, headers: CABECERAS });

    }

}
