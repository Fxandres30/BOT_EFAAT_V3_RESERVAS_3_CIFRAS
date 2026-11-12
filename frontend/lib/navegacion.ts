// Navegación de entrada al panel.
//
// RUTA_INICIO: sección a la que se entra al abrir la aplicación, iniciar
// sesión o registrarse (Reservas).
//
// rutaVolverSegura: valida el parámetro «volver» que la guardia del panel
// añade al mandar a /login, para regresar al enlace directo tras iniciar
// sesión. Solo acepta rutas internas del panel privado (lista blanca): nunca
// otro dominio («//evil.com», «https://…», «/\evil.com»), ni el login, el
// registro o la entrada /app (evita bucles). No concede ningún acceso: la
// página de destino sigue protegida por la guardia del panel, la RLS y el
// backend, igual que si se abriera escribiendo la dirección.

export const RUTA_INICIO = "/tablas";

// Secciones privadas (las que usan DashboardLayout). Se acepta la ruta exacta
// o cualquier subruta.
const SECCIONES_PANEL = [
    "/tablas",
    "/sesiones",
    "/mensajes",
    "/variables-globales",
    "/contactos",
    "/chats",
    "/eventos",
    "/sorteos",
    "/sorteo-instantaneo",
    "/loterias",
    "/automatizacion",
    "/lector-pagos",
    "/bloqueados",
    "/mi-cuenta",
    "/aprende",
];

const LONGITUD_MAXIMA = 512;
const BASE = "http://efaat.invalid";

export function rutaVolverSegura(valor: string | null | undefined): string | null {

    if (typeof valor !== "string" || !valor || valor.length > LONGITUD_MAXIMA) return null;
    // Solo rutas relativas a este sitio: «/x», nunca «//x» ni «/\x».
    if (valor[0] !== "/" || valor[1] === "/" || valor.includes("\\")) return null;
    // Sin caracteres de control (saltos de línea, tabuladores…).
    if (/[\u0000-\u001f\u007f]/.test(valor)) return null;

    let url: URL;
    try {
        url = new URL(valor, BASE);
    } catch {
        return null;
    }
    if (url.origin !== BASE) return null;

    // Se valida la ruta YA normalizada («/tablas/../login» -> «/login»).
    const ruta = url.pathname;
    const permitida = SECCIONES_PANEL.some((s) => ruta === s || ruta.startsWith(`${s}/`));
    if (!permitida) return null;

    return ruta + url.search + url.hash;

}

// Destino tras iniciar sesión a partir de la dirección actual (?volver=…).
export function destinoTrasLogin(search: string): string {
    return rutaVolverSegura(new URLSearchParams(search).get("volver")) ?? RUTA_INICIO;
}

// Dirección de /login que conserva la página privada actual para volver a
// ella. Si la página no es válida o es la de inicio, /login sin parámetros.
export function loginConVolver(rutaActual: string): string {
    const volver = rutaVolverSegura(rutaActual);
    return volver && volver !== RUTA_INICIO ? `/login?volver=${encodeURIComponent(volver)}` : "/login";
}
