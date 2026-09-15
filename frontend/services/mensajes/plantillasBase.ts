// Plantillas iniciales (15 por tipo soportado) — datos puros, no UI.
// Son solo un punto de partida: el usuario puede editar, duplicar,
// eliminar o crear más desde el panel (sin límite artificial).
// Los nombres de estilo son únicamente etiquetas iniciales, no controlan
// ninguna lógica del BOT.
//
// Auditoría de frontend (módulo Mensajes): este archivo usa las variables
// gramaticales de concordancia singular/plural (backend/bot/ai/gramatica.js
// + backend/bot/ai/plantillaMensaje.js) allí donde el texto original tenía
// un problema real de concordancia. El criterio de CADA sustitución es
// exactamente el mismo, semántico, ya validado en
// backend/_migracion_propuesta_fase2.js (66 filas migradas en Supabase +
// 85 sin cambio por ser ya invariantes) — no se inventó ninguna regla
// nueva aquí. Objetivo: que un usuario nuevo, o un tipo que se quede sin
// plantillas y se vuelva a sembrar, ya nazca con las plantillas
// correctas, sin reintroducir "1 números" o "3 número(s)".

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
        "¡Listo {{cliente}}! {{quedo_quedaron}} {{reservado_reservados}}: {{numeros_reservados}} 🎟️",
        "{{reservado_reservados}}: {{numeros_reservados}} ✅",
        "{{cliente}}, {{tu_numero_tus_numeros}} {{numeros_reservados}} ya {{quedo_quedaron}} {{reservado_reservados}} 👍",
        "¡Hola {{cliente}}! Con gusto reservamos {{numeros_reservados}} para ti 😊",
        "¡Genial {{cliente}}! {{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, mucha suerte 🎉",
        "{{cliente}}, {{numeros_reservados}} {{reservado_reservados}}. ¡Que la suerte te acompañe! 🍀",
        "{{cliente}}, confirmamos la reserva de {{numeros_reservados}} para {{evento}} a las {{hora}}. Valor por número: ${{precio}}.",
        "{{reservado_reservados}} {{numeros_reservados}}.",
        "Listo {{cliente}}, ya {{quedo_quedaron}} {{numeros_reservados}} a tu nombre.",
        "Estimado {{cliente}}, le confirmamos la reserva de {{numeros_reservados}} para {{evento}}.",
        "{{numeros_reservados}} {{reservado_reservados}} para {{cliente}}.",
        "{{cliente}}, {{tu_numero_tus_numeros}} {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}} para {{evento}}, a las {{hora}}.",
        "{{numeros_reservados}} → {{reservado_reservados}} a nombre de {{cliente}}.",
        "¡Wuju {{cliente}}! 🥳 {{numeros_reservados}} {{es_son}} {{tuyo_tuyos}} 🎊🍀✨",
        ""
    ]),

    reserva_parcial: construir([
        "{{cliente}}, {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}}. {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}.",
        "{{reservado_reservados}}: {{numeros_reservados}}. {{ocupado_ocupados_ocupados}}: {{numeros_ocupados}}.",
        "{{cliente}}, logramos apartar {{numeros_reservados}}. {{numeros_ocupados}} ya no {{estaba_estaban_ocupados}} {{disponible_disponibles_ocupados}} 🙏",
        "¡Hola {{cliente}}! Te reservamos {{numeros_reservados}}. Lo sentimos, {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}.",
        "{{cliente}}, ¡{{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}! {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} 😅",
        "{{numeros_reservados}} {{reservado_reservados}} para ti, {{cliente}}. ¡Suerte con {{ese_esos}}! {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}.",
        "{{cliente}}, para {{evento}}: {{quedo_quedaron}} {{reservado_reservados}} {{numeros_reservados}} a tu nombre; {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} por otra persona.",
        "{{reservado_reservados}}: {{numeros_reservados}}. No {{disponible_disponibles_ocupados}}: {{numeros_ocupados}}.",
        "{{cliente}}, {{numeros_reservados}} {{reservado_reservados}}. {{numeros_ocupados}} ya no había.",
        "Estimado {{cliente}}, se confirma la reserva parcial: {{numeros_reservados}}. {{el_numero_los_numeros_ocupados}} {{numeros_ocupados}} no {{estaba_estaban_ocupados}} {{disponible_disponibles_ocupados}}.",
        "{{numeros_reservados}} {{reservado_reservados}} / {{numeros_ocupados}} {{ocupado_ocupados_ocupados}}.",
        "{{cliente}}, en {{evento}} {{quedo_quedaron}} {{reservado_reservados}} {{numeros_reservados}}; {{numeros_ocupados}} ya no {{estaba_estaban_ocupados}} {{libre_libres_ocupados}}.",
        "Solicitaste números: {{numeros_reservados}} {{reservado_reservados}}, {{numeros_ocupados}} ya {{ocupado_ocupados_ocupados}}.",
        "{{cliente}} 🙌 {{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, pero {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} 😬🔥",
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

    // numero_ocupado y todos_ocupados siempre tienen exactamente 1 o ≥2
    // solicitados respectivamente (calcularTipoPresentacion los distingue
    // así) — ya son gramaticalmente correctos para cualquier cantidad
    // dentro de esa regla; no se les aplicó ninguna variable nueva salvo
    // "Natural" de todos_ocupados, que además corrige de paso un error de
    // concordancia preexistente ("El números" → con {{el_numero_los_numeros}}).
    todos_ocupados: construir([
        "{{cliente}}, {{el_numero_los_numeros}} {{numeros_solicitados}} ya {{esta_estan}} {{ocupado_ocupados}}.",
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
        "{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}}",
        "{{tu_numero_tus_numeros}}: {{numeros_reservados}}",
        "{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 😊",
        "¡Hola {{cliente}}! {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}}",
        "{{cliente}}, ¡tienes {{numeros_reservados}}! Mucha suerte con {{ese_esos}} 🍀",
        "{{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, {{cliente}}. ¡Que ganes! 🎉",
        "{{cliente}}, según nuestro registro, {{tu_numero_tus_numeros}} {{reservado_reservados}} {{es_son}}: {{numeros_reservados}}.",
        "{{numeros_reservados}}",
        "{{cliente}}, tienes: {{numeros_reservados}}",
        "Estimado {{cliente}}, {{su_numero_sus_numeros}} {{reservado_reservados}} {{es_son}}: {{numeros_reservados}}.",
        "{{tuyo_tuyos}}: {{numeros_reservados}}",
        "{{cliente}}, para {{evento}} tienes: {{numeros_reservados}}",
        "{{numero_numeros}} a tu nombre: {{numeros_reservados}}",
        "{{cliente}} 🎫 {{tu_numero_tus_numeros}} {{es_son}} {{numeros_reservados}} ✨",
        ""
    ]),

    mis_reservas: construir([
        // "esto es lo que tienes reservado" es una construcción neutra
        // invariante ("esto"/"reservado" concuerdan entre sí, no con la
        // cantidad de números) — ya es correcta para 1 o para varios, no
        // necesita ninguna variable de concordancia.
        "{{cliente}}, esto es lo que tienes reservado: {{numeros_reservados}}",
        "{{reservado_reservados}}: {{numeros_reservados}}",
        "{{cliente}}, tienes {{reservado_reservados}}: {{numeros_reservados}} 📋",
        "¡Hola {{cliente}}! Esto tienes reservado hasta ahora: {{numeros_reservados}}",
        "{{cliente}}, ¡tienes {{reservado_reservados}} {{numeros_reservados}}! 🎉",
        "{{numeros_reservados}} {{reservado_reservados}} a tu nombre, {{cliente}}. ¡Suerte!",
        "{{cliente}}, en {{evento}} tienes {{reservado_reservados}} actualmente: {{numeros_reservados}}.",
        "{{numeros_reservados}}",
        "{{cliente}}, tienes: {{numeros_reservados}}",
        // "su reserva actual es" / "tu reserva es": "reserva" es un
        // sustantivo singular invariante (contiene 1 o varios números),
        // no concuerda con la cantidad — ya correctas.
        "Estimado {{cliente}}, su reserva actual es: {{numeros_reservados}}.",
        "Reserva actual: {{numeros_reservados}}",
        "{{cliente}}, para {{evento}} tu reserva es: {{numeros_reservados}}",
        "{{reservado_reservados}} a tu nombre: {{numeros_reservados}}",
        "{{cliente}} 📋 llevas {{reservado_reservados}} {{numeros_reservados}} ✨",
        ""
    ]),

    cantidad_reservas: construir([
        "{{cliente}}, tienes {{cantidad}} {{numero_numeros}} {{reservado_reservados}}.",
        "Tienes {{cantidad}}.",
        "{{cliente}}, llevas {{cantidad}} {{numero_numeros}} 📋",
        "¡Hola {{cliente}}! Llevas {{cantidad}} {{numero_numeros}} {{reservado_reservados}}.",
        "{{cliente}}, ¡ya tienes {{cantidad}}! Sigue así 🎉",
        "{{cantidad}} {{reservado_reservados}}, {{cliente}}. ¡Mucha suerte! 🍀",
        "{{cliente}}, según nuestro registro tienes actualmente {{cantidad}} {{numero_numeros}} {{reservado_reservados}}.",
        "{{cantidad}}",
        "{{cliente}}, tienes {{cantidad}}.",
        // "la cantidad de números reservados... es" — "cantidad de X" es
        // un rótulo de categoría invariante en plural (como "cantidad de
        // manzanas"); "es" concuerda con "la cantidad" (singular), no con
        // el conteo. Ya correcta para cualquier valor.
        "Estimado {{cliente}}, la cantidad de números reservados a su nombre es: {{cantidad}}.",
        "Cantidad: {{cantidad}}",
        "{{cliente}}, para {{evento}} llevas {{cantidad}} {{numero_numeros}}.",
        // "Total de números tuyos" es un rótulo de UI (como "Followers:"),
        // convención habitual mantenerlo invariante en plural.
        "Total de números tuyos: {{cantidad}}",
        "{{cliente}} 🔢 llevas {{cantidad}} {{numero_numeros}} ✨",
        ""
    ]),

    // numero_especifico siempre trata de EXACTAMENTE 1 número (por diseño
    // de resolverConsulta.js) — las 15 ya son singulares/neutras y
    // correctas, no hay nada que concuerde con una cantidad variable.
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
        "{{numero_numeros}} {{disponible_disponibles}}: {{numeros_disponibles}}",
        "{{libre_libres}}: {{numeros_disponibles}}",
        "{{queda_quedan}} {{disponible_disponibles}}: {{numeros_disponibles}} 😊",
        "¡Hola! {{numero_numeros}} {{disponible_disponibles}}: {{numeros_disponibles}}",
        "¡Todavía {{queda_quedan}} {{el_numero_los_numeros}} {{disponible_disponibles}}! {{numeros_disponibles}} 🎉",
        "{{numero_numeros}} {{disponible_disponibles}}: {{numeros_disponibles}}. ¡Elige el tuyo y mucha suerte! 🍀",
        // Dos listas independientes en el mismo mensaje: disponibles usa
        // las variables base (concuerdan con numeros_disponibles);
        // ocupados usa el conjunto "_ocupados" (concuerda con
        // numeros_ocupados de forma independiente — puede ser 1 mientras
        // disponibles es 3, o al revés).
        "Para {{evento}}, {{el_numero_los_numeros}} que aún {{esta_estan}} {{disponible_disponibles}} {{es_son}}: {{numeros_disponibles}}. {{el_numero_los_numeros_ocupados}} ya {{ocupado_ocupados_ocupados}} {{es_son_ocupados}}: {{numeros_ocupados}}.",
        "{{numero_numeros}} {{disponible_disponibles}}: {{numeros_disponibles}}",
        "{{queda_quedan}}: {{numeros_disponibles}}",
        "Se informa que {{el_numero_los_numeros}} {{disponible_disponibles}} actualmente {{es_son}}: {{numeros_disponibles}}.",
        "{{disponible_disponibles}} {{numeros_disponibles}}. {{ocupado_ocupados_ocupados}} {{numeros_ocupados}}.",
        "Para {{evento}}, {{disponible_disponibles}}: {{numeros_disponibles}}",
        "{{numero_numeros}} {{libre_libres}}: {{numeros_disponibles}}",
        "¡{{queda_quedan}} {{el_numero_los_numeros}}! 👀 {{numeros_disponibles}} {{disponible_disponibles}} 🔥",
        ""
    ]),

    // info_evento nunca habla de varios números — siempre UN evento. El
    // "es" que aparece aquí es el verbo copulativo de "Es {{evento}}", sin
    // relación con conteo; no se migra por eso (mismo criterio que Fase 2).
    //
    // Auditoría "completar plantillas vacías" (2026-09): info_evento YA
    // tenía sus 15 base originales (arriba, sin cambios) — las 5 de abajo
    // son ADICIONALES, pedidas explícitamente encima de las existentes.
    // Ninguna de las 15 originales se tocó (mismo array, mismo orden,
    // mismo contenido). Solo usan las variables reales del tipo
    // (evento/fecha/hora — ver tiposMensaje.ts), sin inventar ninguna.
    info_evento: [
        ...construir([
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
        ]),
        { nombre: "Aviso breve", estilo: "aviso_breve", contenido: "🎯 {{evento}} — cierra a las {{hora}}." },
        { nombre: "Cordial", estilo: "cordial", contenido: "¡Hola! Te cuento que hoy el sorteo es {{evento}} 😊 Cierra a las {{hora}}." },
        { nombre: "Completa", estilo: "completa", contenido: "Sorteo vigente: {{evento}}. Fecha: {{fecha}} · Hora de cierre: {{hora}}." },
        { nombre: "Recordatorio", estilo: "recordatorio", contenido: "📅 Recuerda: el evento de hoy es {{evento}}, cierra a las {{hora}} el {{fecha}}." },
        { nombre: "Cercana", estilo: "cercana", contenido: "🎲 ¡Vamos con {{evento}}! Cierre {{hora}} ⏰🍀" }
    ],

    // Inicio del día (Master Spec §15) — 8 plantillas de ejemplo tal como
    // las redactó el usuario. A propósito NO usan los 15 ESTILOS genéricos
    // de arriba (Natural/Súper corta/...): esos nombres no describen el
    // tono real de cada una, así que se listan con su propio nombre/tono.
    // {{evento}}/{{loteria}}/{{premio}} normalmente resolverán vacío en
    // este tipo (Inicio del día se envía ANTES de detectar el sorteo del
    // día — ver automation/eventRules.js::evaluarInicioDia) — no es un
    // error, es la regla real de "nunca inventar un dato que no existe
    // todavía" aplicada aquí.
    inicio_dia: [
        {
            nombre: "Inicio del día — cálido", estilo: "calido",
            contenido: "☀️ ¡Muy buenos días, familia! ❤️\n\n🙏 Gracias por estar nuevamente aquí y por la confianza de siempre.\n\n🎲 Ya estamos preparando todo para la dinámica de hoy.\n\n⏳ En unos minutos estaremos comenzando y les compartiremos toda la información.\n\n👀 Estén atentos al grupo.\n\n🍀 Que hoy sea un excelente día y que la suerte esté de su lado."
        },
        {
            nombre: "Inicio del día — energético", estilo: "energetico",
            contenido: "🌅 ¡BUENOS DÍAS, FAMILIA! 🔥\n\n🎲 ¡Comenzamos un nuevo día de dinámica!\n\n🙏 Gracias por seguir acompañándonos y confiar en nosotros.\n\n🎯 {{nombre_evento}}\n🎰 {{loteria}}\n🏆 {{premio}}\n\n⏰ Ya estamos preparando todo.\n\n👀 En unos minutos comenzamos.\n\n🔥 ¡Vamos con toda y mucha suerte para todos!"
        },
        {
            nombre: "Inicio del día — familiar", estilo: "familiar",
            contenido: "☀️ ¡Familia, muy buenos días! ❤️\n\nQué alegría tenerlos nuevamente por aquí. 🫶\n\n🎲 Ya tenemos preparada la dinámica de hoy y estamos organizando todo para comenzar.\n\n📋 Tabla lista.\n🎯 Dinámica lista.\n🔥 Nosotros listos.\n\n¡Solo faltan ustedes! 😎🍀\n\n⏳ En unos minutos comenzamos."
        },
        {
            nombre: "Inicio del día — expectativa", estilo: "expectativa",
            contenido: "🌅 ¡FAMILIA, HOY SE JUEGA! 🎲🔥\n\nMuy buenos días para todos. ❤️\n\n🙏 Gracias por seguir aquí y confiar en nuestro trabajo.\n\n🎯 {{nombre_evento}}\n🎰 {{loteria}}\n🏆 {{premio}}\n\n⏳ Estamos preparando todo para comenzar.\n\n👀 Estén muy atentos al grupo porque ya casi arrancamos.\n\n🍀 ¡Que la suerte los acompañe hoy!"
        },
        {
            nombre: "Inicio del día — comercial", estilo: "comercial",
            contenido: "☀️ ¡Muy buenos días, familia! 🔥\n\nYa estamos listos para comenzar una nueva dinámica. 🎲\n\n🎯 Hoy tenemos: {{nombre_evento}}\n🎰 {{loteria}}\n🏆 {{premio}}\n\n📋 Estamos terminando de preparar la tabla.\n\n⏳ En unos minutos les estaremos avisando para comenzar.\n\n🍀 Prepárense porque hoy puede ser su día. ❤️"
        },
        {
            nombre: "Inicio del día — corto", estilo: "corto",
            contenido: "☀️ ¡Buenos días, familia! ❤️\n\n🎲 Ya tenemos lista la dinámica de hoy.\n\n🎯 {{nombre_evento}}\n🎰 {{loteria}}\n\n⏳ En unos minutos comenzamos.\n\n👀 Estén atentos al grupo.\n\n🍀 ¡Mucha suerte para todos! 🔥"
        },
        {
            nombre: "Inicio del día — animado", estilo: "animado",
            contenido: "🌅 ¡MUY BUENOS DÍAS, FAMILIA! 🎉🔥\n\nOtro día, otra oportunidad y otra dinámica para ustedes. 🎲\n\n🎯 {{nombre_evento}}\n🎰 {{loteria}}\n🏆 {{premio}}\n\nEstamos dejando todo preparado para arrancar. 💪\n\n⏰ Ya casi abrimos.\n\n👀 No se despeguen porque en unos minutos comenzamos.\n\n🍀 ¡Vamos a darle!"
        },
        {
            nombre: "Inicio del día — cercano", estilo: "cercano",
            contenido: "☀️ ¡Familia, buenos días! 🫶\n\nEsperamos que hayan amanecido muy bien. ❤️\n\nComo siempre, muchas gracias por acompañarnos y hacer parte de esta familia.\n\n🎲 Ya estamos preparando la dinámica de hoy:\n\n🎯 {{nombre_evento}}\n🎰 {{loteria}}\n\n⏳ Falta muy poquito para comenzar.\n\n👀 Atentos al grupo que ya casi arrancamos.\n\n🍀 ¡Muchísima suerte!"
        }
    ],

    // consulta_pago (auditoría "completar plantillas vacías", 2026-09):
    // antes sin semilla a propósito (ver nota de "multiple" abajo, que
    // sigue aplicando sin cambios). consulta_pago SÍ recibe semilla ahora
    // porque, a diferencia de "multiple", es una única faceta por
    // respuesta — el modo por defecto (sin frase explícita de
    // lista/cantidad) siempre es "monto" (ver resolverConsulta.js::
    // modoBucketImplicitos), que siempre trae montoTotal/montoPagado/
    // montoPendiente ya resueltos. Por eso estas 5 usan EXCLUSIVAMENTE
    // {{cliente}}, {{evento}}, {{monto_total}}, {{monto_pagado}},
    // {{monto_pendiente}} — las únicas variables de este tipo que
    // resuelven de forma fiable en el caso real más común. Se evitó a
    // propósito {{numeros_pagados}}/{{numeros_pendientes}}/
    // {{cantidad_pagados}}/{{cantidad_pendientes}}: esas solo se llenan
    // cuando el cliente usa una frase explícita de "lista" o "cantidad"
    // (modo!=="monto"), así que en el caso por defecto quedarían vacías.
    consulta_pago: [
        { nombre: "Natural", estilo: "natural", contenido: "Hola {{cliente}} 👋 tu saldo pendiente es de {{monto_pendiente}}. Ya llevas pagado {{monto_pagado}} de un total de {{monto_total}}." },
        { nombre: "Profesional", estilo: "profesional", contenido: "Estimado/a {{cliente}}, este es el estado de su cuenta para {{evento}}: total {{monto_total}}, pagado {{monto_pagado}}, pendiente {{monto_pendiente}}." },
        { nombre: "Informativa", estilo: "informativa", contenido: "{{cliente}}, tu resumen de pago: total {{monto_total}} · pagado {{monto_pagado}} · pendiente {{monto_pendiente}}." },
        { nombre: "Directa", estilo: "directa", contenido: "{{cliente}}: te falta {{monto_pendiente}} por pagar." },
        { nombre: "Cercana", estilo: "cercana", contenido: "¡Hola {{cliente}}! 💰 Vas pagando {{monto_pagado}} de {{monto_total}}. Te falta {{monto_pendiente}} 🙌" }
    ]

};

// "multiple" (Fase 2 — sistema global de variables) NO tiene plantillas
// semilla a propósito: cada consulta real combina un número VARIABLE de
// facetas (lista/cantidad/monto de una o más sub-intenciones a la vez —
// ver resolverConsulta.js caso "multiple"), así que una plantilla única
// "de fábrica" mostraría campos vacíos según qué combinación preguntó el
// cliente. Sin semilla, el BOT sigue usando su mensaje fijo
// (resolverConsulta.js, que ya concatena cada faceta correctamente) tal
// como hoy — el admin puede crear una plantilla personalizada cuando
// quiera (botón "Nueva plantilla"), sabiendo que las variables que esa
// combinación puntual no trajo quedarán vacías (nunca inventadas).
// Confirmado en la auditoría "completar plantillas vacías" (2026-09):
// se revisó de nuevo esta decisión y se mantiene sin cambios — no es
// técnicamente compatible con una plantilla estática única.
export function obtenerPlantillasBase(tipoId: string): PlantillaBase[] {
    return PLANTILLAS_POR_TIPO[tipoId] || [];
}
