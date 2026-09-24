// ==========================================================================
// Recolector de visitas — 100% invisible.
//
// Lo carga frontend/instrumentation-client.ts (convención de Next 16 que se
// ejecuta en todas las páginas SIN pasar por layouts ni componentes). Este
// archivo NO renderiza nada, NO toca el DOM, NO añade estilos ni muestra
// mensajes: solo escucha eventos del navegador y envía JSON a /api/e.
// Cualquier error se traga — la analítica jamás puede romper el panel.
//
// Estrategia de escrituras:
//   - page_view  al cargar y en cada cambio de ruta (onRouterTransitionStart)
//   - heartbeat  cada 60 s SOLO si la pestaña está visible y hubo
//                interacción en los últimos 5 min (el servidor además lo
//                throttlea a 1 escritura / 30 s por sesión)
//   - idle       una vez, tras 5 min sin interacción
//   - exit       en pagehide, solo si es la última pestaña abierta
//
// Identificadores (localStorage, anónimos y aleatorios):
//   _efa_v  visitor_id
//   _efa_s  { id, u } sesión compartida entre pestañas + última actividad;
//           tras 30 min sin actividad se genera una sesión nueva
//   _efa_t:<pestaña>  último latido de cada pestaña abierta (para no marcar "exit" si
//           queda otra pestaña abierta)
// ==========================================================================

const ENDPOINT = "/api/e";

const K_VISITANTE = "_efa_v";
const K_SESION = "_efa_s";
const K_PESTANAS = "_efa_t";

const TIMEOUT_SESION_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const ACTIVIDAD_MS = 5 * 60 * 1000;
const PESTANA_VIVA_MS = 150 * 1000;

type Tipo = "page_view" | "heartbeat" | "idle" | "exit";

let iniciado = false;
let visitante = "";
let pestana = "";
let paginaActual = "";
let primerPageView = true;
let ultimaInteraccion = Date.now();
let idleEnviado = false;

function uuid(): string {

    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

}

function leer<T>(clave: string): T | null {
    try {
        const v = localStorage.getItem(clave);
        return v ? (JSON.parse(v) as T) : null;
    } catch {
        return null;
    }
}

function escribir(clave: string, valor: unknown) {
    try {
        localStorage.setItem(clave, JSON.stringify(valor));
    } catch {
        // Modo privado / almacenamiento bloqueado: se sigue sin persistir.
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function obtenerVisitante(): string {
    const v = leer<string>(K_VISITANTE);
    if (typeof v === "string" && UUID.test(v)) return v;
    const nuevo = uuid();
    escribir(K_VISITANTE, nuevo);
    return nuevo;
}

// Sesión vigente (compartida entre pestañas); caducada -> nueva.
function obtenerSesion(ahora: number): string {
    const s = leer<{ id: string; u: number }>(K_SESION);
    if (s && typeof s.id === "string" && UUID.test(s.id) && typeof s.u === "number" && ahora - s.u < TIMEOUT_SESION_MS) {
        return s.id;
    }
    const nueva = uuid();
    escribir(K_SESION, { id: nueva, u: ahora });
    return nueva;
}

function sesionCaducada(ahora: number): boolean {
    const s = leer<{ id: string; u: number }>(K_SESION);
    return !s || typeof s.u !== "number" || ahora - s.u >= TIMEOUT_SESION_MS;
}

function tocarSesion(id: string, ahora: number) {
    escribir(K_SESION, { id, u: ahora });
}

// Una clave por pestaña (_efa_t:<id> = último latido): cada pestaña solo
// escribe la suya, así varias pestañas abiertas a la vez no se pisan.
// Devuelve cuántas pestañas siguen vivas (incluida esta si `viva`).
function marcarPestana(viva: boolean) {
    const ahora = Date.now();
    const propia = `${K_PESTANAS}:${pestana}`;
    try {
        if (viva) localStorage.setItem(propia, String(ahora));
        else localStorage.removeItem(propia);
        let vivas = 0;
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(`${K_PESTANAS}:`)) continue;
            const ts = Number(localStorage.getItem(k));
            if (!ts || ahora - ts > PESTANA_VIVA_MS) localStorage.removeItem(k);
            else vivas++;
        }
        return vivas;
    } catch {
        // Sin almacenamiento no se puede saber si hay otras pestañas.
        return viva ? 1 : 0;
    }
}

function enviar(tipo: Tipo, pagina = paginaActual, beacon = false) {

    try {

        const ahora = Date.now();
        const sesion = obtenerSesion(ahora);

        // idle/exit no son actividad: no alargan la sesión.
        if (tipo === "page_view" || tipo === "heartbeat") tocarSesion(sesion, ahora);

        const cuerpo: Record<string, unknown> = {
            t: tipo,
            v: visitante,
            s: sesion,
            p: pagina || "/"
        };

        const ancho = Math.round(screen?.width || 0);
        const alto = Math.round(screen?.height || 0);
        if (ancho > 0 && alto > 0) {
            cuerpo.w = ancho;
            cuerpo.h = alto;
        }

        const tactil = navigator.maxTouchPoints;
        if (Number.isInteger(tactil) && tactil >= 0 && tactil <= 32) cuerpo.tc = tactil;

        // Referrer solo en la primera página de la carga y solo si es externo.
        if (tipo === "page_view" && primerPageView) {
            primerPageView = false;
            try {
                if (document.referrer && new URL(document.referrer).origin !== location.origin) {
                    cuerpo.r = document.referrer;
                }
            } catch {
                // referrer ilegible: se omite
            }
        }

        const json = JSON.stringify(cuerpo);

        if (beacon && typeof navigator.sendBeacon === "function") {
            // text/plain: tipo "simple", el navegador no bloquea el beacon.
            navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "text/plain;charset=UTF-8" }));
            return;
        }

        fetch(ENDPOINT, {
            method: "POST",
            body: json,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            keepalive: true,
            credentials: "same-origin",
            cache: "no-store"
        })
            .then(r => (r.ok ? r.json() : null))
            .then((d: { s?: string } | null) => {
                // El servidor puede rotar la sesión (caducada): adoptar su id.
                if (d && typeof d.s === "string" && UUID.test(d.s) && d.s !== sesion) {
                    tocarSesion(d.s, Date.now());
                }
            })
            .catch(() => {});

    } catch {
        // Nunca propagar.
    }

}

// Vuelta a la pestaña o interacción tras un rato: sesión nueva si caducó,
// si no un heartbeat (que en el servidor reanuda una sesión "idle").
function reactivar() {
    const ahora = Date.now();
    ultimaInteraccion = ahora;
    if (sesionCaducada(ahora)) {
        idleEnviado = false;
        enviar("page_view");
    } else if (idleEnviado) {
        idleEnviado = false;
        enviar("heartbeat");
    }
}

function alInteractuar() {
    if (idleEnviado || Date.now() - ultimaInteraccion > ACTIVIDAD_MS) reactivar();
    else ultimaInteraccion = Date.now();
}

function tick() {
    try {
        marcarPestana(true);
        if (document.visibilityState !== "visible") return;
        if (Date.now() - ultimaInteraccion <= ACTIVIDAD_MS) {
            enviar("heartbeat");
        } else if (!idleEnviado) {
            idleEnviado = true;
            enviar("idle");
        }
    } catch {
        // ignorar
    }
}

export function iniciar() {

    try {

        if (iniciado || typeof window === "undefined") return;
        iniciado = true;

        // Navegadores automatizados (p. ej. Puppeteer de compartirTabla.js).
        if (navigator.webdriver) return;

        visitante = obtenerVisitante();
        pestana = uuid();
        paginaActual = location.pathname;

        marcarPestana(true);
        enviar("page_view");

        const opciones = { passive: true, capture: true } as const;
        for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "pointermove"]) {
            window.addEventListener(ev, alInteractuar, opciones);
        }

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reactivar();
        });

        window.addEventListener("pagehide", () => {
            try {
                const quedan = marcarPestana(false);
                if (quedan === 0) enviar("exit", paginaActual, true);
            } catch {
                // ignorar
            }
        });

        // Volver con atrás/adelante desde la bfcache.
        window.addEventListener("pageshow", (e) => {
            if (e.persisted) {
                marcarPestana(true);
                reactivar();
            }
        });

        setInterval(tick, HEARTBEAT_MS);

    } catch {
        // La analítica nunca debe afectar al panel.
    }

}

// Navegación SPA (Link, router.push/replace, atrás/adelante).
export function navegacion(url: string) {

    try {

        if (!iniciado || !visitante) return;

        const ruta = new URL(url, location.href).pathname;

        // Solo cambió la query string o el hash: misma página.
        if (ruta === paginaActual) return;

        paginaActual = ruta;
        ultimaInteraccion = Date.now();
        idleEnviado = false;
        enviar("page_view", ruta);

    } catch {
        // ignorar
    }

}
