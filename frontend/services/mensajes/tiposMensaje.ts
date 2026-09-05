import { formatearListaNumeros } from "./formatearListaNumeros";

// Catálogo de tipos de mensaje configurables — debe coincidir exactamente
// con backend/bot/ai/plantillaMensaje.js (calcularTipoPresentacion).
// "total" (precio total a pagar) queda fuera intencionalmente: no existe
// ninguna lógica de pagos/montos en el backend todavía (ver auditoría
// Fase 4), así que no se ofrece una variable que nunca tendría dato real.
//
// Variables gramaticales (auditoría de frontend, módulo Mensajes): el
// backend (backend/bot/ai/gramatica.js + plantillaMensaje.js) calcula
// automáticamente 15 pares singular/plural según la cantidad real de
// números de la respuesta — este catálogo SOLO los documenta, nunca los
// calcula (el frontend no debe implementar ni duplicar esa lógica).
// Además, cualquiera de esos 15 pares puede pedirse atado a UNA lista
// específica agregando el sufijo "_reservados" / "_ocupados" /
// "_disponibles" (p.ej. {{ocupado_ocupados_ocupados}}), para respuestas
// que hablan de más de una lista de números a la vez (reserva_parcial:
// reservados Y ocupados; disponibilidad: disponibles Y ocupados). Esa
// mecánica es genérica y real en el backend para los tres conjuntos; aquí
// solo se catalogan las combinaciones que hoy tienen uso real en las
// plantillas (todas del conjunto "_ocupados" — es el único que aparece
// como lista SECUNDARIA en el contenido real hoy).

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
    // Opcionales: cuando un tipo puede producir tanto 1 como 2+ números
    // reales, estos dos ejemplos permiten mostrar AMBOS casos en la vista
    // previa (para que un admin vea que "tu número"/"es"/"reservado" no se
    // rompen con 1, y "tus números"/"son"/"reservados" tampoco con varios).
    // Son solo datos de ejemplo — ninguna decisión de negocio.
    ejemploSingular?: Record<string, string>;
    ejemploPlural?: Record<string, string>;
    soportado: boolean; // false = el BOT todavía no genera este resultado
}

const V = {

    // ---------------------------------------------------------------
    // Datos literales — nunca cambian de forma según cantidad.
    // ---------------------------------------------------------------
    cliente: { variable: "cliente", etiqueta: "Nombre del cliente", mostrarCampo: "mostrar_nombre" },
    evento: { variable: "evento", etiqueta: "Nombre del evento", mostrarCampo: "mostrar_evento" },
    solicitados: { variable: "numeros_solicitados", etiqueta: "Números solicitados", mostrarCampo: "mostrar_numeros_solicitados" },
    reservados: { variable: "numeros_reservados", etiqueta: "Números reservados", mostrarCampo: "mostrar_numeros_reservados" },
    ocupados: { variable: "numeros_ocupados", etiqueta: "Números ocupados", mostrarCampo: "mostrar_numeros_ocupados" },
    disponibles: { variable: "numeros_disponibles", etiqueta: "Números disponibles", mostrarCampo: "mostrar_numeros_disponibles" },
    fecha: { variable: "fecha", etiqueta: "Fecha del evento", mostrarCampo: "mostrar_fecha" },
    hora: { variable: "hora", etiqueta: "Hora del evento", mostrarCampo: "mostrar_hora" },
    precio: { variable: "precio", etiqueta: "Precio por número", mostrarCampo: "mostrar_precio" },
    cantidad: { variable: "cantidad", etiqueta: "Cantidad de números", mostrarCampo: "" },

    // ---------------------------------------------------------------
    // GENERALES — las 15 formas singular/plural que gramatica.js calcula
    // para la lista principal de la respuesta. El backend las expone
    // siempre; aquí solo se listan para el/los tipo(s) donde tienen
    // sentido real (mismo criterio ya aplicado en la migración de
    // Supabase — ver backend/_migracion_propuesta_fase2.js).
    // ---------------------------------------------------------------
    tuNumeroTusNumeros: { variable: "tu_numero_tus_numeros", etiqueta: "\"tu número\" / \"tus números\" (según cantidad)", mostrarCampo: "" },
    elNumeroLosNumeros: { variable: "el_numero_los_numeros", etiqueta: "\"el número\" / \"los números\" (según cantidad)", mostrarCampo: "" },
    eseEsos: { variable: "ese_esos", etiqueta: "\"ese número\" / \"esos números\" (según cantidad)", mostrarCampo: "" },
    estaEstan: { variable: "esta_estan", etiqueta: "\"está\" / \"están\" (según cantidad)", mostrarCampo: "" },
    estabaEstaban: { variable: "estaba_estaban", etiqueta: "\"estaba\" / \"estaban\" (según cantidad)", mostrarCampo: "" },
    esSon: { variable: "es_son", etiqueta: "\"es\" / \"son\" (según cantidad)", mostrarCampo: "" },
    reservadoReservados: { variable: "reservado_reservados", etiqueta: "\"reservado\" / \"reservados\" (según cantidad)", mostrarCampo: "" },
    ocupadoOcupados: { variable: "ocupado_ocupados", etiqueta: "\"ocupado\" / \"ocupados\" (según cantidad)", mostrarCampo: "" },
    disponibleDisponibles: { variable: "disponible_disponibles", etiqueta: "\"disponible\" / \"disponibles\" (según cantidad)", mostrarCampo: "" },
    numeroNumeros: { variable: "numero_numeros", etiqueta: "\"número\" / \"números\" (según cantidad)", mostrarCampo: "" },
    quedoQuedaron: { variable: "quedo_quedaron", etiqueta: "\"quedó\" / \"quedaron\" (según cantidad)", mostrarCampo: "" },
    quedaQuedan: { variable: "queda_quedan", etiqueta: "\"queda\" / \"quedan\" (según cantidad)", mostrarCampo: "" },
    tuyoTuyos: { variable: "tuyo_tuyos", etiqueta: "\"tuyo\" / \"tuyos\" (según cantidad)", mostrarCampo: "" },
    libreLibres: { variable: "libre_libres", etiqueta: "\"libre\" / \"libres\" (según cantidad)", mostrarCampo: "" },
    suNumeroSusNumeros: { variable: "su_numero_sus_numeros", etiqueta: "\"su número\" / \"sus números\" (formal, según cantidad)", mostrarCampo: "" },

    // ---------------------------------------------------------------
    // POR CONJUNTO ("_ocupados") — igual que las de arriba, pero atadas
    // SIEMPRE a la cantidad de numeros_ocupados, nunca a la de
    // numeros_reservados ni numeros_disponibles. Imprescindibles en
    // reserva_parcial y en la cláusula de ocupados de disponibilidad,
    // donde ambas listas pueden tener cantidades distintas en el mismo
    // mensaje (p.ej. "1 número reservado y 2 números ocupados").
    // ---------------------------------------------------------------
    ocupadoOcupadosOcupados: { variable: "ocupado_ocupados_ocupados", etiqueta: "\"ocupado\"/\"ocupados\" — SOLO de los ocupados", mostrarCampo: "" },
    estabaEstabanOcupados: { variable: "estaba_estaban_ocupados", etiqueta: "\"estaba\"/\"estaban\" — SOLO de los ocupados", mostrarCampo: "" },
    disponibleDisponiblesOcupados: { variable: "disponible_disponibles_ocupados", etiqueta: "\"disponible\"/\"disponibles\" — SOLO de los ocupados", mostrarCampo: "" },
    elNumeroLosNumerosOcupados: { variable: "el_numero_los_numeros_ocupados", etiqueta: "\"el número\"/\"los números\" — SOLO de los ocupados", mostrarCampo: "" },
    esSonOcupados: { variable: "es_son_ocupados", etiqueta: "\"es\"/\"son\" — SOLO de los ocupados", mostrarCampo: "" },
    libreLibresOcupados: { variable: "libre_libres_ocupados", etiqueta: "\"libre\"/\"libres\" — SOLO de los ocupados", mostrarCampo: "" }

};

export const TIPOS_MENSAJE: TipoMensaje[] = [

    {
        id: "reserva_completa",
        categoria: "Reservas",
        icono: "✅",
        nombre: "Reserva completada",
        descripcion: "Todos los números solicitados quedaron reservados.",
        variables: [V.cliente, V.evento, V.solicitados, V.reservados, V.fecha, V.hora, V.precio, V.tuNumeroTusNumeros, V.esSon, V.reservadoReservados, V.quedoQuedaron, V.tuyoTuyos, V.numeroNumeros],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["27", "45"]), numeros_reservados: formatearListaNumeros(["27", "45"]), fecha: "2026-09-03", hora: "22:30", precio: "5000" },
        ejemploSingular: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["45"]), numeros_reservados: formatearListaNumeros(["45"]), fecha: "2026-09-05", hora: "22:30", precio: "5000", tu_numero_tus_numeros: "tu número", es_son: "es", reservado_reservados: "reservado", quedo_quedaron: "quedó", tuyo_tuyos: "tuyo", numero_numeros: "número" },
        ejemploPlural: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["27", "45"]), numeros_reservados: formatearListaNumeros(["27", "45"]), fecha: "2026-09-05", hora: "22:30", precio: "5000", tu_numero_tus_numeros: "tus números", es_son: "son", reservado_reservados: "reservados", quedo_quedaron: "quedaron", tuyo_tuyos: "tuyos", numero_numeros: "números" },
        soportado: true
    },
    {
        id: "reserva_parcial",
        categoria: "Reservas",
        icono: "⚠️",
        nombre: "Reserva parcial",
        descripcion: "Algunos números se reservaron, otros ya estaban ocupados.",
        variables: [V.cliente, V.evento, V.solicitados, V.reservados, V.ocupados, V.fecha, V.hora, V.precio, V.tuNumeroTusNumeros, V.esSon, V.reservadoReservados, V.quedoQuedaron, V.tuyoTuyos, V.eseEsos, V.estabaEstabanOcupados, V.ocupadoOcupadosOcupados, V.disponibleDisponiblesOcupados, V.elNumeroLosNumerosOcupados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["27", "45"]), numeros_reservados: formatearListaNumeros(["27"]), numeros_ocupados: formatearListaNumeros(["45"]), fecha: "2026-09-03", hora: "22:30", precio: "5000" },
        // Reservados=1 (singular) mientras ocupados=2 (plural), a propósito:
        // demuestra que ambas listas concuerdan de forma INDEPENDIENTE en
        // el mismo mensaje — nunca se mezclan entre sí.
        ejemploSingular: {
            cliente: "Carlos", evento: "Lotería De Manizales", fecha: "2026-09-05", hora: "22:30", precio: "5000",
            numeros_reservados: formatearListaNumeros(["45"]), reservado_reservados: "reservado", quedo_quedaron: "quedó", tuyo_tuyos: "tuyo", ese_esos: "ese número", es_son: "es",
            numeros_ocupados: formatearListaNumeros(["12", "27"]), estaba_estaban_ocupados: "estaban", ocupado_ocupados_ocupados: "ocupados", disponible_disponibles_ocupados: "disponibles", el_numero_los_numeros_ocupados: "los números"
        },
        ejemploPlural: {
            cliente: "Carlos", evento: "Lotería De Manizales", fecha: "2026-09-05", hora: "22:30", precio: "5000",
            numeros_reservados: formatearListaNumeros(["12", "27", "45"]), reservado_reservados: "reservados", quedo_quedaron: "quedaron", tuyo_tuyos: "tuyos", ese_esos: "esos números", es_son: "son",
            numeros_ocupados: formatearListaNumeros(["9"]), estaba_estaban_ocupados: "estaba", ocupado_ocupados_ocupados: "ocupado", disponible_disponibles_ocupados: "disponible", el_numero_los_numeros_ocupados: "el número"
        },
        soportado: true
    },
    {
        id: "numero_ocupado",
        categoria: "Reservas",
        icono: "🔒",
        nombre: "Número ocupado",
        descripcion: "El único número solicitado ya estaba ocupado.",
        variables: [V.cliente, V.evento, V.solicitados, V.fecha, V.hora, V.tuNumeroTusNumeros, V.esSon],
        // Siempre exactamente 1 número (calcularTipoPresentacion lo garantiza)
        // — no aplica ejemplo dual, solo se completan las formas singulares.
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["27"]), fecha: "2026-09-03", hora: "22:30", tu_numero_tus_numeros: "tu número", es_son: "es" },
        soportado: true
    },
    {
        id: "todos_ocupados",
        categoria: "Reservas",
        icono: "🚫",
        nombre: "Todos los números solicitados ocupados",
        descripcion: "Ninguno de los números solicitados estaba disponible.",
        variables: [V.cliente, V.evento, V.solicitados, V.fecha, V.hora, V.elNumeroLosNumeros, V.estaEstan, V.ocupadoOcupados],
        // Siempre 2+ solicitados (complemento de numero_ocupado) — no
        // aplica ejemplo dual, solo se completan las formas plurales.
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["27", "45"]), fecha: "2026-09-03", hora: "22:30", el_numero_los_numeros: "los números", esta_estan: "están", ocupado_ocupados: "ocupados" },
        soportado: true
    },
    {
        id: "mis_numeros",
        categoria: "Consultas",
        icono: "🎫",
        nombre: "Mis números",
        descripcion: "El cliente pregunta qué números tiene.",
        variables: [V.cliente, V.evento, V.reservados, V.tuNumeroTusNumeros, V.esSon, V.reservadoReservados, V.eseEsos, V.tuyoTuyos, V.suNumeroSusNumeros, V.numeroNumeros],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["01", "27", "48"]) },
        ejemploSingular: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["27"]), tu_numero_tus_numeros: "tu número", es_son: "es", reservado_reservados: "reservado", ese_esos: "ese número", tuyo_tuyos: "tuyo", su_numero_sus_numeros: "su número", numero_numeros: "número" },
        ejemploPlural: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["01", "27", "48"]), tu_numero_tus_numeros: "tus números", es_son: "son", reservado_reservados: "reservados", ese_esos: "esos números", tuyo_tuyos: "tuyos", su_numero_sus_numeros: "sus números", numero_numeros: "números" },
        soportado: true
    },
    {
        id: "mis_reservas",
        categoria: "Consultas",
        icono: "📋",
        nombre: "Mis reservas",
        descripcion: "El cliente pregunta qué tiene reservado.",
        variables: [V.cliente, V.evento, V.reservados, V.tuNumeroTusNumeros, V.esSon, V.reservadoReservados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["01", "27", "48"]) },
        ejemploSingular: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["27"]), tu_numero_tus_numeros: "tu número", es_son: "es", reservado_reservados: "reservado" },
        ejemploPlural: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_reservados: formatearListaNumeros(["01", "27", "48"]), tu_numero_tus_numeros: "tus números", es_son: "son", reservado_reservados: "reservados" },
        soportado: true
    },
    {
        id: "cantidad_reservas",
        categoria: "Consultas",
        icono: "🔢",
        nombre: "Cantidad de reservas",
        descripcion: "El cliente pregunta cuántos números tiene.",
        variables: [V.cliente, V.evento, V.cantidad, V.numeroNumeros, V.reservadoReservados],
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", cantidad: "3" },
        ejemploSingular: { cliente: "Carlos", evento: "Lotería De Manizales", cantidad: "1", numero_numeros: "número", reservado_reservados: "reservado" },
        ejemploPlural: { cliente: "Carlos", evento: "Lotería De Manizales", cantidad: "3", numero_numeros: "números", reservado_reservados: "reservados" },
        soportado: true
    },
    {
        id: "numero_especifico",
        categoria: "Consultas",
        icono: "🔎",
        nombre: "Consulta de número específico",
        descripcion: "El cliente pregunta si un número es suyo, de otro, o está libre.",
        variables: [V.cliente, V.evento, V.solicitados, V.tuNumeroTusNumeros, V.esSon],
        // resolverConsulta.js solo toma numeros[0]: siempre 1 número exacto
        // — no aplica ejemplo dual.
        ejemplo: { cliente: "Carlos", evento: "Lotería De Manizales", numeros_solicitados: formatearListaNumeros(["25"]), tu_numero_tus_numeros: "tu número", es_son: "es" },
        soportado: true
    },
    {
        id: "disponibilidad",
        categoria: "Consultas",
        icono: "📊",
        nombre: "Disponibilidad",
        descripcion: "El cliente pregunta qué números quedan libres.",
        variables: [V.evento, V.disponibles, V.ocupados, V.numeroNumeros, V.disponibleDisponibles, V.libreLibres, V.quedaQuedan, V.elNumeroLosNumeros, V.estaEstan, V.esSon, V.elNumeroLosNumerosOcupados, V.ocupadoOcupadosOcupados, V.esSonOcupados],
        ejemplo: { evento: "Lotería De Manizales", numeros_disponibles: formatearListaNumeros(["00", "03", "04", "05"]), numeros_ocupados: formatearListaNumeros(["01", "27", "48"]) },
        // Disponibles=1 (singular) mientras ocupados=2 (plural), a
        // propósito — misma idea que reserva_parcial: dos listas
        // independientes en el mismo mensaje.
        ejemploSingular: {
            evento: "Lotería De Manizales",
            numeros_disponibles: formatearListaNumeros(["45"]), numero_numeros: "número", disponible_disponibles: "disponible", libre_libres: "libre", queda_quedan: "queda", el_numero_los_numeros: "el número", esta_estan: "está", es_son: "es",
            numeros_ocupados: formatearListaNumeros(["12", "27"]), el_numero_los_numeros_ocupados: "los números", ocupado_ocupados_ocupados: "ocupados", es_son_ocupados: "son"
        },
        ejemploPlural: {
            evento: "Lotería De Manizales",
            numeros_disponibles: formatearListaNumeros(["00", "03", "04"]), numero_numeros: "números", disponible_disponibles: "disponibles", libre_libres: "libres", queda_quedan: "quedan", el_numero_los_numeros: "los números", esta_estan: "están", es_son: "son",
            numeros_ocupados: formatearListaNumeros(["9"]), el_numero_los_numeros_ocupados: "el número", ocupado_ocupados_ocupados: "ocupado", es_son_ocupados: "es"
        },
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
        ejemplo: { cliente: "Carlos", numeros_solicitados: formatearListaNumeros(["150"]) },
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
