// Plantillas sugeridas de NÚMEROS Y PAGOS — solo PRESENTACIÓN. Datos
// puros, no UI. La lógica que obtiene y clasifica los números (una sola
// lectura, pagado/pendiente) vive en el backend
// (backend/bot/funciones/consultas/consultarMisNumeros.js +
// resolverConsulta.js) y no depende de estas plantillas.
//
// El bot da DOS respuestas en esta familia:
//   - mis_numeros: todos los números del cliente, cada uno con su estado.
//   - la respuesta de PAGO ("qué debo", "cuánto debo", "¿estoy al día?",
//     "¿ya pagué?"): solo lo pendiente y su valor, o "estás al día". Sus
//     plantillas se guardan en los 4 tipos consulta_pago_<estado> que ya
//     existían en el panel: el bot elige el del ESTADO REAL del cliente.
//     No es una modalidad por frase: las 4 frases usan la misma plantilla.
//
// Reglas de redacción:
//   - {{cliente}} puede venir vacío: solo se usa como "Hola {{cliente}} 👋",
//     que se sigue leyendo bien sin nombre.
//   - Las listas vacías llegan como "ninguno" (dato real), nunca en blanco.
//   - Pago: las 2 activas con pendientes muestran {{monto_pendiente}}. Sin
//     precio configurado el bot las descarta y usa su mensaje fijo (solo
//     números, nunca "$0").
//   - Nunca "reservado(s)" para el total del cliente: incluye números pagados.
//
// El campo "estilo" (sugerida_1, sugerida_2…) identifica a las sugeridas:
// el botón "Organizar plantillas" del panel lo usa para completar las que
// falten sin duplicar ni tocar plantillas propias.

export interface PlantillaSugerida {
    nombre: string;
    estilo: string;
    contenido: string;
    activa: boolean;
}

export const PREFIJO_SUGERIDA = "sugerida_";

// Las 2 primeras de cada lista son las recomendadas (activas).
const ACTIVAS_POR_MODALIDAD = 2;

function sugeridas(entradas: [string, string][]): PlantillaSugerida[] {

    return entradas.map(([nombre, contenido], i) => ({
        nombre,
        estilo: `${PREFIJO_SUGERIDA}${i + 1}`,
        contenido,
        activa: i < ACTIVAS_POR_MODALIDAD
    }));

}

// Respuesta de pago cuando HAY números pendientes (sin_pago y pago_parcial
// dicen lo mismo: lo que falta y su valor — nunca los ya pagados).
const PAGO_CON_PENDIENTES: [string, string][] = [
    ["Clara", "⏳ Te falta pagar: {{numeros_pendientes}} — {{monto_pendiente}}"],
    ["Con saludo", "Hola 👋 te falta pagar {{numeros_pendientes}} ({{monto_pendiente}})."],
    ["Con nombre, sin valor", "Hola {{cliente}} 👋 te falta pagar: {{numeros_pendientes}}"]
];

export const PLANTILLAS_NUMEROS_PAGOS: Record<string, PlantillaSugerida[]> = {

    // 🎫 "mis números" — todos los números con su estado real.
    mis_numeros: sugeridas([
        ["Resumen claro", "🎟️ {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}\n⏳ Por pagar: {{numeros_pendientes}}"],
        ["Con saludo", "Hola 👋 {{tu_numero_tus_numeros}} en este sorteo {{es_son}}: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}\n⏳ Pendientes de pago: {{numeros_pendientes}}"],
        ["Corta", "🎟️ {{numeros_totales_cliente}} · ✅ Pagados {{numeros_pagados}} · ⏳ Por pagar {{numeros_pendientes}}"],
        ["Con nombre", "Hola {{cliente}} 👋 {{tu_numero_tus_numeros}} {{es_son}}: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}\n⏳ Por pagar: {{numeros_pendientes}}"],
        ["Con evento", "En {{evento}} tienes: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}\n⏳ Por pagar: {{numeros_pendientes}}"],
        ["Con cantidades", "🎟️ {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\n✅ Pagados ({{cantidad_pagados}}): {{numeros_pagados}}\n⏳ Por pagar ({{cantidad_pendientes}}): {{numeros_pendientes}}"],
        ["En una línea", "{{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}} (pagados: {{numeros_pagados}}; por pagar: {{numeros_pendientes}})"],
        ["Formal", "Estimado/a cliente, {{su_numero_sus_numeros}} {{es_son}}: {{numeros_totales_cliente}}. Pagados: {{numeros_pagados}}. Pendientes de pago: {{numeros_pendientes}}."],
        ["Negrita WhatsApp", "*{{tu_numero_tus_numeros|capitalize}}:* {{numeros_totales_cliente}}\n*✅ Pagados:* {{numeros_pagados}}\n*⏳ Por pagar:* {{numeros_pendientes}}"],
        ["Buena suerte", "🍀 {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\nPagados: {{numeros_pagados}} · Por pagar: {{numeros_pendientes}}\n¡Mucha suerte!"]
    ]),

    // Respuesta de PAGO — una presentación por estado real.
    consulta_pago_sin_pago: sugeridas(PAGO_CON_PENDIENTES),
    consulta_pago_pago_parcial: sugeridas(PAGO_CON_PENDIENTES),

    consulta_pago_pago_completo: sugeridas([
        ["Clara", "✅ Estás al día: no tienes números pendientes de pago."],
        ["Con saludo", "Hola 👋 estás al día ✅ No debes nada."],
        ["Con nombre", "Hola {{cliente}} 👋 estás al día ✅ ¡Gracias!"]
    ]),

    consulta_pago_sin_saldo: sugeridas([
        ["Clara", "No tienes números en este sorteo, así que no debes nada."],
        ["Con saludo", "Hola 👋 no tienes números en este sorteo."],
        ["Con invitación", "No tienes números todavía. Escribe «tabla» para ver los disponibles 🎟️"]
    ])

};

export function esPlantillaSugerida(estilo: string | null | undefined): boolean {
    return !!estilo && estilo.startsWith(PREFIJO_SUGERIDA);
}

export function esRecomendada(estilo: string | null | undefined): boolean {
    const n = Number((estilo || "").slice(PREFIJO_SUGERIDA.length));
    return esPlantillaSugerida(estilo) && n >= 1 && n <= ACTIVAS_POR_MODALIDAD;
}
