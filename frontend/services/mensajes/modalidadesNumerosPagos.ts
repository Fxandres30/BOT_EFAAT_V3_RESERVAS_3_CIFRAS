// Grupo "Números y pagos" del panel de Mensajes — solo organización
// visual de las plantillas de PRESENTACIÓN. Cada entrada es un tipo real
// ya existente (tiposMensaje.ts); aquí no se crea ningún tipo nuevo ni se
// cambia qué plantilla elige el bot (eso lo decide
// backend/bot/ai/plantillaMensaje.js con los datos de la lógica central).

export interface ModalidadNumerosPagos {
    tipoId: string;
    // Qué preguntas del cliente llegan a esta plantilla.
    cuandoSeUsa: string;
}

const PREGUNTAS_DE_PAGO = "«¿qué debo?», «¿cuánto debo?», «¿qué me falta por pagar?», «¿estoy al día?» o «¿ya pagué?»";

export const MODALIDADES_NUMEROS_PAGOS: ModalidadNumerosPagos[] = [
    {
        tipoId: "mis_numeros",
        cuandoSeUsa: "«Mis números», «¿cuáles son mis números?», «¿qué números tengo?». Muestra todos sus números y cuáles están pagados y pendientes."
    },
    {
        tipoId: "consulta_pago_sin_pago",
        cuandoSeUsa: `Respuesta de pago (${PREGUNTAS_DE_PAGO}) cuando el cliente todavía no ha pagado ninguno de sus números. Muestra lo pendiente y su valor.`
    },
    {
        tipoId: "consulta_pago_pago_parcial",
        cuandoSeUsa: `Respuesta de pago (${PREGUNTAS_DE_PAGO}) cuando el cliente ya pagó algunos números y le faltan otros. Muestra solo lo pendiente y su valor.`
    },
    {
        tipoId: "consulta_pago_pago_completo",
        cuandoSeUsa: `Respuesta de pago (${PREGUNTAS_DE_PAGO}) cuando todos sus números están pagados: está al día.`
    },
    {
        tipoId: "consulta_pago_sin_saldo",
        cuandoSeUsa: `Respuesta de pago (${PREGUNTAS_DE_PAGO}) cuando el cliente no tiene números en el sorteo.`
    }
];

const IDS = new Set(MODALIDADES_NUMEROS_PAGOS.map((m) => m.tipoId));

export function esModalidadNumerosPagos(tipoId: string): boolean {
    return IDS.has(tipoId);
}

export function obtenerModalidad(tipoId: string): ModalidadNumerosPagos | undefined {
    return MODALIDADES_NUMEROS_PAGOS.find((m) => m.tipoId === tipoId);
}
