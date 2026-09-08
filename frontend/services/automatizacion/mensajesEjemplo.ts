import { supabase } from "@/lib/supabase";
import { DatosMensaje } from "./mensajesAutomation";

// "Cargar 100 ejemplos" — pool REAL de mensajes para poder probar el
// selector (tipo + categoría + activos + aleatoriedad + anti-repetición)
// desde ya, sin escribir uno por uno. Se insertan en automation_messages
// como PROPIOS del usuario autenticado (usuario_id = auth.uid(), nunca un
// UUID fijo ni global) — respeta la RLS de 007 igual que crearMensaje().
//
// Todo mensaje sembrado aquí lleva nombre_interno con el prefijo
// "Ejemplo:" — es la marca que usa cargarMensajesEjemplo() para saber
// cuáles ya existen y no duplicarlos en un segundo clic.
const PREFIJO_EJEMPLO = "Ejemplo:";

// 10 categorías x 10 mensajes cada una = 100. Cada mensaje tiene redacción,
// estructura y enfoque propios (no son variaciones de una misma frase) y
// pertenece a uno de los 4 tipos de acción (OPEN/REMINDER/UPDATE/CLOSE),
// distribuidos de forma equilibrada dentro de cada categoría — 25 mensajes
// por tipo en total sobre los 100.
const CATEGORIAS_MENSAJES: { categoria: string; mensajes: { tipo: string; texto: string }[] }[] = [

    {
        categoria: "eleccion",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🎯 Ya está sobre la mesa {nombre_evento}. ¿Quién se anima primero?" },
            { tipo: "OPEN_MESSAGE", texto: "✨ Arrancó {nombre_evento}. Elige tu número antes de pensarlo dos veces." },
            { tipo: "OPEN_MESSAGE", texto: "🎲 Se abrió {nombre_evento} — el que decide rápido, juega tranquilo." },
            { tipo: "REMINDER_MESSAGE", texto: "🤔 Si todavía no has elegido tu número en {nombre_evento}, este es el momento." },
            { tipo: "REMINDER_MESSAGE", texto: "📝 Quedan pocos números sin elegir en {nombre_evento}. Piénsalo, pero no lo dejes para después." },
            { tipo: "UPDATE_MESSAGE", texto: "📋 Ya van {reservados} números elegidos en {nombre_evento}. ¿Y el tuyo?" },
            { tipo: "UPDATE_MESSAGE", texto: "🔄 Mientras lo piensas, otros ya están eligiendo el suyo en {nombre_evento}." },
            { tipo: "CLOSE_MESSAGE", texto: "✅ Se cerraron las elecciones de {nombre_evento}. Gracias a todos los que ya decidieron." },
            { tipo: "CLOSE_MESSAGE", texto: "🔒 Última oportunidad de elegir en {nombre_evento} — después de esto, no se puede." },
            { tipo: "CLOSE_MESSAGE", texto: "🏁 Con esto damos por cerrado {nombre_evento}. Los números elegidos ya están en juego." }
        ]
    },

    {
        categoria: "escasez",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🔥 {nombre_evento} ya está activo y los números se están acabando rápido." },
            { tipo: "OPEN_MESSAGE", texto: "📢 Abrimos {nombre_evento} con cupos limitados. El que llega primero, elige mejor." },
            { tipo: "REMINDER_MESSAGE", texto: "👀 Cada vez quedan menos disponibles. Si estabas esperando, este es un buen momento para revisar." },
            { tipo: "REMINDER_MESSAGE", texto: "⚠️ Ojo, en {nombre_evento} ya casi no quedan números libres." },
            { tipo: "REMINDER_MESSAGE", texto: "📉 La disponibilidad de {nombre_evento} está bajando más rápido de lo normal." },
            { tipo: "UPDATE_MESSAGE", texto: "📊 Quedan solo {disponibles} disponibles en {nombre_evento}. Se están yendo rápido." },
            { tipo: "UPDATE_MESSAGE", texto: "🧮 Ya casi no hay espacio en {nombre_evento} — {disponibles} números libres nada más." },
            { tipo: "UPDATE_MESSAGE", texto: "📌 Los cupos de {nombre_evento} se están agotando mientras hablamos." },
            { tipo: "CLOSE_MESSAGE", texto: "🚫 Se agotaron los números disponibles de {nombre_evento}. ¡Gracias por la participación!" },
            { tipo: "CLOSE_MESSAGE", texto: "🔚 {nombre_evento} llegó a su límite de cupos. Nos vemos en el próximo." }
        ]
    },

    {
        categoria: "humor",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "😄 Arrancó {nombre_evento}. Ya saben, el que no juega no puede quejarse después 😅" },
            { tipo: "OPEN_MESSAGE", texto: "🎉 Se abrió {nombre_evento}. Alisten la suerte, que hoy sí toca (eso dicen todos siempre)." },
            { tipo: "OPEN_MESSAGE", texto: "😁 Nuevo sorteo en la casa: {nombre_evento}. A ver si hoy es tu día de suerte." },
            { tipo: "REMINDER_MESSAGE", texto: "😅 Uno dice \"ahorita miro\" y cuando vuelve ya no queda lo que quería." },
            { tipo: "REMINDER_MESSAGE", texto: "🙃 Si sigues pensándolo tanto, el número se va a cansar de esperarte." },
            { tipo: "UPDATE_MESSAGE", texto: "😂 {nombre_evento} sigue vivo y coleando, con {reservados} valientes ya adentro." },
            { tipo: "UPDATE_MESSAGE", texto: "🤭 Esto va tomando forma — cada rato aparece alguien nuevo en {nombre_evento}." },
            { tipo: "CLOSE_MESSAGE", texto: "😂 Se cerró {nombre_evento}... el que no jugó, que no ande llorando después 😅" },
            { tipo: "CLOSE_MESSAGE", texto: "🙌 Y así llegamos al final de {nombre_evento}. El que ganó, ya sabe invitar algo 😏" },
            { tipo: "CLOSE_MESSAGE", texto: "😄 Cerramos {nombre_evento} por hoy. Mañana hay más oportunidad de creer en la suerte." }
        ]
    },

    {
        categoria: "competencia",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🔥 Arrancamos {nombre_evento}. Vamos a ver quién se adelanta hoy." },
            { tipo: "OPEN_MESSAGE", texto: "🏁 Empieza {nombre_evento} — el que reserva primero, juega con ventaja." },
            { tipo: "REMINDER_MESSAGE", texto: "💪 Ya varios se adelantaron en {nombre_evento}. ¿Te vas a quedar viendo?" },
            { tipo: "REMINDER_MESSAGE", texto: "🏆 La competencia por los mejores números de {nombre_evento} ya empezó." },
            { tipo: "REMINDER_MESSAGE", texto: "⚔️ Todavía estás a tiempo de meterte en la pelea por {nombre_evento}." },
            { tipo: "UPDATE_MESSAGE", texto: "🔥 Esto se está poniendo bueno. Cada nueva reserva cambia el panorama en {nombre_evento}." },
            { tipo: "UPDATE_MESSAGE", texto: "🏁 La competencia está dura en {nombre_evento} — {reservados} personas ya reservaron." },
            { tipo: "UPDATE_MESSAGE", texto: "📈 El ritmo de {nombre_evento} no baja. Cada vez hay más gente peleando su número." },
            { tipo: "CLOSE_MESSAGE", texto: "🏆 Así cerramos {nombre_evento}. Los que se adelantaron hoy tomaron la delantera." },
            { tipo: "CLOSE_MESSAGE", texto: "🥇 {nombre_evento} queda cerrado. Gracias a todos los que entraron a competir." }
        ]
    },

    {
        categoria: "tiempo",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🕐 Comienza {nombre_evento}, disponible hasta las {hora_cierre}." },
            { tipo: "OPEN_MESSAGE", texto: "📅 Ya está en marcha {nombre_evento}. Tienen hasta las {hora_cierre} para participar." },
            { tipo: "OPEN_MESSAGE", texto: "⏱️ Se abrió {nombre_evento} — el reloj ya empezó a correr." },
            { tipo: "REMINDER_MESSAGE", texto: "⏰ Ya vamos acercándonos al cierre de {nombre_evento}: {hora_cierre}." },
            { tipo: "REMINDER_MESSAGE", texto: "🕓 Recuerda que {nombre_evento} cierra a las {hora_cierre}. No dejes pasar el tiempo." },
            { tipo: "UPDATE_MESSAGE", texto: "⏳ Sigue corriendo el reloj en {nombre_evento} — {reservados} reservas hasta ahora." },
            { tipo: "UPDATE_MESSAGE", texto: "🕒 A medida que se acerca la hora, {nombre_evento} sigue sumando reservas." },
            { tipo: "CLOSE_MESSAGE", texto: "🔔 Llegamos a las {hora_cierre} — {nombre_evento} queda cerrado." },
            { tipo: "CLOSE_MESSAGE", texto: "⌛ El tiempo se cumplió para {nombre_evento}. Gracias a todos por participar." },
            { tipo: "CLOSE_MESSAGE", texto: "🕛 Con la hora {hora_cierre} cumplida, damos por finalizado {nombre_evento}." }
        ]
    },

    {
        categoria: "curiosidad",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🤔 ¿Sabías que hoy {nombre_evento} reparte {premio}? Entra y participa." },
            { tipo: "OPEN_MESSAGE", texto: "👀 Algo nuevo se abrió: {nombre_evento}. Vale la pena echar un vistazo." },
            { tipo: "REMINDER_MESSAGE", texto: "👀 ¿Ya viste cómo se está moviendo {nombre_evento}? Está tomando ritmo." },
            { tipo: "REMINDER_MESSAGE", texto: "🧐 No sabes lo que te espera si entras a ver {nombre_evento} ahora mismo." },
            { tipo: "REMINDER_MESSAGE", texto: "🔎 Hay algo interesante pasando en {nombre_evento} — entra y compruébalo." },
            { tipo: "UPDATE_MESSAGE", texto: "👀 Dato curioso: ya llevamos {reservados} reservados en {nombre_evento}. ¿Tú ya elegiste el tuyo?" },
            { tipo: "UPDATE_MESSAGE", texto: "🧩 {nombre_evento} se está armando distinto hoy — vale la pena mirar cómo va." },
            { tipo: "UPDATE_MESSAGE", texto: "🔍 Cada vez que revisas {nombre_evento} hay algo nuevo que ver." },
            { tipo: "CLOSE_MESSAGE", texto: "🎁 Ya se sabrá pronto quién se lleva {premio} en {nombre_evento}. ¡Estén atentos!" },
            { tipo: "CLOSE_MESSAGE", texto: "🔒 Se cerró {nombre_evento}. Ahora solo queda esperar a ver qué pasa." }
        ]
    },

    {
        categoria: "accion",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🎯 Ya está activo {nombre_evento}.\nValor: {valor}\n¡Vamos a jugar!" },
            { tipo: "OPEN_MESSAGE", texto: "🚀 {nombre_evento} está abierto. Entra, revisa y aparta tu número." },
            { tipo: "OPEN_MESSAGE", texto: "📲 Empezó {nombre_evento} — escribe y reserva tu número ya mismo." },
            { tipo: "REMINDER_MESSAGE", texto: "📢 Recordatorio: {nombre_evento} sigue activo. Valor por número: {valor}." },
            { tipo: "REMINDER_MESSAGE", texto: "✋ No dejes pasar {nombre_evento}. Entra y aparta tu número ahora." },
            { tipo: "UPDATE_MESSAGE", texto: "📊 Así va {nombre_evento}:\nYa tenemos {reservados} reservados." },
            { tipo: "UPDATE_MESSAGE", texto: "🔄 {nombre_evento} sigue en movimiento. Aprovecha y reserva antes de que se llene." },
            { tipo: "CLOSE_MESSAGE", texto: "🔒 {nombre_evento} queda cerrado. ¡Gracias a todos por participar!" },
            { tipo: "CLOSE_MESSAGE", texto: "✅ Cerramos {nombre_evento}. Quien reservó, ya está dentro del sorteo." },
            { tipo: "CLOSE_MESSAGE", texto: "🏁 Fin de la jugada para {nombre_evento}. Nos vemos en el próximo." }
        ]
    },

    {
        categoria: "urgencia",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "🔥 {nombre_evento} ya está abierto, pero no va a durar todo el día." },
            { tipo: "OPEN_MESSAGE", texto: "⚡ Arrancó {nombre_evento} — los cupos se agotan más rápido de lo que crees." },
            { tipo: "REMINDER_MESSAGE", texto: "🚨 ¡Se nos acaba el tiempo!\n{nombre_evento} cierra a las {hora_cierre}." },
            { tipo: "REMINDER_MESSAGE", texto: "⚠️ Últimos minutos para entrar a {nombre_evento}. No lo dejes para después." },
            { tipo: "REMINDER_MESSAGE", texto: "🔥 El cierre de {nombre_evento} está cada vez más cerca. Aprovecha ahora." },
            { tipo: "UPDATE_MESSAGE", texto: "⏱️ El tiempo corre y {nombre_evento} sigue sumando gente. No te quedes por fuera." },
            { tipo: "UPDATE_MESSAGE", texto: "📉 Quedan pocos minutos y pocos números en {nombre_evento}. Decide ya." },
            { tipo: "UPDATE_MESSAGE", texto: "🚨 {nombre_evento} está a punto de llenarse. Última oportunidad de entrar." },
            { tipo: "CLOSE_MESSAGE", texto: "🚨 Último llamado para {nombre_evento}. ¡Cerramos YA!" },
            { tipo: "CLOSE_MESSAGE", texto: "🔴 Se acabó el tiempo para {nombre_evento}. Gracias a todos por la espera y la participación." }
        ]
    },

    {
        categoria: "familiar",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "👨‍👩‍👧 Arrancamos {nombre_evento}, familia. Como siempre, con la casa abierta para todos." },
            { tipo: "OPEN_MESSAGE", texto: "❤️ Se abre {nombre_evento}. Gracias por seguir aquí, acompañándonos siempre." },
            { tipo: "OPEN_MESSAGE", texto: "🙌 Empieza {nombre_evento} — bienvenidos todos los de siempre y los nuevos también." },
            { tipo: "REMINDER_MESSAGE", texto: "👨‍👩‍👧 Avísale a la familia: quedan cupos en {nombre_evento}." },
            { tipo: "REMINDER_MESSAGE", texto: "🤗 Si alguien de la familia todavía no ha entrado a {nombre_evento}, cuéntenle." },
            { tipo: "UPDATE_MESSAGE", texto: "❤️ {nombre_evento} sigue creciendo gracias a ustedes, familia." },
            { tipo: "UPDATE_MESSAGE", texto: "🙏 Gracias por seguir confiando en nosotros — {nombre_evento} va muy bien." },
            { tipo: "CLOSE_MESSAGE", texto: "👨‍👩‍👧‍👦 {nombre_evento} ya cerró. Gracias familia por confiar en nosotros." },
            { tipo: "CLOSE_MESSAGE", texto: "❤️ Gracias por acompañarnos. Estamos llegando al cierre de {nombre_evento}." },
            { tipo: "CLOSE_MESSAGE", texto: "🙌 Cerramos {nombre_evento} con mucho cariño. Nos vemos en el próximo, familia." }
        ]
    },

    {
        categoria: "movimiento",
        mensajes: [
            { tipo: "OPEN_MESSAGE", texto: "📈 Se activó {nombre_evento}. Ya empezaron a moverse los primeros números." },
            { tipo: "OPEN_MESSAGE", texto: "🔔 Arrancó {nombre_evento} — desde ya se ve movimiento en la lista." },
            { tipo: "REMINDER_MESSAGE", texto: "📊 {nombre_evento} lleva buen ritmo de reservas. No te quedes atrás." },
            { tipo: "REMINDER_MESSAGE", texto: "🔄 El movimiento en {nombre_evento} no para. Cada rato hay novedades." },
            { tipo: "REMINDER_MESSAGE", texto: "📈 Sigue habiendo actividad en {nombre_evento} — vale la pena revisar." },
            { tipo: "UPDATE_MESSAGE", texto: "📊 {nombre_evento} sigue avanzando. Ya tenemos {reservados} reservados." },
            { tipo: "UPDATE_MESSAGE", texto: "🔢 Movimiento constante en {nombre_evento}: van {reservados} números ocupados." },
            { tipo: "UPDATE_MESSAGE", texto: "📈 La lista de {nombre_evento} no para de crecer con nuevas reservas." },
            { tipo: "CLOSE_MESSAGE", texto: "🏁 Así terminó el movimiento en {nombre_evento}. Gracias a todos por participar." },
            { tipo: "CLOSE_MESSAGE", texto: "📋 Cerramos {nombre_evento} con {reservados} números ocupados en total. ¡Gracias!" }
        ]
    }

];

// Aplana CATEGORIAS_MENSAJES a los 100 DatosMensaje reales que se insertan
// (activo:true, para poder probar el selector de inmediato). nombre_interno
// se genera acá — "Ejemplo: <categoria> <n>" — único por fila y estable
// entre ejecuciones (mismo orden siempre), que es lo que permite detectar
// "ya existe" sin volver a pedirlo a mano.
const MENSAJES_EJEMPLO: DatosMensaje[] = CATEGORIAS_MENSAJES.flatMap(({ categoria, mensajes }) =>
    mensajes.map((m, i) => ({
        nombre_interno: `${PREFIJO_EJEMPLO} ${categoria} ${i + 1}`,
        texto: m.texto,
        tipo: m.tipo,
        categoria,
        activo: true
    }))
);

// Normaliza para comparar contenido real (minúsculas, sin tildes, sin
// puntuación/emoji-espaciado) — evita que dos mensajes casi idénticos se
// cuelen como "distintos" solo por mayúsculas o signos.
function normalizarTexto(texto: string): string {

    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

}

export interface ResultadoCargaEjemplos {
    cargados: boolean;
    yaExistian: boolean;
    cantidadInsertados: number;
    cantidadTotal: number;
    error: string | null;
}

// Idempotente y sin duplicar contenido:
// 1) trae los mensajes PROPIOS ya marcados como "Ejemplo:" (nombre_interno
//    + texto),
// 2) normaliza y arma un set de textos ya existentes,
// 3) para cada mensaje candidato: si su nombre_interno ya existe, o su
//    texto normalizado ya existe (en Supabase o ya elegido en este mismo
//    lote), se descarta — no se inserta,
// 4) inserta solo lo que falta.
// usuarioId siempre sale de auth.uid() real (nunca un input) — igual que
// el resto de services/automatizacion/.
export async function cargarMensajesEjemplo(usuarioId: string): Promise<ResultadoCargaEjemplos> {

    const { data: existentes, error: errorConsulta } = await supabase
        .from("automation_messages")
        .select("nombre_interno, texto")
        .eq("usuario_id", usuarioId)
        .like("nombre_interno", `${PREFIJO_EJEMPLO}%`);

    if (errorConsulta) {
        return { cargados: false, yaExistian: false, cantidadInsertados: 0, cantidadTotal: 0, error: errorConsulta.message };
    }

    const filas = existentes || [];
    const nombresExistentes = new Set(filas.map((m) => m.nombre_interno));
    const textosVistos = new Set(filas.map((m) => normalizarTexto(m.texto)));

    const candidatos = MENSAJES_EJEMPLO.filter((m) => {

        if (nombresExistentes.has(m.nombre_interno)) return false;

        const normalizado = normalizarTexto(m.texto);

        if (textosVistos.has(normalizado)) return false;

        textosVistos.add(normalizado);
        return true;

    });

    if (candidatos.length === 0) {

        return {
            cargados: false,
            yaExistian: true,
            cantidadInsertados: 0,
            cantidadTotal: filas.length,
            error: null
        };

    }

    const nuevasFilas = candidatos.map((m) => ({
        usuario_id: usuarioId,
        ...m
    }));

    const { error: errorInsert } = await supabase
        .from("automation_messages")
        .insert(nuevasFilas);

    if (errorInsert) {
        return { cargados: false, yaExistian: false, cantidadInsertados: 0, cantidadTotal: filas.length, error: errorInsert.message };
    }

    return {
        cargados: true,
        yaExistian: false,
        cantidadInsertados: nuevasFilas.length,
        cantidadTotal: filas.length + nuevasFilas.length,
        error: null
    };

}
