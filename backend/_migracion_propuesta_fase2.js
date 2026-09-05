// FASE 2 — reclasificación de las 36 filas "REQUIERE_REVISION" de
// _migracion_propuesta.js (Fase 1), ahora que gramatica.js soporta
// cantidades INDEPENDIENTES por conjunto (reservados/ocupados/disponibles)
// y las 6 palabras nuevas encontradas al auditar esos 36 casos
// (quedo_quedaron, tuyo_tuyos, libre_libres, queda_quedan, estaba_estaban,
// su_numero_sus_numeros).
//
// NO reemplaza el archivo de Fase 1 (queda como registro histórico del
// primer dry run) — este archivo toma esas 151 filas y solo SOBRESCRIBE
// las que cambiaron de clasificación/propuesta en esta fase. Ninguna fila
// NO_APLICA o ya-SEGURO de Fase 1 se tocó.
//
// Criterio aplicado en cada reescritura: preferir REUTILIZAR una variable
// ya existente (o ya agregada en esta fase) mediante una reformulación
// natural de la frase, antes que inventar una palabra nueva de un solo uso
// (p.ej. "tenían dueño"/"se adelantaron"/"volaron"/"listos"/"confirmados"
// se reformulan reutilizando estaba_estaban_ocupados + ocupado_ocupados_ocupados,
// en vez de crear tenia_tenian / se_adelanto_se_adelantaron / volo_volaron /
// listo_listos / confirmado_confirmados de un solo uso cada una).
const base = require("./_migracion_propuesta.js");

const OVERRIDES = {

    // ---------------- disponibilidad (9) ----------------
    "ab1112dc-fd32-42d9-b5bb-be9cb0f3f341": { // Súper corta — "Libres: X"
        clasificacion: "SEGURO",
        propuesto: "{{libre_libres}}: {{numeros_disponibles}}",
        nota: "Fase 2: nueva variable libre_libres (single-list, cantidadNumeros=disponibles). Se pierde mayúscula inicial (cosmético)."
    },
    "81575ddd-37af-4403-9253-577ae2820f49": { // WhatsApp — "Quedan disponibles: X"
        clasificacion: "SEGURO",
        propuesto: "{{queda_quedan}} {{disponible_disponibles}}: {{numeros_disponibles}} 😊",
        nota: "Fase 2: nueva variable queda_quedan (verbo quedar, presente)."
    },
    "f4ec117c-3531-40ac-97d9-871b68f0f581": { // Amigable — "Estos números siguen disponibles"
        clasificacion: "SEGURO",
        propuesto: "¡Hola! \n{{numero_numeros}} {{disponible_disponibles}}: {{numeros_disponibles}}",
        nota: "Fase 2: se reformula sin \"Estos...siguen\" (demostrativo + verbo \"seguir\" de un solo uso) reutilizando el patrón ya aprobado en \"Natural\"/\"Directa\". Pierde el matiz \"siguen\" pero mantiene el significado."
    },
    "f8ce4931-2710-421d-8817-41451848db10": { // Entusiasta — "buenos números... Disponibles"
        clasificacion: "SEGURO",
        propuesto: "¡Todavía {{queda_quedan}} {{el_numero_los_numeros}} {{disponible_disponibles}}! \n\n{{numeros_disponibles}} 🎉",
        nota: "Fase 2: se reformula sin \"buenos\" (adjetivo de un solo uso, con apócope buen/buenos) reutilizando queda_quedan + el_numero_los_numeros."
    },
    "c5792222-f259-4d89-87b3-aedfb3b4053c": { // Detallada — dos listas (disponibles + ocupados)
        clasificacion: "SEGURO",
        propuesto: "Para {{evento}}, {{el_numero_los_numeros}} que aún {{esta_estan}} {{disponible_disponibles}} {{es_son}}: {{numeros_disponibles}}. {{el_numero_los_numeros_ocupados}} ya {{ocupado_ocupados_ocupados}} {{es_son_ocupados}}: {{numeros_ocupados}}.",
        nota: "Fase 2: la cláusula de disponibles usa las variables base (bound a cantidadNumeros=disponibles); la cláusula de ocupados usa el conjunto independiente \"_ocupados\" (bound a cantidadOcupados). ANTES esto era imposible con una sola cantidad global."
    },
    "526fcd5f-55d5-402f-a07b-3def0ebfb27e": { // Casual — "Quedan: X"
        clasificacion: "SEGURO",
        propuesto: "{{queda_quedan}}: {{numeros_disponibles}}",
        nota: "Fase 2: queda_quedan."
    },
    "13370614-1447-4493-a1e6-49b05823a118": { // Resumen — dos listas (disponibles + ocupados)
        clasificacion: "SEGURO",
        propuesto: "{{disponible_disponibles}} ({{numeros_disponibles}}). {{ocupado_ocupados_ocupados}} ({{numeros_ocupados}}).",
        nota: "Fase 2: \"Disponibles (N)\" concuerda con cantidadDisponibles; \"Ocupados (M)\" concuerda de forma INDEPENDIENTE con cantidadOcupados vía el conjunto \"_ocupados\"."
    },
    "ecec0ace-d0f4-42f2-8bea-20031098fa24": { // Enfocada en números — "Números libres: X"
        clasificacion: "SEGURO",
        propuesto: "{{numero_numeros}} {{libre_libres}}: {{numeros_disponibles}}",
        nota: "Fase 2: libre_libres."
    },
    "fff00b52-6e02-47f6-be2c-b9d1b2f99800": { // Casual + emojis — "¡Quedan varios!"
        clasificacion: "SEGURO",
        propuesto: "¡{{queda_quedan}} {{el_numero_los_numeros}}! 👀 {{numeros_disponibles}} {{disponible_disponibles}} 🔥",
        nota: "Fase 2: se reformula sin \"varios\" (cuantificador sin contraparte singular limpia; \"uno\" no es adjetivo) reutilizando queda_quedan + el_numero_los_numeros (\"Queda el número\"/\"Quedan los números\")."
    },

    // ---------------- mis_numeros (6) ----------------
    "8cef5427-5b3d-410e-bf97-dd35e80350e8": { // WhatsApp — "estos son los tuyos"
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}} 😊",
        nota: "Fase 2: se reformula sin \"estos\"/\"los tuyos\" (demostrativo + pronombre posesivo redundantes) reutilizando tu_numero_tus_numeros."
    },
    "c544f353-d284-45d4-aee7-01b7da65c883": { // Amigable (HABILITADA) — "Estos son tus números"
        clasificacion: "SEGURO",
        propuesto: "¡Hola! \n{{tu_numero_tus_numeros}} {{es_son}}: {{numeros_reservados}}",
        nota: "Fase 2: HABILITADA. Se retira \"Estos\" (demostrativo de un solo uso) y se reutiliza tu_numero_tus_numeros, ya cubierto."
    },
    "db30dd23-d97d-4d30-9311-92d6328b1f2c": { // Entusiasta — "suerte con ellos"
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, ¡tienes {{numeros_reservados}}! Mucha suerte con {{ese_esos}} 🍀",
        nota: "Fase 2: se reformula sin el pronombre \"ellos\"/\"él\" reutilizando ese_esos (\"con ese número\"/\"con esos números\"), más concreto que un pronombre suelto."
    },
    "41ad2b7d-4cc8-4ca0-a317-4d52672e2ada": { // Buena suerte — "X son tuyos"
        clasificacion: "SEGURO",
        propuesto: "{{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, {{cliente}}. ¡Que ganes! 🎉",
        nota: "Fase 2: nueva variable tuyo_tuyos (pronombre posesivo)."
    },
    "f6856786-5074-46d6-98ba-161bd7175f91": { // Profesional — "sus números registrados son"
        clasificacion: "SEGURO",
        propuesto: "Estimado {{cliente}}, {{su_numero_sus_numeros}} {{reservado_reservados}} {{es_son}}: {{numeros_reservados}}.",
        nota: "Fase 2: nueva variable su_numero_sus_numeros (posesivo formal \"su/sus\", contraparte de tu_numero_tus_numeros para registro formal). \"registrados\" se reformula como \"reservados\" (sinónimo ya cubierto) en vez de crear registrado_registrados de un solo uso."
    },
    "3cd06a25-2305-40f1-b6a2-440316bbfa3d": { // Resumen — "Tuyos: X"
        clasificacion: "SEGURO",
        propuesto: "{{tuyo_tuyos}}: {{numeros_reservados}}",
        nota: "Fase 2: tuyo_tuyos. Se pierde mayúscula inicial (cosmético)."
    },

    // ---------------- reserva_completa (7) ----------------
    "0f16f7b5-d6bc-4bb5-ac09-1947ed5a37d1": { // Natural (HABILITADA) — "Quedaron reservados: X"
        clasificacion: "SEGURO",
        propuesto: "*¡Listo! ✅*\n*{{quedo_quedaron}} {{reservado_reservados}}: {{numeros_reservados}} 🎟️*",
        nota: "Fase 2: HABILITADA. Nueva variable quedo_quedaron (verbo quedar, pretérito)."
    },
    "70aa34c2-3edb-4d85-af3b-a2a9fb5c50bf": { // WhatsApp — "tus números X ya quedaron reservados"
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, {{tu_numero_tus_numeros}} {{numeros_reservados}} ya {{quedo_quedaron}} {{reservado_reservados}} 👍",
        nota: "Fase 2: quedo_quedaron."
    },
    "0377e472-380a-4ce3-9835-0b2a48f3a7c3": { // Entusiasta — "X son tuyos"
        clasificacion: "SEGURO",
        propuesto: "¡Genial {{cliente}}! {{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, mucha suerte 🎉",
        nota: "Fase 2: tuyo_tuyos."
    },
    "d51d7070-9011-496d-b1d4-605b368199be": { // Casual (HABILITADA) — "ya quedaron X a su nombre"
        clasificacion: "SEGURO",
        propuesto: "*Listo, ya {{quedo_quedaron}} {{numeros_reservados}} a su nombre. ✅*",
        nota: "Fase 2: HABILITADA. quedo_quedaron."
    },
    "fb62d468-6cf6-48bb-8308-2c517497bcb4": { // Profesional (HABILITADA) — contracción "de los números"
        clasificacion: "SEGURO",
        propuesto: "*Listo, confirmamos la reserva de {{numeros_reservados}} para {{evento}}.  ✅*\n",
        nota: "Fase 2: NO se necesitó variable nueva — se retira \"los números\" (evita la contracción de+el -> del que {{el_numero_los_numeros}} habría producido mal: \"de el número\"). Coincide con el patrón ya aprobado en \"Detallada\"."
    },
    "bcf41933-2755-47a6-93ca-d0fb6d4ea892": { // Enfocada en evento (HABILITADA) — "Tus números X quedaron reservados"
        clasificacion: "SEGURO",
        propuesto: "*{{tu_numero_tus_numeros}} {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}} para {{evento}}. ✅*",
        nota: "Fase 2: HABILITADA. quedo_quedaron."
    },
    "88b84d22-e6c2-468d-a249-a8e28d184268": { // Casual + emojis (HABILITADA) — "X son tuyos"
        clasificacion: "SEGURO",
        propuesto: "*¡Perfecto! 🥳*\n*{{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}🍀✨*",
        nota: "Fase 2: HABILITADA. tuyo_tuyos."
    },

    // ---------------- reserva_parcial (14) — el caso de las dos listas ----------------
    "349bfbd6-7128-4ec0-8aec-05a48f938f67": { // Natural (HABILITADA)
        clasificacion: "SEGURO",
        propuesto: "*{{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}}. ✅*\n\n*{{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}. ❌*",
        nota: "Fase 2: HABILITADA. quedo_quedaron para reservados; estaba_estaban_ocupados + ocupado_ocupados_ocupados (conjunto independiente) para ocupados — cada lista concuerda con SU propia cantidad."
    },
    "5e1cc8c0-503e-470f-9785-fd56ff9045d9": { // Súper corta
        clasificacion: "SEGURO",
        propuesto: "{{reservado_reservados}}: {{numeros_reservados}}. {{ocupado_ocupados_ocupados}}: {{numeros_ocupados}}.",
        nota: "Fase 2: reservado_reservados (bound a reservados) + ocupado_ocupados_ocupados (bound a ocupados, independiente)."
    },
    "94e8dcae-3bcd-47c7-93a8-45473853a98c": { // WhatsApp
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, logramos apartar {{numeros_reservados}}. {{numeros_ocupados}} ya no {{estaba_estaban_ocupados}} {{disponible_disponibles_ocupados}} 🙏",
        nota: "Fase 2: \"ya no disponible(s)\" describe la lista de ocupados con el conjunto independiente \"_ocupados\"."
    },
    "8eb3f83a-5397-4aba-82d7-7c241b42a980": { // Amigable (HABILITADA)
        clasificacion: "SEGURO",
        propuesto: "*¡Hola!*\n*Te reservamos {{numeros_reservados}}. ✅*\n\n*Lo sentimos, {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}}. ❌*",
        nota: "Fase 2: HABILITADA. Se reformula \"ya tenían dueño\" como \"ya estaban ocupados\" (reutiliza el conjunto _ocupados) en vez de crear tenia_tenian de un solo uso."
    },
    "7779a315-d5eb-4418-ba5e-3c1f607142ac": { // Entusiasta
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, ¡{{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}! {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} 😅",
        nota: "Fase 2: tuyo_tuyos para reservados; se reformula \"se adelantaron\" como \"ya estaban ocupados\" (reutiliza _ocupados) en vez de crear se_adelanto_se_adelantaron de un solo uso."
    },
    "95682c37-2610-4c81-926d-1b567ee9e74b": { // Buena suerte
        clasificacion: "SEGURO",
        propuesto: "{{numeros_reservados}} {{reservado_reservados}} para ti, {{cliente}}. ¡Suerte con {{ese_esos}}! ({{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}})",
        nota: "Fase 2: \"esos números\" (bug latente para reservados=1) corregido con ese_esos. \"ya estaban tomados\" reformulado como \"ya estaban ocupados\" (_ocupados) en vez de tomado_tomados de un solo uso."
    },
    "7a97f45e-0283-47da-bdf6-37d4294f946a": { // Detallada
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, para {{evento}}: {{quedo_quedaron}} {{reservado_reservados}} {{numeros_reservados}} a tu nombre; {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} por otra persona.",
        nota: "Fase 2: \"se reservaron\" reformulado como \"quedaron reservados\" (reutiliza quedo_quedaron) en vez de se_reservo_se_reservaron de un solo uso; ocupados con el conjunto independiente."
    },
    "d3b90e01-4716-4169-bd57-4a3cef51ea88": { // Directa
        clasificacion: "SEGURO",
        propuesto: "{{reservado_reservados}}: {{numeros_reservados}}. No {{disponible_disponibles_ocupados}}: {{numeros_ocupados}}.",
        nota: "Fase 2: \"No disponible(s)\" describe ocupados con el conjunto independiente."
    },
    "a54d9281-22f7-4ed1-8a9d-9bcee5921f38": { // Casual
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, {{numeros_reservados}} {{reservado_reservados}}. {{numeros_ocupados}} ya no había.",
        nota: "Fase 2: \"listos\" reformulado como \"reservados\" (ya cubierto) en vez de listo_listos de un solo uso. \"ya no había\" es invariante (existencial), sin cambios."
    },
    "fcfcf3f0-72cc-47fe-94fa-c5c13fec44d7": { // Profesional
        clasificacion: "SEGURO",
        propuesto: "Estimado {{cliente}}, se confirma la reserva parcial: {{numeros_reservados}}. {{el_numero_los_numeros_ocupados}} {{numeros_ocupados}} no {{estaba_estaban_ocupados}} {{disponible_disponibles_ocupados}}.",
        nota: "Fase 2: \"Los números\" de la cláusula de ocupados usa el conjunto independiente el_numero_los_numeros_ocupados. Nota cosmética: al empezar oración tras punto, la minúscula de la variable no capitaliza solo."
    },
    "321203cf-a91d-4f16-94e6-a3958a2895b2": { // Resumen
        clasificacion: "SEGURO",
        propuesto: "{{numeros_reservados}} {{reservado_reservados}} / {{numeros_ocupados}} {{ocupado_ocupados_ocupados}}.",
        nota: "Fase 2: cada mitad concuerda con su propia lista."
    },
    "ed82b548-bb17-47d8-9322-389649e10e68": { // Enfocada en evento
        clasificacion: "SEGURO",
        propuesto: "{{cliente}}, en {{evento}} {{quedo_quedaron}} {{reservado_reservados}} {{numeros_reservados}}; {{numeros_ocupados}} ya no {{estaba_estaban_ocupados}} {{libre_libres_ocupados}}.",
        nota: "Fase 2: quedo_quedaron para reservados; \"ya no estaban libres\" con libre_libres en el conjunto independiente de ocupados."
    },
    "f59f8116-b47b-4509-aa3a-77c272f43f3e": { // Enfocada en números
        clasificacion: "SEGURO",
        propuesto: "Solicitaste números: {{numeros_reservados}} {{reservado_reservados}}, {{numeros_ocupados}} ya {{ocupado_ocupados_ocupados}}.",
        nota: "Fase 2: se retira \"varios\" (cuantificador de la suma de ambas listas, sin cantidad propia) y \"confirmados\" se reformula como \"reservados\" (ya cubierto) en vez de confirmado_confirmados de un solo uso."
    },
    "017ac38c-be46-491a-8e6e-7eede6170cb4": { // Casual + emojis
        clasificacion: "SEGURO",
        propuesto: "{{cliente}} 🙌 {{numeros_reservados}} {{es_son}} {{tuyo_tuyos}}, pero {{numeros_ocupados}} ya {{estaba_estaban_ocupados}} {{ocupado_ocupados_ocupados}} 😬🔥",
        nota: "Fase 2: tuyo_tuyos para reservados; \"volaron\" reformulado como \"estaban ocupados\" (_ocupados) en vez de volo_volaron de un solo uso."
    }

};

module.exports = base.map(row => OVERRIDES[row.id] ? { ...row, ...OVERRIDES[row.id] } : row);
module.exports.OVERRIDES_IDS = Object.keys(OVERRIDES);
