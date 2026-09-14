// Tipos compartidos del módulo Contactos — mismo criterio que
// components/tablas/types.ts: un solo contrato de datos para hook,
// servicios y componentes.

export type EstadoIdentificacion = "completo" | "solo_lid" | "solo_telefono" | "sin_identificar";

// Fila que devuelve GET /contactos (backend) — ver
// backend/bot/funciones/usuarios/listarContactos.js. La fuente de "quién
// existe" es contactos_tenant JOIN usuarios (migración 018) — NO reservas
// ni mensajes, así que un contacto puede tener cantidadReservas=0.
export interface Contacto {
    id: string;
    nombre: string | null;
    telefono: string | null;
    lid: string | null;

    estadoIdentificacion: EstadoIdentificacion;

    cantidadReservas: number;
    cantidadPagadas: number;

    // Primera/última vez que ESTE tenant vio a este contacto
    // (contactos_tenant.primer_visto_en / ultimo_visto_en) — no confundir
    // con la actividad global de la persona en otros tenants.
    primeraVezVisto: string | null;
    ultimaActividad: string | null;

    // true cuando hay identidad (lid) pero ningún teléfono resuelto todavía
    // — indicador "⚠️ Teléfono pendiente" pedido explícitamente.
    telefonoPendiente: boolean;
}

// Fila real de una tabla dinámica de reservas (subconjunto — ver
// components/tablas/types.ts::NumeroReserva para el contrato completo).
export interface ReservaContacto {
    numero: string;
    estado: string;
    fecha_reserva: string | null;
    hora_reserva: string | null;
    fecha_pago: string | null;
    hora_pago: string | null;
    grupo_nombre: string | null;
    grupo_id: string | null;
    evento_id: string | null;
    comprador: string | null;
    contacto: string | null;
    tabla: string;
}

// Fila real de "reservas_actividad".
export interface ActividadContacto {
    id: string;
    tipo: string;
    detalle: Record<string, unknown>;
    realizado_por: string | null;
    creado_en: string;
    numero: string | null;
    tabla: string;
}

// Fila real de "mensajes_grupos_sorteos" (subconjunto).
export interface MensajeContacto {
    id: string;
    texto: string | null;
    tipo_mensaje: string;
    timestamp_whatsapp: number | null;
    accion: string | null;
    grupo_id: string | null;
    grupo_nombre: string | null;
}

export interface PerfilContacto {
    identidad: {
        id: string;
        nombre: string | null;
        telefono: string | null;
        lid: string | null;
        estadoIdentificacion: EstadoIdentificacion;
        primeraVezVisto: string | null;
        ultimaActividad: string | null;
        telefonoPendiente: boolean;
    };
    reservas: ReservaContacto[];
    actividad: ActividadContacto[];
    mensajes: MensajeContacto[];
}

export type FiltroContactos = "todos" | "recientes" | "con_telefono" | "telefono_pendiente" | "con_reservas";
