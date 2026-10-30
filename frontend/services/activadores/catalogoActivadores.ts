// ==========================================================================
// Catálogo de activadores y acciones de EFAAT — SOLO LECTURA (Fase 1).
//
// Describe qué activa cada funcionalidad del bot y qué hace realmente, a
// partir de la auditoría del código. Es documentación tipada: este panel
// NO decide nada del comportamiento del bot y nada de aquí llega al
// backend. El estado de la configuración real (interruptores, plantillas,
// grupos, sticker) se lee aparte, en estadoActivadores.ts.
//
// Cada archivo, símbolo y frase de ejemplo citados aquí se verifican contra
// el código real en backend/tests/catalogo/catalogoActivadores.test.js:
// si alguien renombra o borra una función, esa prueba falla y obliga a
// actualizar este catálogo en vez de mostrar algo que ya no existe.
// ==========================================================================

export type TipoActivador =
    | "frase"          // texto del mensaje (palabras o frases reconocidas)
    | "condicion"      // regla sobre el mensaje o el remitente
    | "evento"         // evento de WhatsApp o petición HTTP
    | "horario"        // tarea periódica o por hora
    | "estado"         // estado de un sorteo / de la base de datos
    | "accion_admin"   // acción de un administrador en WhatsApp
    | "panel"          // acción manual desde este panel
    | "desconocido";   // no se pudo determinar con certeza

export type EstadoEntrada =
    | "funciona"       // activa en producción
    | "con_conflicto"  // funciona, pero con un riesgo conocido
    | "sin_efecto"     // existe, pero no cambia nada
    | "codigo_muerto"; // nunca se ejecuta

export type NivelEdicion =
    | "panel"          // se configura desde el panel
    | "mixto"          // parte en el panel, la regla en el código
    | "codigo"         // solo cambiando código
    | "entorno"        // variables de entorno del servidor
    | "ninguno";       // no aplica (código muerto)

// Qué parte del estado REAL de la cuenta se muestra junto a la entrada.
export type FuenteEstadoReal = "tipos" | "reacciones" | "automatizacion" | "sticker";

export interface ReferenciaCodigo {
    archivo: string;   // ruta desde la raíz del repositorio
    simbolo?: string;  // función o constante que debe existir en ese archivo
}

export interface Activador {
    tipo: TipoActivador;
    descripcion: string;
    // Palabras/frases que aparecen LITERALMENTE (entre comillas) en
    // `fuente`; son solo ejemplos, no la lista completa.
    ejemplos?: string[];
    fuente?: string;
}

export interface EntradaCatalogo {
    id: string;
    nombre: string;
    resumen: string;
    estado: EstadoEntrada;
    sensible?: boolean;        // modifica datos importantes (reservas, pagos, miembros)
    activadores: Activador[];
    condiciones: string[];
    accion: string;
    lee: string[];
    escribe: string[];
    codigo: ReferenciaCodigo[];
    plantillas?: string[];     // tipos de respuesta del panel de Mensajes
    panel?: { pagina: string; ruta: string; que: string }[];
    edicion: { nivel: NivelEdicion; detalle: string };
    avisos?: string[];
    estadoReal?: FuenteEstadoReal;
}

export interface ModuloCatalogo {
    id: string;
    nombre: string;
    descripcion: string;
    entradas: EntradaCatalogo[];
}

const PANEL_MENSAJES = { pagina: "Mensajes", ruta: "/mensajes" };
const PANEL_AUTOMATIZACION = { pagina: "Automatización", ruta: "/automatizacion" };

const FALLBACK_GEMINI = "Sin plantilla activa, el texto se genera con redacción automática con IA a partir del resultado real; si no está disponible, se envía el mensaje predeterminado de EFAAT.";
const FALLBACK_FIJO = "Sin plantilla activa se envía el mensaje predeterminado de EFAAT (nunca se usa redacción con IA).";

export const CATALOGO_ACTIVADORES: ModuloCatalogo[] = [

    // ======================================================================
    {
        id: "entrada",
        nombre: "Entrada de mensajes",
        descripcion: "Filtros que se aplican a cada mensaje antes de cualquier respuesta. No responden nada por sí mismos.",
        entradas: [
            {
                id: "compuerta",
                nombre: "Filtro de ingreso (duplicados y mensajes antiguos)",
                resumen: "Evita procesar dos veces un mensaje o actuar sobre mensajes antiguos.",
                estado: "funciona",
                activadores: [{ tipo: "evento", descripcion: "Llega un mensaje de WhatsApp." }],
                condiciones: [
                    "Si el mensaje (grupo + id) ya está registrado, se descarta.",
                    "Si es antiguo (recibido sin conexión, reenviado o anterior a la sesión), solo se guarda en el historial."
                ],
                accion: "Registra el mensaje y decide si continúa al resto del flujo.",
                lee: ["mensajes_grupos_sorteos"],
                escribe: ["mensajes_grupos_sorteos"],
                codigo: [
                    { archivo: "backend/bot/funciones/mensajes/compuertaIngreso.js", simbolo: "clasificarIngreso" },
                    { archivo: "backend/bot/funciones/mensajes/compuertaIngreso.js", simbolo: "yaRegistrado" },
                    { archivo: "backend/bot/handlers/dispatcher.js" }
                ],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "regla-cruz",
                nombre: "Mensajes con ❌",
                resumen: "Un mensaje que contiene ❌ nunca se procesa ni se responde.",
                estado: "funciona",
                activadores: [{ tipo: "condicion", descripcion: "El contenido original del mensaje contiene ❌." }],
                condiciones: [],
                accion: "Solo queda en el historial.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/mensajes/mensajeConCruz.js", simbolo: "contieneCruz" }],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "salida-programa",
                nombre: "Mensajes enviados por EFAAT",
                resumen: "Los mensajes que envió EFAAT no se vuelven a procesar como pedidos.",
                estado: "funciona",
                activadores: [{ tipo: "condicion", descripcion: "Mensaje enviado desde el número vinculado que EFAAT registró al enviarlo." }],
                condiciones: [],
                accion: "Solo queda en el historial.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/utils/mensajesEnviados.js", simbolo: "fueEnviadoPorPrograma" }],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "archivos-con-pie",
                nombre: "Fotos, videos y documentos",
                resumen: "El pie de foto de un archivo (p. ej. un comprobante) nunca se toma como reserva ni consulta.",
                estado: "funciona",
                activadores: [{ tipo: "condicion", descripcion: "El mensaje trae imagen, video o documento." }],
                condiciones: ["Sí puede anunciar un sorteo (la detección de anuncios va antes)."],
                accion: "No se evalúa como reserva ni consulta.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/handlers/eventHandler.js", simbolo: "esMensajeConArchivo" }],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "cuentas-ignoradas",
                nombre: "Cuentas ignoradas",
                resumen: "Cuentas operativas cuyos avisos no se toman como pedidos de clientes.",
                estado: "funciona",
                activadores: [{ tipo: "condicion", descripcion: "El remitente es una de las cuentas fijas (por identificador de contacto de WhatsApp) o una sesión de WhatsApp vinculada a EFAAT." }],
                condiciones: ["Solo se saltan reservas y consultas; sus anuncios de sorteo y stickers de pago sí se procesan."],
                accion: "No se evalúa como reserva ni consulta.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/mensajes/cuentasIgnoradas.js", simbolo: "esCuentaIgnorada" }],
                edicion: { nivel: "codigo", detalle: "La lista de cuentas es fija; no es editable desde el panel." }
            },
            {
                id: "clasificacion-historial",
                nombre: "Clasificación de mensajes en el historial",
                resumen: "Etiqueta cada mensaje como reserva, pago, consulta o comando en el historial.",
                estado: "sin_efecto",
                activadores: [{
                    tipo: "frase",
                    descripcion: "Solo dígitos → reserva; contiene «pagu», «transfer», «comprobante» o «consign» → pago; empieza por «tabla», «saldo» o «lista» → consulta; empieza por «/» o «.» → comando.",
                    ejemplos: ["pagu", "transfer", "comprobante", "tabla", "saldo"],
                    fuente: "backend/bot/funciones/mensajes/clasificarMensaje.js"
                }],
                condiciones: [],
                accion: "Añade la etiqueta al registro del historial.",
                lee: [],
                escribe: ["mensajes_grupos_sorteos"],
                codigo: [
                    { archivo: "backend/bot/funciones/mensajes/clasificarMensaje.js", simbolo: "clasificarMensaje" },
                    { archivo: "backend/bot/workers/index.js", simbolo: "iniciarWorkers" },
                    { archivo: "backend/bot/workers/reservaWorker.js", simbolo: "reservaWorker" }
                ],
                edicion: { nivel: "ninguno", detalle: "No tiene efecto en las respuestas automáticas." },
                avisos: [
                    "Ningún proceso utiliza esta etiqueta todavía.",
                    "Las respuestas reales las deciden los detectores de Reservas y Consultas, no esta clasificación."
                ]
            },
            {
                id: "comandos",
                nombre: "Comandos",
                resumen: "Comandos de administración.",
                estado: "codigo_muerto",
                activadores: [{ tipo: "desconocido", descripcion: "No hay ningún comando definido." }],
                condiciones: [],
                accion: "Ninguna: la función no hace nada.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/handlers/commandHandler.js" }],
                edicion: { nivel: "ninguno", detalle: "No existen comandos." },
                avisos: ["Todavía no hay comandos de administración disponibles: la función existe, pero no realiza ninguna acción."]
            }
        ]
    },

    // ======================================================================
    {
        id: "sorteos",
        nombre: "Anuncios de sorteo",
        descripcion: "Cómo EFAAT reconoce el anuncio de un sorteo escrito en el grupo y qué hace con él.",
        entradas: [
            {
                id: "deteccion-anuncio",
                nombre: "Detección de anuncio de sorteo",
                resumen: "Un mensaje con la línea del sorteo y su precio crea o actualiza el sorteo del grupo y abre el grupo.",
                estado: "con_conflicto",
                sensible: true,
                activadores: [
                    { tipo: "frase", descripcion: "Una línea con una hora (HH:MM) y el nombre de una lotería conocida, o la palabra «lotería»." },
                    { tipo: "frase", descripcion: "Un precio junto a «valor número», «valor del número» o «cada número»." },
                    { tipo: "condicion", descripcion: "El precio debe tener una tabla configurada (1.000, 1.500, 2.000, 3.000, 5.000, 7.000…)." }
                ],
                condiciones: [
                    "Si es el mismo sorteo ya activo, se reactiva en lugar de duplicarse.",
                    "No pisa un sorteo activo creado desde «Sorteos programados»."
                ],
                accion: "Guarda el sorteo, abre el grupo en WhatsApp, inicia la automatización del grupo (si está autorizada) y escanea identidades.",
                lee: ["eventos_bot", "tabla de números del precio"],
                escribe: ["eventos_bot", "event_sessions"],
                codigo: [
                    { archivo: "backend/bot/funciones/eventos/detectarEvento.js", simbolo: "detectarEvento" },
                    { archivo: "backend/bot/funciones/eventos/extraerEvento.js", simbolo: "extraerEvento" },
                    { archivo: "backend/bot/funciones/eventos/extractor/buscarLineaEvento.js", simbolo: "buscarLineaEvento" },
                    { archivo: "backend/bot/funciones/eventos/extractor/extraerValorNumero.js", simbolo: "extraerValorNumero" },
                    { archivo: "backend/bot/funciones/eventos/extractor/loterias.js", simbolo: "LOTERIAS" },
                    { archivo: "backend/bot/funciones/eventos/configEvento.js", simbolo: "obtenerConfiguracion" },
                    { archivo: "backend/bot/funciones/eventos/guardarEvento.js", simbolo: "guardarEvento" },
                    { archivo: "backend/bot/funciones/eventos/grupos/abrirGrupo.js", simbolo: "abrirGrupo" }
                ],
                edicion: { nivel: "codigo", detalle: "La lista de loterías y los precios aceptados son fijos en el sistema." },
                avisos: [
                    "No se comprueba que quien anuncia sea administrador: cualquier miembro cuyo mensaje cumpla la forma del anuncio crearía o actualizaría el sorteo.",
                    "Un anuncio con «valor 5000» (sin «número») no se reconoce como anuncio."
                ]
            },
            {
                id: "anuncio-no-es-pedido",
                nombre: "Un anuncio no es un pedido",
                resumen: "El mensaje con forma de anuncio no se interpreta además como reserva o consulta (su hora o «Números disponibles» no son pedidos).",
                estado: "funciona",
                activadores: [{ tipo: "condicion", descripcion: "Mismo criterio con el que se acepta un anuncio: lotería + hora + precio configurado." }],
                condiciones: [],
                accion: "No responde ni reserva por ese mensaje.",
                lee: [],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/eventos/extraerEvento.js", simbolo: "pareceAnuncioDeSorteo" },
                    { archivo: "backend/bot/handlers/eventHandler.js", simbolo: "pareceAnuncioDeSorteo" }
                ],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            }
        ]
    },

    // ======================================================================
    {
        id: "reservas",
        nombre: "Reservas",
        descripcion: "Pedidos de números de los clientes. Es la única respuesta a mensajes que escribe en la tabla de números.",
        entradas: [
            {
                id: "reserva",
                nombre: "Reserva de números",
                resumen: "El cliente pide uno o varios números y EFAAT los aparta a su nombre si están libres.",
                estado: "funciona",
                sensible: true,
                activadores: [
                    { tipo: "frase", descripcion: "Números con exactamente las cifras del sorteo (p. ej. «25», «12 45»)." },
                    {
                        tipo: "frase",
                        descripcion: "Verbos de tomar un número: deciden que es reserva aunque el mensaje pregunte si está libre.",
                        ejemplos: ["quiero", "dame", "separa", "anotame", "para mi", "me llevo"],
                        fuente: "backend/bot/funciones/consultas/detectarIntencion.js"
                    },
                    {
                        tipo: "condicion",
                        descripcion: "El texto no contiene palabras que lo descartan como reserva.",
                        ejemplos: ["sorteo", "premio", "pago", "tengo", "hora"],
                        fuente: "backend/bot/funciones/reservas/validarTextoReserva.js"
                    }
                ],
                condiciones: [
                    "El sorteo acepta reservas: activo, no cerrado y antes de su hora de cierre (un sorteo de mañana sí acepta).",
                    "Las horas («10:30», «10pm») no cuentan como números.",
                    "No es un anuncio de sorteo, ni de una cuenta ignorada, ni un archivo.",
                    "Solo se apartan los números libres; los de otra persona se informan como ocupados."
                ],
                accion: "Aparta los números a nombre del cliente, responde y (si está activado) reacciona ✅/❌.",
                lee: ["eventos_bot", "tabla de números del sorteo", "usuarios"],
                escribe: ["tabla de números del sorteo (libre → reservado)", "eventos_bot (contadores)"],
                codigo: [
                    { archivo: "backend/bot/funciones/consultas/detectarIntencion.js", simbolo: "resolverComoReservaOninguna" },
                    { archivo: "backend/bot/funciones/reservas/detectarReserva.js", simbolo: "detectarReserva" },
                    { archivo: "backend/bot/funciones/reservas/detectarReserva.js", simbolo: "sorteoAceptaReservas" },
                    { archivo: "backend/bot/funciones/reservas/validarTextoReserva.js", simbolo: "validarTextoReserva" },
                    { archivo: "backend/bot/funciones/reservas/extraerNumeros.js", simbolo: "extraerNumeros" },
                    { archivo: "backend/bot/funciones/reservas/reservarNumeros.js", simbolo: "reservarNumeros" }
                ],
                plantillas: ["reserva_completa", "reserva_parcial", "numero_ocupado", "todos_ocupados"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas de cada tipo de respuesta de reserva." }],
                edicion: { nivel: "mixto", detalle: "En el panel: el texto de la respuesta y si se envía. La regla que decide qué es una reserva es fija del sistema." },
                avisos: [
                    FALLBACK_GEMINI,
                    "Si el tipo de respuesta está desactivado, la reserva igual se realiza; solo no se envía el mensaje.",
                    "Una reserva en un sorteo cerrado se ignora sin responder al cliente."
                ],
                estadoReal: "tipos"
            },
            {
                id: "reacciones",
                nombre: "Reacciones ✅/❌ a las reservas",
                resumen: "Reacciona sobre el mensaje del cliente según el resultado de su reserva.",
                estado: "funciona",
                activadores: [{ tipo: "estado", descripcion: "Resultado de una reserva ya respondida: todo reservado → ✅, todo ocupado → ❌." }],
                condiciones: ["Solo si la respuesta de la reserva se envió."],
                accion: "Envía una reacción al mensaje del cliente.",
                lee: ["configuracion_seleccion_mensajes"],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/reservas/reaccionReserva.js", simbolo: "reaccionarAlMensaje" },
                    { archivo: "backend/bot/funciones/reservas/reaccionReserva.js", simbolo: "reaccionesActivadas" }
                ],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor «Reacciones automáticas ✅/❌»." }],
                edicion: { nivel: "panel", detalle: "Se activa o desactiva desde Mensajes." },
                estadoReal: "reacciones"
            }
        ]
    },

    // ======================================================================
    {
        id: "consultas",
        nombre: "Consultas de clientes",
        descripcion: "Preguntas de solo lectura: nunca reservan ni cambian pagos. Todas las de números y pagos usan una sola lectura de los números del cliente.",
        entradas: [
            {
                id: "mis-numeros",
                nombre: "Mis números",
                resumen: "Muestra todos los números del cliente y cuáles están pagados y pendientes.",
                estado: "funciona",
                activadores: [{
                    tipo: "frase",
                    descripcion: "«número(s)» junto a una palabra de posesión, una palabra de «reserva» («mis reservas», «qué reservé») o una pregunta corta de posesión.",
                    ejemplos: ["mis", "tengo", "cuales", "muestrame", "mios", "reservas"],
                    fuente: "backend/bot/funciones/consultas/detectarIntencion.js"
                }],
                condiciones: ["Sin números concretos en el mensaje."],
                accion: "Lee los números del cliente una vez y responde con su estado real.",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/consultas/detectarIntencion.js", simbolo: "detectarIntencion" },
                    { archivo: "backend/bot/funciones/consultas/consultarMisNumeros.js", simbolo: "consultarMisNumerosPorEstado" },
                    { archivo: "backend/bot/funciones/consultas/resolverConsulta.js", simbolo: "resolverConsulta" }
                ],
                plantillas: ["mis_numeros"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor. Las frases que la activan son fijas del sistema." },
                avisos: [FALLBACK_FIJO, "Las preguntas por «mis reservas» también usan estas plantillas y este interruptor; si el antiguo «Mis reservas» estaba apagado, esas preguntas siguen sin respuesta."],
                estadoReal: "tipos"
            },
            {
                id: "respuesta-pago",
                nombre: "Respuesta de pago (qué debo / estoy al día / ¿ya pagué?)",
                resumen: "Muestra solo lo pendiente y su valor si hay precio, o «estás al día».",
                estado: "funciona",
                activadores: [
                    {
                        tipo: "frase",
                        descripcion: "Deuda, estado de cuenta y preguntas de pago (con errores comunes como «devo»).",
                        ejemplos: ["cuanto debo", "cuanto me falta", "estoy al dia", "como voy", "me falta por pagar"],
                        fuente: "backend/bot/funciones/consultas/detectarIntencion.js"
                    },
                    {
                        tipo: "frase",
                        descripcion: "Vocabulario exacto de pago y deuda (sin coincidencia aproximada: «pasar» o «pasado» no son pago). «Debo» o «devo» bastan solos; «debe» o «debemos» solos no.",
                        ejemplos: ["debo", "devo", "pague", "page", "cancele"],
                        fuente: "backend/bot/funciones/consultas/vocabularioPago.js"
                    },
                    { tipo: "condicion", descripcion: "«Ya pagué», «cancelé el 25» solo cuentan como PREGUNTA con «?», «¿» o una palabra interrogativa; si son afirmaciones, EFAAT no responde." }
                ],
                condiciones: ["La plantilla se elige por el estado real del cliente (sin pago, parcial, completo, sin números)."],
                accion: "Lee los números del cliente una vez y responde con lo pendiente. Nunca confirma un pago no registrado.",
                lee: ["tabla de números del sorteo", "eventos_bot (precio)"],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/consultas/detectarIntencion.js", simbolo: "esPregunta" },
                    { archivo: "backend/bot/funciones/consultas/vocabularioPago.js", simbolo: "contieneDeuda" },
                    { archivo: "backend/bot/funciones/consultas/resolverConsulta.js", simbolo: "construirMensajeResumen" },
                    { archivo: "backend/shared/pagos/determinarEstadoPago.js", simbolo: "determinarEstadoPago" }
                ],
                plantillas: ["consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas de cada estado de pago." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor por estado. Las frases son fijas del sistema." },
                avisos: [FALLBACK_FIJO, "Sin precio configurado se descartan las plantillas con montos y nunca se muestra «$0»."],
                estadoReal: "tipos"
            },
            {
                id: "preguntas-puntuales-pago",
                nombre: "Preguntas puntuales de pago",
                resumen: "«¿Cuáles están pagados?», «¿qué números cancelé?», «¿cuántos debo?», «¿cuánto he pagado?», «¿cuánto es todo?».",
                estado: "funciona",
                activadores: [{
                    tipo: "frase",
                    descripcion: "Frases completas de lista, cantidad o monto.",
                    ejemplos: ["cuales estan pagados", "cuales pague", "que numeros cancele", "cuantos debo", "cuanto he pagado", "cuanto es todo"],
                    fuente: "backend/bot/funciones/consultas/detectarIntencion.js"
                }],
                condiciones: ["«Cancelé» = pagué: responde con los números pagados. La tabla no conserva las reservas liberadas, así que nunca se muestra un historial de cancelaciones.", "Junto a «Mis números» en el mismo mensaje, una lista no se repite: ya va en esa respuesta."],
                accion: "Misma lectura única; responde con un mensaje fijo.",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/resolverConsulta.js", simbolo: "construirFacetaEstadoNumeros" }],
                edicion: { nivel: "codigo", detalle: "Mensaje fijo: las plantillas de pago por estado no se usan para estas preguntas." }
            },
            {
                id: "cantidad",
                nombre: "Cantidad de números",
                resumen: "«¿Cuántos números tengo?»",
                estado: "funciona",
                activadores: [{ tipo: "frase", descripcion: "«cuántos» / «cuántas» (coincidencia exacta).", ejemplos: ["cuantos", "cuantas"], fuente: "backend/bot/funciones/consultas/detectarIntencion.js" }],
                condiciones: ["Sin números concretos en el mensaje."],
                accion: "Misma lectura única; responde la cantidad total.",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/resolverConsulta.js", simbolo: "resolverConsulta" }],
                plantillas: ["cantidad_reservas"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor." },
                avisos: [FALLBACK_FIJO],
                estadoReal: "tipos"
            },
            {
                id: "numero-especifico",
                nombre: "Estado de un número",
                resumen: "«¿Está libre el 45?», «¿quién tiene el 45?», «¿el 25 está pago?».",
                estado: "funciona",
                activadores: [{
                    tipo: "frase",
                    descripcion: "Un número concreto junto a una pregunta de estado o dueño.",
                    ejemplos: ["esta libre", "quien tiene", "esta ocupado", "puedo reservar"],
                    fuente: "backend/bot/funciones/consultas/detectarIntencion.js"
                }],
                condiciones: ["Si el mensaje expresa que el cliente toma el número, es una reserva."],
                accion: "Lee ese número y responde si está libre, reservado o pagado (por el cliente o por otra persona).",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/consultarNumero.js", simbolo: "consultarNumero" }],
                plantillas: ["numero_especifico"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor." },
                avisos: [FALLBACK_GEMINI],
                estadoReal: "tipos"
            },
            {
                id: "disponibilidad",
                nombre: "Disponibilidad / tabla",
                resumen: "Envía los números libres del sorteo, o el aviso de agotado.",
                estado: "funciona",
                activadores: [
                    { tipo: "frase", descripcion: "Pedidos cortos de la tabla.", ejemplos: ["tabla", "tablita", "disponibles"], fuente: "backend/bot/funciones/consultas/pedidoTabla.js" },
                    { tipo: "frase", descripcion: "Palabras de disponibilidad sin número concreto.", ejemplos: ["disponible", "libres", "quedan"], fuente: "backend/bot/funciones/consultas/detectarIntencion.js" }
                ],
                condiciones: [
                    "Una sola respuesta por ráfaga: 8 s por grupo y 30 s por cliente.",
                    "Un aviso («ya no quedan números») o una orden de no actualizar no dispara la tabla."
                ],
                accion: "Lee la tabla fresca y responde con los disponibles, o con el mensaje de agotado.",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/consultas/pedidoTabla.js", simbolo: "esPedidoDeTabla" },
                    { archivo: "backend/bot/funciones/consultas/controlDisponibilidad.js", simbolo: "solicitarTurno" },
                    { archivo: "backend/bot/funciones/consultas/consultarDisponibilidad.js", simbolo: "consultarDisponibilidad" }
                ],
                plantillas: ["disponibilidad", "disponibilidad_agotada"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas (normal y agotado)." }],
                edicion: { nivel: "mixto", detalle: "Texto e interruptor en el panel. Los tiempos de espera entre respuestas son fijos en el servidor." },
                avisos: [FALLBACK_GEMINI + " El aviso de agotado nunca usa redacción con IA."],
                estadoReal: "tipos"
            },
            {
                id: "info-evento",
                nombre: "Información del sorteo",
                resumen: "Lotería, hora y fecha del sorteo activo.",
                estado: "funciona",
                activadores: [{ tipo: "frase", descripcion: "Palabras sobre el sorteo sin número concreto.", ejemplos: ["loteria", "sorteo", "hora", "cuando", "que dia"], fuente: "backend/bot/funciones/consultas/detectarIntencion.js" }],
                condiciones: [],
                accion: "Responde con los datos del sorteo guardado.",
                lee: ["eventos_bot"],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/consultarInfoEvento.js", simbolo: "consultarInfoEvento" }],
                plantillas: ["info_evento"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor." },
                avisos: [FALLBACK_GEMINI],
                estadoReal: "tipos"
            },
            {
                id: "consulta-combinada",
                nombre: "Consulta combinada",
                resumen: "Varias preguntas de números y pagos en un mensaje («mis números y cuánto debo»).",
                estado: "funciona",
                activadores: [{ tipo: "frase", descripcion: "Dos o más preguntas de la familia separadas por «y» o comas." }],
                condiciones: ["Cada parte respeta su propio interruptor; la de pago, el del estado real del cliente (sin pago, parcial, completo, sin números). Una parte apagada se omite; si no queda ninguna, no se responde."],
                accion: "Una sola lectura de los números para todas las partes.",
                lee: ["tabla de números del sorteo"],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/detectarIntencion.js", simbolo: "dividirEnSegmentos" }],
                plantillas: ["multiple"],
                panel: [{ ...PANEL_MENSAJES, que: "Interruptor y plantillas." }],
                edicion: { nivel: "mixto", detalle: "En el panel: texto e interruptor." },
                avisos: [FALLBACK_FIJO],
                estadoReal: "tipos"
            },
            {
                id: "tipos-sin-uso",
                nombre: "Tipos de respuesta sin uso",
                resumen: "«Mensaje no entendido», «Número inválido», «Evento no disponible», «Solicitud ambigua» y «Otros resultados».",
                estado: "sin_efecto",
                activadores: [{ tipo: "desconocido", descripcion: "Ningún detector los genera." }],
                condiciones: [],
                accion: "Ninguna: EFAAT nunca envía estas respuestas.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "frontend/services/mensajes/tiposMensaje.ts", simbolo: "mensaje_no_entendido" }],
                plantillas: ["mensaje_no_entendido", "numero_invalido", "evento_no_disponible", "solicitud_ambigua", "otro_determinista"],
                edicion: { nivel: "ninguno", detalle: "Aparecen en el panel como «Futuro»; configurarlos no cambia nada." }
            }
        ]
    },

    // ======================================================================
    {
        id: "pagos",
        nombre: "Pagos",
        descripcion: "Cómo se registra realmente un pago. Ninguna frase de un cliente puede confirmar un pago.",
        entradas: [
            {
                id: "registro-sticker",
                nombre: "Registrar el sticker de pago",
                resumen: "Guarda qué sticker usa el administrador para confirmar pagos.",
                estado: "funciona",
                activadores: [
                    { tipo: "panel", descripcion: "El administrador activa «Registrar sticker» (vale 2 minutos)." },
                    { tipo: "accion_admin", descripcion: "Un administrador del grupo envía el sticker mientras el registro está vigente." }
                ],
                condiciones: ["Rol de administrador comprobado en vivo.", "Mientras el registro está vigente, ese sticker no confirma ningún pago."],
                accion: "Guarda la huella del sticker para el grupo o como predeterminado.",
                lee: ["configuracion_stickers_pago"],
                escribe: ["configuracion_stickers_pago"],
                codigo: [{ archivo: "backend/bot/funciones/pagos/registrarStickerPago.js", simbolo: "registrarStickerPago" }],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Sticker de pago: registrar, cancelar o desactivar." }],
                edicion: { nivel: "panel", detalle: "El registro se inicia desde el panel." },
                estadoReal: "sticker"
            },
            {
                id: "confirmar-pago-sticker",
                nombre: "Confirmar pago con sticker",
                resumen: "El administrador responde al mensaje del cliente con el sticker de pago y sus números reservados pasan a pagados.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "accion_admin", descripcion: "Administrador + sticker registrado + respuesta (cita) a un mensaje del cliente." }],
                condiciones: ["Identidad del cliente citado resuelta.", "El sorteo del grupo debe estar activo.", "No se ejecuta si ese mismo mensaje fue usado para registrar el sticker."],
                accion: "Marca como pagados los números reservados del cliente. No envía ningún mensaje.",
                lee: ["configuracion_stickers_pago", "eventos_bot", "usuarios"],
                escribe: ["tabla de números del sorteo (reservado → pagado)", "eventos_bot (contadores)"],
                codigo: [
                    { archivo: "backend/bot/funciones/pagos/confirmarPagoPorSticker.js", simbolo: "confirmarPagoPorSticker" },
                    { archivo: "backend/bot/funciones/pagos/marcarReservasPagadasPorAdmin.js", simbolo: "marcarReservasPagadasPorAdmin" }
                ],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Solo qué sticker se usa; la regla no es configurable." }],
                edicion: { nivel: "mixto", detalle: "Solo el sticker es configurable. Nunca se activa por una frase." },
                avisos: ["Después del cierre del sorteo el sticker ya no marca pagos: esos pagos deben marcarse desde Tablas."],
                estadoReal: "sticker"
            },
            {
                id: "afirmacion-pago",
                nombre: "«Ya pagué» de un cliente",
                resumen: "Una afirmación de pago no recibe respuesta ni confirma nada.",
                estado: "funciona",
                activadores: [{ tipo: "frase", descripcion: "Verbos de pago sin signo de pregunta.", ejemplos: ["pague", "pagado", "cancele", "cancelado"], fuente: "backend/bot/funciones/consultas/vocabularioPago.js" }],
                condiciones: ["Nunca se interpreta como reserva."],
                accion: "Ninguna: es el mensaje que el administrador cita con el sticker de pago.",
                lee: [],
                escribe: [],
                codigo: [{ archivo: "backend/bot/funciones/consultas/detectarIntencion.js", simbolo: "esPregunta" }],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "marcar-pagado-panel",
                nombre: "Marcar pagado desde el panel",
                resumen: "El administrador marca un número reservado como pagado en la tabla.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "panel", descripcion: "Acción manual en la página Tablas." }],
                condiciones: ["Solo números ya reservados de la cuenta."],
                accion: "Marca el número como pagado en el servidor (con método de pago y observaciones opcionales) y lo deja en el historial.",
                lee: ["tabla de números"],
                escribe: ["tabla de números (reservado → pagado)", "actividad de la tabla", "historial de auditoría"],
                codigo: [{ archivo: "backend/services/reservaManual.js", simbolo: "pagarManual" }],
                panel: [{ pagina: "Tablas", ruta: "/tablas", que: "Acciones sobre cada número." }],
                edicion: { nivel: "panel", detalle: "Acción manual." }
            },
            {
                id: "lector-pagos",
                nombre: "Lector de pagos (app Android)",
                resumen: "Recibe las notificaciones bancarias leídas por el teléfono vinculado.",
                estado: "funciona",
                activadores: [{ tipo: "evento", descripcion: "Aviso enviado por el teléfono vinculado." }],
                condiciones: ["Credenciales del dispositivo válidas.", "Movimientos duplicados se descartan."],
                accion: "Guarda los movimientos. No confirma pagos ni los cruza con reservas.",
                lee: [],
                escribe: ["pagos_movimientos", "pagos_dispositivos"],
                codigo: [
                    { archivo: "backend/pagos/pagosController.js", simbolo: "crearMovimiento" },
                    { archivo: "backend/routes/pagos.js" }
                ],
                panel: [{ pagina: "Lector de pagos", ruta: "/lector-pagos", que: "Vincular el teléfono y ver movimientos." }],
                edicion: { nivel: "panel", detalle: "Vinculación del dispositivo." }
            }
        ]
    },

    // ======================================================================
    {
        id: "automatizacion",
        nombre: "Automatización programada",
        descripcion: "Mensajes que EFAAT envía automáticamente, por grupo autorizado. Se revisa cada 30 segundos.",
        entradas: [
            {
                id: "inicio-dia",
                nombre: "Inicio del día",
                resumen: "Saludo diario antes de la dinámica.",
                estado: "funciona",
                activadores: [{ tipo: "horario", descripcion: "Hora y días configurados (hora de Bogotá)." }],
                condiciones: ["Grupo autorizado.", "Una vez por día."],
                accion: "Envía una plantilla de «Inicio del día» elegida al azar.",
                lee: ["automation_configs", "grupos_autorizados", "plantillas_mensaje"],
                escribe: ["automation_actions"],
                codigo: [{ archivo: "backend/automation/scheduler.js", simbolo: "evaluarInicioDiaGlobal" }, { archivo: "backend/automation/eventRules.js", simbolo: "evaluarInicioDia" }],
                plantillas: ["inicio_dia"],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Activar, hora y días." }, { ...PANEL_MENSAJES, que: "Plantillas de «Inicio del día»." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                estadoReal: "automatizacion"
            },
            {
                id: "apertura",
                nombre: "Mensaje de apertura",
                resumen: "Al detectarse el anuncio del sorteo.",
                estado: "funciona",
                activadores: [{ tipo: "evento", descripcion: "Se detecta un anuncio de sorteo en un grupo autorizado." }],
                condiciones: ["Días y horario permitidos.", "Una vez por sorteo."],
                accion: "Envía un mensaje del grupo de mensajes de apertura.",
                lee: ["automation_configs", "automation_messages"],
                escribe: ["event_sessions", "automation_actions", "automation_message_uses"],
                codigo: [{ archivo: "backend/automation/engine.js", simbolo: "onEventoDetectado" }, { archivo: "backend/automation/engine.js", simbolo: "enviarMensajeApertura" }],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Mensajes de apertura y su activación." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                estadoReal: "automatizacion"
            },
            {
                id: "tabla-inicial",
                nombre: "Publicación inicial de la tabla",
                resumen: "Comparte la tabla del sorteo al comenzar.",
                estado: "funciona",
                activadores: [{ tipo: "horario", descripcion: "Hora y días configurados, con un sorteo activo." }],
                condiciones: ["El sorteo debe tener una tabla válida.", "Una vez por sorteo."],
                accion: "Publica la tabla real (la misma función que «Compartir tabla»).",
                lee: ["eventos_bot", "tabla de números"],
                escribe: ["automation_actions"],
                codigo: [{ archivo: "backend/automation/scheduler.js", simbolo: "evaluarPublicacionInicialTabla" }, { archivo: "backend/services/compartirTabla.js", simbolo: "compartirTabla" }],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Activar, hora y días." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                estadoReal: "automatizacion"
            },
            {
                id: "recordatorios",
                nombre: "Recordatorios antes del cierre",
                resumen: "Avisos X minutos antes del cierre del sorteo.",
                estado: "funciona",
                activadores: [{ tipo: "horario", descripcion: "Minutos antes de la hora de cierre configurados." }],
                condiciones: [
                    "Antes de cada envío se lee el estado real del sorteo: solo se envía si quedan números libres y el grupo sigue abierto en WhatsApp.",
                    "Sin libres (todo reservado o pagado) o con el grupo cerrado, el recordatorio se omite y queda registrado: nunca se envía tarde ni dos veces.",
                    "Si el estado no se puede leer, no se envía y se reintenta en el siguiente ciclo.",
                    "Cada recordatorio se envía una sola vez por sorteo."
                ],
                accion: "Envía un mensaje del grupo de recordatorios (invitan a participar).",
                lee: ["automation_configs", "automation_messages", "eventos_bot", "tabla de números", "grupos (announce)"],
                escribe: ["automation_actions"],
                codigo: [
                    { archivo: "backend/automation/scheduler.js", simbolo: "evaluarRecordatorios" },
                    { archivo: "backend/automation/eventRules.js", simbolo: "decidirRecordatoriosSegunEstado" },
                    { archivo: "backend/automation/repo/estadoSorteo.js", simbolo: "leerEstadoParaRecordatorios" }
                ],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Minutos y mensajes de recordatorio." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                avisos: [
                    "Los «Sorteos programados» tienen sus propios recordatorios, independientes de estos.",
                    "No existen recordatorios de cobro en la automatización: sus categorías (elección, escasez, urgencia…) son de tono, no de propósito."
                ],
                estadoReal: "automatizacion"
            },
            {
                id: "actualizacion",
                nombre: "Mensaje de actualización",
                resumen: "Aviso cuando entran suficientes reservas nuevas.",
                estado: "funciona",
                activadores: [{ tipo: "estado", descripcion: "Reservas nuevas ≥ umbral configurado." }],
                condiciones: ["Espera mínima entre dos avisos.", "Solo si quedan números libres y el grupo sigue abierto (estado real leído antes del envío)."],
                accion: "Envía un mensaje del grupo de actualizaciones.",
                lee: ["automation_configs", "eventos_bot"],
                escribe: ["automation_actions", "event_sessions"],
                codigo: [{ archivo: "backend/automation/scheduler.js", simbolo: "evaluarActualizacion" }],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Umbral, espera y mensajes." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                estadoReal: "automatizacion"
            },
            {
                id: "mensaje-cierre",
                nombre: "Mensaje de cierre",
                resumen: "Después de que el sorteo se cierra.",
                estado: "funciona",
                activadores: [{ tipo: "estado", descripcion: "El sorteo pasó a cerrado por el cierre automático." }],
                condiciones: ["Una vez por sorteo."],
                accion: "Envía un mensaje del grupo de cierre.",
                lee: ["automation_configs", "automation_messages"],
                escribe: ["automation_actions", "event_sessions"],
                codigo: [{ archivo: "backend/automation/scheduler.js", simbolo: "ejecutarCierre" }],
                panel: [{ ...PANEL_AUTOMATIZACION, que: "Activación y mensajes de cierre." }],
                edicion: { nivel: "panel", detalle: "Configurable por grupo." },
                estadoReal: "automatizacion"
            },
            {
                id: "stickers-automatizacion",
                nombre: "Stickers en la automatización",
                resumen: "Opción «stickers» de la configuración de automatización.",
                estado: "sin_efecto",
                activadores: [{ tipo: "desconocido", descripcion: "Ningún flujo la lee." }],
                condiciones: [],
                accion: "Ninguna (función preparada, todavía sin uso).",
                lee: ["automation_configs"],
                escribe: [],
                codigo: [{ archivo: "backend/automation/engine.js", simbolo: "stickers" }],
                edicion: { nivel: "ninguno", detalle: "No tiene efecto." }
            }
        ]
    },

    // ======================================================================
    {
        id: "ciclo",
        nombre: "Ciclo de vida del sorteo",
        descripcion: "Trabajos periódicos que cierran y mantienen los sorteos activos.",
        entradas: [
            {
                id: "cierre-automatico",
                nombre: "Cierre automático del sorteo",
                resumen: "Cierra el grupo cuando llega la hora de cierre o todos los números están pagados.",
                estado: "funciona",
                sensible: true,
                activadores: [
                    { tipo: "horario", descripcion: "Revisión periódica de los sorteos activos." },
                    { tipo: "estado", descripcion: "Pasó la hora de cierre, o todos los números del sorteo están pagados." }
                ],
                condiciones: ["Si WhatsApp no confirma el cierre del grupo, el sorteo sigue activo y se reintenta."],
                accion: "Cierra el grupo en WhatsApp y marca el sorteo como cerrado.",
                lee: ["eventos_bot", "tabla de números"],
                escribe: ["eventos_bot (activo, estado, cierre_estado)"],
                codigo: [
                    { archivo: "backend/bot/funciones/eventos/workers/workerEventos.js", simbolo: "procesarSorteo" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/procesarSorteo.js", simbolo: "procesarSorteo" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/verificarHoraCierre.js", simbolo: "verificarHoraCierre" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/cerrarEvento.js", simbolo: "cerrarFilaDeEvento" }
                ],
                edicion: { nivel: "codigo", detalle: "La hora de cierre sale del anuncio o del sorteo programado; la regla es fija." },
                avisos: ["La hora se compara con el reloj del servidor."]
            },
            {
                id: "reconciliar-apertura",
                nombre: "Reintento de apertura del grupo",
                resumen: "Si abrir el grupo falló al anunciar, se reintenta.",
                estado: "funciona",
                activadores: [{ tipo: "estado", descripcion: "Sorteo activo cuyo grupo no se pudo abrir." }],
                condiciones: ["El número vinculado a EFAAT debe ser administrador del grupo."],
                accion: "Vuelve a abrir el grupo en WhatsApp.",
                lee: ["eventos_bot"],
                escribe: ["eventos_bot"],
                codigo: [{ archivo: "backend/bot/funciones/eventos/grupos/reconciliarApertura.js", simbolo: "reconciliarAperturaGrupo" }],
                edicion: { nivel: "codigo", detalle: "Regla fija del sistema." }
            },
            {
                id: "ciclo-codigo-muerto",
                nombre: "Módulos de ciclo de vida sin uso",
                resumen: "Componentes internos antiguos de notificación y evaluación de sorteos.",
                estado: "codigo_muerto",
                activadores: [{ tipo: "desconocido", descripcion: "Nadie los llama." }],
                condiciones: [],
                accion: "Ninguna.",
                lee: [],
                escribe: [],
                codigo: [
                    { archivo: "backend/bot/funciones/eventos/notificarEvento.js", simbolo: "notificarEvento" },
                    { archivo: "backend/bot/funciones/eventos/index.js", simbolo: "notificarEvento" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/procesarEvento.js" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/evaluarEvento.js" },
                    { archivo: "backend/bot/funciones/eventos/lifecycle/verificarEventoLleno.js" },
                    { archivo: "backend/bot/ai/responderReserva.js" }
                ],
                edicion: { nivel: "ninguno", detalle: "No forman parte del comportamiento real." },
                avisos: [
                    "Son componentes antiguos que no se ejecutan.",
                    "No afectan a tus sorteos ni a tus respuestas automáticas."
                ]
            }
        ]
    },

    // ======================================================================
    {
        id: "programados",
        nombre: "Sorteos programados",
        descripcion: "Sorteos creados desde el panel que EFAAT publica automáticamente. Tienen sus propios textos, distintos de las plantillas de Mensajes.",
        entradas: [
            {
                id: "publicacion-programada",
                nombre: "Publicación programada",
                resumen: "A la hora confirmada guarda el sorteo, abre el grupo y envía el anuncio.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "horario", descripcion: "Revisión cada 30 segundos de los sorteos confirmados cuya hora llegó." }],
                condiciones: ["Solo versiones confirmadas.", "Nunca encima de otro sorteo activo del grupo (salvo «Sustituir»). La tabla se conserva o se reinicia según lo que elegiste; los números de otros sorteos nunca se modifican sin reinicio confirmado.", "Cada mensaje como mucho una vez; si falla queda «requiere revisión»."],
                accion: "Crea el sorteo (mismo registro que un anuncio), abre el grupo y publica el anuncio.",
                lee: ["sorteos_programados", "sorteos_programados_grupos", "eventos_bot", "tabla de números"],
                escribe: ["eventos_bot", "sorteos_programados_grupos", "automation_actions"],
                codigo: [{ archivo: "backend/sorteos/publicador.js", simbolo: "publicarPendientes" }, { archivo: "backend/sorteos/mensajes.js", simbolo: "mensajePublicacion" }],
                panel: [{ pagina: "Sorteos", ruta: "/sorteos", que: "Programar, confirmar y reintentar." }],
                edicion: { nivel: "panel", detalle: "Configurable por sorteo." }
            },
            {
                id: "recordatorios-programados",
                nombre: "Recordatorios y aviso de cierre programados",
                resumen: "Mensajes del sorteo programado antes y al cierre.",
                estado: "funciona",
                activadores: [{ tipo: "horario", descripcion: "Horas configuradas en el sorteo programado." }],
                condiciones: [
                    "Cada mensaje como mucho una vez, solo dentro de su ventana de 10 minutos.",
                    "Antes de cada recordatorio se lee el estado real: se omite si todo está pagado o si el grupo está cerrado sin pagos pendientes.",
                    "Con pagos pendientes se envía igual: el texto es libre y no indica si invita a participar o recuerda pagar."
                ],
                accion: "Envía los textos escritos en el sorteo programado.",
                lee: ["sorteos_programados", "sorteos_programados_grupos", "tabla de números", "grupos (announce)"],
                escribe: ["automation_actions"],
                codigo: [
                    { archivo: "backend/sorteos/publicador.js", simbolo: "procesarPublicados" },
                    { archivo: "backend/sorteos/mensajes.js", simbolo: "mensajeRecordatorio" },
                    { archivo: "backend/automation/eventRules.js", simbolo: "decidirRecordatoriosSegunEstado" }
                ],
                avisos: ["Sin libres o con el grupo cerrado, un recordatorio que invite a reservar todavía se enviaría si hay pagos pendientes: falta indicar el propósito de cada recordatorio."],
                panel: [{ pagina: "Sorteos", ruta: "/sorteos", que: "Textos y horas." }],
                edicion: { nivel: "panel", detalle: "Configurable por sorteo." }
            },
            {
                id: "liberar-vencidas",
                nombre: "Liberación de reservas vencidas",
                resumen: "Libera las reservas no pagadas a la hora indicada.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "horario", descripcion: "Hora de liberación del sorteo programado." }],
                condiciones: ["Solo si ese sorteo lo activó explícitamente."],
                accion: "Devuelve a libre los números reservados sin pagar.",
                lee: ["tabla de números"],
                escribe: ["tabla de números (reservado → libre)"],
                codigo: [{ archivo: "backend/sorteos/publicador.js", simbolo: "liberarVencidas" }],
                panel: [{ pagina: "Sorteos", ruta: "/sorteos", que: "Opción del sorteo programado." }],
                edicion: { nivel: "panel", detalle: "Se activa por sorteo." }
            }
        ]
    },

    // ======================================================================
    {
        id: "miembros",
        nombre: "Grupos y miembros",
        descripcion: "Acciones sobre los participantes de los grupos.",
        entradas: [
            {
                id: "bloqueo",
                nombre: "Expulsión de bloqueados",
                resumen: "Saca del grupo a una persona bloqueada en cuanto entra.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "evento", descripcion: "Un participante entra al grupo." }],
                condiciones: ["La persona está en la lista de bloqueados.", "Una sola vez por persona y grupo en una ventana corta."],
                accion: "Expulsa al participante.",
                lee: ["bloqueados", "usuarios"],
                escribe: ["bloqueo_intentos"],
                codigo: [{ archivo: "backend/bot/funciones/bloqueo/bloqueoParticipantesGrupo.js", simbolo: "procesarIngresoParticipante" }, { archivo: "backend/bot/events/groups.js", simbolo: "registerGroups" }],
                panel: [{ pagina: "Bloqueados", ruta: "/bloqueados", que: "Lista de bloqueados." }],
                edicion: { nivel: "mixto", detalle: "La lista se edita en el panel; la regla es fija." }
            },
            {
                id: "escaner-identidades",
                nombre: "Escáner de identidades",
                resumen: "Asocia los teléfonos y los identificadores de contacto de WhatsApp de los participantes.",
                estado: "funciona",
                activadores: [
                    { tipo: "evento", descripcion: "Entra un participante o se detecta un anuncio." },
                    { tipo: "horario", descripcion: "Escaneo periódico." }
                ],
                condiciones: [],
                accion: "Actualiza usuarios y contactos.",
                lee: ["usuarios"],
                escribe: ["usuarios", "contactos_tenant"],
                codigo: [{ archivo: "backend/bot/funciones/usuarios/escanerIdentidadesLifecycle.js", simbolo: "escanearGrupo" }],
                edicion: { nivel: "codigo", detalle: "Proceso interno." }
            },
            {
                id: "sincronizar-grupo",
                nombre: "Sincronización del grupo",
                resumen: "Actualiza los datos de un grupo cuando cambia en WhatsApp.",
                estado: "funciona",
                activadores: [{ tipo: "evento", descripcion: "WhatsApp informa un cambio en el grupo." }],
                condiciones: [],
                accion: "Sincroniza los datos del grupo.",
                lee: [],
                escribe: ["grupos"],
                codigo: [{ archivo: "backend/bot/events/groups.js", simbolo: "programarSincronizacion" }],
                edicion: { nivel: "codigo", detalle: "Proceso interno." }
            },
            {
                id: "inactividad",
                nombre: "Control de inactividad",
                resumen: "Detecta miembros sin compras confirmadas en 15 días.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "horario", descripcion: "Revisión cada hora, a partir de la hora configurada (Bogotá)." }],
                condiciones: ["Por defecto solo SIMULA y registra; expulsar requiere modo real y una segunda confirmación en el servidor."],
                accion: "Registra (o, en modo real, expulsa) a los miembros inactivos.",
                lee: ["usuarios", "eventos_bot", "inactividad_miembros"],
                escribe: ["inactividad_ejecuciones", "inactividad_evaluaciones", "inactividad_miembros"],
                codigo: [{ archivo: "backend/bot/funciones/inactividad/ejecutarControlInactividad.js", simbolo: "ejecutarControlInactividad" }, { archivo: "backend/bot/funciones/inactividad/configInactividad.js", simbolo: "INACTIVIDAD_MODO" }],
                edicion: { nivel: "entorno", detalle: "Solo se configura en el servidor, con ayuda de soporte. No hay opción en el panel." },
                avisos: ["El modo actual del servidor no se puede ver desde el panel."]
            }
        ]
    },

    // ======================================================================
    {
        id: "panel",
        nombre: "Acciones manuales del panel",
        descripcion: "Acciones que solo ocurren cuando el administrador las ejecuta desde aquí.",
        entradas: [
            {
                id: "compartir-tabla",
                nombre: "Compartir tabla",
                resumen: "Publica la imagen de la tabla en el grupo.",
                estado: "funciona",
                activadores: [{ tipo: "panel", descripcion: "Botón «Compartir» en Tablas." }],
                condiciones: [],
                accion: "Genera la imagen de la tabla y la envía al grupo.",
                lee: ["tabla de números", "diseño de la tabla"],
                escribe: [],
                codigo: [{ archivo: "backend/services/compartirTabla.js", simbolo: "compartirTabla" }, { archivo: "backend/routes/tablas.js", simbolo: "compartirTabla" }],
                panel: [{ pagina: "Tablas", ruta: "/tablas", que: "Compartir." }],
                edicion: { nivel: "panel", detalle: "Acción manual." }
            },
            {
                id: "acciones-numero",
                nombre: "Reservar a mano, registrar el pago, liberar o desbloquear un número",
                resumen: "Intervención manual del propietario sobre un número de la tabla.",
                estado: "funciona",
                sensible: true,
                activadores: [{ tipo: "panel", descripcion: "Ventana de cada número en Tablas." }],
                condiciones: [
                    "Reservar: número libre, sorteo activo del precio y abierto, grupo autorizado y contacto de tus contactos (mismas reglas que las respuestas automáticas).",
                    "Registrar el pago: solo números reservados.",
                    "Liberar, anular un pago o desbloquear: con confirmación; anular un pago exige motivo."
                ],
                accion: "Cambia el estado del número en el servidor, sin enviar mensajes, y lo deja en el historial con el operador.",
                lee: ["tabla de números", "contactos", "sorteo activo"],
                escribe: ["tabla de números", "actividad de la tabla", "historial de auditoría"],
                codigo: [
                    { archivo: "backend/services/reservaManual.js", simbolo: "reservarManual" },
                    { archivo: "backend/bot/funciones/reservas/reservarNumeros.js", simbolo: "reservarNumeros" },
                    { archivo: "backend/routes/tablas.js", simbolo: "reservaManual" }
                ],
                panel: [{ pagina: "Tablas", ruta: "/tablas", que: "Acciones sobre cada número." }],
                edicion: { nivel: "panel", detalle: "Acción manual." }
            }
        ]
    }

];

export const ETIQUETA_TIPO_ACTIVADOR: Record<TipoActivador, string> = {
    frase: "Frase",
    condicion: "Condición",
    evento: "Evento",
    horario: "Horario",
    estado: "Estado",
    accion_admin: "Acción de administrador",
    panel: "Acción del panel",
    desconocido: "Desconocido"
};

export const ETIQUETA_ESTADO: Record<EstadoEntrada, string> = {
    funciona: "Funciona",
    con_conflicto: "Con conflicto conocido",
    sin_efecto: "Sin efecto",
    codigo_muerto: "Sin uso"
};

export const ETIQUETA_EDICION: Record<NivelEdicion, string> = {
    panel: "Editable en el panel",
    mixto: "Parcialmente editable",
    codigo: "Regla fija",
    entorno: "Configurado en el servidor",
    ninguno: "Sin efecto"
};
