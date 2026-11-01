// ==========================================================================
// sorteos/estilosMensaje.js — catálogo de los 20 estilos del mensaje de
// publicación de un sorteo. PURO: solo datos.
//
// Cada estilo es una plantilla con {{variables}} (ver mensajes.js). Se
// diferencian por composición: orden de los bloques, encabezados,
// separadores, bloques monoespaciados, citas de WhatsApp o prosa; no solo
// por los emojis. El sorteo guarda una COPIA del texto (editable), así que
// cambiar un estilo aquí no altera los sorteos ya creados.
//
// Una línea cuyo único contenido antes de la variable es un marco ("│ ",
// "> ") o una sangría repite ese marco en cada línea del valor (premios,
// cuentas): así las listas quedan dentro del boleto, de la cita, etc.
//
// "clasico" es EXACTAMENTE el mensaje que el panel publicaba antes de los
// estilos (y el que se usa cuando un sorteo antiguo no guardó texto).
// ==========================================================================

const ESTILO_PREDETERMINADO = "clasico";

const ESTILOS = [
    {
        id: "clasico",
        nombre: "Clásico EFAAT",
        descripcion: "El mensaje de siempre: título, datos con emoji, premios y pagos.",
        plantilla: [
            "🎉 *{{nombre}}* 🎉",
            "🕘 Juega a las {{hora}}",
            "💵 Valor del número: {{valor}}",
            "",
            "🏆 *Premios*",
            "{{premios}}",
            "",
            "💳 *Pagos*",
            "{{cuentas}}",
            "",
            "✍️ Escribe el número que quieres para reservarlo. Reservas hasta las {{hora_cierre}}."
        ].join("\n")
    },
    {
        id: "compacto",
        nombre: "Compacto",
        descripcion: "Cuatro líneas: todo lo esencial en un vistazo.",
        plantilla: [
            "🎯 *{{nombre}}* · {{dia_semana}} {{hora}}",
            "💵 {{valor}} · 🏆 {{premios_linea}}",
            "💳 {{cuentas_compacto}}",
            "✍️ Reserva tu número hasta las {{hora_cierre}}."
        ].join("\n")
    },
    {
        id: "ficha",
        nombre: "Ficha técnica",
        descripcion: "Bloque monoespaciado con los datos alineados, como una ficha.",
        plantilla: [
            "*FICHA DEL SORTEO*",
            "```",
            "Lotería : {{nombre}}",
            "Fecha   : {{fecha_larga}}",
            "Juega   : {{hora}}",
            "Cierre  : {{hora_cierre}}",
            "Valor   : {{valor}}",
            "Números : {{rango}}",
            "```",
            "*Premios*",
            "{{premios_numerados}}",
            "",
            "*Pagos*",
            "{{cuentas}}",
            "",
            "Responde con el número que quieres reservar."
        ].join("\n")
    },
    {
        id: "cartel",
        nombre: "Cartel",
        descripcion: "Título en mayúsculas entre líneas gruesas y premio mayor destacado.",
        plantilla: [
            "━━━━━━━━━━━━━━━━━━",
            "*{{nombre_mayusculas}}*",
            "━━━━━━━━━━━━━━━━━━",
            "",
            "🏆 *GRAN PREMIO*",
            "{{premio_mayor}}",
            "",
            "📅 {{fecha_titulo}} · {{hora}}",
            "💵 Número a {{valor}}",
            "",
            "━━ PREMIOS ━━",
            "{{premios}}",
            "",
            "━━ PAGOS ━━",
            "{{cuentas}}",
            "",
            "🔥 ¡Aparta tu número antes de las {{hora_cierre}}!"
        ].join("\n")
    },
    {
        id: "boleto",
        nombre: "Boleto",
        descripcion: "Enmarcado como un boleto, con secciones separadas por cortes.",
        plantilla: [
            "┌────────────────────",
            "│ 🎟️ *BOLETO · {{nombre_mayusculas}}*",
            "│ 📅 {{fecha_titulo}}",
            "│ 🕘 Juega: {{hora}}",
            "│ 💵 Valor: {{valor}}",
            "├────────────────────",
            "│ {{premios}}",
            "├────────────────────",
            "│ {{cuentas}}",
            "└────────────────────",
            "✂️ Escribe tu número para reservarlo (hasta las {{hora_cierre}})."
        ].join("\n")
    },
    {
        id: "pregunta_respuesta",
        nombre: "Pregunta y respuesta",
        descripcion: "Resuelve las dudas típicas: cuándo, cuánto, qué se gana y dónde pagar.",
        plantilla: [
            "❓ *Todo sobre {{nombre}}*",
            "",
            "❓ *¿Cuándo se juega?*",
            "{{fecha_titulo}} a las {{hora}}.",
            "",
            "❓ *¿Cuánto vale el número?*",
            "{{valor}}",
            "",
            "❓ *¿Qué puedo ganar?*",
            "{{premios}}",
            "",
            "❓ *¿Dónde pago?*",
            "{{cuentas}}",
            "",
            "❓ *¿Hasta cuándo reservo?*",
            "Hasta las {{hora_cierre}}. Escribe tu número aquí."
        ].join("\n")
    },
    {
        id: "urgencia",
        nombre: "Urgencia",
        descripcion: "Abre con el cierre de reservas y la llamada a la acción.",
        plantilla: [
            "⏰ *¡RESERVAS HASTA LAS {{hora_cierre}}!* ⏰",
            "",
            "👉 Escribe YA el número que quieres.",
            "",
            "*{{nombre}}* · {{dia_semana}} {{hora}}",
            "💵 {{valor}} por número",
            "🏆 {{premios_linea}}",
            "",
            "💳 Paga en:",
            "{{cuentas}}",
            "",
            "⚠️ Después del cierre no se reciben más reservas."
        ].join("\n")
    },
    {
        id: "premio_primero",
        nombre: "Premio primero",
        descripcion: "El premio mayor encabeza el mensaje; los datos vienen después.",
        plantilla: [
            "🏆 *{{premio_mayor}}*",
            "_puede ser tuyo con un número de {{valor}}_",
            "",
            "🎰 {{nombre}} · {{fecha_larga}} · {{hora}}",
            "",
            "*Todos los premios*",
            "{{premios}}",
            "",
            "*Pagos*",
            "{{cuentas}}",
            "",
            "Reserva hasta las {{hora_cierre}} escribiendo tu número."
        ].join("\n")
    },
    {
        id: "formal",
        nombre: "Comunicado formal",
        descripcion: "Carta con saludo, cuerpo en prosa y despedida.",
        plantilla: [
            "*COMUNICADO · {{nombre_mayusculas}}*",
            "",
            "Estimados participantes:",
            "",
            "Les informamos que el sorteo *{{nombre}}* se realizará el {{fecha_larga}} a las {{hora}}. El valor de cada número es de {{valor}}.",
            "",
            "Premios:",
            "{{premios_texto}}",
            "",
            "Los pagos pueden realizarse en:",
            "{{cuentas}}",
            "",
            "Las reservas se recibirán hasta las {{hora_cierre}}. Para participar, respondan con el número de su preferencia.",
            "",
            "Atentamente,",
            "La administración"
        ].join("\n")
    },
    {
        id: "citas",
        nombre: "Citas",
        descripcion: "Cada bloque va en una cita de WhatsApp (barra lateral).",
        plantilla: [
            "*{{nombre}}*",
            "",
            "> 📅 {{fecha_titulo}} · {{hora}}",
            "> 💵 {{valor}} por número",
            "",
            "*Premios*",
            "> {{premios}}",
            "",
            "*Pagos*",
            "> {{cuentas}}",
            "",
            "_Reserva escribiendo tu número antes de las {{hora_cierre}}._"
        ].join("\n")
    },
    {
        id: "noticia",
        nombre: "Titular de noticia",
        descripcion: "Titular, entradilla en prosa y secciones como una nota de prensa.",
        plantilla: [
            "📰 *ÚLTIMA HORA*",
            "*Abierta la tabla de {{nombre}}*",
            "",
            "_{{fecha_titulo}}_ — {{nombre}} juega a las {{hora}}. Cada número cuesta {{valor}} y las reservas cierran a las {{hora_cierre}}. En juego: {{premio_mayor}}.",
            "",
            "*Premios en juego*",
            "{{premios}}",
            "",
            "*Medios de pago*",
            "{{cuentas}}"
        ].join("\n")
    },
    {
        id: "conversacional",
        nombre: "Conversacional",
        descripcion: "Un mensaje cercano, escrito como si hablaras con el grupo.",
        plantilla: [
            "¡Hola a todos! 👋",
            "",
            "Ya abrimos la tabla de *{{nombre}}*, que juega el {{fecha_larga}} a las {{hora}}. Cada número vale {{valor}} y pueden ganar:",
            "",
            "{{premios}}",
            "",
            "Para pagar pueden usar:",
            "{{cuentas}}",
            "",
            "Solo escríbanme el número que quieren y se lo aparto 😊 Tienen hasta las {{hora_cierre}}."
        ].join("\n")
    },
    {
        id: "pasos",
        nombre: "Pasos",
        descripcion: "Cómo participar en tres pasos: elegir, pagar y enviar el comprobante.",
        plantilla: [
            "🎯 *{{nombre}}* — {{fecha_larga}}, {{hora}}",
            "",
            "*Paso 1 · Elige tu número*",
            "Escríbelo en este grupo ({{rango}}). Cada número vale {{valor}}.",
            "",
            "*Paso 2 · Paga*",
            "{{cuentas}}",
            "",
            "*Paso 3 · Envía el comprobante*",
            "Antes de las {{hora_cierre}}.",
            "",
            "🏆 *Premios*",
            "{{premios}}"
        ].join("\n")
    },
    {
        id: "tabla_guias",
        nombre: "Tabla con guías",
        descripcion: "Datos y premios en columnas unidas por puntos guía.",
        plantilla: [
            "*{{nombre}}* ({{dia_semana}})",
            "```",
            "Fecha ........ {{fecha_titulo}}",
            "Juega ........ {{hora}}",
            "Cierre ....... {{hora_cierre}}",
            "Valor ........ {{valor}}",
            "```",
            "*Premios*",
            "```",
            "{{premios_guias}}",
            "```",
            "*Pagos*",
            "{{cuentas}}",
            "",
            "Responde con tu número para reservarlo."
        ].join("\n")
    },
    {
        id: "minimalista",
        nombre: "Minimalista",
        descripcion: "Sin emojis: tipografía, cursivas y rayas.",
        plantilla: [
            "{{nombre}}",
            "_{{fecha_titulo}} · {{hora}}_",
            "",
            "Número — {{valor}}",
            "Cierre — {{hora_cierre}}",
            "",
            "Premios",
            "{{premios_texto}}",
            "",
            "Pagos",
            "{{cuentas_compacto}}",
            "",
            "Responde con tu número."
        ].join("\n")
    },
    {
        id: "agenda",
        nombre: "Agenda",
        descripcion: "Encabezado con el día y los horarios en orden cronológico.",
        plantilla: [
            "📅 *{{fecha_titulo}}*",
            "━━━━━━━━━━━━",
            "⏳ {{hora_cierre}} · cierre de reservas",
            "🎰 {{hora}} · juega {{nombre}}",
            "━━━━━━━━━━━━",
            "💵 {{valor}} por número ({{rango}})",
            "",
            "🏆 Premios",
            "{{premios}}",
            "",
            "💳 Pagos",
            "{{cuentas}}",
            "",
            "✍️ Escribe tu número para apartarlo."
        ].join("\n")
    },
    {
        id: "tarjetas",
        nombre: "Tarjetas por sección",
        descripcion: "Secciones con título en mayúsculas y contenido sangrado.",
        plantilla: [
            "◆ *{{nombre}}* ◆",
            "",
            "▸ *CUÁNDO*",
            "   {{fecha_titulo}} · {{hora}}",
            "",
            "▸ *VALOR*",
            "   {{valor}} por número",
            "",
            "▸ *PREMIOS*",
            "   {{premios}}",
            "",
            "▸ *PAGOS*",
            "   {{cuentas}}",
            "",
            "▸ *RESERVAS*",
            "   Hasta las {{hora_cierre}}: escribe tu número."
        ].join("\n")
    },
    {
        id: "lista_numerada",
        nombre: "Lista numerada",
        descripcion: "Datos y premios como listas numeradas de WhatsApp.",
        plantilla: [
            "*{{nombre}}* — datos del sorteo",
            "",
            "1. Fecha: {{fecha_larga}}",
            "2. Hora: {{hora}}",
            "3. Valor: {{valor}}",
            "4. Cierre de reservas: {{hora_cierre}}",
            "",
            "*Premios*",
            "{{premios_numerados}}",
            "",
            "*Pagos*",
            "{{cuentas}}",
            "",
            "Responde con el número que quieres."
        ].join("\n")
    },
    {
        id: "ornamental",
        nombre: "Marco ornamental",
        descripcion: "Título entre orlas de estrellas y viñetas decorativas.",
        plantilla: [
            "✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦",
            "*{{nombre}}*",
            "✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦",
            "",
            "❖ {{fecha_titulo}}",
            "❖ {{hora}}",
            "❖ {{valor}} el número",
            "",
            "✧ Premios ✧",
            "{{premios}}",
            "",
            "✧ Pagos ✧",
            "{{cuentas}}",
            "",
            "✦ Reservas hasta las {{hora_cierre}} ✦"
        ].join("\n")
    },
    {
        id: "pagos_primero",
        nombre: "Pagos primero",
        descripcion: "Las cuentas de pago encabezan el mensaje, para grupos que pagan al reservar.",
        plantilla: [
            "💳 *PAGA Y ASEGURA TU NÚMERO*",
            "{{cuentas}}",
            "",
            "━━━━━━━━━━",
            "🎰 *{{nombre}}*",
            "📅 {{fecha_titulo}} · {{hora}}",
            "💵 {{valor}} por número",
            "🏆 {{premios_linea}}",
            "━━━━━━━━━━",
            "",
            "📩 Envía tu número y el comprobante antes de las {{hora_cierre}}."
        ].join("\n")
    }
];

const POR_ID = new Map(ESTILOS.map(e => [e.id, e]));

const esEstilo = (id) => typeof id === "string" && POR_ID.has(id);

// Plantilla de un estilo; uno desconocido usa el clásico.
function plantillaDe(id) {
    return (POR_ID.get(id) || POR_ID.get(ESTILO_PREDETERMINADO)).plantilla;
}

module.exports = { ESTILOS, ESTILO_PREDETERMINADO, esEstilo, plantillaDe };
