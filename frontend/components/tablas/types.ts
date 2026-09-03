// Tipos compartidos del módulo de Reservas/Tablas. Un solo lugar para el
// contrato de datos — hook, servicios y componentes usan estos mismos
// tipos en vez de "any" o interfaces sueltas repetidas por archivo.

export type EstadoNumero = "libre" | "reservado" | "pagado" | "bloqueado" | "en_proceso";

// Fila real de "reservas_dos_cifras" / "5k_15k_reservas_2_cifras".
export interface NumeroReserva {
    id: number;
    numero: string;
    estado: EstadoNumero;

    comprador: string | null;
    contacto: string | null;
    nombre: string | null;
    telefono: string | null;
    lib: string | null;

    grupo_id: string | null;
    grupo_nombre: string | null;

    evento_id: string | null;
    nombre_evento: string | null;

    usuario_id: string | null;
    usuario_global_id: string | null;
    telefono_bot: string | null;

    fecha_reserva: string | null;
    hora_reserva: string | null;

    fecha_pago: string | null;
    hora_pago: string | null;

    temporal_por: string | null;
    bloqueado_hasta: string | null;

    ip_reserva: string | null;
    contacto_lower: string | null;

    creado_en: string;
}

export interface EventoActivo {
    id: string;
    nombre_evento: string | null;
    valor: string | null;
    tabla: string;
    estado: string | null;
    activo: boolean;
    abierto: boolean;
    reservados: number;
    pagados: number;
    pendientes: number;
    libres: number;
    cantidad_numeros: number | null;
    grupo_nombre: string | null;
    hora_fin: string | null;
    hora_cierre: string | null;
    fecha_evento: string | null;
}

// "Grupo" = paquete de números reservados juntos por un mismo cliente,
// derivado de filas que comparten evento_id + contacto/teléfono + fecha y
// hora de reserva. No es el grupo de WhatsApp (ver grupoWhatsApp abajo).
export interface PaqueteReserva {
    id: string;
    cliente: string | null;
    contacto: string | null;
    numeros: string[];
    estado: EstadoNumero | "mixto";
    grupoWhatsApp: string | null;
    eventoId: string | null;
    fechaReserva: string | null;
    horaReserva: string | null;
    totalFilas: number;
}

export type TipoActividad =
    | "reservado"
    | "pagado"
    | "liberado"
    | "bloqueado"
    | "cancelado"
    | "grupo_creado"
    | "grupo_modificado"
    | "tabla_reiniciada";

export interface ActividadReserva {
    id: string;
    usuario_id: string;
    tabla: string;
    numero: string | null;
    evento_id: string | null;
    tipo: TipoActividad;
    detalle: Record<string, unknown>;
    realizado_por: string | null;
    creado_en: string;
}
