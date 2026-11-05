// ==========================================================================
// Landing comercial pública de EFAAT (ruta "/"). Componente de servidor:
// no lee Supabase, no llama al backend del bot y no usa la sesión del
// usuario. La única parte interactiva es la demostración (DemoSorteo), que
// también es 100% local. Los acordeones de preguntas son <details> nativos.
//
// Reglas de contenido:
//   - Solo se anuncian funciones que existen en el código; lo que sigue en
//     desarrollo aparece como tal.
//   - La prueba gratuita y la contratación se piden por correo
//     (CORREO_COMERCIAL): todavía no hay registro comercial ni suscripciones.
//     La solicitud queda pendiente de coordinación; nunca se promete
//     activación inmediata.
//   - Contenido por plan (PLAN_DETALLE / COMPARATIVA): texto comercial
//     aprobado por el negocio. El sistema todavía NO aplica límites por plan
//     (ver lib/comercial/planes.ts); esto es solo presentación.
//   - Reacciones: ✅ todos reservados, ❌ todos ocupados, ninguna si es
//     parcial (backend/bot/funciones/reservas/reaccionReserva.js).
//   - Consultas (backend/bot/funciones/consultas/resolverConsulta.js): sus
//     números reservados, sus pagos pendientes y los números disponibles.
//   - «Asignación automática»: el número pedido en el grupo queda a nombre
//     del participante sin intervención. No hay asignación al azar.
//   - Confirmación de pagos: desde el panel (uno a uno o por lote). El
//     sticker de pago es una función en verificación y no consulta bancos.
//     No se anuncian la lectura de pagos en Android ni el control de
//     inactividad.
//   - No hay términos ni política de privacidad publicados: no se enlazan.
//   - Conexiones (auditado en backend/services/baileys/manager.js): el bot
//     atiende con UNA sesión activa a la vez y el failover automático elige
//     entre todas las sesiones conectadas del proceso, sin filtrar por
//     cliente. Por eso no se anuncian varias conexiones operativas a la vez
//     ni el cambio automático a la de respaldo: el respaldo queda «En
//     espera» y se activa desde el panel («Usar esta sesión»).
//   - La ilustración del panel usa datos ficticios: no es una captura real
//     (una captura del panel mostraría datos de clientes).
// ==========================================================================

import Link from "next/link";
import {
    ArrowRight,
    Ban,
    BadgeCheck,
    CalendarClock,
    Check,
    FileText,
    Grid3x3,
    Hourglass,
    LayoutDashboard,
    ListChecks,
    Mail,
    MessageCircle,
    Minus,
    MonitorSmartphone,
    Printer,
    QrCode,
    Search,
    ShieldCheck,
    Smartphone,
    SmilePlus,
    Ticket,
    UserCheck,
    Users,
    Wifi,
    Wrench,
    Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// La duración de la prueba (DIAS_PRUEBA_GRATUITA / HORAS_PRUEBA_GRATUITA) y
// el correo de solicitud (enlaceSolicitud) vienen SOLO de planes.ts.
import {
    CORREO_COMERCIAL,
    DIAS_PRUEBA_GRATUITA,
    HORAS_PRUEBA_GRATUITA,
    PLANES,
    enlaceSolicitud,
    formatearCOP,
    textoGrupos
} from "@/lib/comercial/planes";
import type { PlanComercial } from "@/lib/comercial/planes";
import DemoSorteo from "./demo/DemoSorteo";
import VolverArriba from "./VolverArriba";
import styles from "./landing.module.css";

interface Funcion {
    icono: LucideIcon;
    titulo: string;
    texto: string;
}

// Las ocho funciones principales (tarjetas grandes).
const FUNCIONES: Funcion[] = [
    {
        icono: Zap,
        titulo: "Sorteos instantáneos",
        texto: "Publica un sorteo en tus grupos en el momento, con la tabla de números y el mensaje de anuncio listos."
    },
    {
        icono: CalendarClock,
        titulo: "Sorteos programados",
        texto: "Deja programados la publicación de la tabla, los recordatorios y el aviso de cierre en los grupos que elijas."
    },
    {
        icono: Ticket,
        titulo: "Reservas de números",
        texto: "Los participantes piden sus números escribiendo en el grupo y EFAAT los aparta si están libres, avisando cuáles ya estaban ocupados."
    },
    {
        icono: BadgeCheck,
        titulo: "Confirmación de pagos",
        texto: "Marca como pagados los números desde el panel, uno a uno o varios a la vez, y consulta el historial de cada número."
    },
    {
        icono: UserCheck,
        titulo: "Asignación automática de números",
        texto: "Cada número pedido queda a nombre del participante en la tabla, sin que tengas que anotarlo a mano."
    },
    {
        icono: Grid3x3,
        titulo: "Tablas y precios",
        texto: "Configura una tabla de números para cada precio y ve en vivo cuáles están libres, reservados o pagados."
    },
    {
        icono: Users,
        titulo: "Grupos de WhatsApp",
        texto: "Elige en qué grupos trabaja EFAAT y en cuáles se publica cada sorteo."
    },
    {
        icono: LayoutDashboard,
        titulo: "Panel del organizador",
        texto: "Sorteos, tablas, reservas, pagos y mensajes en un solo lugar, desde el computador o el celular."
    }
];

// Funciones complementarias (lista compacta bajo las tarjetas).
const FUNCIONES_EXTRA: Funcion[] = [
    {
        icono: SmilePlus,
        titulo: "Respuestas y reacciones automáticas",
        texto: "Cada pedido recibe su respuesta en el grupo. Además, EFAAT reacciona con ✅ cuando se reservan todos los números pedidos y con ❌ cuando todos estaban ocupados; si la reserva es parcial, no reacciona."
    },
    {
        icono: Search,
        titulo: "Consultas de los participantes",
        texto: "Los participantes pueden consultar sus números reservados, conocer sus pagos pendientes y preguntar qué números siguen disponibles."
    },
    {
        icono: FileText,
        titulo: "Plantillas de mensajes",
        texto: "Elige el tono de cada respuesta entre varios estilos o escribe las tuyas, con variables como el nombre del participante y sus números."
    },
    {
        icono: Printer,
        titulo: "Tablas para compartir e imprimir",
        texto: "Genera la imagen de la tabla con tu diseño para compartirla en el grupo o imprimirla."
    },
    {
        icono: Ban,
        titulo: "Bloqueos de participantes",
        texto: "Lleva tu lista de participantes bloqueados: si uno vuelve a entrar a tus grupos, EFAAT lo retira automáticamente."
    },
    {
        icono: QrCode,
        titulo: "Conexión con código QR",
        texto: "Vincula tu número escaneando un código QR, como en WhatsApp Web, y revisa el estado de la conexión desde el panel."
    }
];

const EN_DESARROLLO = [
    {
        titulo: "Confirmación de pagos con sticker",
        texto: "Está en verificación: el organizador responde con un sticker al mensaje del participante y sus números reservados pasan a pagados. No consulta bancos ni comprueba transferencias; mientras tanto, los pagos se marcan desde el panel."
    },
    {
        titulo: "Apertura y cierre automático de grupos",
        texto: "Está en ajuste y verificación. No la incluimos todavía como función garantizada."
    }
];

const PROBLEMAS = [
    {
        antes: "Responder uno por uno a quien pide un número.",
        despues: "EFAAT aparta el número y responde en el grupo al instante."
    },
    {
        antes: "Buscar en la lista cada vez que alguien pregunta qué números tiene.",
        despues: "Cada participante consulta sus propios números y recibe la respuesta automática."
    },
    {
        antes: "Llevar la cuenta de quién reservó qué en notas o capturas.",
        despues: "Cada reserva queda en la tabla del panel con el nombre del participante."
    },
    {
        antes: "Publicar a mano la tabla, los recordatorios y el cierre.",
        despues: "Programas el sorteo una vez y EFAAT publica en los grupos elegidos."
    }
];

const PASOS = [
    { titulo: "Envía tu solicitud", texto: `Escríbenos a ${CORREO_COMERCIAL}. Tu solicitud queda pendiente hasta que la revisemos y te contactemos.` },
    { titulo: "Coordinamos el inicio", texto: "Acordamos contigo la fecha de inicio y te acompañamos a vincular tu número con código QR." },
    { titulo: "Configura tus respuestas", texto: "Elige el estilo de las respuestas y programa tu primer sorteo." },
    { titulo: "Deja que EFAAT responda", texto: "Las reservas y las consultas de números propios se atienden solas; tú lo sigues desde el panel." }
];

interface Recomendacion extends Funcion {
    esencial?: boolean;
}

const RECOMENDACIONES: Recomendacion[] = [
    {
        icono: Smartphone,
        titulo: "Utiliza un número dedicado para EFAAT",
        texto: "Recomendamos utilizar un número destinado al sistema, separado del número personal que usas para conversar con familiares y clientes. Así reduces las interrupciones y facilitas la administración.",
        esencial: true
    },
    {
        icono: ShieldCheck,
        titulo: "Haz administrador al número conectado",
        texto: "El número de WhatsApp vinculado a EFAAT debe ser administrador de los grupos donde funcionará EFAAT. Este permiso es necesario para las acciones administrativas que lo requieran, como expulsar participantes bloqueados y abrir o cerrar grupos cuando corresponda.",
        esencial: true
    },
    {
        icono: Wifi,
        titulo: "Mantén activa y estable la conexión",
        texto: "No cierres manualmente la sesión vinculada desde tu teléfono si quieres que EFAAT siga atendiendo tus grupos."
    },
    {
        icono: ListChecks,
        titulo: "Comprueba los permisos del grupo",
        texto: "Ser administrador no garantiza por sí solo que todas las funciones estén disponibles: también deben estar habilitadas las acciones correspondientes y configuradas correctamente."
    }
];

// --------------------------------------------------------------------------
// Planes: precio y grupos vienen de lib/comercial/planes.ts (fuente única);
// aquí solo el texto comercial de cada tarjeta.
// --------------------------------------------------------------------------

interface DetallePlan {
    descripcion: string;
    base?: string;          // «Todo lo del …» (se muestra destacado)
    incluye: string[];
}

const PLAN_DETALLE: Record<PlanComercial["id"], DetallePlan> = {
    esencial: {
        descripcion: "Para empezar a automatizar un grupo de sorteos.",
        incluye: [
            "Solo sorteos instantáneos",
            "Gestión de reservas y pagos",
            "Asignación automática de números",
            "Configuración de tablas y precios",
            "Panel de administración",
            "2 plantillas por categoría"
        ]
    },
    profesional: {
        descripcion: "Para quien maneja dos grupos y quiere programar sus sorteos.",
        base: "Todo lo del Esencial",
        incluye: [
            "Sorteos instantáneos y programados",
            "Configuración independiente por grupo",
            "Administración centralizada",
            "2 plantillas por categoría"
        ]
    },
    avanzado: {
        descripcion: "Para organizadores con varios grupos activos a la vez.",
        base: "Todo lo del Profesional",
        incluye: [
            "Administración de hasta 5 grupos",
            "Configuraciones independientes",
            "Control centralizado"
        ]
    },
    empresarial: {
        descripcion: "Para operaciones grandes que quieren acompañamiento cercano.",
        base: "Todo lo del Avanzado",
        incluye: [
            "Gestión centralizada",
            "Acompañamiento personalizado de configuración"
        ]
    }
};

// Celda de la comparativa: true = incluido, false = no incluido, texto = valor.
type Celda = boolean | string;

const COMPARATIVA: { concepto: string; valores: [Celda, Celda, Celda, Celda] }[] = [
    { concepto: "Grupos de WhatsApp", valores: ["1", "Hasta 2", "Hasta 5", "Hasta 10"] },
    { concepto: "Sorteos instantáneos", valores: [true, true, true, true] },
    { concepto: "Sorteos programados", valores: [false, true, true, true] },
    { concepto: "Gestión de reservas", valores: [true, true, true, true] },
    { concepto: "Confirmación de pagos", valores: [true, true, true, true] },
    { concepto: "Asignación automática de números", valores: [true, true, true, true] },
    { concepto: "Configuración de tablas y precios", valores: [true, true, true, true] },
    { concepto: "Administración", valores: ["Panel", "Centralizada", "Centralizada", "Centralizada"] },
    { concepto: "Configuración independiente por grupo", valores: [false, true, true, true] },
    { concepto: "Plantillas de mensajes", valores: ["2 por categoría", "2 por categoría", "2 por categoría", "2 por categoría"] },
    { concepto: "Acompañamiento personalizado de configuración", valores: [false, false, false, true] }
];

// --------------------------------------------------------------------------
// Preguntas frecuentes (acordeones), en dos bloques.
// --------------------------------------------------------------------------

const PREGUNTAS_GENERALES = [
    {
        p: "¿Qué es EFAAT?",
        r: "EFAAT es una plataforma para organizadores de sorteos por WhatsApp. Atiende las reservas de números que llegan a tus grupos, responde a cada participante y te deja administrar sorteos, tablas, reservas y pagos desde un solo panel."
    },
    {
        p: "¿Cómo funciona la plataforma?",
        r: "Vinculas un número de WhatsApp con código QR y eliges los grupos donde trabaja EFAAT. Cuando publicas un sorteo, los participantes piden sus números en el grupo; EFAAT los aparta si están libres, les responde y los anota en la tabla. Tú confirmas los pagos y sigues todo desde el panel."
    },
    {
        p: "¿Cuántos grupos incluye cada plan?",
        r: "Esencial incluye 1 grupo de WhatsApp; Profesional, hasta 2; Avanzado, hasta 5; y Empresarial, hasta 10. Si necesitas más de 10 grupos, escríbenos y lo revisamos contigo."
    },
    {
        p: "¿Qué diferencia hay entre sorteos instantáneos y programados?",
        r: "Un sorteo instantáneo se publica en tus grupos en el momento. Uno programado se deja listo con fecha y hora: EFAAT publica la tabla, envía los recordatorios y avisa el cierre en los grupos elegidos. El plan Esencial incluye solo sorteos instantáneos; desde Profesional se incluyen ambos."
    },
    {
        p: "¿Cómo se contrata EFAAT?",
        r: `Por ahora la contratación se hace directamente con nuestro equipo: elige tu plan y escríbenos a ${CORREO_COMERCIAL}. Te indicamos cómo realizar el pago y coordinamos contigo el inicio. No hay cobros automáticos.`
    },
    {
        p: "¿Cómo solicito una prueba gratuita?",
        r: `Escríbenos a ${CORREO_COMERCIAL} o usa el botón «Solicitar prueba». La solicitud no activa nada de inmediato: queda pendiente hasta que la revisemos y coordinemos contigo el inicio. La prueba dura ${DIAS_PRUEBA_GRATUITA} días (${HORAS_PRUEBA_GRATUITA} horas) desde la fecha acordada y durante ese tiempo no se cobra nada.`
    },
    {
        p: "¿Puedo cambiar de plan?",
        r: `Sí. Escríbenos a ${CORREO_COMERCIAL} y ajustamos tu plan. Por ahora los cambios de plan se gestionan directamente con nuestro equipo.`
    },
    {
        p: "¿Qué ocurre cuando termina la prueba?",
        r: "No hacemos ningún cobro automático. Si quieres continuar, eliges un plan y lo contratas escribiéndonos; te indicamos cómo realizar el pago. Si decides no continuar, EFAAT deja de atender tus grupos."
    }
];

const PREGUNTAS_CONEXION = [
    {
        p: "¿Necesito conectar mi WhatsApp?",
        r: "Sí. Para que EFAAT responda en tus grupos, debes vincular un número de WhatsApp mediante un código QR. Recomendamos utilizar un número dedicado al sistema y mantenerlo como administrador de los grupos donde funcionará EFAAT. La conexión se coordina al iniciar tu servicio."
    },
    {
        p: "¿Por qué mi número debe ser administrador?",
        r: "Porque algunas funciones administrativas de EFAAT necesitan permisos de administrador en el grupo. Por ejemplo, retirar participantes bloqueados y ejecutar las acciones de apertura o cierre que correspondan. Comprueba también que las opciones necesarias estén habilitadas en cada grupo."
    },
    {
        p: "¿Puedo conectar más de un número?",
        r: "El panel permite administrar sesiones según las capacidades y autorizaciones de tu cuenta. Consulta la disponibilidad de conexiones adicionales antes de configurar un número de respaldo."
    },
    {
        p: "¿Qué pasa si WhatsApp desconecta mi número?",
        r: "Puedes revisar el estado de la sesión desde el panel y, si es necesario, volver a vincular WhatsApp escaneando un nuevo código QR. La continuidad del servicio depende del estado de la sesión y de las capacidades de recuperación disponibles."
    },
    {
        p: "¿Puedo eliminar una conexión desde el panel?",
        r: "Puedes administrar las sesiones disponibles desde el panel. Antes de eliminar una conexión, comprueba que no sea la sesión que actualmente atiende tus grupos."
    },
    {
        p: "¿Cómo se gestionan mis datos y mi conexión de WhatsApp?",
        r: `La conexión se hace con un código QR y puedes cerrarla cuando quieras desde tu teléfono, en WhatsApp › Dispositivos vinculados. Si tienes preguntas sobre el tratamiento de tus datos, escríbenos a ${CORREO_COMERCIAL}.`
    }
];

function Marca({ clase }: { clase?: string }) {
    return (
        <span className={`${styles.marcaImagenes} ${clase ?? ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.marcaLogo} src="/sidebar/sorteo-icono.png" alt="" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.marcaTexto} src="/sidebar/logo-efaat360.png" alt="" aria-hidden="true" />
        </span>
    );
}

function Encabezado() {
    return (
        <header className={styles.encabezado}>
            <div className={`${styles.contenedor} ${styles.encabezadoFila}`}>
                <a href="#inicio" className={styles.marca} aria-label="EFAAT, inicio">
                    <Marca />
                </a>
                <nav aria-label="Secciones" className={styles.nav}>
                    <a href="#funciones">Funciones</a>
                    <a href="#demo">Demostración</a>
                    <a href="#planes">Planes</a>
                    <a href="#preguntas">Preguntas</a>
                </nav>
                <div className={styles.encabezadoAcciones}>
                    <Link href="/login" className={styles.enlaceSesion}>Iniciar sesión</Link>
                    <a href="#solicitar-prueba" className={`${styles.boton} ${styles.botonPrimario} ${styles.botonChico}`}>
                        Solicitar prueba
                    </a>
                </div>
            </div>
        </header>
    );
}

function IlustracionPanel() {
    // Ilustración construida con las mismas piezas que muestra el panel
    // (tabla de números + respuesta en el grupo). No es una captura real.
    const ocupados = new Set([3, 7, 12, 18, 21, 27, 33, 38, 41, 45]);
    const pagados = new Set([5, 14, 30, 36, 47]);
    const propios = new Set([23, 9]);
    const clase = (n: number) =>
        propios.has(n) ? styles.ilusMio : pagados.has(n) ? styles.ilusPagado : ocupados.has(n) ? styles.ilusOcupado : styles.ilusLibre;

    return (
        <figure className={styles.ilustracion}>
            <div className={styles.ilusVentana} aria-hidden="true">
                <div className={styles.ilusBarra}>
                    <span /><span /><span />
                    <strong>Panel EFAAT · Tablas</strong>
                </div>
                <div className={styles.ilusCuerpo}>
                    <div className={styles.ilusLateral}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/sidebar/sorteo-icono.png" alt="" />
                        <i /><i className={styles.ilusLateralActivo} /><i /><i /><i />
                    </div>
                    <div className={styles.ilusContenido}>
                        <div className={styles.ilusCabecera}>
                            <div>
                                <small>Sorteo activo</small>
                                <strong>Tabla de $10.000</strong>
                            </div>
                            <span className={styles.ilusEstado}>En curso</span>
                        </div>
                        <div className={styles.ilusResumen}>
                            <span><b>33</b> libres</span>
                            <span><b>12</b> reservados</span>
                            <span><b>5</b> pagados</span>
                        </div>
                        <div className={styles.ilusTabla}>
                            {Array.from({ length: 50 }, (_, n) => (
                                <span key={n} className={clase(n)}>{n.toString().padStart(2, "0")}</span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className={styles.ilusChat} aria-hidden="true">
                <p className={styles.ilusChatTitulo}><MessageCircle size={14} /> Grupo de sorteos</p>
                <p className={styles.ilusBurbujaCliente}>Me anotas el 09 y el 23 <span>✅</span></p>
                <p className={styles.ilusBurbujaBot}>¡Listo Camila! 09 y 23 quedaron reservados 🎟️</p>
            </div>
            <figcaption className={styles.ilusPie}>Ilustración del panel con datos ficticios.</figcaption>
        </figure>
    );
}

function CeldaComparativa({ valor }: { valor: Celda }) {
    if (valor === true) return <span className={styles.celdaSi}><Check size={18} aria-hidden="true" /><span className={styles.soloLector}>Incluido</span></span>;
    if (valor === false) return <span className={styles.celdaNo}><Minus size={18} aria-hidden="true" /><span className={styles.soloLector}>No incluido</span></span>;
    return <span className={styles.celdaTexto}>{valor}</span>;
}

function Acordeon({ preguntas }: { preguntas: { p: string; r: string }[] }) {
    return (
        <div className={styles.preguntas}>
            {preguntas.map((x) => (
                <details key={x.p} className={styles.pregunta}>
                    <summary>{x.p}</summary>
                    <p>{x.r}</p>
                </details>
            ))}
        </div>
    );
}

export default function Landing() {
    return (
        <div className={styles.pagina}>
            <a href="#contenido" className={styles.saltar}>Ir al contenido</a>
            <Encabezado />

            <main id="contenido">

                {/* 1. PORTADA */}
                <section id="inicio" className={styles.hero}>
                    <div className={`${styles.contenedor} ${styles.heroFila}`}>
                        <div className={styles.heroTexto}>
                            <p className={styles.etiqueta}>Para organizadores de sorteos por WhatsApp</p>
                            <h1 className={styles.heroTitulo}>
                                Tus sorteos de WhatsApp, <span>organizados y automáticos</span>
                            </h1>
                            <p className={styles.heroSub}>
                                EFAAT atiende las reservas de números en tus grupos, responde a cada participante y
                                lleva la tabla al día. Tú publicas, confirmas pagos y sigues cada sorteo desde un solo panel.
                            </p>
                            <div className={styles.acciones}>
                                <a href="#solicitar-prueba" className={`${styles.boton} ${styles.botonPrimario}`}>
                                    Solicitar prueba gratis de {DIAS_PRUEBA_GRATUITA} días <ArrowRight size={18} aria-hidden="true" />
                                </a>
                                <a href="#planes" className={`${styles.boton} ${styles.botonContorno}`}>Ver planes</a>
                            </div>
                            <ul className={styles.heroPuntos}>
                                <li><Check size={16} aria-hidden="true" /> Reservas atendidas en el grupo</li>
                                <li><Check size={16} aria-hidden="true" /> Sorteos instantáneos y programados</li>
                                <li><Check size={16} aria-hidden="true" /> Sin cobros automáticos</li>
                            </ul>
                            <p className={styles.nota}>La prueba no se activa al instante: coordinamos el inicio contigo.</p>
                        </div>
                        <IlustracionPanel />
                    </div>
                </section>

                {/* 2. PROBLEMA Y SOLUCIÓN */}
                <section className={styles.seccion} aria-labelledby="problema-titulo">
                    <div className={styles.contenedor}>
                        <div className={styles.cabeceraSeccion}>
                            <p className={styles.antetitulo}>El día a día del organizador</p>
                            <h2 id="problema-titulo" className={styles.tituloSeccion}>Menos tiempo pegado al chat</h2>
                            <p className={styles.introSeccion}>
                                Gestionar un sorteo por WhatsApp es responder lo mismo muchas veces. EFAAT se encarga de las
                                tareas repetitivas para que te concentres en tu comunidad.
                            </p>
                        </div>
                        <ul className={styles.comparacion}>
                            {PROBLEMAS.map((x) => (
                                <li key={x.antes} className={styles.comparacionFila}>
                                    <p className={styles.antes}><span>Sin EFAAT</span>{x.antes}</p>
                                    <p className={styles.despues}><span>Con EFAAT</span>{x.despues}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                {/* 3. FUNCIONES */}
                <section id="funciones" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="funciones-titulo">
                    <div className={styles.contenedor}>
                        <div className={styles.cabeceraSeccion}>
                            <p className={styles.antetitulo}>Funciones</p>
                            <h2 id="funciones-titulo" className={styles.tituloSeccion}>Todo tu sorteo, de la publicación al pago</h2>
                            <p className={styles.introSeccion}>Funciones disponibles hoy en la atención automática y en el panel.</p>
                        </div>
                        <ul className={styles.funciones}>
                            {FUNCIONES.map(({ icono: Icono, titulo, texto }) => (
                                <li key={titulo} className={styles.funcion}>
                                    <span className={styles.funcionIcono} aria-hidden="true"><Icono size={22} /></span>
                                    <h3>{titulo}</h3>
                                    <p>{texto}</p>
                                </li>
                            ))}
                        </ul>

                        <h3 className={styles.subtitulo}>Y además</h3>
                        <ul className={styles.extras}>
                            {FUNCIONES_EXTRA.map(({ icono: Icono, titulo, texto }) => (
                                <li key={titulo} className={styles.extra}>
                                    <span className={styles.extraIcono} aria-hidden="true"><Icono size={18} /></span>
                                    <div>
                                        <h4>{titulo}</h4>
                                        <p>{texto}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <div className={styles.desarrollo}>
                            <h3><Wrench size={18} aria-hidden="true" /> En desarrollo</h3>
                            <ul>
                                {EN_DESARROLLO.map((x) => (
                                    <li key={x.titulo}><strong>{x.titulo}.</strong> {x.texto}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </section>

                {/* 4. DEMOSTRACIÓN */}
                <section id="demo" className={styles.seccion} aria-labelledby="demo-titulo">
                    <div className={styles.contenedor}>
                        <div className={styles.cabeceraSeccion}>
                            <p className={styles.antetitulo}>Demostración</p>
                            <h2 id="demo-titulo" className={styles.tituloSeccion}>Pruébalo ahora: un sorteo de ejemplo</h2>
                            <p className={styles.introSeccion}>
                                Escribe en el grupo como lo haría un participante y mira cómo cambia la tabla. También puedes
                                tocar un número libre de la tabla para pedirlo.
                            </p>
                        </div>
                        <DemoSorteo />
                    </div>
                </section>

                {/* 5. PLANES Y PRECIOS */}
                <section id="planes" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="planes-titulo">
                    <div className={styles.contenedor}>
                        <div className={`${styles.cabeceraSeccion} ${styles.cabeceraCentro}`}>
                            <p className={styles.antetitulo}>Planes y precios</p>
                            <h2 id="planes-titulo" className={styles.tituloSeccion}>Elige el plan según tus grupos</h2>
                            <p className={styles.introSeccion}>
                                Valores mensuales en pesos colombianos (COP). Empieza con una prueba gratuita de{" "}
                                {DIAS_PRUEBA_GRATUITA} días y cambia de plan cuando lo necesites.
                            </p>
                        </div>
                        <ul className={styles.planes}>
                            {PLANES.map((plan) => {
                                const detalle = PLAN_DETALLE[plan.id];
                                return (
                                    <li key={plan.id} className={`${styles.plan} ${plan.recomendado ? styles.planRecomendado : ""}`} data-plan={plan.id}>
                                        {plan.recomendado && <span className={styles.planInsignia}>Recomendado</span>}
                                        <h3 className={styles.planNombre}>{plan.nombre}</h3>
                                        <p className={styles.planDescripcion}>{detalle.descripcion}</p>
                                        <p className={styles.planPrecio}>
                                            <strong>{formatearCOP(plan.precioMensualCOP)}</strong>
                                            <span>COP/mes</span>
                                        </p>
                                        <p className={styles.planGrupos}>
                                            <Users size={18} aria-hidden="true" /> {textoGrupos(plan.maxGrupos)}
                                        </p>
                                        <ul className={styles.planLista}>
                                            {detalle.base && (
                                                <li className={styles.planBase}><Check size={16} aria-hidden="true" /> {detalle.base}</li>
                                            )}
                                            {detalle.incluye.map((x) => (
                                                <li key={x}><Check size={16} aria-hidden="true" /> {x}</li>
                                            ))}
                                        </ul>
                                        <a
                                            href={enlaceSolicitud(plan)}
                                            className={`${styles.boton} ${plan.recomendado ? styles.botonPrimario : styles.botonSecundario} ${styles.botonAncho}`}
                                        >
                                            Elegir {plan.nombre}
                                        </a>
                                    </li>
                                );
                            })}
                        </ul>

                        {/* COMPARACIÓN DE PLANES */}
                        <div className={styles.comparativa}>
                            <h3 className={styles.subtitulo}>Compara los planes</h3>
                            <p className={styles.deslizar} aria-hidden="true">Desliza la tabla para ver todos los planes →</p>
                            <div className={styles.tablaDesplazable} role="region" aria-label="Comparación de planes" tabIndex={0}>
                                <table className={styles.tabla}>
                                    <thead>
                                        <tr>
                                            <th scope="col">Incluye</th>
                                            {PLANES.map((plan) => (
                                                <th key={plan.id} scope="col" className={plan.recomendado ? styles.colRecomendada : undefined}>
                                                    {plan.nombre}
                                                    <small>{formatearCOP(plan.precioMensualCOP)}</small>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {COMPARATIVA.map((fila) => (
                                            <tr key={fila.concepto}>
                                                <th scope="row">{fila.concepto}</th>
                                                {fila.valores.map((v, i) => (
                                                    <td key={PLANES[i].id} className={PLANES[i].recomendado ? styles.colRecomendada : undefined}>
                                                        <CeldaComparativa valor={v} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <p className={styles.notaPlanes}>
                            <Hourglass size={16} aria-hidden="true" /> La contratación se hace por ahora directamente con
                            nuestro equipo en {CORREO_COMERCIAL}. No realizamos cobros automáticos.
                        </p>
                    </div>
                </section>

                {/* 6. CÓMO EMPEZAR + SOLICITUD DE PRUEBA */}
                <section id="solicitar-prueba" className={styles.seccion} aria-labelledby="prueba-titulo">
                    <div className={styles.contenedor}>
                        <div className={styles.cabeceraSeccion}>
                            <p className={styles.antetitulo}>Cómo empezar</p>
                            <h2 id="prueba-titulo" className={styles.tituloSeccion}>Solicita una prueba gratuita de {DIAS_PRUEBA_GRATUITA} días</h2>
                            <p className={styles.introSeccion}>
                                Mientras terminamos el registro en línea, coordinamos cada prueba de forma personal para
                                acompañarte en la conexión de WhatsApp.
                            </p>
                        </div>
                        <ol className={styles.pasos}>
                            {PASOS.map((x, i) => (
                                <li key={x.titulo} className={styles.paso}>
                                    <span className={styles.pasoNumero} aria-hidden="true">{i + 1}</span>
                                    <h3>{x.titulo}</h3>
                                    <p>{x.texto}</p>
                                </li>
                            ))}
                        </ol>
                        <div className={styles.solicitud}>
                            <div>
                                <p className={styles.solicitudTitulo}>Solicita tu prueba por correo</p>
                                <p className={styles.solicitudTexto}>
                                    Se abrirá tu programa de correo con un mensaje listo para completar.
                                    También puedes escribir directamente a <a href={`mailto:${CORREO_COMERCIAL}`}>{CORREO_COMERCIAL}</a>.
                                </p>
                            </div>
                            <a href={enlaceSolicitud()} className={`${styles.boton} ${styles.botonClaro}`} data-cta="solicitar-prueba">
                                <Mail size={18} aria-hidden="true" /> Solicitar prueba gratis
                            </a>
                        </div>
                    </div>
                </section>

                {/* 7. RECOMENDACIONES DE CONEXIÓN + ADMINISTRACIÓN DESDE EL PANEL */}
                <section id="conectar-whatsapp" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="conectar-titulo">
                    <div className={styles.contenedor}>
                        <div className={styles.cabeceraSeccion}>
                            <p className={styles.antetitulo}>Antes de conectar</p>
                            <h2 id="conectar-titulo" className={styles.tituloSeccion}>Recomendaciones para conectar WhatsApp correctamente</h2>
                            <p className={styles.introSeccion}>
                                Antes de vincular tu número, revisa estas indicaciones. Las dos primeras son esenciales para
                                que EFAAT funcione bien en tus grupos.
                            </p>
                        </div>
                        <ul className={`${styles.funciones} ${styles.recomendaciones}`}>
                            {RECOMENDACIONES.map(({ icono: Icono, titulo, texto, esencial }) => (
                                <li
                                    key={titulo}
                                    className={`${styles.funcion} ${esencial ? styles.recomendacionEsencial : ""}`}
                                    data-esencial={esencial ? "si" : undefined}
                                >
                                    <span className={styles.funcionIcono} aria-hidden="true"><Icono size={22} /></span>
                                    {esencial && <span className={styles.insigniaEsencial}>Esencial</span>}
                                    <h3>{titulo}</h3>
                                    <p>{texto}</p>
                                </li>
                            ))}
                        </ul>

                        <div className={styles.conexiones}>
                            <h3><MonitorSmartphone size={18} aria-hidden="true" /> Administra tus conexiones desde el panel</h3>
                            <p>
                                En la sección Sesiones del panel puedes gestionar las sesiones de WhatsApp que tu cuenta
                                permite administrar: agregar y vincular un número adicional con código QR, revisar el estado
                                de cada conexión, desconectarla y eliminar las que ya no necesites.
                            </p>
                            <ul>
                                <li>
                                    <strong>Conexión de respaldo.</strong> Un número adicional puede servirte como alternativa
                                    si la conexión principal se interrumpe. EFAAT atiende tus grupos con una sola sesión a la
                                    vez; la de respaldo queda en espera.
                                </li>
                                <li>
                                    <strong>Principal y respaldo.</strong> Cada sesión muestra su estado: «En servicio» indica la
                                    que atiende tus grupos, «Preferida» la principal y «En espera» las demás. Para pasar a otra
                                    conexión, usa «Usar esta sesión».
                                </li>
                                <li>
                                    <strong>Si se desconecta.</strong> Si WhatsApp cierra una sesión o la cierras por accidente,
                                    revisa su estado en el panel y vuelve a vincularla escaneando un nuevo código QR.
                                </li>
                            </ul>
                            <p className={styles.conexionesNota}>
                                El cambio automático a la conexión de respaldo no forma parte de las funciones garantizadas:
                                comprueba en el panel qué sesión está atendiendo tus grupos.
                            </p>
                        </div>
                    </div>
                </section>

                {/* 8. PREGUNTAS FRECUENTES */}
                <section id="preguntas" className={styles.seccion} aria-labelledby="preguntas-titulo">
                    <div className={`${styles.contenedor} ${styles.contenedorAngosto}`}>
                        <div className={`${styles.cabeceraSeccion} ${styles.cabeceraCentro}`}>
                            <p className={styles.antetitulo}>Preguntas frecuentes</p>
                            <h2 id="preguntas-titulo" className={styles.tituloSeccion}>Resolvemos tus dudas</h2>
                        </div>
                        <h3 className={styles.grupoPreguntas}>EFAAT, planes y contratación</h3>
                        <Acordeon preguntas={PREGUNTAS_GENERALES} />
                        <h3 className={styles.grupoPreguntas}>Conexión de WhatsApp</h3>
                        <Acordeon preguntas={PREGUNTAS_CONEXION} />
                    </div>
                </section>

                {/* 9. CIERRE */}
                <section className={styles.ctaFinal} aria-labelledby="cta-titulo">
                    <div className={`${styles.contenedor} ${styles.contenedorAngosto}`}>
                        <Marca clase={styles.ctaMarca} />
                        <h2 id="cta-titulo">Empieza a automatizar tu próximo sorteo</h2>
                        <p>
                            Solicita tu prueba de {DIAS_PRUEBA_GRATUITA} días o escríbenos para elegir tu plan. Te
                            acompañamos a configurarlo.
                        </p>
                        <div className={`${styles.acciones} ${styles.accionesCentro}`}>
                            <a href={enlaceSolicitud()} className={`${styles.boton} ${styles.botonClaro}`}>
                                Solicitar prueba gratis de {DIAS_PRUEBA_GRATUITA} días
                            </a>
                            <a href={`mailto:${CORREO_COMERCIAL}`} className={`${styles.boton} ${styles.botonContorno}`}>
                                <Mail size={18} aria-hidden="true" /> Escribir al equipo
                            </a>
                        </div>
                        <p className={styles.ctaCuenta}>
                            ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
                        </p>
                    </div>
                </section>
            </main>

            <footer className={styles.pie}>
                <div className={`${styles.contenedor} ${styles.pieFila}`}>
                    <div className={styles.pieMarca}>
                        <Marca />
                        <p>© {new Date().getFullYear()} EFAAT</p>
                    </div>
                    <nav aria-label="Enlaces del pie" className={styles.pieEnlaces}>
                        <a href="#funciones">Funciones</a>
                        <a href="#planes">Planes</a>
                        <a href="#preguntas">Preguntas</a>
                        <Link href="/login">Iniciar sesión</Link>
                        <a href={`mailto:${CORREO_COMERCIAL}`}>Contacto: {CORREO_COMERCIAL}</a>
                    </nav>
                </div>
            </footer>

            <VolverArriba />
        </div>
    );
}
