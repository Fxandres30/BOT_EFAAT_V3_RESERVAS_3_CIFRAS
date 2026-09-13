// ==========================================================================
// CATÁLOGO GLOBAL DE VARIABLES EFAAT — espejo de solo-datos, lado cliente.
//
// LA FUENTE DE VERDAD es backend/shared/variables/catalogoVariables.js.
// Este archivo es un espejo (mismo patrón ya usado en este proyecto por
// aplicarPlantillaPreview.ts y formatearListaNumeros.ts): el frontend
// (navegador) no puede importar un módulo CommonJS del backend, así que
// los METADATOS (nunca la lógica de resolución/negocio) se replican aquí
// para alimentar el autocomplete, la validación y el preview del editor.
// Si agregas o cambias una variable en el backend, replica el mismo
// cambio aquí.
// ==========================================================================

export type CategoriaVariable =
    | "CLIENTE" | "NUMEROS" | "RESERVAS" | "PAGOS" | "EVENTO"
    | "FECHA_HORA" | "RESULTADO" | "DISPONIBILIDAD" | "AUTOMATIZACION"
    | "MENSAJES" | "SISTEMA";

export interface DefinicionCategoria {
    emoji: string;
    label: string;
}

export const CATEGORIAS: Record<CategoriaVariable, DefinicionCategoria> = {
    CLIENTE: { emoji: "👤", label: "Cliente" },
    NUMEROS: { emoji: "🎟️", label: "Números" },
    RESERVAS: { emoji: "📦", label: "Reservas" },
    PAGOS: { emoji: "💰", label: "Pagos" },
    EVENTO: { emoji: "🎯", label: "Evento" },
    FECHA_HORA: { emoji: "📅", label: "Fecha y hora" },
    RESULTADO: { emoji: "🏆", label: "Resultado" },
    DISPONIBILIDAD: { emoji: "📊", label: "Disponibilidad" },
    AUTOMATIZACION: { emoji: "🤖", label: "Automatización" },
    MENSAJES: { emoji: "💬", label: "Mensajes" },
    SISTEMA: { emoji: "⚙️", label: "Sistema" }
};

export interface VariableGlobal {
    key: string;
    aliases: string[];
    categoria: CategoriaVariable;
    description: string;
    example: string;
    requires: string[];
    type: "texto" | "numero" | "moneda" | "fecha" | "hora" | "lista" | "concordancia";
    estado: "EXISTENTE" | "NUEVA";
}

export const CATALOGO_VARIABLES: VariableGlobal[] = [

    { key: "cliente", aliases: ["nombre"], categoria: "CLIENTE", description: "Nombre del cliente identificado en la conversación", example: "Andrés", requires: ["usuario"], type: "texto", estado: "EXISTENTE" },
    { key: "telefono", aliases: [], categoria: "CLIENTE", description: "Teléfono/JID del cliente identificado", example: "3001234567", requires: ["usuario"], type: "texto", estado: "NUEVA" },

    { key: "numeros_solicitados", aliases: ["numero", "numerito", "numeritos"], categoria: "NUMEROS", description: "Números que el cliente acaba de escribir/consultar", example: "( 12 )", requires: ["evento"], type: "lista", estado: "EXISTENTE" },
    { key: "numeros_reservados", aliases: [], categoria: "NUMEROS", description: "Números reservados por el cliente (en \"mis números\" incluye también los ya pagados)", example: "( 12 - 45 )", requires: ["evento"], type: "lista", estado: "EXISTENTE" },
    { key: "numeros_pagados", aliases: [], categoria: "NUMEROS", description: "Números del cliente que ya están pagados", example: "( 12 - 27 )", requires: ["usuario", "evento", "estado_pago"], type: "lista", estado: "NUEVA" },
    { key: "numeros_pendientes", aliases: [], categoria: "NUMEROS", description: "Números del cliente que siguen reservados sin pagar", example: "( 23 - 45 )", requires: ["usuario", "evento", "estado_pago"], type: "lista", estado: "NUEVA" },
    { key: "numeros_totales_cliente", aliases: ["numeros", "numeros_del_cliente"], categoria: "NUMEROS", description: "Todos los números del cliente (reservados + pagados) en un solo listado", example: "( 12 - 23 - 27 - 45 - 60 )", requires: ["usuario", "evento"], type: "lista", estado: "NUEVA" },
    { key: "cantidad", aliases: ["cantidad_numeros"], categoria: "NUMEROS", description: "Cantidad numérica principal del resultado actual", example: "3", requires: ["consulta"], type: "numero", estado: "EXISTENTE" },
    { key: "cantidad_reservados", aliases: ["reservados"], categoria: "NUMEROS", description: "Cantidad de números reservados en el resultado actual", example: "3", requires: [], type: "numero", estado: "EXISTENTE" },
    { key: "cantidad_pagados", aliases: [], categoria: "NUMEROS", description: "Cantidad de números pagados por el cliente", example: "3", requires: ["usuario", "evento", "estado_pago"], type: "numero", estado: "NUEVA" },
    { key: "cantidad_pendientes", aliases: [], categoria: "NUMEROS", description: "Cantidad de números pendientes de pago del cliente", example: "2", requires: ["usuario", "evento", "estado_pago"], type: "numero", estado: "NUEVA" },

    { key: "numeros_disponibles", aliases: [], categoria: "DISPONIBILIDAD", description: "Números libres del evento activo", example: "( 01 - 02 - 03 )", requires: ["evento"], type: "lista", estado: "EXISTENTE" },
    { key: "numeros_ocupados", aliases: [], categoria: "DISPONIBILIDAD", description: "Números ocupados/reservados por otra persona", example: "( 07 )", requires: ["evento"], type: "lista", estado: "EXISTENTE" },
    { key: "cantidad_disponibles", aliases: ["disponibles"], categoria: "DISPONIBILIDAD", description: "Cantidad de números disponibles del evento", example: "88", requires: ["evento"], type: "numero", estado: "EXISTENTE" },
    { key: "cantidad_ocupados", aliases: [], categoria: "DISPONIBILIDAD", description: "Cantidad de números ocupados", example: "1", requires: [], type: "numero", estado: "EXISTENTE" },

    { key: "precio", aliases: ["valor", "valor_numero"], categoria: "PAGOS", description: "Valor de cada número del evento (número crudo, sin formato de moneda)", example: "5000", requires: ["evento"], type: "numero", estado: "EXISTENTE" },
    { key: "monto_total", aliases: [], categoria: "PAGOS", description: "Valor total de todos los números del cliente en el evento activo", example: "$50.000", requires: ["usuario", "evento", "estado_pago"], type: "moneda", estado: "NUEVA" },
    { key: "monto_pagado", aliases: [], categoria: "PAGOS", description: "Monto que el cliente ya pagó", example: "$30.000", requires: ["usuario", "evento", "estado_pago"], type: "moneda", estado: "NUEVA" },
    { key: "monto_pendiente", aliases: ["pago_pendiente"], categoria: "PAGOS", description: "Monto que el cliente todavía debe", example: "$20.000", requires: ["usuario", "evento", "estado_pago"], type: "moneda", estado: "NUEVA" },

    { key: "evento", aliases: ["nombre_evento"], categoria: "EVENTO", description: "Nombre del evento/sorteo activo", example: "Sorteo Medellín", requires: ["evento"], type: "texto", estado: "EXISTENTE" },
    { key: "premio", aliases: [], categoria: "EVENTO", description: "Premio principal configurado para el evento activo", example: "Nevera", requires: ["evento"], type: "texto", estado: "NUEVA" },

    { key: "fecha", aliases: [], categoria: "FECHA_HORA", description: "Fecha del evento activo", example: "2026-01-20", requires: ["evento"], type: "fecha", estado: "EXISTENTE" },
    { key: "hora", aliases: [], categoria: "FECHA_HORA", description: "Hora de cierre del evento (formato 12h)", example: "8:00 PM", requires: ["evento"], type: "hora", estado: "EXISTENTE" },
    { key: "hora_cierre", aliases: [], categoria: "FECHA_HORA", description: "Mismo dato que \"hora\" (cierre del evento); usado por el motor de automatización en formato de 24h sin formatear", example: "20:00", requires: ["evento"], type: "hora", estado: "EXISTENTE" },

    { key: "numero_numeros", aliases: [], categoria: "NUMEROS", description: "\"número\" o \"números\" según la cantidad (concordancia)", example: "números", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "tu_numero_tus_numeros", aliases: [], categoria: "NUMEROS", description: "\"tu número\" o \"tus números\" según la cantidad", example: "tus números", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "su_numero_sus_numeros", aliases: [], categoria: "NUMEROS", description: "\"su número\" o \"sus números\" (forma formal)", example: "sus números", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "el_numero_los_numeros", aliases: [], categoria: "NUMEROS", description: "\"el número\" o \"los números\"", example: "los números", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "ese_esos", aliases: [], categoria: "NUMEROS", description: "\"ese número\" o \"esos números\"", example: "esos números", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "esta_estan", aliases: [], categoria: "NUMEROS", description: "\"está\" o \"están\"", example: "están", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "estaba_estaban", aliases: [], categoria: "NUMEROS", description: "\"estaba\" o \"estaban\"", example: "estaban", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "es_son", aliases: [], categoria: "NUMEROS", description: "\"es\" o \"son\"", example: "son", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "reservado_reservados", aliases: [], categoria: "NUMEROS", description: "\"reservado\" o \"reservados\"", example: "reservados", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "ocupado_ocupados", aliases: [], categoria: "DISPONIBILIDAD", description: "\"ocupado\" o \"ocupados\"", example: "ocupados", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "disponible_disponibles", aliases: [], categoria: "DISPONIBILIDAD", description: "\"disponible\" o \"disponibles\"", example: "disponibles", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "libre_libres", aliases: [], categoria: "DISPONIBILIDAD", description: "\"libre\" o \"libres\"", example: "libres", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "quedo_quedaron", aliases: [], categoria: "NUMEROS", description: "\"quedó\" o \"quedaron\"", example: "quedaron", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "queda_quedan", aliases: [], categoria: "NUMEROS", description: "\"queda\" o \"quedan\"", example: "quedan", requires: [], type: "concordancia", estado: "EXISTENTE" },
    { key: "tuyo_tuyos", aliases: [], categoria: "NUMEROS", description: "\"tuyo\" o \"tuyos\"", example: "tuyos", requires: [], type: "concordancia", estado: "EXISTENTE" }

];

export const GRAMATICA_KEYS = [
    "numero_numeros", "tu_numero_tus_numeros", "su_numero_sus_numeros",
    "el_numero_los_numeros", "ese_esos", "esta_estan", "estaba_estaban",
    "es_son", "reservado_reservados", "ocupado_ocupados",
    "disponible_disponibles", "libre_libres", "quedo_quedaron",
    "queda_quedan", "tuyo_tuyos"
];

export const CONJUNTOS_GRAMATICA = ["reservados", "ocupados", "disponibles"];

const MAPA_ALIASES: Record<string, string> = {};
for (const variable of CATALOGO_VARIABLES) {
    for (const alias of variable.aliases) {
        MAPA_ALIASES[alias] = variable.key;
    }
}

const MAPA_POR_CLAVE: Record<string, VariableGlobal> = {};
for (const variable of CATALOGO_VARIABLES) {
    MAPA_POR_CLAVE[variable.key] = variable;
}

export interface ClaveResuelta {
    definicion: VariableGlobal;
    esGramaticaPorConjunto: boolean;
    conjunto: string | null;
}

// Mismo algoritmo de reconocimiento que el backend (clave canónica, alias,
// o forma sufijada de gramática "<base>_<conjunto>") — solo LEE datos del
// catálogo espejo, no decide ni calcula ningún valor.
export function resolverClaveCanonica(nombre: string): ClaveResuelta | null {

    if (!nombre) return null;

    if (MAPA_POR_CLAVE[nombre]) {
        return { definicion: MAPA_POR_CLAVE[nombre], esGramaticaPorConjunto: false, conjunto: null };
    }

    if (MAPA_ALIASES[nombre]) {
        return { definicion: MAPA_POR_CLAVE[MAPA_ALIASES[nombre]], esGramaticaPorConjunto: false, conjunto: null };
    }

    for (const conjunto of CONJUNTOS_GRAMATICA) {

        const sufijo = `_${conjunto}`;

        if (nombre.endsWith(sufijo)) {

            const base = nombre.slice(0, -sufijo.length);

            if (GRAMATICA_KEYS.includes(base)) {
                return { definicion: MAPA_POR_CLAVE[base], esGramaticaPorConjunto: true, conjunto };
            }

        }

    }

    return null;

}

export function esVariableConocida(nombre: string): boolean {
    return resolverClaveCanonica(nombre) !== null;
}

export function listarCatalogo(): VariableGlobal[] {
    return CATALOGO_VARIABLES;
}

// Escanea un contenido de plantilla y devuelve los nombres {{...}} que no
// existen en el catálogo — nunca corrige, solo señala (usado al guardar).
export function extraerVariablesDesconocidas(texto: string): string[] {

    if (!texto) return [];

    const encontradas = new Set<string>();
    const desconocidas: string[] = [];
    const regex = /\{\{\s*(\w+)\s*\}\}/g;
    let coincidencia: RegExpExecArray | null;

    while ((coincidencia = regex.exec(texto)) !== null) {

        const nombre = coincidencia[1];

        if (encontradas.has(nombre)) continue;
        encontradas.add(nombre);

        if (!esVariableConocida(nombre)) {
            desconocidas.push(nombre);
        }

    }

    return desconocidas;

}
