// ==========================================================================
// Landing comercial pública de EFAAT (ruta "/"). Componente de servidor:
// no lee Supabase, no llama al backend del bot y no usa la sesión del
// usuario. La única parte interactiva es la demostración (DemoSorteo), que
// también es 100% local.
//
// Reglas de contenido (Fase 1):
//   - Solo se anuncian funciones que existen en el código; lo que sigue en
//     desarrollo aparece como tal.
//   - La prueba gratuita y la contratación se piden por correo
//     (CORREO_COMERCIAL): todavía no hay registro comercial ni suscripciones.
//     La solicitud queda pendiente de coordinación; nunca se promete
//     activación inmediata.
//   - Reacciones: ✅ todos reservados, ❌ todos ocupados, ninguna si es
//     parcial (backend/bot/funciones/reservas/reaccionReserva.js).
//   - Consultas: solo los números propios de cada participante.
//   - El sticker de pago es una función en verificación y no consulta
//     bancos. No se anuncian la lectura de pagos en Android ni el control
//     de inactividad.
//   - No hay términos ni política de privacidad publicados: no se enlazan.
//   - Conexiones (auditado en backend/services/baileys/manager.js): el bot
//     atiende con UNA sesión activa a la vez y el failover automático elige
//     entre todas las sesiones conectadas del proceso, sin filtrar por
//     cliente. Por eso no se anuncian varias conexiones operativas a la vez
//     ni el cambio automático a la de respaldo: el respaldo queda «En
//     espera» y se activa desde el panel («Usar esta sesión»).
// ==========================================================================

import Link from "next/link";
import {
    ArrowRight,
    Ban,
    CalendarClock,
    Check,
    FileText,
    Hourglass,
    LayoutGrid,
    ListChecks,
    Mail,
    MessageCircle,
    MonitorSmartphone,
    Printer,
    QrCode,
    Search,
    ShieldCheck,
    Smartphone,
    SmilePlus,
    Wifi,
    Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
    CORREO_COMERCIAL,
    DIAS_PRUEBA_GRATUITA,
    PLANES,
    enlaceSolicitud,
    formatearCOP,
    textoGrupos
} from "@/lib/comercial/planes";
import DemoSorteo from "./demo/DemoSorteo";
import styles from "./landing.module.css";

interface Funcion {
    icono: LucideIcon;
    titulo: string;
    texto: string;
}

const FUNCIONES: Funcion[] = [
    {
        icono: MessageCircle,
        titulo: "Reservas desde el grupo",
        texto: "Los participantes escriben en el grupo los números que quieren y EFAAT los aparta si están libres, avisando cuáles ya estaban ocupados."
    },
    {
        icono: SmilePlus,
        titulo: "Respuestas y reacciones automáticas",
        texto: "Cada pedido recibe su respuesta en el grupo. Además, EFAAT reacciona con ✅ cuando se reservan todos los números pedidos y con ❌ cuando todos estaban ocupados; si la reserva es parcial, no reacciona."
    },
    {
        icono: Search,
        titulo: "Consulta de números propios",
        texto: "Cada participante puede preguntar en el grupo qué números tiene reservados y EFAAT le responde solo con los suyos."
    },
    {
        icono: FileText,
        titulo: "Plantillas de respuesta",
        texto: "Elige el tono de cada respuesta entre varios estilos o escribe las tuyas, con variables como el nombre del participante y sus números."
    },
    {
        icono: CalendarClock,
        titulo: "Sorteos programados",
        texto: "Programa un sorteo desde el panel: publicación de la tabla, recordatorios y aviso de cierre en los grupos que elijas."
    },
    {
        icono: LayoutGrid,
        titulo: "Tabla de números en vivo",
        texto: "Ve en el panel qué números están libres, reservados o pagados, y marca pagos o libera números manualmente."
    },
    {
        icono: Printer,
        titulo: "Tablas para compartir e imprimir",
        texto: "Genera la imagen de la tabla con tu diseño para compartirla en el grupo o imprimirla."
    },
    {
        icono: Ban,
        titulo: "Bloqueos de participantes",
        texto: "Lleva desde el panel tu lista de participantes bloqueados: si uno vuelve a entrar a tus grupos, EFAAT lo retira automáticamente."
    },
    {
        icono: QrCode,
        titulo: "Conexión de WhatsApp con código QR",
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

const PREGUNTAS = [
    {
        p: "¿Cómo funciona la prueba gratuita?",
        r: `Por ahora se solicita escribiendo a ${CORREO_COMERCIAL}. La solicitud no activa nada de inmediato: queda pendiente hasta que la revisemos y coordinemos contigo el inicio. La prueba dura ${DIAS_PRUEBA_GRATUITA} días desde la fecha acordada y durante ese tiempo no se cobra nada.`
    },
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
        p: "¿Qué ocurre cuando termina la prueba?",
        r: "No hacemos ningún cobro automático. Si quieres continuar, eliges un plan y lo contratas escribiéndonos; te indicamos cómo realizar el pago. Si decides no continuar, EFAAT deja de atender tus grupos."
    },
    {
        p: "¿Puedo cambiar de plan?",
        r: `Sí. Escríbenos a ${CORREO_COMERCIAL} y ajustamos tu plan. Por ahora los cambios de plan se gestionan directamente con nuestro equipo.`
    },
    {
        p: "¿Qué sucede si administro varios grupos?",
        r: "Cada plan define cuántos grupos de WhatsApp puede atender EFAAT: 1, 2, 5 o 10. Todos los planes incluyen las mismas funciones; la diferencia es la cantidad de grupos. Si necesitas más de 10, escríbenos."
    },
    {
        p: "¿Cómo se gestionan mis datos y mi conexión de WhatsApp?",
        r: `La conexión se hace con un código QR y puedes cerrarla cuando quieras desde tu teléfono, en WhatsApp › Dispositivos vinculados. Si tienes preguntas sobre el tratamiento de tus datos, escríbenos a ${CORREO_COMERCIAL}.`
    }
];

function Encabezado() {
    return (
        <header className={styles.encabezado}>
            <div className={`${styles.contenedor} ${styles.encabezadoFila}`}>
                <a href="#inicio" className={styles.marca} aria-label="EFAAT, inicio">
                    <span className={styles.marcaLogo} aria-hidden="true">E</span>
                    EFAAT
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
    const propios = new Set([23, 9]);
    return (
        <figure className={styles.ilustracion}>
            <div className={styles.ilusVentana} aria-hidden="true">
                <div className={styles.ilusBarra}>
                    <span /><span /><span />
                    <strong>Tabla del sorteo</strong>
                </div>
                <div className={styles.ilusTabla}>
                    {Array.from({ length: 50 }, (_, n) => (
                        <span
                            key={n}
                            className={propios.has(n) ? styles.ilusMio : ocupados.has(n) ? styles.ilusOcupado : styles.ilusLibre}
                        >
                            {n.toString().padStart(2, "0")}
                        </span>
                    ))}
                </div>
                <div className={styles.ilusChat}>
                    <p className={styles.ilusBurbujaCliente}>Me anotas el 09 y el 23 <span aria-label="Reacción ✅">✅</span></p>
                    <p className={styles.ilusBurbujaBot}>¡Listo Camila! 09 y 23 quedaron reservados 🎟️</p>
                </div>
            </div>
            <figcaption className={styles.ilusPie}>Ilustración con datos ficticios.</figcaption>
        </figure>
    );
}

export default function Landing() {
    return (
        <div className={styles.pagina}>
            <a href="#contenido" className={styles.saltar}>Ir al contenido</a>
            <Encabezado />

            <main id="contenido">

                {/* 1. HERO */}
                <section id="inicio" className={styles.hero}>
                    <div className={`${styles.contenedor} ${styles.heroFila}`}>
                        <div className={styles.heroTexto}>
                            <p className={styles.etiqueta}>Para organizadores de sorteos por WhatsApp</p>
                            <h1 className={styles.heroTitulo}>Automatiza tus sorteos de WhatsApp con EFAAT</h1>
                            <p className={styles.heroSub}>
                                EFAAT toma las reservas de números que llegan a tu grupo, responde a cada participante y le
                                dice cuáles son sus números, y te deja programar y seguir cada sorteo desde un solo panel.
                            </p>
                            <div className={styles.acciones}>
                                <a href="#solicitar-prueba" className={`${styles.boton} ${styles.botonPrimario}`}>
                                    Solicitar prueba gratis de {DIAS_PRUEBA_GRATUITA} días <ArrowRight size={18} aria-hidden="true" />
                                </a>
                                <a href="#demo" className={`${styles.boton} ${styles.botonSecundario}`}>Ver demostración</a>
                            </div>
                            <p className={styles.nota}>Sin cobros automáticos. La prueba no se activa al instante: coordinamos el inicio contigo.</p>
                        </div>
                        <IlustracionPanel />
                    </div>
                </section>

                {/* 2. PROBLEMA Y SOLUCIÓN */}
                <section className={styles.seccion} aria-labelledby="problema-titulo">
                    <div className={styles.contenedor}>
                        <h2 id="problema-titulo" className={styles.tituloSeccion}>Menos tiempo pegado al chat</h2>
                        <p className={styles.introSeccion}>
                            Gestionar un sorteo por WhatsApp es responder lo mismo muchas veces. EFAAT se encarga de las
                            tareas repetitivas para que te concentres en tu comunidad.
                        </p>
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

                {/* 3. FUNCIONALIDADES */}
                <section id="funciones" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="funciones-titulo">
                    <div className={styles.contenedor}>
                        <h2 id="funciones-titulo" className={styles.tituloSeccion}>Lo que EFAAT hace por ti</h2>
                        <p className={styles.introSeccion}>Funciones disponibles hoy en la atención automática y en el panel.</p>
                        <ul className={styles.funciones}>
                            {FUNCIONES.map(({ icono: Icono, titulo, texto }) => (
                                <li key={titulo} className={styles.funcion}>
                                    <span className={styles.funcionIcono} aria-hidden="true"><Icono size={20} /></span>
                                    <h3>{titulo}</h3>
                                    <p>{texto}</p>
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
                        <h2 id="demo-titulo" className={styles.tituloSeccion}>Pruébalo ahora: un sorteo de ejemplo</h2>
                        <p className={styles.introSeccion}>
                            Escribe en el grupo como lo haría un participante y mira cómo cambia la tabla. También puedes
                            tocar un número libre de la tabla para pedirlo.
                        </p>
                        <DemoSorteo />
                    </div>
                </section>

                {/* PASOS + SOLICITUD DE PRUEBA */}
                <section id="solicitar-prueba" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="prueba-titulo">
                    <div className={styles.contenedor}>
                        <h2 id="prueba-titulo" className={styles.tituloSeccion}>Solicita una prueba gratuita de {DIAS_PRUEBA_GRATUITA} días</h2>
                        <p className={styles.introSeccion}>
                            Mientras terminamos el registro en línea, coordinamos cada prueba de forma personal para
                            acompañarte en la conexión de WhatsApp.
                        </p>
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
                            <a href={enlaceSolicitud()} className={`${styles.boton} ${styles.botonPrimario}`} data-cta="solicitar-prueba">
                                <Mail size={18} aria-hidden="true" /> Solicitar prueba gratis
                            </a>
                        </div>
                    </div>
                </section>

                {/* RECOMENDACIONES DE CONEXIÓN + ADMINISTRACIÓN DESDE EL PANEL */}
                <section id="conectar-whatsapp" className={styles.seccion} aria-labelledby="conectar-titulo">
                    <div className={styles.contenedor}>
                        <h2 id="conectar-titulo" className={styles.tituloSeccion}>Recomendaciones para conectar WhatsApp correctamente</h2>
                        <p className={styles.introSeccion}>
                            Antes de vincular tu número, revisa estas indicaciones. Las dos primeras son esenciales para
                            que EFAAT funcione bien en tus grupos.
                        </p>
                        <ul className={`${styles.funciones} ${styles.recomendaciones}`}>
                            {RECOMENDACIONES.map(({ icono: Icono, titulo, texto, esencial }) => (
                                <li
                                    key={titulo}
                                    className={`${styles.funcion} ${esencial ? styles.recomendacionEsencial : ""}`}
                                    data-esencial={esencial ? "si" : undefined}
                                >
                                    <span className={styles.funcionIcono} aria-hidden="true"><Icono size={20} /></span>
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

                {/* 5. PLANES */}
                <section id="planes" className={styles.seccion} aria-labelledby="planes-titulo">
                    <div className={styles.contenedor}>
                        <h2 id="planes-titulo" className={styles.tituloSeccion}>Planes y precios</h2>
                        <p className={styles.introSeccion}>
                            Todos los planes incluyen las mismas funciones; cambia la cantidad de grupos de WhatsApp que
                            EFAAT atiende. Valores mensuales en pesos colombianos (COP).
                        </p>
                        <ul className={styles.planes}>
                            {PLANES.map((plan) => (
                                <li key={plan.id} className={`${styles.plan} ${plan.recomendado ? styles.planRecomendado : ""}`} data-plan={plan.id}>
                                    {plan.recomendado && <span className={styles.planInsignia}>Recomendado</span>}
                                    <h3 className={styles.planNombre}>{plan.nombre}</h3>
                                    <p className={styles.planPrecio}>
                                        <strong>{formatearCOP(plan.precioMensualCOP)}</strong>
                                        <span> COP/mes</span>
                                    </p>
                                    <p className={styles.planGrupos}>{textoGrupos(plan.maxGrupos)}</p>
                                    <ul className={styles.planLista}>
                                        <li><Check size={16} aria-hidden="true" /> Todas las funciones disponibles</li>
                                        <li><Check size={16} aria-hidden="true" /> Panel del organizador</li>
                                        <li><Check size={16} aria-hidden="true" /> Acompañamiento en la conexión</li>
                                    </ul>
                                    <a
                                        href={enlaceSolicitud(plan)}
                                        className={`${styles.boton} ${plan.recomendado ? styles.botonPrimario : styles.botonSecundario} ${styles.botonAncho}`}
                                    >
                                        Elegir {plan.nombre}
                                    </a>
                                </li>
                            ))}
                        </ul>
                        <p className={styles.notaPlanes}>
                            <Hourglass size={16} aria-hidden="true" /> La contratación se hace por ahora directamente con
                            nuestro equipo en {CORREO_COMERCIAL}. No realizamos cobros automáticos.
                        </p>
                    </div>
                </section>

                {/* 6. PREGUNTAS FRECUENTES */}
                <section id="preguntas" className={`${styles.seccion} ${styles.seccionSuave}`} aria-labelledby="preguntas-titulo">
                    <div className={`${styles.contenedor} ${styles.contenedorAngosto}`}>
                        <h2 id="preguntas-titulo" className={styles.tituloSeccion}>Preguntas frecuentes</h2>
                        <div className={styles.preguntas}>
                            {PREGUNTAS.map((x) => (
                                <details key={x.p} className={styles.pregunta}>
                                    <summary>{x.p}</summary>
                                    <p>{x.r}</p>
                                </details>
                            ))}
                        </div>
                    </div>
                </section>

                {/* 7. CTA FINAL */}
                <section className={styles.ctaFinal} aria-labelledby="cta-titulo">
                    <div className={`${styles.contenedor} ${styles.contenedorAngosto}`}>
                        <h2 id="cta-titulo">Empieza a automatizar tu próximo sorteo</h2>
                        <p>Solicita tu prueba de {DIAS_PRUEBA_GRATUITA} días y te ayudamos a configurarla.</p>
                        <div className={`${styles.acciones} ${styles.accionesCentro}`}>
                            <a href={enlaceSolicitud()} className={`${styles.boton} ${styles.botonClaro}`}>
                                Solicitar prueba gratis de {DIAS_PRUEBA_GRATUITA} días
                            </a>
                            <Link href="/login" className={`${styles.boton} ${styles.botonContorno}`}>Ya tengo cuenta</Link>
                        </div>
                    </div>
                </section>
            </main>

            <footer className={styles.pie}>
                <div className={`${styles.contenedor} ${styles.pieFila}`}>
                    <p>© {new Date().getFullYear()} EFAAT</p>
                    <nav aria-label="Enlaces del pie" className={styles.pieEnlaces}>
                        <Link href="/login">Iniciar sesión</Link>
                        <a href={`mailto:${CORREO_COMERCIAL}`}>Contacto: {CORREO_COMERCIAL}</a>
                    </nav>
                </div>
            </footer>
        </div>
    );
}
