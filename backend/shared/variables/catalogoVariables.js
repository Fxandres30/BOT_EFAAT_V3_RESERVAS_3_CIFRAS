// ==========================================================================
// CATÁLOGO GLOBAL DE VARIABLES EFAAT — fuente única de verdad.
//
// Este archivo SOLO contiene DATOS (metadatos de cada variable). Nunca
// contiene lógica de negocio ni acceso a Supabase — eso vive en
// resolverVariables.js, que reutiliza gramatica.js / resolverConsulta.js /
// los campos ya calculados por el BOT.
//
// Todo lo que aparece aquí fue verificado contra el código real (auditoría
// "SISTEMA GLOBAL DE VARIABLES EFAAT"). No se inventó ninguna variable: las
// marcadas "EXISTENTE" ya se usan hoy; las marcadas "NUEVA" son datos que
// YA EXISTEN en el backend (ver "fuente") pero que hasta ahora ningún
// motor de plantillas exponía.
//
// Espejo de solo-datos para el frontend (por la frontera Node/navegador,
// el mismo patrón ya usado por tiposMensaje.ts / aplicarPlantillaPreview.ts):
//   frontend/services/mensajes/catalogoVariablesGlobal.ts
// Si agregas o cambias una variable aquí, replica el mismo cambio allá.
// ==========================================================================

const CATEGORIAS = {

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

// requires[] usa este vocabulario fijo (ver contextoVariables.js):
//   "usuario"     -> hay un cliente identificado (ctx.usuario)
//   "evento"      -> hay un evento activo (ctx.evento)
//   "reserva"     -> el resultado actual es una reserva (ctx.reserva)
//   "consulta"    -> el resultado actual es una consulta (ctx.consulta)
//   "estado_pago" -> la consulta ya calculó pagados/pendientes/montos
//                    (consulta_pago o multiple con esa faceta) — el
//                    resolver SIEMPRE revalida el dato real además de este
//                    indicador (ver resolverVariables.js).
const CATALOGO = [

    // -------------------- CLIENTE --------------------
    {
        key: "cliente",
        aliases: ["nombre"],
        categoria: "CLIENTE",
        description: "Nombre del cliente identificado en la conversación",
        example: "Andrés",
        requires: ["usuario"],
        type: "texto",
        estado: "EXISTENTE",
        fuente: "ctx.usuario.nombre (plantillaMensaje.js::construirVariables)"
    },
    {
        key: "telefono",
        aliases: [],
        categoria: "CLIENTE",
        description: "Teléfono/JID del cliente identificado",
        example: "3001234567",
        requires: ["usuario"],
        type: "texto",
        estado: "NUEVA",
        fuente: "ctx.usuario.telefono (ya existe en el objeto usuario, nunca se exponía a plantillas)"
    },

    // -------------------- NÚMEROS --------------------
    {
        key: "numeros_solicitados",
        aliases: ["numero", "numerito", "numeritos"],
        categoria: "NUMEROS",
        description: "Números que el cliente acaba de escribir/consultar (formato de lista)",
        example: "( 12 )",
        requires: ["evento"],
        type: "lista",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes (reserva y numero_especifico)"
    },
    {
        key: "numeros_reservados",
        aliases: [],
        categoria: "NUMEROS",
        // Nota real de comportamiento heredado (no se cambia en esta fase):
        // en mis_numeros/mis_reservas esta variable representa TODOS los
        // números del cliente (reservados+pagados mezclados), no solo los
        // que siguen en estado "reservado" — así funciona hoy y así se
        // mantiene por compatibilidad.
        description: "Números reservados por el cliente para el resultado actual (en mis_numeros/mis_reservas incluye también los ya pagados, comportamiento histórico)",
        example: "( 12 - 45 )",
        requires: ["evento"],
        type: "lista",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes"
    },
    {
        key: "numeros_pagados",
        aliases: [],
        categoria: "NUMEROS",
        description: "Números del cliente que ya están pagados (estado real, sin mezclar con pendientes)",
        example: "( 12 - 27 )",
        requires: ["usuario", "evento", "estado_pago"],
        type: "lista",
        estado: "NUEVA",
        fuente: "resultado.pagados (construirFacetaEstadoNumeros, modo lista — resolverConsulta.js)"
    },
    {
        key: "numeros_pendientes",
        aliases: [],
        categoria: "NUMEROS",
        description: "Números del cliente que siguen reservados sin pagar",
        example: "( 23 - 45 )",
        requires: ["usuario", "evento", "estado_pago"],
        type: "lista",
        estado: "NUEVA",
        fuente: "resultado.reservados (construirFacetaEstadoNumeros, modo lista — resolverConsulta.js)"
    },
    {
        key: "numeros_totales_cliente",
        aliases: ["numeros", "numeros_del_cliente"],
        categoria: "NUMEROS",
        description: "Todos los números del cliente (reservados + pagados), en un solo listado ordenado",
        example: "( 12 - 23 - 27 - 45 - 60 )",
        requires: ["usuario", "evento"],
        type: "lista",
        estado: "NUEVA",
        fuente: "resultado.numerosDelUsuario (mis_numeros/mis_reservas y construirFacetaEstadoNumeros modo lista — mismo nombre de campo en ambos, resolverConsulta.js)"
    },
    {
        key: "cantidad",
        aliases: ["cantidad_numeros"],
        categoria: "NUMEROS",
        description: "Cantidad numérica principal del resultado actual",
        example: "3",
        requires: ["consulta"],
        type: "numero",
        estado: "EXISTENTE",
        fuente: "resultado.cantidad (cantidad_reservas, resolverConsulta.js)"
    },
    {
        key: "cantidad_reservados",
        aliases: ["reservados"],
        categoria: "NUMEROS",
        description: "Cantidad de números reservados involucrados en el resultado actual",
        example: "3",
        requires: [],
        type: "numero",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes / automation engine.js::construirVariablesDesdeEvento (evento.reservados)"
    },
    {
        key: "cantidad_pagados",
        aliases: [],
        categoria: "NUMEROS",
        description: "Cantidad de números pagados por el cliente",
        example: "3",
        requires: ["usuario", "evento", "estado_pago"],
        type: "numero",
        estado: "NUEVA",
        fuente: "resultado.pagados.length o resultado.cantidad cuando bucket=pagado (resolverConsulta.js)"
    },
    {
        key: "cantidad_pendientes",
        aliases: [],
        categoria: "NUMEROS",
        description: "Cantidad de números pendientes de pago del cliente",
        example: "2",
        requires: ["usuario", "evento", "estado_pago"],
        type: "numero",
        estado: "NUEVA",
        fuente: "resultado.reservados.length o resultado.cantidad cuando bucket=pendiente (resolverConsulta.js)"
    },

    // -------------------- DISPONIBILIDAD --------------------
    {
        key: "numeros_disponibles",
        aliases: [],
        categoria: "DISPONIBILIDAD",
        description: "Números libres del evento activo, organizados en 3 filas visualmente equilibradas",
        example: "01  04  07  12\n18  23  31  36\n42  47  53  61",
        requires: ["evento"],
        type: "lista",
        estado: "EXISTENTE",
        fuente: "consultarDisponibilidad() (resolverConsulta.js) / gramatica.js::formatearGrillaNumeros"
    },
    {
        key: "numeros_ocupados",
        aliases: [],
        categoria: "DISPONIBILIDAD",
        description: "Números ocupados/reservados por otra persona (reserva parcial o consulta de disponibilidad)",
        example: "( 07 )",
        requires: ["evento"],
        type: "lista",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes"
    },
    {
        key: "cantidad_disponibles",
        aliases: ["disponibles"],
        categoria: "DISPONIBILIDAD",
        description: "Cantidad de números disponibles del evento",
        example: "88",
        requires: ["evento"],
        type: "numero",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes / automation engine.js (evento.libres)"
    },
    {
        key: "cantidad_ocupados",
        aliases: [],
        categoria: "DISPONIBILIDAD",
        description: "Cantidad de números ocupados",
        example: "1",
        requires: [],
        type: "numero",
        estado: "EXISTENTE",
        fuente: "gramatica.js::calcularNumerosRelevantes"
    },

    // -------------------- PAGOS --------------------
    {
        key: "precio",
        aliases: ["valor", "valor_numero"],
        categoria: "PAGOS",
        description: "Valor de cada número del evento activo (número crudo, sin formato de moneda — así lo esperan las plantillas existentes)",
        example: "5000",
        requires: ["evento"],
        type: "numero",
        estado: "EXISTENTE",
        fuente: "ctx.evento.valor (plantillaMensaje.js) / automation engine.js (evento.valor)"
    },
    {
        key: "monto_total",
        aliases: [],
        categoria: "PAGOS",
        description: "Valor total de todos los números del cliente (reservados + pagados) en el evento activo",
        example: "$50.000",
        requires: ["usuario", "evento", "estado_pago"],
        type: "moneda",
        estado: "NUEVA",
        fuente: "resultado.montoTotal (construirFacetaEstadoNumeros, modo monto — resolverConsulta.js)"
    },
    {
        key: "monto_pagado",
        aliases: [],
        categoria: "PAGOS",
        description: "Monto que el cliente ya pagó",
        example: "$30.000",
        requires: ["usuario", "evento", "estado_pago"],
        type: "moneda",
        estado: "NUEVA",
        fuente: "resultado.montoPagado (construirFacetaEstadoNumeros, modo monto — resolverConsulta.js)"
    },
    {
        key: "monto_pendiente",
        aliases: ["pago_pendiente"],
        categoria: "PAGOS",
        description: "Monto que el cliente todavía debe",
        example: "$20.000",
        requires: ["usuario", "evento", "estado_pago"],
        type: "moneda",
        estado: "NUEVA",
        fuente: "resultado.montoPendiente (construirFacetaEstadoNumeros, modo monto — resolverConsulta.js)"
    },

    // -------------------- EVENTO --------------------
    {
        key: "evento",
        // "loteria": verificado contra bot/funciones/eventos/extractor/
        // extraerNombreEvento.js — el nombre de la lotería (ej. "Lotería
        // Boyacá") ES el mismo valor que ya se guarda como
        // eventos_bot.nombre_evento (extraerNombreEvento() busca la
        // lotería conocida y ESO es lo que se guarda). No existe una
        // columna/fuente separada para "lotería" — por eso es un alias,
        // nunca un dato inventado.
        aliases: ["nombre_evento", "loteria"],
        categoria: "EVENTO",
        description: "Nombre del evento/sorteo activo (incluye la lotería, cuando el nombre coincide con una lotería conocida)",
        example: "Lotería Boyacá",
        requires: ["evento"],
        type: "texto",
        estado: "EXISTENTE",
        fuente: "ctx.evento.nombre_evento (plantillaMensaje.js) / automation engine.js"
    },
    {
        key: "premio",
        aliases: [],
        categoria: "EVENTO",
        description: "Premio principal configurado para el evento activo",
        example: "Nevera",
        requires: ["evento"],
        type: "texto",
        estado: "NUEVA",
        fuente: "evento.premios[0].premio — hoy solo lo usa automation/engine.js, dato real ya existente"
    },

    // -------------------- FECHA Y HORA --------------------
    {
        key: "fecha",
        aliases: [],
        categoria: "FECHA_HORA",
        description: "Fecha del evento activo",
        example: "2026-01-20",
        requires: ["evento"],
        type: "fecha",
        estado: "EXISTENTE",
        fuente: "ctx.evento.fecha_evento"
    },
    {
        key: "hora",
        aliases: [],
        categoria: "FECHA_HORA",
        description: "Hora de cierre del evento, formateada en 12h para el cliente",
        example: "8:00 PM",
        requires: ["evento"],
        type: "hora",
        estado: "EXISTENTE",
        fuente: "formatHora12(ctx.evento.hora_fin) (plantillaMensaje.js)"
    },
    {
        key: "hora_cierre",
        aliases: [],
        categoria: "FECHA_HORA",
        description: "Mismo dato que 'hora' (cierre del evento); el motor de automatización lo usa en su formato original de 24h sin formatear — alias conceptual, cada motor conserva su propio formato de salida",
        example: "20:00",
        requires: ["evento"],
        type: "hora",
        estado: "EXISTENTE",
        fuente: "evento.hora_cierre (automation engine.js::construirVariablesDesdeEvento)",
        aliasDe: "hora"
    },

    // -------------------- GRAMÁTICA (concordancia singular/plural) -------
    // Las 15 variables base de gramatica.js. Cada una también existe en
    // forma sufijada "_reservados" / "_ocupados" / "_disponibles" cuando
    // una plantilla necesita concordar con un conjunto de números
    // independiente del principal (ver GRAMATICA_KEYS/CONJUNTOS_GRAMATICA
    // más abajo) — no se listan 45 filas repetidas, el resolver reconoce
    // el patrón mecánicamente, igual que ya hace gramatica.js.
    {
        key: "numero_numeros",
        aliases: [],
        categoria: "NUMEROS",
        description: "\"número\" o \"números\" según la cantidad (concordancia)",
        example: "números",
        requires: [],
        type: "concordancia",
        estado: "EXISTENTE",
        fuente: "gramatica.js::construirVariablesGramaticales"
    },
    { key: "tu_numero_tus_numeros", aliases: [], categoria: "NUMEROS", description: "\"tu número\" o \"tus números\" según la cantidad", example: "tus números", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "su_numero_sus_numeros", aliases: [], categoria: "NUMEROS", description: "\"su número\" o \"sus números\" (forma formal)", example: "sus números", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "el_numero_los_numeros", aliases: [], categoria: "NUMEROS", description: "\"el número\" o \"los números\"", example: "los números", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "ese_esos", aliases: [], categoria: "NUMEROS", description: "\"ese número\" o \"esos números\"", example: "esos números", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "esta_estan", aliases: [], categoria: "NUMEROS", description: "\"está\" o \"están\"", example: "están", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "estaba_estaban", aliases: [], categoria: "NUMEROS", description: "\"estaba\" o \"estaban\"", example: "estaban", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "es_son", aliases: [], categoria: "NUMEROS", description: "\"es\" o \"son\"", example: "son", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "reservado_reservados", aliases: [], categoria: "NUMEROS", description: "\"reservado\" o \"reservados\"", example: "reservados", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "ocupado_ocupados", aliases: [], categoria: "DISPONIBILIDAD", description: "\"ocupado\" o \"ocupados\"", example: "ocupados", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "disponible_disponibles", aliases: [], categoria: "DISPONIBILIDAD", description: "\"disponible\" o \"disponibles\"", example: "disponibles", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "libre_libres", aliases: [], categoria: "DISPONIBILIDAD", description: "\"libre\" o \"libres\"", example: "libres", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "quedo_quedaron", aliases: [], categoria: "NUMEROS", description: "\"quedó\" o \"quedaron\"", example: "quedaron", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "queda_quedan", aliases: [], categoria: "NUMEROS", description: "\"queda\" o \"quedan\"", example: "quedan", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" },
    { key: "tuyo_tuyos", aliases: [], categoria: "NUMEROS", description: "\"tuyo\" o \"tuyos\"", example: "tuyos", requires: [], type: "concordancia", estado: "EXISTENTE", fuente: "gramatica.js" }

];

// Claves base de gramática (para reconocer el patrón "<base>_<conjunto>",
// ej. "ocupado_ocupados_ocupados") sin duplicar 45 filas en el catálogo.
const GRAMATICA_KEYS = [
    "numero_numeros", "tu_numero_tus_numeros", "su_numero_sus_numeros",
    "el_numero_los_numeros", "ese_esos", "esta_estan", "estaba_estaban",
    "es_son", "reservado_reservados", "ocupado_ocupados",
    "disponible_disponibles", "libre_libres", "quedo_quedaron",
    "queda_quedan", "tuyo_tuyos"
];

const CONJUNTOS_GRAMATICA = ["reservados", "ocupados", "disponibles"];

// Mapa alias -> clave canónica (construido una sola vez a partir de CATALOGO).
const MAPA_ALIASES = {};
for (const variable of CATALOGO) {
    for (const alias of variable.aliases || []) {
        MAPA_ALIASES[alias] = variable.key;
    }
}

const MAPA_POR_CLAVE = {};
for (const variable of CATALOGO) {
    MAPA_POR_CLAVE[variable.key] = variable;
}

// ==========================================================================
// CATÁLOGO GLOBAL UNIFICADO (Fase "Variables Globales") — el catálogo
// ESTÁTICO de arriba (CATALOGO) sigue siendo exactamente el mismo, sin
// tocar ni una fila. Lo único que cambia es que las funciones de
// reconocimiento ahora aceptan, además, una lista OPCIONAL de variables
// DINÁMICAS (filas reales de la tabla variables_globales, ya normalizadas
// con normalizarVariableDinamica() más abajo). Si el llamador no pasa esa
// lista (todo el código existente que no la conoce), el comportamiento es
// IDÉNTICO al de siempre — cero regresión.
//
// "No crear duplicados silenciosos": la validación de unicidad del
// identificador contra el catálogo ESTÁTICO (¿ya existe esa clave o alias
// como variable existente?) se hace al CREAR la variable dinámica (ver
// variablesGlobalesRepo.js / frontend), no aquí — aquí solo se documenta el
// contrato: un identificador dinámico NUNCA debe coincidir con una clave o
// alias ya existente en CATALOGO.
// ==========================================================================

// Formato válido de un identificador de variable — el mismo alfabeto que ya
// exige \w+ en el regex de sustitución de aplicarPlantilla()/resolverTexto():
// debe empezar con letra minúscula, seguido de minúsculas/dígitos/"_".
const REGEX_IDENTIFICADOR_VALIDO = /^[a-z][a-z0-9_]*$/;

function esIdentificadorValido(identificador) {
    return typeof identificador === "string" && REGEX_IDENTIFICADOR_VALIDO.test(identificador);
}

// Convierte una fila real de variables_globales al MISMO formato que una
// entrada de CATALOGO, para que el resto del sistema (resolverClaveCanonica,
// listarCatalogo, etc.) la trate exactamente igual sin ningún camino
// especial. "dinamica: true" es la única marca que la distingue — la usa
// resolverVariables.js para saber que el singular/plural/valor viene
// directo de la fila, no de gramatica.js.
function normalizarVariableDinamica(fila) {

    if (!fila || !fila.identificador) return null;

    // "example" es SOLO metadata de presentación (autocomplete/preview) —
    // nunca se usa para resolver el valor real (eso siempre lee
    // singular/plural/valor directo, ver resolverVariables.js). Si el admin
    // escribió un ejemplo propio (fase "Ejemplo" del panel), ese manda; si
    // lo dejó vacío, se conserva el fallback automático de siempre
    // (singular / plural para concordancia, el valor fijo para texto).
    const ejemplo = fila.ejemplo && String(fila.ejemplo).trim()
        ? fila.ejemplo
        : (fila.tipo === "concordancia" ? `${fila.singular} / ${fila.plural}` : (fila.valor || ""));

    return {
        key: fila.identificador,
        aliases: [],
        categoria: fila.categoria || "PERSONALIZADA",
        description: fila.descripcion || fila.nombre_visible || "",
        example: ejemplo,
        requires: [],
        type: fila.tipo === "concordancia" ? "concordancia" : "texto",
        estado: "NUEVA",
        dinamica: true,
        singular: fila.singular ?? null,
        plural: fila.plural ?? null,
        valor: fila.valor ?? null
    };

}

function mapaPorClaveDe(catalogoExtra) {

    const mapa = {};

    for (const variable of catalogoExtra || []) {
        if (variable && variable.key) mapa[variable.key] = variable;
    }

    return mapa;

}

// Resuelve un nombre escrito en una plantilla (puede ser la clave
// canónica, un alias, o una forma sufijada de gramática) a su definición
// de catálogo + metadatos de reconocimiento. Devuelve null si el nombre
// no es una variable conocida — nunca inventa una coincidencia parcial.
//
// catalogoExtra (opcional): variables dinámicas YA normalizadas (ver
// normalizarVariableDinamica) — se consultan SOLO si el nombre no se
// reconoce en el catálogo estático (las 15 gramaticales y el resto de
// EXISTENTE/NUEVA siguen resolviendo exactamente igual que antes).
function resolverClaveCanonica(nombre, catalogoExtra) {

    if (!nombre || typeof nombre !== "string") {
        return null;
    }

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

    if (catalogoExtra && catalogoExtra.length > 0) {

        const mapaExtra = mapaPorClaveDe(catalogoExtra);

        if (mapaExtra[nombre]) {
            return { definicion: mapaExtra[nombre], esGramaticaPorConjunto: false, conjunto: null };
        }

    }

    return null;

}

function obtenerVariable(key) {
    return MAPA_POR_CLAVE[key] || null;
}

// listarCatalogo(catalogoExtra?) -> catálogo estático + dinámico, en ese
// orden. Si un identificador dinámico coincidiera con uno estático (no
// debería llegar a pasar: se valida al crear la variable), el estático
// queda primero y por tanto "gana" en cualquier búsqueda por índice —
// nunca hay dos comportamientos distintos para el mismo nombre.
function listarCatalogo(catalogoExtra) {

    if (!catalogoExtra || catalogoExtra.length === 0) {
        return CATALOGO;
    }

    const clavesEstaticas = new Set(CATALOGO.map(v => v.key));

    return [...CATALOGO, ...catalogoExtra.filter(v => v && !clavesEstaticas.has(v.key))];

}

function esVariableConocida(nombre, catalogoExtra) {
    return resolverClaveCanonica(nombre, catalogoExtra) !== null;
}

// Escanea un contenido de plantilla ({{variable}} o {{variable|modificador}})
// y devuelve los nombres que NO existen en el catálogo (ni como clave, ni
// como alias, ni como forma sufijada de gramática, ni en catalogoExtra).
// Usado al guardar una plantilla — nunca corrige ni sustituye el nombre,
// solo lo señala (sección 16). El modificador ("|upper", etc.) se ignora
// para esta validación: lo que importa es si la VARIABLE existe.
function extraerVariablesDesconocidas(texto, catalogoExtra) {

    if (typeof texto !== "string" || !texto) {
        return [];
    }

    const encontradas = new Set();
    const desconocidas = [];
    const regex = /\{\{\s*(\w+)(?:\|\w+)?\s*\}\}/g;
    let coincidencia;

    while ((coincidencia = regex.exec(texto)) !== null) {

        const nombre = coincidencia[1];

        if (encontradas.has(nombre)) {
            continue;
        }

        encontradas.add(nombre);

        if (!esVariableConocida(nombre, catalogoExtra)) {
            desconocidas.push(nombre);
        }

    }

    return desconocidas;

}

module.exports = {
    CATEGORIAS,
    CATALOGO,
    GRAMATICA_KEYS,
    CONJUNTOS_GRAMATICA,
    resolverClaveCanonica,
    obtenerVariable,
    listarCatalogo,
    esVariableConocida,
    extraerVariablesDesconocidas,
    esIdentificadorValido,
    normalizarVariableDinamica
};
