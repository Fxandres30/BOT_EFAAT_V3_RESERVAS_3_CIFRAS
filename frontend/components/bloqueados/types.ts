// Tipos del módulo Bloqueados (bloqueo automático de WhatsApp) — fila real
// de "bloqueados" devuelta por GET /bloqueados (backend) — ver
// backend/bot/funciones/bloqueo/bloqueadosRepo.js.
//
// UN SOLO CONCEPTO DE NEGOCIO: "bloqueado". No existe un tipo/tabla
// separado de "vetado".

export interface Bloqueado {
    id: string;
    usuario_id: string;

    telefono: string | null;
    lid: string | null;
    jid: string | null;
    nombre: string | null;

    motivo: string | null;
    activo: boolean;

    bloqueado_por: string | null;
    creado_en: string;
    actualizado_en: string;

    // Contadores/panel.
    intentos_ingreso: number;
    expulsiones: number;
    ultimo_grupo_id: string | null;
    ultimo_grupo_nombre: string | null;
    ultimo_intento_en: string | null;
}
