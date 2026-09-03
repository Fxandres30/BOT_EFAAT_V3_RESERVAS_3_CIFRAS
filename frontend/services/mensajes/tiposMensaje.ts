// Catálogo de tipos de mensaje configurables — debe coincidir exactamente
// con backend/bot/ai/plantillaMensaje.js (calcularTipoPresentacion).
// "total" (precio total a pagar) queda fuera intencionalmente: no existe
// ninguna lógica de pagos/montos en el backend todavía (ver auditoría
// Fase 4), así que no se ofrece una variable que nunca tendría dato real.

export interface VariableMensaje {
    variable: string;
    etiqueta: string;
    mostrarCampo: string; // clave dentro del JSON "variables" de plantillas_mensaje
}

export interface TipoMensaje {
    id: string;
    categoria: "Reservas" | "Consultas" | "Futuro";
    icono: string;
    nombre: string;
    descripcion: string;
    variables: VariableMensaje[];
    ejemplo: Record<string, string>; // datos de EJEMPLO solo para previsualización
    soportado: boolean; // false = el BOT todavía no genera este resultado
}

const V = {
    cliente: { variable: "cliente", etiqueta: "Nombre del cliente", mostrarCampo: "mostrar_nombre" },
    evento: { variable: "evento", etiqueta: "Nombre del evento", mostrarCampo: "mostrar_evento" },
    solicitados: { variable: "numeros_solicitados", etiqueta: "Números solicitados", mostrarCampo: "mostrar_numeros_solicitados" },
    reservados: { variable: "numeros_reservados", etiqueta: "Números reservados", mostrarCampo: "mostrar_numeros_reservados" },
    ocupados: { variable: "numeros_ocupados", etiqueta: "Números ocupados", mostrarCampo: "mostrar_numeros_ocupados" },
    disponibles: { variable: "numeros_disponibles", etiqueta: "Números disponibles", mostrarCampo: "mostrar_numeros_disponibles" },
    fecha: { variable: "fecha", etiqueta: "Fecha del evento", mostrarCampo: "mostrar_fecha" },
    hora: { variable: "hora", etiqueta: "Hora del evento", mostrarCampo: "mostrar_hora" },
    precio: { variable: "precio", etiqueta: "Precio por número", mostrarCampo: "mostrar_precio" },
    cantidad: { variable: "cantidad", etiqueta: "Cantidad de números", mostrarCampo: "" }
};

export const TIPOS_MENSAJE: TipoMensaje[] = [

    {
        id: "reserva_completa",
        categoria: "Reservas",
        icono: "✅",
        nombre: "Reserva completada",
        descripcion: "Todos los números solicitados quedaron reservados.",
        variables: [V.cliente, V.evento, V.solicitados, V.reservados, V.fecha, V.hora, V.precio],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: "27, 45", numeros_reservados: "27, 45", fecha: "2026-09-03", hora: "22:30", precio: "5000" },
        soportado: true
    },
    {
        id: "reserva_parcial",
        categoria: "Reservas",
        icono: "⚠️",
        nombre: "Reserva parcial",
        descripcion: "Algunos números se reservaron, otros ya estaban ocupados.",
        variables: [V.cliente, V.evento, V.solicitados, V.reservados, V.ocupados, V.fecha, V.hora, V.precio],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: "27, 45", numeros_reservados: "27", numeros_ocupados: "45", fecha: "2026-09-03", hora: "22:30", precio: "5000" },
        soportado: true
    },
    {
        id: "numero_ocupado",
        categoria: "Reservas",
        icono: "🔒",
        nombre: "Número ocupado",
        descripcion: "El único número solicitado ya estaba ocupado.",
        variables: [V.cliente, V.evento, V.solicitados, V.fecha, V.hora],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: "27", fecha: "2026-09-03", hora: "22:30" },
        soportado: true
    },
    {
        id: "todos_ocupados",
        categoria: "Reservas",
        icono: "🚫",
        nombre: "Todos los números solicitados ocupados",
        descripcion: "Ninguno de los números solicitados estaba disponible.",
        variables: [V.cliente, V.evento, V.solicitados, V.fecha, V.hora],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: "27, 45", fecha: "2026-09-03", hora: "22:30" },
        soportado: true
    },
    {
        id: "mis_numeros",
        categoria: "Consultas",
        icono: "🎫",
        nombre: "Mis números",
        descripcion: "El cliente pregunta qué números tiene.",
        variables: [V.cliente, V.evento, V.reservados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: "01, 27, 48" },
        soportado: true
    },
    {
        id: "mis_reservas",
        categoria: "Consultas",
        icono: "📋",
        nombre: "Mis reservas",
        descripcion: "El cliente pregunta qué tiene reservado.",
        variables: [V.cliente, V.evento, V.reservados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: "01, 27, 48" },
        soportado: true
    },
    {
        id: "cantidad_reservas",
        categoria: "Consultas",
        icono: "🔢",
        nombre: "Cantidad de reservas",
        descripcion: "El cliente pregunta cuántos números tiene.",
        variables: [V.cliente, V.evento, V.cantidad],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", cantidad: "3" },
        soportado: true
    },
    {
        id: "numero_especifico",
        categoria: "Consultas",
        icono: "🔎",
        nombre: "Consulta de número específico",
        descripcion: "El cliente pregunta si un número es suyo, de otro, o está libre.",
        variables: [V.cliente, V.evento, V.solicitados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: "25" },
        soportado: true
    },
    {
        id: "disponibilidad",
        categoria: "Consultas",
        icono: "📊",
        nombre: "Disponibilidad",
        descripcion: "El cliente pregunta qué números quedan libres.",
        variables: [V.evento, V.disponibles, V.ocupados],
        ejemplo: { evento: "Lotería De Manizales", numeros_disponibles: "00, 03, 04, 05...", numeros_ocupados: "01, 27, 48" },
        soportado: true
    },
    {
        id: "info_evento",
        categoria: "Consultas",
        icono: "🎯",
        nombre: "Información del evento",
        descripcion: "El cliente pregunta por la lotería, hora o fecha del sorteo.",
        variables: [V.evento, V.fecha, V.hora],
        ejemplo: { evento: "Lotería De Manizales", fecha: "2026-09-03", hora: "22:30" },
        soportado: true
    },

    // ============================================================
    // Preparados para el futuro: el BOT NO genera estos resultados
    // todavía (calcularTipoPresentacion nunca produce estos ids).
    // Se muestran en el panel para dejar la arquitectura lista, pero
    // no se pueden activar plantillas reales sobre ellos.
    // ============================================================
    {
        id: "mensaje_no_entendido",
        categoria: "Futuro",
        icono: "❓",
        nombre: "Mensaje no entendido",
        descripcion: "Preparado para el futuro — el BOT todavía no genera este resultado.",
        variables: [V.cliente],
        ejemplo: { cliente: "Carlos" },
        soportado: false
    },
    {
        id: "numero_invalido",
        categoria: "Futuro",
        icono: "🚧",
        nombre: "Número inválido",
        descripcion: "Preparado para el futuro — el BOT todavía no genera este resultado.",
        variables: [V.cliente, V.solicitados],
        ejemplo: { cliente: "Carlos", numeros_solicitados: "150" },
        soportado: false
    },
    {
        id: "evento_no_disponible",
        categoria: "Futuro",
        icono: "🕓",
        nombre: "Evento no disponible",
        descripcion: "Preparado para el futuro — el BOT todavía no genera este resultado.",
        variables: [V.cliente],
        ejemplo: { cliente: "Carlos" },
        soportado: false
    },
    {
        id: "solicitud_ambigua",
        categoria: "Futuro",
        icono: "🤔",
        nombre: "Solicitud ambigua",
        descripcion: "Preparado para el futuro — el BOT todavía no genera este resultado.",
        variables: [V.cliente],
        ejemplo: { cliente: "Carlos" },
        soportado: false
    },
    {
        id: "otro_determinista",
        categoria: "Futuro",
        icono: "🧩",
        nombre: "Otros resultados determinísticos futuros",
        descripcion: "Preparado para el futuro — el BOT todavía no genera este resultado.",
        variables: [V.cliente],
        ejemplo: { cliente: "Carlos" },
        soportado: false
    }

];

export function obtenerTipoMensaje(id: string): TipoMensaje | undefined {
    return TIPOS_MENSAJE.find((t) => t.id === id);
}
