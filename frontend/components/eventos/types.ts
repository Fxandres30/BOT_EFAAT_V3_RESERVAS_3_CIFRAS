export interface Evento {

    id?: string;

    usuario_id?: string | null;

    session_id?: string | null;

    telefono_bot?: string | null;

    grupo_id?: string;

    grupo_nombre?: string | null;

    nombre_evento?: string;

    estado?: string;

    valor?: string;

    hora_fin?: string;

    hora_cierre?: string;

    fecha_evento?: string;

    creado_en?: string;

    actualizado_en?: string;

    tabla?: string;

    cifras?: number;

    cantidad_numeros?: number;

    premios?: string[];

    reservados?: number;

    pagados?: number;

    pendientes?: number;

    libres?: number;

    activo?: boolean;

    abierto?: boolean;

}

export interface EventoProps {

    evento: Evento;

}

export interface EventosProps {

    eventos: Evento[];

}

export interface EventoInfoItemProps {

    icon: string;

    titulo: string;

    valor?: string | number | null;

}

export interface EventoStatItemProps {

    icon: string;

    titulo: string;

    valor: string | number;

}

export interface EventoTableProps {

    eventos: Evento[];

    onRefresh?: () => Promise<void>;

}