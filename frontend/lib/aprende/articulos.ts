// ==========================================================================
// Centro de aprendizaje «Aprende a usar EFAAT» — contenido ESTÁTICO.
//
// Cada artículo describe solo lo que la interfaz hace hoy (auditado sobre el
// código del panel y del backend el 2026-10-22). Si una pantalla cambia, su
// artículo debe cambiar con ella. No se documentan opciones que no existan
// ni se consulta ningún dato privado para generar estos textos.
//
// Las categorías sin artículos todavía aparecen «en preparación», con un
// enlace a su sección, en lugar de describir comportamientos sin verificar.
//
// Sin imports a propósito: tests/aprende lo carga transpilándolo.
// ==========================================================================

export type IconoCategoria =
    | "rocket" | "smartphone" | "ticket" | "message" | "puzzle" | "users" | "target"
    | "calendar-clock" | "calendar-days" | "bot" | "scan" | "shield" | "user";

export interface Categoria {
    id: string;
    titulo: string;
    descripcion: string;
    icono: IconoCategoria;
    // Sección del panel a la que se refiere.
    seccion: { href: string; texto: string } | null;
}

export interface Articulo {
    slug: string;
    categoria: string;
    titulo: string;
    descripcion: string;
    minutos: number;
    // Palabras con las que también se encuentra en el buscador.
    claves: string[];
    paraQueSirve: string;
    antes: string[];
    pasos: string[];
    estados: { nombre: string; significado: string }[];
    errores: { sintoma: string; comprobar: string }[];
    siNoFunciona: string[];
    seccion: { href: string; texto: string } | null;
}

export const CORREO_SOPORTE_APRENDE = "soporte@efaat.com";

export const CATEGORIAS: Categoria[] = [
    { id: "primeros-pasos", titulo: "Primeros pasos", descripcion: "Qué es EFAAT, qué configurar primero y cómo leer los estados.", icono: "rocket", seccion: null },
    { id: "sesiones", titulo: "Sesiones de WhatsApp", descripcion: "Vincular tu número, saber si el bot escucha y resolver desconexiones.", icono: "smartphone", seccion: { href: "/sesiones", texto: "Abrir Sesiones" } },
    { id: "reservas", titulo: "Reservas y tablas", descripcion: "Tablas por precio, estados de los números, historial y compartir.", icono: "ticket", seccion: { href: "/tablas", texto: "Abrir Reservas" } },
    { id: "mi-cuenta", titulo: "Mi cuenta", descripcion: "Perfil, contraseña, plan, grupos y soporte.", icono: "user", seccion: { href: "/mi-cuenta", texto: "Abrir Mi cuenta" } },
    { id: "mensajes", titulo: "Mensajes", descripcion: "Respuestas del bot en los grupos.", icono: "message", seccion: { href: "/mensajes", texto: "Abrir Mensajes" } },
    { id: "variables", titulo: "Variables globales", descripcion: "Datos reutilizables en los mensajes.", icono: "puzzle", seccion: { href: "/variables-globales", texto: "Abrir Variables globales" } },
    { id: "contactos", titulo: "Contactos", descripcion: "Directorio de participantes de tus grupos.", icono: "users", seccion: { href: "/contactos", texto: "Abrir Contactos" } },
    { id: "eventos", titulo: "Eventos", descripcion: "Sorteos detectados por el bot.", icono: "target", seccion: { href: "/eventos", texto: "Abrir Eventos" } },
    { id: "sorteos", titulo: "Sorteos programados", descripcion: "Publicar sorteos desde el panel.", icono: "calendar-clock", seccion: { href: "/sorteos", texto: "Abrir Sorteos programados" } },
    { id: "loterias", titulo: "Calendario de loterías", descripcion: "Loterías y horarios disponibles.", icono: "calendar-days", seccion: { href: "/loterias", texto: "Abrir Calendario de loterías" } },
    { id: "automatizacion", titulo: "Automatización", descripcion: "Grupos autorizados, mensajes y programación del bot.", icono: "bot", seccion: { href: "/automatizacion", texto: "Abrir Automatización" } },
    { id: "lector-pagos", titulo: "Lector de pagos", descripcion: "Lectura de notificaciones de pago.", icono: "scan", seccion: { href: "/lector-pagos", texto: "Abrir Lector de pagos" } },
    { id: "bloqueados", titulo: "Bloqueados", descripcion: "Participantes bloqueados en tus grupos.", icono: "shield", seccion: { href: "/bloqueados", texto: "Abrir Bloqueados" } }
];

const SESIONES = { href: "/sesiones", texto: "Abrir Sesiones" };
const RESERVAS = { href: "/tablas", texto: "Abrir Reservas" };

export const ARTICULOS: Articulo[] = [

    // ------------------------------------------------------ Primeros pasos
    {
        slug: "que-es-efaat",
        categoria: "primeros-pasos",
        titulo: "Qué es EFAAT y cómo orientarte",
        descripcion: "Lo que hace el panel y para qué sirve cada opción del menú.",
        minutos: 3,
        claves: ["menú", "panel", "inicio", "orientarse"],
        paraQueSirve: "EFAAT conecta un número de WhatsApp a un bot que atiende tus grupos de sorteos: toma las reservas de números, responde consultas y te deja administrar todo desde este panel.",
        antes: [
            "Haber iniciado sesión en el panel con tu correo y contraseña.",
            "Tener a mano el teléfono con el WhatsApp que usará el bot."
        ],
        pasos: [
            "Usa el menú lateral para moverte entre secciones. En el móvil se abre con el botón «Abrir menú» de la barra superior.",
            "«Sesiones»: vincula y vigila tu número de WhatsApp.",
            "«Reservas»: abre la tabla de números de cada precio, con su historial.",
            "«Automatización»: autoriza los grupos donde trabaja el bot y configura su comportamiento.",
            "«Mi cuenta» (abajo, junto a tu correo): tus datos, tu contraseña y el contacto con soporte.",
            "Las demás opciones (Mensajes, Variables globales, Contactos, Eventos, Sorteos programados, Calendario de loterías, Lector de pagos y Bloqueados) tendrán su propia guía en este centro."
        ],
        estados: [],
        errores: [
            { sintoma: "El panel te devuelve a la pantalla de inicio de sesión.", comprobar: "Tu sesión terminó o se cerró en otra pestaña. Vuelve a iniciar sesión." }
        ],
        siNoFunciona: ["Si una sección no carga, recarga la página. Si sigue igual, escríbenos desde «Mi cuenta › Ayuda y soporte»."],
        seccion: null
    },
    {
        slug: "primera-configuracion",
        categoria: "primeros-pasos",
        titulo: "Qué configurar primero",
        descripcion: "Los tres pasos para que el bot empiece a tomar reservas.",
        minutos: 4,
        claves: ["empezar", "configuración inicial", "requisitos", "grupos autorizados"],
        paraQueSirve: "Te indica el orden en que conviene preparar tu cuenta para que el bot pueda trabajar en tus grupos.",
        antes: [
            "Un número de WhatsApp que esté en los grupos de tus sorteos.",
            "Acceso a ese teléfono para escanear un código QR."
        ],
        pasos: [
            "Conecta tu WhatsApp: en «Sesiones», pulsa «Agregar sesión» y luego «Conectar» en la tarjeta nueva (detalle en la guía «Crear y conectar una sesión»).",
            "Autoriza tus grupos: en «Automatización › Grupos» aparecen los grupos de tu sesión conectada; pulsa «Autorizar» en cada grupo donde quieres que trabaje el bot. El bot no procesa mensajes, reservas ni pagos en grupos sin autorizar.",
            "Revisa tus tablas: en «Reservas» abre la tabla del precio de tu sorteo. Cuando el bot detecta el anuncio de un sorteo en un grupo autorizado (o lo publicas desde el panel), la tabla muestra «Evento activo» y empieza a recibir reservas."
        ],
        estados: [
            { nombre: "🟢 Autorizado", significado: "El bot trabaja en ese grupo." },
            { nombre: "🟡 Autorizado (inactivo)", significado: "Está autorizado pero en pausa: el bot no lo atiende." },
            { nombre: "⚪ No autorizado", significado: "El bot no actúa en ese grupo." }
        ],
        errores: [
            { sintoma: "En «Automatización › Grupos» no aparece ningún grupo.", comprobar: "Los grupos se leen de la sesión conectada. Comprueba en «Sesiones» que tu número esté conectado." },
            { sintoma: "Acabas de autorizar un grupo y el bot aún no responde.", comprobar: "La autorización puede tardar hasta unos 30 segundos en aplicarse." }
        ],
        siNoFunciona: ["Revisa la guía «Mi sesión no conecta o se desconecta» y, si el problema sigue, escríbenos."],
        seccion: { href: "/automatizacion/grupos", texto: "Abrir Automatización › Grupos" }
    },
    {
        slug: "estados-principales",
        categoria: "primeros-pasos",
        titulo: "Cómo reconocer los estados del sistema",
        descripcion: "Qué significan las etiquetas de las sesiones y los colores de los números.",
        minutos: 3,
        claves: ["estados", "colores", "saludable", "verificando", "sin verificar", "disponible", "reservado", "pagado"],
        paraQueSirve: "Te ayuda a saber de un vistazo si el bot está escuchando y en qué situación está cada número.",
        antes: [],
        pasos: [
            "En «Sesiones», mira la etiqueta de la esquina de cada tarjeta: es el estado real que informa el bot y se actualiza cada pocos segundos.",
            "En una tabla de «Reservas», el color de cada número indica su estado actual (la leyenda aparece encima de la cuadrícula).",
            "Si un dato no se pudo comprobar, el panel lo dice («Verificando…» o «Sin verificar») en lugar de suponerlo."
        ],
        estados: [
            { nombre: "Saludable · escuchando", significado: "La sesión está conectada y el bot está procesando mensajes." },
            { nombre: "Conectada a WhatsApp", significado: "Hay conexión con WhatsApp." },
            { nombre: "Conectando / QR pendiente", significado: "Se está estableciendo la conexión o falta escanear el código QR." },
            { nombre: "Degradada", significado: "Conectada pero con problemas; la tarjeta muestra las causas." },
            { nombre: "Desconectada", significado: "No hay conexión con WhatsApp." },
            { nombre: "Verificando… / Sin verificar", significado: "El panel aún no pudo consultar el estado real; no significa que esté desconectada." },
            { nombre: "Disponible (gris por defecto)", significado: "El número se puede reservar." },
            { nombre: "Reservado (rojo por defecto)", significado: "Apartado y pendiente de pago (incluye números en proceso o bloqueados)." },
            { nombre: "Pagado (verde por defecto)", significado: "El pago está registrado. Los colores cambian si la tabla tiene un diseño personalizado." }
        ],
        errores: [],
        siNoFunciona: ["Consulta las guías de Sesiones y de Reservas para el detalle de cada estado."],
        seccion: null
    },

    // ------------------------------------------------------------ Sesiones
    {
        slug: "crear-y-conectar-sesion",
        categoria: "sesiones",
        titulo: "Crear y conectar una sesión",
        descripcion: "Vincula tu número de WhatsApp al bot escaneando un código QR.",
        minutos: 4,
        claves: ["qr", "vincular", "conectar", "agregar sesión", "dispositivos vinculados", "whatsapp"],
        paraQueSirve: "Una sesión es la conexión entre un número de WhatsApp y el bot de EFAAT. Sin una sesión conectada el bot no puede leer ni responder en tus grupos.",
        antes: [
            "Tener el teléfono con WhatsApp a mano y con internet.",
            "Que ese número esté en los grupos donde trabajará el bot."
        ],
        pasos: [
            "Entra en «Sesiones» y pulsa «Agregar sesión». Aparece una tarjeta nueva con el estado de la sesión.",
            "En la tarjeta, pulsa «Conectar». El botón muestra «Procesando...» mientras el bot prepara el código.",
            "Cuando el botón cambie a «Ver QR», púlsalo: se abre la ventana «Conectar WhatsApp» con el código y un contador.",
            "En el teléfono, abre WhatsApp › Dispositivos vinculados › Vincular un dispositivo, y escanea el código.",
            "Al vincularse, la ventana se cierra sola y el botón de la tarjeta pasa a «Desconectar».",
            "Si quieres que el bot use esta sesión, pulsa «Usar esta sesión» (ver la guía «Sesión en uso y sesión preferida»)."
        ],
        estados: [
            { nombre: "Conectar", significado: "La sesión no está vinculada." },
            { nombre: "Ver QR", significado: "Hay un código listo para escanear." },
            { nombre: "Procesando...", significado: "Se envió la orden y se espera la confirmación del bot." },
            { nombre: "Desconectar", significado: "La sesión está vinculada." }
        ],
        errores: [
            { sintoma: "El contador llegó a 00:00 y la ventana se cerró.", comprobar: "El código venció. Vuelve a pulsar «Ver QR» o, si el botón volvió a «Conectar», púlsalo de nuevo." },
            { sintoma: "La ventana dice «Generando código…».", comprobar: "El código todavía no llega. El código se actualiza solo; espera unos segundos." },
            { sintoma: "Aparece un mensaje debajo del botón.", comprobar: "Indica que la orden falló o que el bot no confirmó a tiempo. Léelo y vuelve a intentarlo." }
        ],
        siNoFunciona: [
            "Prueba «Reconectar» desde el menú de la tarjeta (los tres puntos).",
            "Si sigue sin conectar, revisa la guía «Mi sesión no conecta o se desconecta»."
        ],
        seccion: SESIONES
    },
    {
        slug: "estado-de-la-sesion",
        categoria: "sesiones",
        titulo: "Comprobar si la sesión está conectada y escuchando",
        descripcion: "Cómo leer la tarjeta de la sesión y sus tiempos.",
        minutos: 3,
        claves: ["escuchando", "salud", "bot activo", "último mensaje", "degradada", "atendida en otro equipo"],
        paraQueSirve: "La tarjeta muestra el estado real que informa el bot: no solo si WhatsApp está conectado, sino si el bot está escuchando y procesando mensajes.",
        antes: ["Tener al menos una sesión creada."],
        pasos: [
            "Entra en «Sesiones». La etiqueta de la esquina superior de cada tarjeta es su estado; se vuelve a consultar cada 15 segundos.",
            "Debajo del nombre y el teléfono, las marcas indican el papel de la sesión: «Bot activo», «Preferida» o «En espera».",
            "Cuando hay datos del bot, la tarjeta muestra tiempos: «Conectada», «Escuchando desde», «Último mensaje», «Último procesado OK» y, si los hay, «Último error» y «Recuperación auto.».",
            "Si hay problemas, la tarjeta lista las causas y una acción recomendada."
        ],
        estados: [
            { nombre: "Saludable · escuchando", significado: "Todo correcto: el bot recibe y procesa mensajes." },
            { nombre: "Bot activo", significado: "Es la sesión que usa el bot y está procesando." },
            { nombre: "Activa · no está procesando", significado: "Es la sesión en uso pero el bot no la está procesando; revisa las causas que muestra la tarjeta." },
            { nombre: "En uso · verificando / sin verificar", significado: "Es la sesión en uso, pero aún no se pudo confirmar su estado." },
            { nombre: "Atendida en otro equipo", significado: "Otro servidor de EFAAT está atendiendo esta sesión en este momento." },
            { nombre: "Sin verificar", significado: "No se pudo consultar al bot; la tarjeta muestra el último estado guardado como referencia." }
        ],
        errores: [
            { sintoma: "Arriba aparece «No pudimos consultar el estado del bot en este momento».", comprobar: "No se ha desconectado nada: el panel no pudo preguntar al bot y lo reintenta solo cada pocos segundos." }
        ],
        siNoFunciona: ["Si una sesión sigue «Degradada» o «Desconectada», sigue la guía «Mi sesión no conecta o se desconecta»."],
        seccion: SESIONES
    },
    {
        slug: "sesion-en-uso-y-preferida",
        categoria: "sesiones",
        titulo: "Sesión en uso y sesión preferida",
        descripcion: "Qué significan «Usar esta sesión», «Sesión en uso» y «Hacer preferida».",
        minutos: 2,
        claves: ["usar esta sesión", "sesión en uso", "preferida", "principal", "en espera", "varias sesiones"],
        paraQueSirve: "Si tienes varias sesiones, el bot trabaja con una sola de tu cuenta a la vez. Aquí eliges cuál.",
        antes: ["Tener la sesión conectada para poder usarla."],
        pasos: [
            "En una sesión conectada, pulsa «Usar esta sesión». Pasa a ser la sesión con la que trabaja el bot para tu cuenta y también queda marcada como «Preferida».",
            "El botón cambia a «Sesión en uso» en la sesión elegida.",
            "Desde el menú de la tarjeta (los tres puntos) puedes usar «Hacer preferida» para marcar una sesión como preferida aunque no esté conectada.",
            "Las sesiones que no están en uso ni son preferidas muestran «En espera»."
        ],
        estados: [
            { nombre: "Sesión en uso", significado: "Es la sesión que usa el bot para tu cuenta." },
            { nombre: "Preferida", significado: "La sesión que elegiste como preferida." },
            { nombre: "En espera", significado: "Está creada pero el bot no la usa." }
        ],
        errores: [
            { sintoma: "No ves el botón «Usar esta sesión» en la tarjeta.", comprobar: "Solo aparece con la sesión conectada. Desde el menú también está la opción «Usar esta sesión» mientras no sea la sesión en uso." }
        ],
        siNoFunciona: ["Recarga la página de Sesiones para ver los cambios; normalmente se reflejan solos en unos segundos."],
        seccion: SESIONES
    },
    {
        slug: "desconectar-y-eliminar-sesion",
        categoria: "sesiones",
        titulo: "Desconectar, reconectar, renombrar o eliminar una sesión",
        descripcion: "Las acciones de la tarjeta y de su menú, y qué efecto tiene cada una.",
        minutos: 3,
        claves: ["desconectar", "reconectar", "eliminar", "cambiar nombre", "menú de la sesión"],
        paraQueSirve: "Te explica cómo administrar una sesión existente sin sorpresas.",
        antes: ["Tener una sesión creada."],
        pasos: [
            "Desconectar: en una sesión conectada, pulsa «Desconectar» en la tarjeta.",
            "Reconectar: abre el menú de la tarjeta (los tres puntos) y elige «Reconectar». Hace lo mismo que «Conectar».",
            "Cambiar nombre: en el menú, «Cambiar nombre». Solo cambia el nombre que ves en el panel.",
            "Eliminar: en el menú, «Eliminar», y confirma en la ventana. Se desconecta el número y se borran la sesión y sus archivos de autenticación. No se puede deshacer.",
            "También puedes cerrar la vinculación desde el teléfono: WhatsApp › Dispositivos vinculados."
        ],
        estados: [],
        errores: [
            { sintoma: "Eliminaste la sesión por error.", comprobar: "No se puede recuperar: crea una sesión nueva con «Agregar sesión» y vuelve a escanear el QR." }
        ],
        siNoFunciona: ["Si una acción queda en «Procesando...», espera: termina con la confirmación del bot, con un error o al vencer la espera."],
        seccion: SESIONES
    },
    {
        slug: "enlace-de-conexion",
        categoria: "sesiones",
        titulo: "Conectar con un enlace (y sus precauciones)",
        descripcion: "Envía un enlace para que otra persona escanee el QR desde su teléfono.",
        minutos: 2,
        claves: ["compartir enlace", "enlace de conexión", "link", "conectar a distancia", "seguridad"],
        paraQueSirve: "Sirve cuando el teléfono que se va a vincular no está contigo: la persona abre el enlace y escanea el código desde otra pantalla.",
        antes: [
            "Haber pulsado «Conectar» en la tarjeta, para que exista un código QR que mostrar.",
            "Confiar en la persona que recibirá el enlace."
        ],
        pasos: [
            "En el menú de la tarjeta (los tres puntos), elige «Compartir enlace». También está en la ventana del QR. El enlace se copia al portapapeles.",
            "Envíaselo a la persona dueña del teléfono que se va a vincular.",
            "Al abrirlo verá el código QR con un contador «Expira en» y las instrucciones para escanearlo.",
            "Cuando la vinculación termina, la página muestra «WhatsApp conectado» y puede cerrarse."
        ],
        estados: [
            { nombre: "Esperando conexión", significado: "El código está listo para escanear." },
            { nombre: "Generando código QR...", significado: "Todavía no hay un código: falta pulsar «Conectar» en el panel o aún se está creando." },
            { nombre: "WhatsApp conectado", significado: "La sesión quedó vinculada." }
        ],
        errores: [
            { sintoma: "La persona ve «Generando código QR...» todo el tiempo.", comprobar: "Pulsa «Conectar» en la tarjeta de la sesión; el código aparece en su página automáticamente." }
        ],
        siNoFunciona: [
            "Importante: la página del enlace no pide iniciar sesión. Quien lo tenga puede ver el código y vincular su WhatsApp a esa sesión mientras el código esté vigente. Compártelo solo con la persona correcta y no lo publiques en grupos."
        ],
        seccion: SESIONES
    },
    {
        slug: "sesion-no-conecta",
        categoria: "sesiones",
        titulo: "Mi sesión no conecta o se desconecta",
        descripcion: "Comprobaciones ordenadas para recuperar la conexión.",
        minutos: 3,
        claves: ["no conecta", "desconectada", "pierde conexión", "error", "problema", "qr vencido"],
        paraQueSirve: "Una lista de comprobaciones para cuando la sesión no se vincula o deja de escuchar.",
        antes: ["Tener el teléfono con WhatsApp encendido y con internet."],
        pasos: [
            "Mira la etiqueta de la tarjeta. Si dice «Verificando…» o «Sin verificar», el panel no pudo consultar al bot: espera unos segundos antes de actuar.",
            "Si dice «Degradada» o «Desconectada», lee las causas y la acción recomendada que muestra la tarjeta.",
            "Pulsa «Reconectar» en el menú de la tarjeta (o «Conectar») y, cuando aparezca «Ver QR», vuelve a escanear el código.",
            "En el teléfono, revisa WhatsApp › Dispositivos vinculados: si la sesión ya no aparece, hay que vincularla de nuevo.",
            "Si la tarjeta dice «Atendida en otro equipo», otro servidor de EFAAT la está atendiendo: no hace falta reconectar."
        ],
        estados: [],
        errores: [
            { sintoma: "El código vence antes de escanearlo.", comprobar: "Ten WhatsApp abierto en «Vincular un dispositivo» antes de pulsar «Ver QR»." },
            { sintoma: "Se conecta pero el bot no responde en un grupo.", comprobar: "Ese grupo debe estar autorizado en «Automatización › Grupos» y la sesión debe ser la «Sesión en uso»." }
        ],
        siNoFunciona: [`Escríbenos a ${CORREO_SOPORTE_APRENDE} indicando el nombre de la sesión y lo que muestra su tarjeta. Nunca te pediremos tu contraseña ni el código QR.`],
        seccion: SESIONES
    },

    // ------------------------------------------------------------ Reservas
    {
        slug: "tablas-de-precio",
        categoria: "reservas",
        titulo: "Las tablas de precio y el evento activo",
        descripcion: "Qué es cada tabla, cómo abrirla y qué significa el aviso de evento.",
        minutos: 3,
        claves: ["tabla", "precio", "evento activo", "sin evento activo", "estadísticas", "ocupación"],
        paraQueSirve: "Cada tabla agrupa los números de los sorteos de un precio. Ahí ves en tiempo real qué números están disponibles, reservados o pagados.",
        antes: ["Tener tu cuenta con tablas configuradas (aparecen en «Reservas»)."],
        pasos: [
            "Entra en «Reservas» y elige la tabla del precio que quieres ver.",
            "Arriba verás el nombre del sorteo y una marca: «🟢 Evento activo» o «⚪ Sin evento activo».",
            "Las tarjetas muestran Disponibles, Reservados, Pagados y el porcentaje de Ocupación.",
            "Debajo están las acciones (Reiniciar, Editar, Compartir, Cambiar grupos, Personalizar y Diseños), la cuadrícula de números y el «Historial de números».",
            "La tabla se actualiza sola cuando el bot o el panel cambian un número."
        ],
        estados: [
            { nombre: "🟢 Evento activo", significado: "Hay un sorteo abierto de este precio en la tabla." },
            { nombre: "⚪ Sin evento activo", significado: "No hay sorteo de este precio ahora: los números muestran su último estado, pero no se pueden reservar hasta abrir un evento." },
            { nombre: "Aviso de otro evento", significado: "La tabla física está ocupada por un sorteo de otro precio; sus números ocupados se ven reservados o pagados aquí." }
        ],
        errores: [
            { sintoma: "«No se encontraron los números de esta tabla».", comprobar: "La pantalla explica el motivo. No reinicies la tabla: recarga la página o avísanos." },
            { sintoma: "«Tu cuenta no tiene tablas de números configuradas».", comprobar: "Escríbenos para revisar la configuración de tu cuenta." }
        ],
        siNoFunciona: ["Si el sorteo no aparece como activo, revisa que el grupo esté autorizado y que el anuncio se haya publicado en él."],
        seccion: RESERVAS
    },
    {
        slug: "estados-de-los-numeros",
        categoria: "reservas",
        titulo: "Estados de los números",
        descripcion: "Qué significa cada color y cada estado del detalle del número.",
        minutos: 2,
        claves: ["disponible", "reservado", "pagado", "en proceso", "bloqueado", "retención vencida", "colores"],
        paraQueSirve: "Te ayuda a interpretar correctamente cada número antes de actuar sobre él.",
        antes: [],
        pasos: [
            "En la cuadrícula, cada número tiene el color de su estado (ver la leyenda encima).",
            "Pulsa un número para abrir su detalle: verás el estado real, el cliente, el teléfono, el grupo de WhatsApp, las fechas y su historial."
        ],
        estados: [
            { nombre: "Disponible", significado: "Libre para reservar." },
            { nombre: "Reservado · pendiente de pago", significado: "Apartado por un cliente; falta el pago." },
            { nombre: "Pagado", significado: "El pago está registrado." },
            { nombre: "En proceso (retención temporal)", significado: "Retenido durante un tiempo; en la cuadrícula se ve como reservado." },
            { nombre: "Retención vencida", significado: "La tabla lo muestra disponible, pero sigue retenido en la base: ni el bot ni el panel pueden reservarlo hasta liberarlo." },
            { nombre: "Bloqueado", significado: "No se puede reservar; el detalle indica el motivo si está registrado." }
        ],
        errores: [],
        siNoFunciona: ["Si el estado no coincide con lo que pasó en el grupo, revisa el historial del número antes de cambiarlo."],
        seccion: RESERVAS
    },
    {
        slug: "reservar-pagar-liberar",
        categoria: "reservas",
        titulo: "Reservar, registrar el pago o liberar un número",
        descripcion: "Intervenir manualmente un número desde su detalle.",
        minutos: 4,
        claves: ["reserva manual", "registrar pago", "liberar", "anular pago", "desbloquear", "motivo"],
        paraQueSirve: "Corrige o completa lo que el bot no registró: una reserva por llamada, un pago recibido o una reserva que hay que soltar.",
        antes: [
            "Para reservar: un sorteo activo de este precio que acepte reservas y al menos un grupo del sorteo autorizado para el bot.",
            "Tener claro el motivo de la intervención: queda registrado."
        ],
        pasos: [
            "Pulsa el número en la cuadrícula para abrir su detalle.",
            "Reservar (número disponible): busca el contacto o crea uno nuevo con nombre y teléfono, elige el grupo de WhatsApp donde hizo el pedido, escribe el motivo y pulsa «Reservar el …». La fecha y la hora las fija el servidor al guardar. No se envía ningún mensaje por WhatsApp.",
            "Registrar pago (número reservado): pulsa «Registrar pago», elige el método si quieres (opcional), añade observaciones y pulsa «Confirmar pago». El número pasa a Pagado.",
            "Liberar (número reservado): pulsa «Liberar reserva» y confirma. Se borran el cliente, el grupo y las fechas de esa reserva y el número queda disponible.",
            "Anular un pago: en un número pagado, pulsa «Anular y liberar»; el motivo es obligatorio.",
            "Desde «Reservas recientes» también puedes registrar el pago o liberar los últimos números reservados."
        ],
        estados: [],
        errores: [
            { sintoma: "«No hay un sorteo activo para esta tabla: no se puede reservar».", comprobar: "Abre o publica el sorteo de este precio." },
            { sintoma: "«El sorteo ya no acepta reservas».", comprobar: "El sorteo está cerrado o pasó su hora de cierre." },
            { sintoma: "«Ningún grupo de este sorteo está autorizado para el bot».", comprobar: "Autoriza el grupo en «Automatización › Grupos»." },
            { sintoma: "«El número cambió de estado».", comprobar: "Alguien (el bot u otra persona) lo cambió mientras tanto. Recarga y revisa antes de repetir." }
        ],
        siNoFunciona: ["Si una reserva falla por la red, puedes reintentar: si ya se guardó, no se duplica."],
        seccion: RESERVAS
    },
    {
        slug: "buscar-y-filtrar",
        categoria: "reservas",
        titulo: "Buscar por número, nombre o teléfono",
        descripcion: "El buscador y los filtros del Historial de números.",
        minutos: 2,
        claves: ["buscar", "buscador", "filtrar", "teléfono", "nombre", "grupo", "fecha", "limpiar"],
        paraQueSirve: "Encuentra rápido los números de un cliente o de un día concreto. La búsqueda filtra a la vez el historial y la cuadrícula.",
        antes: [],
        pasos: [
            "En la tabla, baja hasta «Historial de números». El buscador está arriba de la sección.",
            "Número: escribe «7» o «07» para encontrar el 07.",
            "Nombre: escribe el nombre con o sin tildes.",
            "Teléfono: escribe el número completo, con o sin +57, espacios o guiones. Un trozo del teléfono no basta.",
            "Usa los filtros de estado actual, grupo y fecha para acotar.",
            "Cuando hay filtros, encima de la cuadrícula aparece «Cuadrícula filtrada…». Pulsa «Mostrar todos» o «Limpiar» para volver a verlo todo."
        ],
        estados: [],
        errores: [
            { sintoma: "Un número del cliente no aparece al buscar su teléfono.", comprobar: "Puede que esa reserva no tenga guardado el teléfono ni la identidad del contacto. Prueba buscando por su nombre." },
            { sintoma: "Un número que antes estuvo pagado no aparece con el filtro «Pagado».", comprobar: "El filtro usa el estado actual. Elige «Estado actual: todos» para verlo." }
        ],
        siNoFunciona: ["Pulsa «Limpiar» para quitar todos los filtros."],
        seccion: RESERVAS
    },
    {
        slug: "historial-de-numeros",
        categoria: "reservas",
        titulo: "Leer el Historial de números",
        descripcion: "Estado actual, hora de reserva y movimientos registrados.",
        minutos: 3,
        claves: ["historial", "movimientos", "auditoría", "actividad registrada", "archivo", "hora de reserva"],
        paraQueSirve: "Te muestra qué pasó con cada número: quién lo tiene ahora y qué movimientos quedaron registrados.",
        antes: [],
        pasos: [
            "En la tabla, abre «Historial de números». Cada fila es un número con su estado actual, cliente, contacto y grupo.",
            "A la derecha, «Reserva: fecha hora» es el momento en que se reservó el número en su reserva actual (hora de Colombia). Si falta la hora, dice «Hora no registrada».",
            "Pulsa una fila para ver «Estado actual» y «Movimientos registrados».",
            "Cada movimiento indica su fuente: «auditoría» (registro fiable de operaciones), «actividad registrada» o «archivo de reinicio»."
        ],
        estados: [
            { nombre: "auditoría", significado: "Operación registrada por el servidor, con estado anterior y nuevo." },
            { nombre: "actividad registrada", significado: "Registro de actividad de la tabla." },
            { nombre: "archivo de reinicio", significado: "Copia de cómo estaba el número antes de reiniciar la tabla desde un sorteo programado." }
        ],
        errores: [
            { sintoma: "La sección dice que la auditoría aún no está activada.", comprobar: "Se muestran la actividad registrada y el archivo de reinicios mientras tanto." },
            { sintoma: "Falta un cambio que sí ocurrió.", comprobar: "No todos los cambios quedan registrados: por ejemplo, reiniciar la tabla manualmente no guarda el estado anterior." }
        ],
        siNoFunciona: ["El historial solo muestra lo registrado: nunca rellena fechas o movimientos que no existan."],
        seccion: RESERVAS
    },
    {
        slug: "compartir-tabla",
        categoria: "reservas",
        titulo: "Compartir la tabla en tus grupos",
        descripcion: "Publicar la imagen de la tabla con su texto en WhatsApp.",
        minutos: 3,
        claves: ["compartir", "imagen", "publicar", "cambiar grupos", "pie de foto", "enviar"],
        paraQueSirve: "Envía a tus grupos una imagen de la cuadrícula tal como se ve, con el texto de publicación del sorteo.",
        antes: [
            "Un sorteo activo en esta tabla.",
            "Tu WhatsApp conectado en «Sesiones».",
            "Grupos autorizados en «Automatización»."
        ],
        pasos: [
            "Quita los filtros del Historial antes de compartir: la imagen es la cuadrícula tal como se ve (si está filtrada, sale filtrada).",
            "Pulsa «Compartir». La primera vez (o si los grupos guardados ya no están disponibles) se abre «Compartir tabla en WhatsApp».",
            "Revisa la vista previa y el texto (pie de foto). Lo que cambies ahí vale solo para ese envío; para cambiarlo siempre, usa «Editar».",
            "Elige los grupos y pulsa «Continuar», y luego «Confirmar y enviar». Nada se envía hasta que confirmas.",
            "Los grupos quedan guardados: el siguiente «Compartir» publica directamente en ellos.",
            "Para elegir otros grupos, pulsa «Cambiar grupos». Ahí también puedes «Guardar grupos sin enviar»."
        ],
        estados: [
            { nombre: "Ya enviado en esta misma solicitud", significado: "No se duplicó el envío." },
            { nombre: "Envío en curso", significado: "Espera a que termine." }
        ],
        errores: [
            { sintoma: "«Tu WhatsApp no está conectado».", comprobar: "Conéctalo en «Sesiones» y vuelve a intentarlo. No se envió nada." },
            { sintoma: "«No hay ningún sorteo activo en esta tabla para compartir».", comprobar: "Abre o publica el sorteo de este precio." },
            { sintoma: "«No tienes grupos autorizados».", comprobar: "Autoriza grupos en «Automatización › Grupos»." },
            { sintoma: "«El envío tardó demasiado en responder».", comprobar: "Puede que se haya enviado: revisa los grupos antes de reintentar." }
        ],
        siNoFunciona: ["La imagen solo incluye la cuadrícula de números: no lleva la leyenda, los filtros, los botones ni las estadísticas."],
        seccion: RESERVAS
    },
    {
        slug: "editar-personalizar-disenos",
        categoria: "reservas",
        titulo: "Editar el sorteo, personalizar y aplicar diseños",
        descripcion: "Los botones «Editar», «Personalizar» y «Diseños».",
        minutos: 3,
        claves: ["editar", "personalizar", "diseños", "colores", "biblioteca", "mensaje de publicación"],
        paraQueSirve: "Ajusta el sorteo de la tabla y el aspecto de la cuadrícula sin afectar a las demás tablas.",
        antes: [],
        pasos: [
            "«Editar» abre el sorteo de esta tabla: si hay uno activo, puedes cambiar lo que se permite con el sorteo en curso; si no, abre el sorteo programado más reciente sin publicar; si no hay ninguno, te ofrece «Crear sorteo nuevo».",
            "«Personalizar» cambia los colores, los presets y la apariencia de los números de esta tabla. Puedes guardar los cambios o «Guardar como diseño nuevo».",
            "«Diseños» abre la «Biblioteca de diseños» con los predeterminados y los tuyos. Aplicar un diseño crea una copia independiente para esta tabla: no cambia otras tablas ni el original.",
            "En «Mis diseños» puedes editar, duplicar o eliminar cada diseño."
        ],
        estados: [
            { nombre: "Diseño personalizado", significado: "Esta tabla tiene su propio diseño." }
        ],
        errores: [
            { sintoma: "«Editar» muestra un error.", comprobar: "Pulsa «Reintentar». El panel nunca abre un formulario vacío si no pudo cargar el sorteo." }
        ],
        siNoFunciona: ["Los cambios de diseño solo afectan al aspecto: no cambian reservas ni pagos."],
        seccion: RESERVAS
    },
    {
        slug: "reiniciar-tabla",
        categoria: "reservas",
        titulo: "Reiniciar una tabla",
        descripcion: "Qué borra el botón «Reiniciar» y cuándo usarlo.",
        minutos: 1,
        claves: ["reiniciar", "borrar", "limpiar tabla", "nuevo sorteo"],
        paraQueSirve: "Deja todos los números de la tabla disponibles otra vez.",
        antes: ["Asegúrate de que el sorteo terminó y de que ya no necesitas los datos actuales."],
        pasos: [
            "Pulsa «Reiniciar» en la tabla.",
            "La ventana te muestra cuántos números están ocupados ahora.",
            "Pulsa «Sí, reiniciar» para confirmar: se borran cliente, contacto, grupo, evento y fechas de cada reserva. Solo afecta tus propias filas."
        ],
        estados: [],
        errores: [
            { sintoma: "Necesitas los datos de antes del reinicio.", comprobar: "El reinicio manual no guarda una copia en el historial. Revisa antes los números que te interesen." }
        ],
        siNoFunciona: ["Si la tabla muestra que no se encontraron sus números, no la reinicies: avísanos."],
        seccion: RESERVAS
    },

    // ----------------------------------------------------------- Mi cuenta
    {
        slug: "mi-cuenta",
        categoria: "mi-cuenta",
        titulo: "Tu perfil, contraseña, plan y soporte",
        descripcion: "Qué puedes consultar y cambiar en «Mi cuenta».",
        minutos: 3,
        claves: ["perfil", "contraseña", "nombre", "plan", "suscripción", "pagos", "soporte", "renovar"],
        paraQueSirve: "Reúne tus datos de acceso y las vías de contacto con el equipo de EFAAT.",
        antes: [],
        pasos: [
            "Abre «Mi cuenta» desde el menú lateral, debajo de tu correo.",
            "«Mi perfil»: consulta tus datos, cambia tu nombre visible y tu contraseña (te pide primero la actual). El correo no se puede cambiar desde el panel.",
            "«Mi suscripción» y «Pagos y renovaciones»: tu plan, su vencimiento y tus pagos todavía no se registran en el panel. Desde ahí puedes pedirlos o solicitar una renovación por correo.",
            "«Mis grupos»: tus grupos autorizados y tus conexiones de WhatsApp.",
            `«Ayuda y soporte»: el correo ${CORREO_SOPORTE_APRENDE}.`
        ],
        estados: [],
        errores: [
            { sintoma: "«La contraseña actual no es correcta».", comprobar: "Revisa la contraseña con la que entras al panel." },
            { sintoma: "No se pudo cambiar la contraseña.", comprobar: "Usa «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión." }
        ],
        siNoFunciona: ["No realizamos cobros automáticos ni pedimos datos de tarjeta en el panel."],
        seccion: { href: "/mi-cuenta", texto: "Abrir Mi cuenta" }
    }

];

export const PRIMEROS_PASOS = "primeros-pasos";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function articuloPorSlug(slug: string): Articulo | null {
    return ARTICULOS.find(a => a.slug === slug) || null;
}

export function categoriaPorId(id: string): Categoria | null {
    return CATEGORIAS.find(c => c.id === id) || null;
}

export function articulosDe(categoria: string): Articulo[] {
    return ARTICULOS.filter(a => a.categoria === categoria);
}

// Búsqueda sin tildes: todas las palabras deben aparecer en el título, la
// descripción, las claves o la categoría del artículo.
export function buscarArticulos(consulta: string): Articulo[] {
    const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return ARTICULOS.filter((a) => {
        const texto = normalizar([a.titulo, a.descripcion, ...a.claves, categoriaPorId(a.categoria)?.titulo || ""].join(" "));
        return palabras.every(p => texto.includes(p));
    });
}
