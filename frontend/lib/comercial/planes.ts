// ==========================================================================
// Configuración comercial de EFAAT — ÚNICA fuente de los planes, precios y
// datos de contacto que muestra la landing pública (app/page.tsx).
//
// Son precios PROPUESTOS: cambiarlos aquí los cambia en toda la landing.
// Todavía no existe un sistema de suscripciones que aplique estos límites
// (ver informe de la Fase 0): la contratación y la prueba gratuita se
// gestionan manualmente por correo. No añadir aquí funciones "exclusivas"
// de un plan mientras el backend no las aplique de verdad.
// ==========================================================================

export interface PlanComercial {
    id: "esencial" | "profesional" | "avanzado" | "empresarial";
    nombre: string;
    precioMensualCOP: number;
    maxGrupos: number;
    recomendado?: boolean;
}

export const PLANES: readonly PlanComercial[] = [
    { id: "esencial", nombre: "Esencial", precioMensualCOP: 49999, maxGrupos: 1 },
    { id: "profesional", nombre: "Profesional", precioMensualCOP: 139999, maxGrupos: 2, recomendado: true },
    { id: "avanzado", nombre: "Avanzado", precioMensualCOP: 299999, maxGrupos: 5 },
    { id: "empresarial", nombre: "Empresarial", precioMensualCOP: 499999, maxGrupos: 10 }
];

export const DIAS_PRUEBA_GRATUITA = 7;

export const CORREO_COMERCIAL = "soporte@efaat.com";

// "$49.999" — formato colombiano (punto de miles, sin decimales).
export function formatearCOP(valor: number): string {
    return "$" + Math.round(valor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function textoGrupos(maxGrupos: number): string {
    return maxGrupos === 1 ? "1 grupo de WhatsApp" : `Hasta ${maxGrupos} grupos de WhatsApp`;
}

// Enlace mailto para solicitar la prueba o un plan. No envía nada por sí
// mismo: abre el programa de correo del visitante con el texto prellenado.
export function enlaceSolicitud(plan?: PlanComercial): string {

    const asunto = plan
        ? `Quiero contratar el plan ${plan.nombre} de EFAAT`
        : `Solicitud de prueba gratuita de ${DIAS_PRUEBA_GRATUITA} días de EFAAT`;

    const cuerpo = [
        "Hola, equipo de EFAAT:",
        "",
        plan
            ? `Me interesa el plan ${plan.nombre} (${textoGrupos(plan.maxGrupos).toLowerCase()}).`
            : `Quiero solicitar la prueba gratuita de ${DIAS_PRUEBA_GRATUITA} días.`,
        "",
        "Nombre:",
        "Ciudad:",
        "¿Cuántos grupos de sorteos administro?:",
        "¿Cómo gestiono hoy las reservas?:",
        "",
        "Gracias."
    ].join("\n");

    return `mailto:${CORREO_COMERCIAL}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

}

// Enlaces de «Mi cuenta» (panel privado): mismo canal que la landing. La
// renovación y los cambios de plan se gestionan con el equipo por correo;
// no hay cobros automáticos ni pasarela de pago.
export type MotivoSoporte = "renovacion" | "cambio_plan" | "consulta_plan" | "soporte";

const ASUNTOS_SOPORTE: Record<MotivoSoporte, string> = {
    renovacion: "Renovación de mi cuenta de EFAAT",
    cambio_plan: "Cambio de plan de EFAAT",
    consulta_plan: "Consulta sobre mi plan de EFAAT",
    soporte: "Soporte de EFAAT"
};

export function enlaceSoporte(motivo: MotivoSoporte, correoCuenta: string | null, plan?: PlanComercial): string {

    const cuerpo = [
        "Hola, equipo de EFAAT:",
        "",
        motivo === "renovacion" ? "Quiero renovar mi cuenta."
            : motivo === "cambio_plan" ? (plan ? `Quiero cambiar al plan ${plan.nombre} (${textoGrupos(plan.maxGrupos).toLowerCase()}).` : "Quiero cambiar de plan.")
            : motivo === "consulta_plan" ? "Quiero confirmar mi plan actual, su estado y su fecha de vencimiento."
            : "Necesito ayuda con:",
        "",
        `Correo de mi cuenta: ${correoCuenta || ""}`,
        "",
        "Gracias."
    ].join("\n");

    return `mailto:${CORREO_COMERCIAL}?subject=${encodeURIComponent(ASUNTOS_SOPORTE[motivo])}&body=${encodeURIComponent(cuerpo)}`;

}
