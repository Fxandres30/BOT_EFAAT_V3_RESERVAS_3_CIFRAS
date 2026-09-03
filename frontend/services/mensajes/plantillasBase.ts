// Plantillas iniciales (15 por tipo soportado) — datos puros, no UI.
// Son solo un punto de partida: el usuario puede editar, duplicar,
// eliminar o crear más desde el panel (sin límite artificial).
// Los nombres de estilo son únicamente etiquetas iniciales, no controlan
// ninguna lógica del BOT.

export interface PlantillaBase {
    nombre: string;
    estilo: string;
    contenido: string;
}

// Los 15 estilos base, en el orden pedido. "Personalizada" siempre queda
// en blanco para que el usuario escriba desde cero.
const ESTILOS = [
    "Natural", "Súper corta", "WhatsApp", "Amigable", "Entusiasta",
    "Buena suerte", "Detallada", "Directa", "Casual", "Profesional",
    "Resumen", "Enfocada en evento", "Enfocada en números",
    "Casual + emojis", "Personalizada"
];

function construir(contenidos: string[]): PlantillaBase[] {

    return ESTILOS.map((nombre, i) => ({
        nombre,
        estilo: nombre.toLowerCase().replace(/\s+/g, "_"),
        contenido: contenidos[i] || ""
    }));

}

const PLANTILLAS_POR_TIPO: Record<string, PlantillaBase[]> = {

    reserva_completa: construir([
        "¡Listo {{cliente}}! Quedaron reservados: {{numeros_reservados}} 🎟️",
        "Reservado: {{numeros_reservados}} ✅",
        "{{cliente}}, tus números {{numeros_reservados}} ya quedaron reservados 👍",
        "¡Hola {{cliente}}! Con gusto reservamos {{numeros_reservados}} para ti 😊",
        "¡Genial {{cliente}}! {{numeros_reservados}} son tuyos, mucha suerte 🎉",
        "{{cliente}}, {{numeros_reservados}} reservados. ¡Que la suerte te acompañe! 🍀",
        "{{cliente}}, confirmamos la reserva de {{numeros_reservados}} para {{evento}} a las {{hora}}. Valor por número: ${{precio}}.",
        "Reservados {{numeros_reservados}}.",
        "Listo {{cliente}}, ya quedaron {{numeros_reservados}} a tu nombre.",
        "Estimado {{cliente}}, le confirmamos la reserva de los números {{numeros_reservados}} para {{evento}}.",
        "{{numeros_reservados}} reservados para {{cliente}}.",
        "{{cliente}}, tus números {{numeros_reservados}} quedaron reservados para {{evento}}, a las {{hora}}.",
        "{{numeros_reservados}} → reservados a nombre de {{cliente}}.",
        "¡Wuju {{cliente}}! 🥳 {{numeros_reservados}} son tuyos 🎊🍀✨",
        ""
    ]),

    reserva_parcial: construir([
        "{{cliente}}, {{numeros_reservados}} quedaron reservados. {{numeros_ocupados}} ya estaban ocupados.",
        "Reservados: {{numeros_reservados}}. Ocupados: {{numeros_ocupados}}.",
        "{{cliente}}, logramos apartar {{numeros_reservados}}. {{numeros_ocupados}} ya no estaban disponibles 🙏",
        "¡Hola {{cliente}}! Te reservamos {{numeros_reservados}}. Lo sentimos, {{numeros_ocupados}} ya tenían dueño.",
        "{{cliente}}, ¡{{numeros_reservados}} son tuyos! {{numeros_ocupados}} se adelantaron 😅",
        "{{numeros_reservados}} reservados para ti, {{cliente}}. ¡Suerte con esos números! ({{numeros_ocupados}} ya estaban tomados)",
        "{{cliente}}, para {{evento}}: se reservaron {{numeros_reservados}} a tu nombre; {{numeros_ocupados}} ya estaban ocupados por otra persona.",
        "Reservados: {{numeros_reservados}}. No disponibles: {{numeros_ocupados}}.",
        "{{cliente}}, {{numeros_reservados}} listos. {{numeros_ocupados}} ya no había.",
        "Estimado {{cliente}}, se confirma la reserva parcial: {{numeros_reservados}}. Los números {{numeros_ocupados}} no estaban disponibles.",
        "{{numeros_reservados}} reservados / {{numeros_ocupados}} ocupados.",
        "{{cliente}}, en {{evento}} quedaron reservados {{numeros_reservados}}; {{numeros_ocupados}} ya no estaban libres.",
        "Solicitaste varios números: {{numeros_reservados}} confirmados, {{numeros_ocupados}} ya ocupados.",
        "{{cliente}} 🙌 {{numeros_reservados}} son tuyos, pero {{numeros_ocupados}} ya volaron 😬🔥",
        ""
    ]),

    numero_ocupado: construir([
        "{{cliente}}, el número {{numeros_solicitados}} ya está ocupado.",
        "{{numeros_solicitados}} ya está ocupado.",
        "Uy {{cliente}}, {{numeros_solicitados}} ya tiene dueño 🙏",
        "¡Hola {{cliente}}! Lo sentimos, el {{numeros_solicitados}} ya fue tomado por otra persona.",
        "{{cliente}}, casi lo logras, pero {{numeros_solicitados}} ya se fue 😅 ¡anímate con otro!",
        "{{numeros_solicitados}} ya no está libre. ¡Prueba con otro número, seguro hay suerte! 🍀",
        "{{cliente}}, el número {{numeros_solicitados}} que solicitaste para {{evento}} ya se encuentra ocupado por otro participante.",
        "{{numeros_solicitados}}: ocupado.",
        "{{cliente}}, ese ya no está. {{numeros_solicitados}} ocupado.",
        "Estimado {{cliente}}, le informamos que el número {{numeros_solicitados}} ya no se encuentra disponible.",
        "{{numeros_solicitados}} → ocupado.",
        "{{cliente}}, en {{evento}} el número {{numeros_solicitados}} ya fue reservado por otra persona.",
        "El número {{numeros_solicitados}} ya está ocupado.",
        "{{cliente}} 😅 el {{numeros_solicitados}} ya voló, ¡prueba con otro! 🔥",
        ""
    ]),

    todos_ocupados: construir([
        "{{cliente}}, los números {{numeros_solicitados}} ya están ocupados.",
        "{{numeros_solicitados}} ya ocupados.",
        "{{cliente}}, esos ya no estaban 🙏 {{numeros_solicitados}} ocupados.",
        "¡Hola {{cliente}}! Lo sentimos, {{numeros_solicitados}} ya fueron tomados.",
        "{{cliente}}, {{numeros_solicitados}} ya volaron 😅 ¡intenta con otros!",
        "{{numeros_solicitados}} ya no están libres. ¡Ánimo, prueba con otros números! 🍀",
        "{{cliente}}, los números {{numeros_solicitados}} que solicitaste para {{evento}} ya se encuentran ocupados por otros participantes.",
        "{{numeros_solicitados}}: todos ocupados.",
        "{{cliente}}, esos ya no hay. {{numeros_solicitados}} ocupados.",
        "Estimado {{cliente}}, le informamos que los números {{numeros_solicitados}} ya no se encuentran disponibles.",
        "{{numeros_solicitados}} → todos ocupados.",
        "{{cliente}}, en {{evento}} los números {{numeros_solicitados}} ya fueron reservados por otras personas.",
        "Los números {{numeros_solicitados}} ya están ocupados.",
        "{{cliente}} 😬 {{numeros_solicitados}} ya se fueron todos, ¡prueba con otros! 🔥",
        ""
    ]),

    mis_numeros: construir([
        "{{cliente}}, tus números son: {{numeros_reservados}}",
        "Tus números: {{numeros_reservados}}",
        "{{cliente}}, estos son los tuyos: {{numeros_reservados}} 😊",
        "¡Hola {{cliente}}! Estos son tus números: {{numeros_reservados}}",
        "{{cliente}}, ¡tienes {{numeros_reservados}}! Mucha suerte con ellos 🍀",
        "{{numeros_reservados}} son tuyos, {{cliente}}. ¡Que ganes! 🎉",
        "{{cliente}}, según nuestro registro, tus números reservados son: {{numeros_reservados}}.",
        "{{numeros_reservados}}",
        "{{cliente}}, tienes: {{numeros_reservados}}",
        "Estimado {{cliente}}, sus números registrados son: {{numeros_reservados}}.",
        "Tuyos: {{numeros_reservados}}",
        "{{cliente}}, para {{evento}} tienes: {{numeros_reservados}}",
        "Números a tu nombre: {{numeros_reservados}}",
        "{{cliente}} 🎫 tus números son {{numeros_reservados}} ✨",
        ""
    ]),

    mis_reservas: construir([
        "{{cliente}}, esto es lo que tienes reservado: {{numeros_reservados}}",
        "Reservado: {{numeros_reservados}}",
        "{{cliente}}, tienes reservado: {{numeros_reservados}} 📋",
        "¡Hola {{cliente}}! Esto tienes reservado hasta ahora: {{numeros_reservados}}",
        "{{cliente}}, ¡tienes reservado {{numeros_reservados}}! 🎉",
        "{{numeros_reservados}} reservado a tu nombre, {{cliente}}. ¡Suerte!",
        "{{cliente}}, en {{evento}} tienes reservado actualmente: {{numeros_reservados}}.",
        "{{numeros_reservados}}",
        "{{cliente}}, tienes: {{numeros_reservados}}",
        "Estimado {{cliente}}, su reserva actual es: {{numeros_reservados}}.",
        "Reserva actual: {{numeros_reservados}}",
        "{{cliente}}, para {{evento}} tu reserva es: {{numeros_reservados}}",
        "Reservado a tu nombre: {{numeros_reservados}}",
        "{{cliente}} 📋 llevas reservado {{numeros_reservados}} ✨",
        ""
    ]),

    cantidad_reservas: construir([
        "{{cliente}}, tienes {{cantidad}} número(s) reservado(s).",
        "Tienes {{cantidad}}.",
        "{{cliente}}, llevas {{cantidad}} número(s) 📋",
        "¡Hola {{cliente}}! Llevas {{cantidad}} número(s) reservado(s).",
        "{{cliente}}, ¡ya tienes {{cantidad}}! Sigue así 🎉",
        "{{cantidad}} reservados, {{cliente}}. ¡Mucha suerte! 🍀",
        "{{cliente}}, según nuestro registro tienes actualmente {{cantidad}} número(s) reservado(s).",
        "{{cantidad}}",
        "{{cliente}}, tienes {{cantidad}}.",
        "Estimado {{cliente}}, la cantidad de números reservados a su nombre es: {{cantidad}}.",
        "Cantidad: {{cantidad}}",
        "{{cliente}}, para {{evento}} llevas {{cantidad}} número(s).",
        "Total de números tuyos: {{cantidad}}",
        "{{cliente}} 🔢 llevas {{cantidad}} números ✨",
        ""
    ]),

    numero_especifico: construir([
        "{{cliente}}, sobre el {{numeros_solicitados}}: te cuento su estado.",
        "{{numeros_solicitados}}: revisado.",
        "{{cliente}}, ya revisé el {{numeros_solicitados}} por ti 👍",
        "¡Hola {{cliente}}! Consultando el número {{numeros_solicitados}} para ti.",
        "{{cliente}}, ¡vamos a ver qué pasó con el {{numeros_solicitados}}! 🔎",
        "Revisando {{numeros_solicitados}} para ti, {{cliente}}.",
        "{{cliente}}, con respecto al número {{numeros_solicitados}} que consultaste para {{evento}}, este es su estado actual.",
        "{{numeros_solicitados}}: estado consultado.",
        "{{cliente}}, el {{numeros_solicitados}}:",
        "Estimado {{cliente}}, en relación al número {{numeros_solicitados}} consultado, le informamos su estado.",
        "{{numeros_solicitados}} — estado:",
        "{{cliente}}, en {{evento}} el número {{numeros_solicitados}} tiene este estado:",
        "Número consultado: {{numeros_solicitados}}",
        "{{cliente}} 🔎 el {{numeros_solicitados}}... ¡vamos a ver! ✨",
        ""
    ]),

    disponibilidad: construir([
        "Números disponibles: {{numeros_disponibles}}",
        "Libres: {{numeros_disponibles}}",
        "Quedan disponibles: {{numeros_disponibles}} 😊",
        "¡Hola! Estos números siguen disponibles: {{numeros_disponibles}}",
        "¡Todavía hay buenos números! Disponibles: {{numeros_disponibles}} 🎉",
        "Disponibles: {{numeros_disponibles}}. ¡Elige el tuyo y mucha suerte! 🍀",
        "Para {{evento}}, los números que aún están disponibles son: {{numeros_disponibles}}. Los ya ocupados son: {{numeros_ocupados}}.",
        "Disponibles: {{numeros_disponibles}}",
        "Quedan: {{numeros_disponibles}}",
        "Se informa que los números disponibles actualmente son: {{numeros_disponibles}}.",
        "Disponibles ({{numeros_disponibles}}). Ocupados ({{numeros_ocupados}}).",
        "Para {{evento}}, disponibles: {{numeros_disponibles}}",
        "Números libres: {{numeros_disponibles}}",
        "¡Quedan varios! 👀 {{numeros_disponibles}} disponibles 🔥",
        ""
    ]),

    info_evento: construir([
        "Este sorteo es: {{evento}}, a las {{hora}}.",
        "{{evento}} — {{hora}}",
        "Es {{evento}}, hoy a las {{hora}} 😊",
        "¡Hola! El sorteo es {{evento}}, a las {{hora}}.",
        "¡Es {{evento}}! Sorteo a las {{hora}} 🎉 ¡mucha suerte!",
        "{{evento}} a las {{hora}}. ¡Suerte para todos! 🍀",
        "El evento activo actualmente es {{evento}}, programado para el {{fecha}} a las {{hora}}.",
        "{{evento}}, {{hora}}",
        "Es {{evento}}, {{hora}}.",
        "Se informa que el sorteo vigente es {{evento}}, con cierre programado a las {{hora}} del {{fecha}}.",
        "Evento: {{evento}} | Hora: {{hora}}",
        "Sorteo: {{evento}} — Fecha: {{fecha}} — Hora: {{hora}}",
        "Hora del sorteo {{evento}}: {{hora}}",
        "¡Es {{evento}}! 🎯 a las {{hora}} ✨🍀",
        ""
    ])

};

export function obtenerPlantillasBase(tipoId: string): PlantillaBase[] {
    return PLANTILLAS_POR_TIPO[tipoId] || [];
}
