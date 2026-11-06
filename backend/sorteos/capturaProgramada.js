// ==========================================================================
// sorteos/capturaProgramada.js — LA imagen de publicación de un sorteo.
//
// Fuente ÚNICA de la imagen que el publicador (publicador.js →
// dependenciasReales().capturarImagen) envía en CUALQUIER publicación de un
// sorteo: instantáneo, programado, reintentos, grupos nuevos (desde
// «Compartir» o «Editar»), y lo tome el ciclo automático o una petición del
// panel. La imagen siempre es una captura hecha EN EL NAVEGADOR con
// frontend/services/tablas/capturarTabla.ts (la función del botón
// «Compartir»), y la guarda aquí la entrada que la capturó, ANTES de pedir
// la publicación:
//
//   - «Confirmar y programar» / «Publicar ahora» / «Reintentar»: la vista
//     previa (TablaImprimible con los números de vistaPrevia) + su huella.
//   - «Compartir» en Tablas con grupos nuevos: la captura de la cuadrícula +
//     la huella de la tabla en ese momento.
//
// Al publicar se usa SOLO si es de la versión confirmada del sorteo y la
// tabla sigue como estaba al capturarla (misma huella: libres, ocupados y
// pagados). Si no, no se publica una imagen desactualizada (ni anterior a un
// reinicio): el grupo queda en revisión y «Reintentar» vuelve a capturar.
// El servidor nunca genera la imagen de una publicación (sin Chromium).
//
// Dónde: disco del servidor del backend (sin migración):
//   <dir>/<sorteoId>.json            ficha { version, huella, archivo, sha256 }
//   <dir>/<sorteoId>-<sha16>.png     la imagen (nombre según su contenido)
// La ficha se escribe la última y de forma atómica: dos guardados a la vez
// nunca dejan una ficha que apunte a otra imagen. <dir> = EFAAT_CAPTURAS_DIR
// o backend/data/capturas-sorteos.
// ==========================================================================

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ID_VALIDO = /^[0-9A-Za-z-]{1,64}$/;
// Archivos sin tocar durante este tiempo se borran al guardar otra imagen.
const VIDA_MAXIMA_MS = 45 * 24 * 60 * 60 * 1000;

function directorio() {
    if (process.env.EFAAT_CAPTURAS_DIR) return process.env.EFAAT_CAPTURAS_DIR;
    // Pruebas (EFAAT_PRUEBAS=1): nunca dentro del repositorio.
    if (process.env.EFAAT_PRUEBAS === "1") return path.join(require("os").tmpdir(), `efaat-capturas-pruebas-${process.pid}`);
    return path.join(__dirname, "..", "data", "capturas-sorteos");
}

const sha256 = (datos) => crypto.createHash("sha256").update(datos).digest("hex");

// Huella de lo que pinta la imagen: qué números están libres, ocupados y
// pagados (el diseño y el perfil van ligados a la versión confirmada).
function huellaNumeros(numeros) {
    const orden = (lista) => [...(lista || [])].map(String).sort();
    return sha256(JSON.stringify({
        d: orden(numeros?.numerosDisponibles),
        o: orden(numeros?.numerosOcupados),
        p: orden(numeros?.numerosPagados)
    }));
}

function validarId(sorteoId) {
    if (!ID_VALIDO.test(String(sorteoId || ""))) throw new Error("Identificador de sorteo no válido para su imagen.");
    return String(sorteoId);
}

// Escritura atómica: nunca queda un archivo a medias que se pueda leer.
// En Windows dos renombres simultáneos sobre el mismo destino pueden dar
// EPERM/EBUSY/EACCES momentáneos (en Linux el rename es atómico): se reintenta.
async function escribir(ruta, datos) {
    const temporal = `${ruta}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    // Solo el usuario del proceso (PM2) puede leerla o escribirla.
    await fs.writeFile(temporal, datos, { mode: 0o600 });
    for (let intento = 0; ; intento++) {
        try {
            await fs.rename(temporal, ruta);
            return;
        } catch (err) {
            if (intento >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(err?.code)) {
                await fs.unlink(temporal).catch(() => {});
                throw err;
            }
            await new Promise(res => setTimeout(res, 10 + Math.random() * 20));
        }
    }
}

async function limpiarAntiguas(dir, ahora) {
    let nombres = [];
    try { nombres = await fs.readdir(dir); } catch { return; }
    for (const n of nombres) {
        try {
            const ruta = path.join(dir, n);
            const st = await fs.stat(ruta);
            if (ahora - st.mtimeMs > VIDA_MAXIMA_MS) await fs.unlink(ruta);
        } catch { /* best-effort */ }
    }
}

// Guarda (o sustituye) la imagen de un sorteo. Lanza si no se pudo.
async function guardar(sorteoId, { version, huella, png, origen = null }) {
    const id = validarId(sorteoId);
    if (!Buffer.isBuffer(png) || !png.length) throw new Error("Imagen vacía.");
    if (!Number.isInteger(Number(version)) || typeof huella !== "string" || !huella) throw new Error("Faltan la versión o la huella de la imagen.");
    const dir = directorio();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const sha = sha256(png);
    const archivo = `${id}-${sha.slice(0, 16)}.png`;
    await escribir(path.join(dir, archivo), png);
    await escribir(path.join(dir, `${id}.json`), JSON.stringify({
        sorteo_id: id, version: Number(version), huella, archivo, sha256: sha, bytes: png.length, origen, guardado_en: new Date().toISOString()
    }));
    limpiarAntiguas(dir, Date.now()).catch(() => {});
}

// -> { version, huella, png, origen, guardado_en } | null (no hay, o no es íntegra)
async function leer(sorteoId) {
    let id;
    try { id = validarId(sorteoId); } catch { return null; }
    try {
        const dir = directorio();
        const ficha = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8"));
        if (!/^[0-9A-Za-z-]+-[0-9a-f]{16}\.png$/.test(String(ficha.archivo)) || !String(ficha.archivo).startsWith(`${id}-`)) return null;
        const png = await fs.readFile(path.join(dir, ficha.archivo));
        if (sha256(png) !== ficha.sha256) return null;
        return { version: Number(ficha.version), huella: ficha.huella, png, origen: ficha.origen || null, guardado_en: ficha.guardado_en || null };
    } catch {
        return null;
    }
}

// Error que repetir no arregla: el publicador deja el grupo en revisión.
function errorRevision(mensaje, tipo) {
    return Object.assign(new Error(mensaje), { revision: true, tipo });
}

const leerNumerosReal = (tabla, usuarioId) => require("../automation/repo/tablaEvento").obtenerNumeros(tabla, usuarioId);

// Huella de la tabla del sorteo AHORA.
async function huellaActual(sorteo, { obtenerNumeros = null } = {}) {
    return huellaNumeros(await (obtenerNumeros || leerNumerosReal)(sorteo.tabla, sorteo.usuario_id));
}

// La imagen guardada del sorteo, solo si sigue siendo la de su tabla.
async function imagenDelSorteo(sorteo, opciones = {}) {

    const guardada = await leer(sorteo.id);

    if (!guardada || guardada.version !== Number(sorteo.confirmado_version)) {
        throw errorRevision("no hay imagen de la tabla para la versión confirmada de este sorteo (se confirmó sin ella o se editó después). Pulsa «Reintentar» para revisar la tabla y publicar con una imagen nueva.", "sin_captura");
    }

    if ((await huellaActual(sorteo, opciones)) !== guardada.huella) {
        throw errorRevision("la tabla cambió desde que se capturó la imagen (reservas, pagos, liberaciones o reinicio) y no se publica una imagen desactualizada. Pulsa «Reintentar» para revisar la tabla actual y publicar con una imagen nueva.", "tabla_cambiada");
    }

    return guardada.png;

}

// Dependencia `capturarImagen` del publicador: toda publicación de un
// sorteo usa su imagen guardada. Sin sorteo no hay publicación que hacer.
async function capturarParaPublicar(_precio, _usuarioId, _eventoId = null, contexto = {}) {
    if (!contexto?.sorteo) throw errorRevision("falta el sorteo de la publicación.", "sin_sorteo");
    return imagenDelSorteo(contexto.sorteo);
}

module.exports = { huellaNumeros, huellaActual, guardar, leer, imagenDelSorteo, imagenProgramada: imagenDelSorteo, capturarParaPublicar, directorio };
