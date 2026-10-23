import type { ActividadReserva, EstadoNumero, NumeroReserva } from "./types";

// ==========================================================================
// «Historial de números» — une el ESTADO ACTUAL de cada número (la fila de
// la tabla física, la misma que pinta la cuadrícula) con los EVENTOS que de
// verdad quedaron registrados. Las dos cosas se presentan por separado: el
// estado actual nunca se deduce de los eventos ni al revés.
//
// Fuentes de eventos (todas filtradas por el cliente de la sesión):
//   auditoria  reservas_auditoria (032): solo la escribe el backend, es
//              inmutable y la fecha la pone la base. Registro fiable.
//   actividad  reservas_actividad (002): la escribe el backend, pero la RLS
//              también deja insertar al panel del propio cliente. Se muestra
//              como «actividad registrada», no como auditoría.
//   archivo    reservas_archivo (030): copia de cada fila liberada al
//              reiniciar la tabla desde un sorteo programado.
//
// Con la auditoría disponible, la actividad que DUPLICA un evento auditado
// (reservas y acciones del panel) se descarta; quedan solo los eventos que
// la auditoría no cubre (pago por sticker del admin, liberación por
// vencimiento).
//
// Nada se inventa: un dato ausente queda en null. Solo imports de tipos.
// ==========================================================================

export type FuenteEvento = "auditoria" | "actividad" | "archivo";

export interface FilaAuditoria {
    id: string;
    origen: "manual" | "bot";
    accion: "reservar" | "pagar" | "liberar" | "desbloquear";
    numero: string;
    grupo_nombre: string | null;
    contacto_nombre: string | null;
    contacto_telefono: string | null;
    // usuarios.id del comprador (misma identidad que usuario_global_id).
    contacto_id: string | null;
    estado_anterior: string | null;
    estado_nuevo: string | null;
    motivo: string | null;
    observaciones: string | null;
    metodo_pago: string | null;
    resultado: "ok" | "rechazado" | "error";
    codigo: string | null;
    operador_email: string | null;
    creado_en: string;
}

export interface FilaArchivo {
    id: string;
    numero: string;
    estado: string;
    nombre_evento: string | null;
    fila: Record<string, unknown> | null;
    motivo: string | null;
    archivado_en: string;
}

export interface EventoHistorial {
    id: string;
    fuente: FuenteEvento;
    titulo: string;
    // Instante real registrado por la base (ISO).
    en: string;
    origen: string | null;
    resultado: "ok" | "rechazado" | "error";
    estadoAnterior: string | null;
    estadoNuevo: string | null;
    cliente: string | null;
    contacto: string | null;
    grupo: string | null;
    detalles: string[];
}

export interface FilaHistorial {
    numero: string;
    estado: EstadoNumero;
    cliente: string | null;
    contacto: string | null;
    grupo: string | null;
    sorteo: string | null;
    // Fecha y hora guardadas en la fila (hora de Colombia), tal cual.
    reserva: { fecha: string; hora: string | null } | null;
    pago: { fecha: string; hora: string | null } | null;
    eventos: EventoHistorial[];
    // Solo para buscar (no se muestra): quién aparece en la reserva actual y
    // en cada movimiento, con la identidad real cuando la fuente la guarda.
    busqueda: FuenteBusqueda[];
}

// Una persona tal como la registró UNA fuente (reserva actual o un
// movimiento). `identidad` = usuarios.id (usuario_global_id de la reserva,
// contacto_id de la auditoría); null si la fuente no la guarda (actividad).
export interface FuenteBusqueda {
    identidad: string | null;
    nombres: string[];
    // Teléfonos canónicos (telefonoCanonico).
    telefonos: string[];
}

// Identidad del directorio de contactos del cliente (GET /contactos).
export interface ContactoIdentidad {
    id: string;
    nombre: string | null;
    telefono: string | null;
}

export interface FuentesHistorial {
    auditoria: FilaAuditoria[];
    auditoriaDisponible: boolean;
    actividad: ActividadReserva[];
    archivo: FilaArchivo[];
    // Opcional: completa nombre y teléfono ACTUALES de las identidades que ya
    // aparecen en esta tabla (p. ej. una reserva hecha cuando la persona solo
    // tenía LID y su teléfono se conoció después).
    contactos?: ContactoIdentidad[];
}

const TITULO_AUDITORIA: Record<FilaAuditoria["accion"], string> = {
    reservar: "Reserva",
    pagar: "Pago registrado",
    liberar: "Liberación",
    desbloquear: "Desbloqueo"
};

const TITULO_ACTIVIDAD: Record<string, string> = {
    reservado: "Reserva",
    pagado: "Pago registrado",
    liberado: "Liberación",
    bloqueado: "Bloqueo",
    cancelado: "Pago anulado"
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Teléfono comparable, con la MISMA regla que el backend
// (identityScanner/normalizarCandidatos.js · limpiarTelefono): parte de
// usuario del JID sin dispositivo (":N") ni agente ("_N"), solo dígitos, y
// "57" + 10 dígitos equivale a los 10 dígitos. Un LID ("…@lid") no es un
// teléfono: null. Un texto con letras (un nombre) tampoco.
export function telefonoCanonico(valor: unknown): string | null {
    const crudo = texto(valor);
    if (!crudo) return null;
    const [usuario, dominio] = crudo.split("@");
    if (dominio && dominio.toLowerCase().startsWith("lid")) return null;
    if (/[a-z]/i.test(usuario)) return null;
    const digitos = usuario.split(":")[0].split("_")[0].replace(/\D/g, "");
    if (digitos.length === 12 && digitos.startsWith("57")) return digitos.slice(2);
    return digitos.length >= 7 && digitos.length <= 15 ? digitos : null;
}

// Contacto que no es teléfono ni JID (texto libre): se busca como un nombre.
const contactoTextual = (v: unknown): string | null => {
    const t = texto(v);
    return t && !t.includes("@") && /[a-z]/i.test(t) ? t : null;
};

function fuenteBusqueda(identidad: unknown, nombres: unknown[], telefonos: unknown[]): FuenteBusqueda {
    return {
        identidad: texto(identidad),
        nombres: [...nombres.map(texto), ...telefonos.map(contactoTextual)].filter(Boolean) as string[],
        telefonos: [...new Set(telefonos.map(telefonoCanonico).filter(Boolean) as string[])]
    };
}

function desdeAuditoria(a: FilaAuditoria): EventoHistorial {
    return {
        id: `auditoria:${a.id}`,
        fuente: "auditoria",
        titulo: TITULO_AUDITORIA[a.accion] || a.accion,
        en: a.creado_en,
        origen: a.origen === "bot" ? "bot" : a.operador_email ? `panel · ${a.operador_email}` : "panel",
        resultado: a.resultado,
        estadoAnterior: a.estado_anterior,
        estadoNuevo: a.estado_nuevo,
        cliente: texto(a.contacto_nombre),
        contacto: texto(a.contacto_telefono),
        grupo: texto(a.grupo_nombre),
        detalles: [
            a.metodo_pago && `Método: ${a.metodo_pago}`,
            a.motivo && `Motivo: ${a.motivo}`,
            a.observaciones && `Observaciones: ${a.observaciones}`,
            a.resultado !== "ok" && a.codigo && `Código: ${a.codigo}`
        ].filter(Boolean) as string[]
    };
}

function origenActividad(realizadoPor: string | null, detalle: Record<string, unknown>): string | null {
    if (detalle.confirmado_via === "sticker_admin") return "sticker del administrador";
    if (realizadoPor === "bot:vencimiento") return "bot · reserva vencida";
    if (realizadoPor?.startsWith("panel:")) return `panel · ${realizadoPor.slice(6)}`;
    return texto(realizadoPor);
}

function desdeActividad(a: ActividadReserva): EventoHistorial {
    const d = a.detalle || {};
    const anterior = texto(d.estadoAnterior);
    return {
        id: `actividad:${a.id}`,
        fuente: "actividad",
        titulo: TITULO_ACTIVIDAD[a.tipo] || a.tipo,
        en: a.creado_en,
        origen: origenActividad(a.realizado_por, d),
        resultado: "ok",
        estadoAnterior: anterior,
        estadoNuevo: a.tipo === "liberado" || a.tipo === "cancelado" ? "libre" : a.tipo === "reservado" || a.tipo === "pagado" || a.tipo === "bloqueado" ? a.tipo : null,
        cliente: texto(d.comprador),
        contacto: texto(d.contacto),
        grupo: texto(d.grupo_nombre),
        detalles: [
            texto(d.metodo_pago) && `Método: ${d.metodo_pago}`,
            d.motivo === "vencimiento" && typeof d.minutos === "number" ? `Venció tras ${d.minutos} min sin pago` : texto(d.motivo) && `Motivo: ${d.motivo}`
        ].filter(Boolean) as string[]
    };
}

function desdeArchivo(a: FilaArchivo): EventoHistorial {
    const f = a.fila || {};
    return {
        id: `archivo:${a.id}`,
        fuente: "archivo",
        titulo: "Archivado al reiniciar la tabla",
        en: a.archivado_en,
        origen: "sorteo programado",
        resultado: "ok",
        estadoAnterior: a.estado,
        estadoNuevo: "libre",
        cliente: texto(f.comprador) || texto(f.nombre),
        contacto: texto(f.telefono) || texto(f.contacto),
        grupo: texto(f.grupo_nombre),
        detalles: [
            a.nombre_evento && `Sorteo: ${a.nombre_evento}`,
            texto(f.fecha_reserva) && `Reservado el ${f.fecha_reserva}${texto(f.hora_reserva) ? ` ${f.hora_reserva}` : ""}`,
            texto(f.fecha_pago) && `Pagado el ${f.fecha_pago}${texto(f.hora_pago) ? ` ${f.hora_pago}` : ""}`
        ].filter(Boolean) as string[]
    };
}

// Actividad que la auditoría ya registra: reservas (bot y panel) y acciones
// del panel. Solo se descarta si la auditoría está disponible.
function duplicaAuditoria(a: ActividadReserva): boolean {
    return a.tipo === "reservado" || !!a.realizado_por?.startsWith("panel:");
}

export function construirHistorial(numeros: NumeroReserva[], fuentes: FuentesHistorial, estadoDe: (n: NumeroReserva) => EstadoNumero): FilaHistorial[] {

    const eventos = new Map<string, EventoHistorial[]>();
    const personas = new Map<string, FuenteBusqueda[]>();
    const agregar = (numero: string | null, e: EventoHistorial, persona: FuenteBusqueda) => {
        if (!numero) return;
        eventos.set(numero, [...(eventos.get(numero) || []), e]);
        personas.set(numero, [...(personas.get(numero) || []), persona]);
    };

    if (fuentes.auditoriaDisponible) fuentes.auditoria.forEach(a => agregar(a.numero, desdeAuditoria(a),
        fuenteBusqueda(a.contacto_id, [a.contacto_nombre], [a.contacto_telefono])));
    fuentes.actividad
        .filter(a => a.numero && a.tipo in TITULO_ACTIVIDAD)
        .filter(a => !(fuentes.auditoriaDisponible && duplicaAuditoria(a)))
        .forEach(a => agregar(a.numero, desdeActividad(a),
            fuenteBusqueda(null, [a.detalle?.comprador], [a.detalle?.contacto])));
    fuentes.archivo.forEach(a => {
        const f = a.fila || {};
        agregar(a.numero, desdeArchivo(a), fuenteBusqueda(f.usuario_global_id, [f.comprador, f.nombre], [f.telefono, f.contacto]));
    });

    // Directorio: nombre y teléfono actuales de cada identidad.
    const directorio = new Map((fuentes.contactos || []).map(c => [c.id, c]));
    const completar = (p: FuenteBusqueda): FuenteBusqueda => {
        const c = p.identidad ? directorio.get(p.identidad) : undefined;
        if (!c) return p;
        const tel = telefonoCanonico(c.telefono);
        return {
            identidad: p.identidad,
            nombres: c.nombre ? [...p.nombres, c.nombre] : p.nombres,
            telefonos: tel && !p.telefonos.includes(tel) ? [...p.telefonos, tel] : p.telefonos
        };
    };

    const filas: FilaHistorial[] = [];

    for (const n of numeros) {

        const estado = estadoDe(n);
        const lista = (eventos.get(n.numero) || []).sort((x, y) => y.en.localeCompare(x.en));
        const ocupado = estado !== "libre";

        // Un número libre sin ningún evento no tiene historial que mostrar.
        if (!ocupado && lista.length === 0) continue;

        filas.push({
            numero: n.numero,
            estado,
            // Datos de la reserva actual: solo si el número sigue ocupado.
            cliente: ocupado ? texto(n.comprador) || texto(n.nombre) : null,
            contacto: ocupado ? texto(n.telefono) || texto(n.contacto) : null,
            grupo: ocupado ? texto(n.grupo_nombre) : null,
            sorteo: ocupado ? texto(n.nombre_evento) : null,
            reserva: ocupado && n.fecha_reserva ? { fecha: n.fecha_reserva, hora: n.hora_reserva } : null,
            pago: ocupado && n.fecha_pago ? { fecha: n.fecha_pago, hora: n.hora_pago } : null,
            eventos: lista,
            busqueda: [
                ...(ocupado ? [fuenteBusqueda(n.usuario_global_id, [n.comprador, n.nombre], [n.telefono, n.contacto])] : []),
                ...(personas.get(n.numero) || [])
            ].map(completar)
        });

    }

    return filas.sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true }));

}

export type FiltroEstadoHistorial = "todos" | EstadoNumero;

export interface FiltrosHistorial {
    texto: string;
    estado: FiltroEstadoHistorial;
    grupo: string;
    // "AAAA-MM-DD" (fecha de Colombia) o "".
    fecha: string;
}

export const FILTROS_HISTORIAL_VACIOS: FiltrosHistorial = { texto: "", estado: "todos", grupo: "", fecha: "" };

// Fecha de Colombia ("AAAA-MM-DD") de un instante ISO.
export function fechaColombia(iso: string): string | null {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type TipoConsulta = "vacia" | "numero" | "telefono" | "texto";

// Qué se está buscando. 1 a 3 dígitos = número de la tabla ("7" -> "07").
// Solo dígitos y separadores de teléfono (espacios, guiones, paréntesis, +)
// con 7 o más dígitos = teléfono. Lo demás = nombre o contacto escrito.
export function tipoConsulta(consulta: string): { tipo: TipoConsulta; valor: string } {
    const q = consulta.trim();
    if (!q) return { tipo: "vacia", valor: "" };
    if (/^\d{1,3}$/.test(q)) return { tipo: "numero", valor: q };
    if (/^[\d\s+\-().]+$/.test(q)) {
        const tel = telefonoCanonico(q);
        if (tel) return { tipo: "telefono", valor: tel };
    }
    return { tipo: "texto", valor: normalizar(q) };
}

const esNumero = (numero: string, q: string) =>
    numero === q || (q.length < numero.length && numero === q.padStart(numero.length, "0"));

// Números que cumplen la BÚSQUEDA (sin estado/grupo/fecha). Teléfono: igual,
// nunca «contiene». Nombre: contiene, sin tildes. Una coincidencia en una
// fuente con identidad trae TODOS los números de esa misma identidad en
// esta tabla (relación real usuario_global_id / contacto_id), sea cual sea
// su estado; nunca se une a dos personas porque se parezcan.
function numerosPorConsulta(filas: FilaHistorial[], consulta: string): Set<string> | null {

    const { tipo, valor } = tipoConsulta(consulta);
    if (tipo === "vacia") return null;

    if (tipo === "numero") return new Set(filas.filter(f => esNumero(f.numero, valor)).map(f => f.numero));

    const coincide = (p: FuenteBusqueda) => tipo === "telefono"
        ? p.telefonos.includes(valor)
        : p.nombres.some(n => normalizar(n).includes(valor));

    const directos = new Set<string>();
    const identidades = new Set<string>();

    for (const fila of filas) {
        for (const p of fila.busqueda) {
            if (!coincide(p)) continue;
            directos.add(fila.numero);
            if (p.identidad) identidades.add(p.identidad);
        }
    }

    return new Set(filas
        .filter(f => directos.has(f.numero) || f.busqueda.some(p => p.identidad && identidades.has(p.identidad)))
        .map(f => f.numero));

}

// Estado (ACTUAL), grupo y fecha de una fila.
function cumpleFiltros(fila: FilaHistorial, f: FiltrosHistorial): boolean {

    if (f.estado !== "todos" && fila.estado !== f.estado) return false;

    const grupos = [fila.grupo, ...fila.eventos.map(e => e.grupo)].filter(Boolean) as string[];
    if (f.grupo && !grupos.includes(f.grupo)) return false;

    if (f.fecha) {
        const fechas = [fila.reserva?.fecha, fila.pago?.fecha, ...fila.eventos.map(e => fechaColombia(e.en))];
        if (!fechas.includes(f.fecha)) return false;
    }

    return true;

}

// ÚNICA regla de búsqueda y filtros del panel de la tabla: la usan el
// historial (filtrarHistorial) y la cuadrícula (numerosCoincidentes). Un
// número que coincide conserva todos sus movimientos.
function aplicarFiltros(filas: FilaHistorial[], f: FiltrosHistorial): Set<string> {
    const porConsulta = numerosPorConsulta(filas, f.texto);
    return new Set(filas
        .filter(fila => (!porConsulta || porConsulta.has(fila.numero)) && cumpleFiltros(fila, f))
        .map(fila => fila.numero));
}

export function filtrarHistorial(filas: FilaHistorial[], f: FiltrosHistorial): FilaHistorial[] {
    const set = aplicarFiltros(filas, f);
    return filas.filter(fila => set.has(fila.numero));
}

export function hayFiltrosActivos(f: FiltrosHistorial): boolean {
    return Boolean(f.texto.trim() || f.estado !== "todos" || f.grupo || f.fecha);
}

// Números de la cuadrícula que cumplen los filtros (null = sin filtros: se
// ven todos). Un número sin historial (libre y sin movimientos) se evalúa
// solo con su número y su estado actual. Solo considera los números
// recibidos: los de la tabla de este precio y de este cliente.
export function numerosCoincidentes(numeros: NumeroReserva[], filas: FilaHistorial[], f: FiltrosHistorial, estadoDe: (n: NumeroReserva) => EstadoNumero): Set<string> | null {

    if (!hayFiltrosActivos(f)) return null;

    const porNumero = new Map(filas.map(fila => [fila.numero, fila]));
    const todas = numeros.map((n): FilaHistorial => porNumero.get(n.numero) ?? {
        numero: n.numero, estado: estadoDe(n), cliente: null, contacto: null, grupo: null,
        sorteo: null, reserva: null, pago: null, eventos: [], busqueda: []
    });

    return aplicarFiltros(todas, f);

}

export function gruposDelHistorial(filas: FilaHistorial[]): string[] {
    const set = new Set<string>();
    for (const f of filas) {
        if (f.grupo) set.add(f.grupo);
        f.eventos.forEach(e => e.grupo && set.add(e.grupo));
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

// Texto de la reserva en la fila del historial. Sale de fecha_reserva +
// hora_reserva de la fila actual: reservarNumeros.js los escribe una sola vez,
// al pasar el número de libre a reservado (bot o panel), ya en hora de
// Colombia; los pagos solo tocan fecha_pago/hora_pago. Se muestran tal cual,
// sin convertir zonas horarias. null = número sin reserva actual.
export function etiquetaReserva(reserva: FilaHistorial["reserva"]): string | null {
    if (!reserva) return null;
    const m = reserva.hora?.match(/^(\d{1,2}):(\d{2})/);
    return m
        ? `Reserva: ${reserva.fecha} ${m[1].padStart(2, "0")}:${m[2]}`
        : `Reserva: ${reserva.fecha} · Hora no registrada`;
}
