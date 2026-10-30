// ==========================================================================
// estadoSorteoPrecio.ts — cálculo PURO (sin red ni Supabase) del estado del
// sorteo que muestra cada tarjeta de precio en Reservas (IndiceTablas).
//
// Fuentes (las mismas que usa AnuncioSorteoModal, ya filtradas por el
// usuario del token en el backend):
//   - activos     GET /api/sorteos/activos -> eventos_bot activos y no
//                 cerrados, una entrada por identidad (sus grupos juntos);
//   - programados GET /api/sorteos/gestion -> sorteos_programados con su
//                 estado operativo real (leído de eventos_bot); si esa ruta
//                 falla, GET /api/sorteos y solo se decide por la hora.
// Un activo es del precio si su valor coincide y su tabla física es la de
// ese precio en tablas_cliente (mismo criterio que sorteosActivos.js
// ::filasActivas). Nada se deduce del nombre del precio ni de las reservas.
//
// Si una fuente falla, NO se afirma «sin sorteo»: el estado es
// «no_disponible».
// ==========================================================================

import type { Sorteo, SorteoActivo, SorteoGestionado } from "../sorteos/apiSorteos";
import { calcularCierreReal, fechaValida } from "../automatizacion/estadoProgramacion";

export type EstadoTarjeta = "activo" | "programado" | "revision" | "sin_sorteo" | "no_disponible";

export interface EntradaEstadoSorteo {
    estado: EstadoTarjeta;
    // id del evento o del sorteo programado (clave estable para React).
    clave: string;
    nombre: string | null;
    // Grupos del sorteo activo (filas de eventos_bot con su identidad).
    grupos?: number;
    // Instante real de publicación del programado (publicar_en guardado).
    publicarEn?: Date | null;
    publicando?: boolean;
    // Por qué requiere revisión (o aviso en un activo publicado a medias).
    motivo?: string;
}

// `gestion` solo falta si se usó el listado simple.
export type ProgramacionTarjeta = Sorteo & Partial<Pick<SorteoGestionado, "gestion">>;

interface Entrada {
    precio: number;
    tabla: string;
    activos: SorteoActivo[] | null;
    programados: ProgramacionTarjeta[] | null;
    ahora: Date;
}

const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });

const MOTIVO_FALLIDO = "La publicación falló. Revísala en Sorteos programados.";
const MOTIVO_PARCIAL = "Algunos grupos no se publicaron. Revísalo en Sorteos programados.";

const deTabla = (tablaRegistro: string | null | undefined, tabla: string) => !tablaRegistro || tablaRegistro === tabla;

// Momento en que se cierra: fecha_sorteo (o el día de la publicación en
// Colombia, como validar.js::fechaSorteoDe) + hora_cierre, o hora_fin si no
// la tiene (nunca es posterior a hora_fin). Sin datos: null.
function momentoDeCierre(s: Sorteo): Date | null {

    const fecha = s.config?.fecha_sorteo
        || (fechaValida(s.publicar_en) ? FORMATO_DIA.format(fechaValida(s.publicar_en) as Date) : null);

    return calcularCierreReal(fecha, s.config?.hora_cierre || s.config?.hora_fin);

}

// Una programación solo se muestra mientras su sorteo siga por delante: el
// estado operativo del backend manda y, además, la hora de cierre (sin hora
// conocida, se sigue mostrando: no se da por resuelto).
function siguePendiente(s: ProgramacionTarjeta, ahora: Date): boolean {

    const operativo = s.gestion?.operativo;

    if (operativo?.estado === "terminado" || operativo?.estado === "cancelado") return false;
    if (operativo?.estado === "en_curso" && operativo.reservas === "cerradas") return false;

    const momento = momentoDeCierre(s);

    return !momento || momento.getTime() > ahora.getTime();

}

export function estadoSorteoPrecio({ precio, tabla, activos, programados, ahora }: Entrada): EntradaEstadoSorteo[] {

    if (!activos) return [{ estado: "no_disponible", clave: "no_disponible", nombre: null }];

    const delPrecio = (programados || [])
        .filter(s => Number(s.config?.valor) === precio && deTabla(s.tabla, tabla));

    const porId = new Map(delPrecio.map(s => [s.id, s]));

    const enCurso: EntradaEstadoSorteo[] = activos
        .filter(a => Number(a.valor) === precio && deTabla(a.tabla, tabla))
        .map(a => ({
            estado: "activo",
            clave: `activo:${a.id}`,
            nombre: a.nombre,
            grupos: a.grupos.length,
            motivo: a.sorteo_programado_id && porId.get(a.sorteo_programado_id)?.estado === "publicado_parcial" ? MOTIVO_PARCIAL : undefined
        }));

    const yaActivos = new Set(activos.map(a => a.sorteo_programado_id).filter(Boolean));

    const revision: EntradaEstadoSorteo[] = delPrecio
        .filter(s => !yaActivos.has(s.id))
        .filter(s => (s.estado === "fallido" || s.estado === "publicado_parcial") && siguePendiente(s, ahora))
        .map(s => ({
            estado: "revision",
            clave: `sorteo:${s.id}`,
            nombre: s.config?.nombre || null,
            motivo: s.estado === "fallido" ? MOTIVO_FALLIDO : MOTIVO_PARCIAL
        }));

    // Solo los confirmados (un borrador aún no está programado).
    const futuros: EntradaEstadoSorteo[] = delPrecio
        .filter(s => !yaActivos.has(s.id) && (s.estado === "programado" || s.estado === "publicando") && siguePendiente(s, ahora))
        .map(s => ({
            estado: "programado" as const,
            clave: `sorteo:${s.id}`,
            nombre: s.config?.nombre || null,
            publicarEn: fechaValida(s.publicar_en),
            publicando: s.estado === "publicando"
        }))
        .sort((a, b) => (a.publicarEn?.getTime() ?? Infinity) - (b.publicarEn?.getTime() ?? Infinity));

    const entradas = [...enCurso, ...revision, ...futuros];

    if (entradas.length) return entradas;

    // Sin el listado de programados no se puede afirmar que no hay ninguno.
    if (!programados) return [{ estado: "no_disponible", clave: "no_disponible", nombre: null }];

    return [{ estado: "sin_sorteo", clave: "sin_sorteo", nombre: null }];

}
