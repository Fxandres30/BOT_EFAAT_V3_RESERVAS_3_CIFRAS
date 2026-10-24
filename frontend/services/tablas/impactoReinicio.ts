// Impacto de reiniciar la tabla física de un precio (Tablas → «Reiniciar»).
// Módulo puro: recibe las filas y los sorteos ya leídos y decide qué se
// muestra al administrador y si puede confirmar. Lo usa
// services/tablas/reiniciarTabla.ts (que lee y escribe) y su diálogo.
//
// «Reserva anticipada» = número ocupado con la identidad de un sorteo
// programado del cliente que NUNCA llegó a tener evento (eventos_bot). Un
// sorteo programado en 'fallido' o 'publicando' cuyo evento sí existió (se
// publicó, aunque fuera a mano o a medias, y quizá ya cerró) no es
// anticipado: sus reservas son de un sorteo publicado. Antes se contaban
// por el estado del sorteo programado y un sorteo ya jugado bloqueaba el
// reinicio para siempre.

/** Estados de un sorteo programado que todavía no se publicó del todo
 *  (mismos que backend/sorteos/reservasAnticipadas.js). */
export const ESTADOS_SIN_PUBLICAR = ["borrador", "programado", "publicando", "fallido"];

/** Lo que el administrador escribe para confirmar el reinicio. */
export const TEXTO_CONFIRMACION = "REINICIAR";

export interface FilaReinicio {
    numero: string;
    estado: string;
    identidad_evento_real?: string | null;
}

export interface SorteoProgramadoReinicio {
    id: string;
    estado: string;
    identidad_evento_real: string | null;
    config?: { nombre?: string | null; valor?: number | string | null } | null;
}

export interface EventoReinicio {
    identidad_evento_real: string | null;
    activo?: boolean | null;
    tabla?: string | null;
    nombre_evento?: string | null;
    valor?: number | string | null;
}

export interface AnticipadasSorteo {
    sorteoId: string;
    nombre: string;
    cantidad: number;
    reservados: number;
    pagados: number;
}

export interface ImpactoReinicio {
    tabla: string;
    total: number;
    ocupados: number;
    porEstado: { reservado: number; pagado: number; bloqueado: number; en_proceso: number; otros: number };
    anticipadas: AnticipadasSorteo[];
    totalAnticipadas: number;
    /** Sorteos EN CURSO en esta tabla física (sus reservas y pagos se borrarían). */
    sorteosActivos: { nombre: string; valor: number | null }[];
    /** Otros precios del cliente que usan la misma tabla física. */
    preciosCompartidos: number[];
    /** Estado de los números ocupados al revisar: si cambia, no se reinicia. */
    huella: string;
}

/** Identidades de reservas anticipadas reales: sorteo sin publicar y sin evento. */
export function identidadesAnticipadas(sorteos: SorteoProgramadoReinicio[], eventos: EventoReinicio[]): Map<string, SorteoProgramadoReinicio> {
    const conEvento = new Set(eventos.map(e => e.identidad_evento_real).filter(Boolean));
    const mapa = new Map<string, SorteoProgramadoReinicio>();
    for (const s of sorteos) {
        if (!s.identidad_evento_real || !ESTADOS_SIN_PUBLICAR.includes(s.estado) || conEvento.has(s.identidad_evento_real)) continue;
        if (!mapa.has(s.identidad_evento_real)) mapa.set(s.identidad_evento_real, s);
    }
    return mapa;
}

/** Huella de lo ocupado: número, estado e identidad (orden estable). */
export function huellaFilas(filas: FilaReinicio[]): string {
    return filas
        .filter(f => f.estado !== "libre")
        .map(f => `${f.numero}|${f.estado}|${f.identidad_evento_real || ""}`)
        .sort()
        .join(",");
}

export function calcularImpacto({ tabla, precio, filas, sorteos, eventos, precios }: {
    tabla: string;
    precio: number;
    filas: FilaReinicio[];
    sorteos: SorteoProgramadoReinicio[];
    eventos: EventoReinicio[];
    /** Precios del cliente con su tabla física (tablas_cliente). */
    precios: { precio: number; tabla: string }[];
}): ImpactoReinicio {

    const porEstado = { reservado: 0, pagado: 0, bloqueado: 0, en_proceso: 0, otros: 0 };
    for (const f of filas) {
        if (f.estado === "libre") continue;
        if (f.estado in porEstado) porEstado[f.estado as keyof typeof porEstado]++;
        else porEstado.otros++;
    }

    const anticipadasPor = identidadesAnticipadas(sorteos, eventos);
    const porSorteo = new Map<string, AnticipadasSorteo>();
    for (const f of filas) {
        const s = f.estado !== "libre" && f.identidad_evento_real ? anticipadasPor.get(f.identidad_evento_real) : undefined;
        if (!s) continue;
        const a = porSorteo.get(s.id) || { sorteoId: s.id, nombre: s.config?.nombre || "Sorteo programado", cantidad: 0, reservados: 0, pagados: 0 };
        a.cantidad++;
        if (f.estado === "pagado") a.pagados++; else if (f.estado === "reservado") a.reservados++;
        porSorteo.set(s.id, a);
    }
    const anticipadas = [...porSorteo.values()];

    const sorteosActivos = eventos
        .filter(e => e.activo && e.tabla === tabla)
        .reduce<{ nombre: string; valor: number | null }[]>((lista, e) => {
            const nombre = e.nombre_evento || "Sorteo";
            const valor = e.valor != null ? Number(String(e.valor).replace(/[^\d]/g, "")) || null : null;
            if (!lista.some(x => x.nombre === nombre && x.valor === valor)) lista.push({ nombre, valor });
            return lista;
        }, []);

    return {
        tabla,
        total: filas.length,
        ocupados: filas.filter(f => f.estado !== "libre").length,
        porEstado,
        anticipadas,
        totalAnticipadas: anticipadas.reduce((n, a) => n + a.cantidad, 0),
        sorteosActivos,
        preciosCompartidos: precios.filter(p => p.tabla === tabla && p.precio !== precio).map(p => p.precio).sort((a, b) => a - b),
        huella: huellaFilas(filas)
    };

}

/** ¿Puede confirmar? Texto exacto y, si hay reservas anticipadas, aceptarlas expresamente. */
export function puedeConfirmar(impacto: ImpactoReinicio, { texto, aceptaAnticipadas }: { texto: string; aceptaAnticipadas: boolean }): boolean {
    if (texto.trim().toUpperCase() !== TEXTO_CONFIRMACION) return false;
    if (impacto.totalAnticipadas > 0 && !aceptaAnticipadas) return false;
    return true;
}
