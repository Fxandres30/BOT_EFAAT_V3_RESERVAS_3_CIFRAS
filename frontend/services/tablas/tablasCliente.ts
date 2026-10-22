import { supabase } from "@/lib/supabase";
import { TABLAS_CONFIG, type TablaConfig } from "@/lib/tablasConfig";

// Qué precios ofrece EL CLIENTE de la sesión y en qué tabla física vive cada
// uno (tablas_cliente, migración 027). Espejo de
// backend/bot/funciones/eventos/tablasCliente.js:
//   - sin la migración, sin inicializar o si la lectura falla -> la
//     configuración base de lib/tablasConfig.ts (lo de siempre);
//   - si no, sus configuraciones ACTIVAS.
// El aislamiento entre clientes no depende de esto: lo dan el filtro
// usuario_id de cada consulta y la RLS (Parte A). La RLS de tablas_cliente
// además solo devuelve las filas del usuario de la sesión.

export interface ConfiguracionTabla extends TablaConfig {
    precio: number;
}

const BASE: ConfiguracionTabla[] = Object.entries(TABLAS_CONFIG)
    .map(([precio, c]) => ({ precio: Number(precio), ...c }))
    .sort((a, b) => a.precio - b.precio);

// Una lectura por usuario cada minuto como mucho: la tabla se recarga en
// cada cambio en tiempo real y la configuración casi nunca cambia.
const VIGENCIA_MS = 60_000;
const cache = new Map<string, { hasta: number; lista: Promise<ConfiguracionTabla[]> }>();

async function leer(usuarioId: string): Promise<ConfiguracionTabla[]> {

    const { data, error } = await supabase
        .from("tablas_cliente")
        .select("precio, tabla_fisica, cifras, cantidad, activa")
        .eq("usuario_id", usuarioId)
        .order("precio", { ascending: true });

    if (error || !data || data.length === 0) return BASE;

    return data
        .filter((f) => f.activa !== false)
        .map((f) => ({ precio: Number(f.precio), tabla: f.tabla_fisica, cifras: f.cifras, cantidad: f.cantidad }));

}

export async function obtenerTablasCliente(usuarioId: string | null | undefined): Promise<ConfiguracionTabla[]> {

    if (!usuarioId) return [];

    const ahora = Date.now();
    const vigente = cache.get(usuarioId);
    if (vigente && vigente.hasta > ahora) return vigente.lista;

    const lista = leer(usuarioId).catch(() => BASE);
    cache.set(usuarioId, { hasta: ahora + VIGENCIA_MS, lista });
    return lista;

}

export async function obtenerTablaConfigCliente(precio: number, usuarioId: string | null | undefined): Promise<TablaConfig | null> {

    const c = (await obtenerTablasCliente(usuarioId)).find((x) => x.precio === precio);

    return c ? { tabla: c.tabla, cifras: c.cifras, cantidad: c.cantidad } : null;

}

// Tras inicializar o editar la configuración.
export function olvidarTablasCliente(usuarioId?: string) {
    if (usuarioId) cache.delete(usuarioId);
    else cache.clear();
}
