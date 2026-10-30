// «Sorteo instantáneo» (módulo puro: sin red). Decide cuándo se puede pulsar
// «Publicar ahora» y cómo se muestra el resultado REAL de cada grupo. La
// publicación la hace el backend con el publicador de los programados
// (POST /sorteos/:id/publicar-ahora).

import type { EstadoGrupo, ResultadoPublicacionInmediata, Sorteo, VistaPrevia } from "./apiSorteos";

export type PruebaImagen =
    | { tipo: "probando" }
    | { tipo: "ok"; imagen: string }
    | { tipo: "error"; mensaje: string };

// Sin imagen no se publica (el publicador tampoco envía texto solo): la
// imagen que generó el SERVIDOR tiene que haberse visto antes.
export function motivoNoPublicable(
    vista: VistaPrevia,
    { revisado, reinicioConfirmado, imagen }: { revisado: boolean; reinicioConfirmado: boolean; imagen: PruebaImagen }
): string | null {
    if (vista.estado !== "borrador") return "Este sorteo ya se confirmó.";
    if (vista.bloqueos.length) return "Resuelve los bloqueos de abajo.";
    if (vista.estado_publicacion !== "listo") return "Algún grupo tiene otro sorteo abierto: elige «Sustituir el sorteo activo» o ciérralo antes.";
    if (imagen.tipo === "probando") return "Generando la imagen en el servidor…";
    if (imagen.tipo === "error") return "El servidor no pudo generar la imagen: sin imagen no se publica.";
    if (vista.reinicio?.al_publicar && !reinicioConfirmado) return "Confirma el reinicio de la tabla.";
    if (!revisado) return "Marca que revisaste la vista previa.";
    return null;
}

// Tras un «tiempo agotado» el panel vuelve a leer el sorteo: mismo resumen
// que devuelve publicar-ahora (servicio.resumenPublicacion).
export function resumenDesdeSorteo(sorteo: Sorteo): ResultadoPublicacionInmediata {
    const grupos = (sorteo.grupos || []).filter(g => g.estado !== "cancelado").map(g => ({
        grupo_id: g.grupo_id,
        nombre: g.grupo_nombre,
        estado: g.estado,
        error: g.ultimo_error
    }));
    const cuenta = (e: EstadoGrupo) => grupos.filter(g => g.estado === e).length;
    return {
        sorteo_id: sorteo.id,
        estado: sorteo.estado,
        publicados: cuenta("publicado"),
        fallidos: cuenta("fallido"),
        en_revision: cuenta("requiere_revision"),
        pendientes: cuenta("pendiente") + cuenta("publicando"),
        grupos
    };
}

// Frase de resumen, sin dar por enviado lo que no se confirmó.
export function textoResultado(r: ResultadoPublicacionInmediata): string {
    const total = r.grupos.length;
    const partes = [`Enviado en ${r.publicados} de ${total} grupo(s).`];
    if (r.fallidos) partes.push(`${r.fallidos} con error (no se envió; se reintentará automáticamente).`);
    if (r.en_revision) partes.push(`${r.en_revision} en revisión: no se sabe si llegó, no se reenvía solo.`);
    if (r.pendientes) partes.push(`${r.pendientes} todavía pendiente(s).`);
    if (r.repetido) partes.unshift("Este sorteo ya se había confirmado: no se publicó otra vez.");
    return partes.join(" ");
}
