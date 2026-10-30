import type { BadgeTone } from "@/components/ui";
import type { EstadoGrupo, EstadoOperativo, EstadoSorteo, GrupoGestion, SorteoGestionado } from "./apiSorteos";

// Textos y tonos de los TRES estados de un sorteo programado (módulo puro:
// sin red). Los estados y las reglas los decide el backend
// (sorteos/administracion.js); aquí solo se nombran.

type Etiqueta = { texto: string; tono: BadgeTone };

/** Estado de la PROGRAMACIÓN (sorteos_programados.estado). */
export const ESTADO_PROGRAMACION: Record<EstadoSorteo, Etiqueta> = {
    borrador: { texto: "Borrador (sin confirmar)", tono: "neutral" },
    programado: { texto: "Programado", tono: "primary" },
    publicando: { texto: "Publicando", tono: "warning" },
    publicado: { texto: "Publicado", tono: "success" },
    publicado_parcial: { texto: "Publicado en parte", tono: "warning" },
    fallido: { texto: "Falló", tono: "error" },
    cancelado: { texto: "Cancelado", tono: "neutral" }
};

/** Estado de la PUBLICACIÓN en un grupo. */
export const ESTADO_GRUPO: Record<EstadoGrupo, Etiqueta> = {
    pendiente: { texto: "Pendiente", tono: "neutral" },
    publicando: { texto: "Publicando", tono: "warning" },
    publicado: { texto: "Publicado", tono: "success" },
    fallido: { texto: "Reintentando", tono: "warning" },
    requiere_revision: { texto: "Requiere revisión", tono: "error" },
    cancelado: { texto: "Cancelado", tono: "neutral" }
};

/** Estado OPERATIVO del sorteo (eventos_bot). */
export const ESTADO_OPERATIVO: Record<EstadoOperativo, Etiqueta> = {
    pendiente: { texto: "Sorteo pendiente", tono: "neutral" },
    en_curso: { texto: "Sorteo en curso", tono: "primary" },
    terminado: { texto: "Sorteo terminado", tono: "success" },
    cancelado: { texto: "Sorteo cancelado", tono: "neutral" },
    sin_publicar: { texto: "No se publicó", tono: "error" },
    desconocido: { texto: "Estado no disponible", tono: "warning" }
};

export function etiquetaGrupo(g: Pick<GrupoGestion, "estado" | "en_espera">): Etiqueta {
    return g.en_espera ? { texto: "En espera", tono: "warning" } : ESTADO_GRUPO[g.estado];
}

export function etiquetaOperativo(s: SorteoGestionado): Etiqueta {
    const o = s.gestion.operativo;
    if (o.estado === "en_curso" && o.reservas === "cerradas") return { texto: "Reservas cerradas", tono: "warning" };
    return ESTADO_OPERATIVO[o.estado];
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Resumen de reservas de la identidad del sorteo, o null si no hay. */
export function textoReservas(s: SorteoGestionado): string | null {
    const r = s.gestion.impacto.reservas;
    if (!r.total) return null;
    const partes = [r.reservados && plural(r.reservados, "reservado", "reservados"), r.pagados && plural(r.pagados, "pagado", "pagados"), r.otros && plural(r.otros, "en otro estado", "en otro estado")].filter(Boolean);
    return `${partes.join(" · ")}${s.gestion.impacto.anticipadas ? " (anticipadas)" : ""}`;
}

/**
 * Lo que se le muestra al administrador ANTES de eliminar: el sorteo, los
 * grupos afectados, las publicaciones hechas y las reservas relacionadas, y
 * qué pasará. Si no se puede eliminar, por qué y qué hacer en su lugar.
 */
export function resumenEliminacion(s: SorteoGestionado) {

    const g = s.gestion;
    const publicados = g.grupos.filter(x => x.estado === "publicado");

    return {
        nombre: s.config.nombre,
        grupos: g.grupos.map(x => ({ nombre: x.nombre || x.grupo_id, estado: etiquetaGrupo(x).texto, publicado_en: x.publicado_en })),
        publicaciones: publicados.length,
        reservas: textoReservas(s),
        posible: g.acciones.eliminar,
        bloqueos: g.eliminacion.bloqueos,
        alternativa: g.eliminacion.alternativa,
        avisos: g.eliminacion.avisos || [],
        conActividad: g.eliminacion.con_actividad === true,
        borra: g.eliminacion.borra || [],
        conserva: g.eliminacion.conserva || [],
        consecuencia: g.acciones.eliminar
            ? "Se borra solo la programación y su lista de grupos. No se envía ni se borra nada en WhatsApp, ni en la tabla de números, ni en las reservas. Dejará de ejecutarse y no se puede deshacer."
            : g.eliminacion.alternativa === "cancelar"
                ? "Puedes cancelarla: lo pendiente ya no se publicará y todo lo demás (publicaciones, reservas y pagos) se conserva."
                : g.eliminacion.alternativa === "archivar"
                    ? "Puedes archivarla: deja de aparecer en la lista sin borrar nada; se puede restaurar."
                    : "Por ahora no hay una acción segura: espera a que el sorteo termine o resuelve lo pendiente."
    };

}

/** Texto de la confirmación de «Cancelar», según lo que hay en juego. */
export function textoCancelacion(s: SorteoGestionado): string {
    const i = s.gestion.impacto.grupos;
    const partes = ["¿Cancelar la programación?"];
    if (i.pendientes + i.fallidos) partes.push(`${plural(i.pendientes + i.fallidos, "grupo pendiente ya no se publicará", "grupos pendientes ya no se publicarán")}.`);
    if (i.publicados) partes.push(`Lo ya publicado en ${plural(i.publicados, "grupo", "grupos")} NO se deshace: sigue activo hasta su cierre.`);
    if (i.publicando) partes.push(`${plural(i.publicando, "grupo se está", "grupos se están")} publicando ahora y no se puede detener.`);
    partes.push("No se toca ninguna reserva ni pago.");
    return partes.join(" ");
}
