// Tipos del módulo Bloqueados (bloqueo automático de WhatsApp) — fila real
// de "bloqueados" devuelta por GET /bloqueados (backend) — ver
// backend/bot/funciones/bloqueo/bloqueadosRepo.js.
//
// UN SOLO CONCEPTO DE NEGOCIO: "bloqueado". No existe un tipo/tabla
// separado de "vetado".
//
// Tres cosas distintas que el panel muestra por separado:
//   - bloqueo registrado (activo),
//   - bloqueo nativo de WhatsApp (bloqueo_nativo_estado),
//   - expulsión de los grupos (expulsion: una tarea por grupo, verificada
//     con la lista real de participantes — migración 040).

// Estado general de la expulsión (backend expulsionesRepo.estadoGeneral).
export type EstadoExpulsionGeneral =
    | "desbloqueado"
    | "solo_registrado"
    | "expulsion_pendiente"
    | "expulsado_de_todos"
    | "simulado"
    | "parcial"
    | "sesion_desconectada"
    | "error_permisos"
    | "error_whatsapp"
    | "requiere_atencion";

// Estado de la expulsión en UN grupo (bloqueo_expulsiones.estado).
export type EstadoExpulsionGrupo =
    | "pendiente"
    | "en_curso"
    | "expulsado"
    | "ya_no_estaba"
    | "simulado"
    | "sin_verificar"
    | "sin_permisos"
    | "sesion_desconectada"
    | "error_whatsapp"
    | "identidad_ambigua"
    | "no_expulsable"
    | "cancelado";

export type ModoExpulsion = "desactivado" | "simulacion" | "real";

export type EstadoBloqueoNativo = "aplicado" | "fallido" | "sin_sesion" | "no_disponible" | "retirado";

export interface ResumenExpulsion {
    estado: EstadoExpulsionGeneral;
    total: number;
    expulsados: number;
    yaNoEstaban: number;
    resueltos: number;
    enProceso: number;
    simulados: number;
    conProblema: number;
    migracionPendiente: boolean;
    // Solo en las respuestas que incluyen el contexto del servidor.
    modo?: ModoExpulsion;
    sesionConectada?: boolean;
}

export interface ContextoExpulsion {
    modo: ModoExpulsion;
    // Cada cuánto el servidor revisa los participantes reales (null si la
    // expulsión está desactivada o el backend es anterior).
    vigilanciaSegundos?: number | null;
    sesionConectada: boolean;
    migracionPendiente: boolean;
}

export interface ExpulsionGrupo {
    id: string;
    grupo_id: string;
    grupo_nombre: string | null;
    estado: EstadoExpulsionGrupo;
    modo: "simulacion" | "real" | null;
    origen: "bloqueo" | "reingreso" | "reintento" | null;
    intentos: number;
    ultimo_status: string | null;
    ultimo_error: string | null;
    participante_jid: string | null;
    criterio_identidad: "lid_jid" | "telefono" | null;
    proximo_intento_en: string | null;
    ultimo_intento_en: string | null;
    verificada_en: string | null;
    solicitada_en: string | null;
}

export interface IntentoExpulsion {
    id: string;
    grupo_id: string;
    grupo_nombre: string | null;
    resultado: string;
    error: string | null;
    origen: string | null;
    modo: string | null;
    status_whatsapp: string | null;
    creado_en: string;
}

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

    // Migración 040 (ausentes si no se aplicó).
    bloqueo_nativo_estado?: EstadoBloqueoNativo | null;
    bloqueo_nativo_error?: string | null;

    expulsion?: ResumenExpulsion;
}

export interface DetalleExpulsiones {
    bloqueado: Bloqueado;
    expulsion: ResumenExpulsion & ContextoExpulsion;
    grupos: ExpulsionGrupo[];
    intentos: IntentoExpulsion[];
}
