const supabase = require("../../../lib/supabase");
const { validarFormatoNumero } = require("./extraerNumeros");

async function reservarNumeros({

    evento,
    numeros,
    usuario,
    comprador,
    contacto,
    lib

}) {

    if (!Array.isArray(numeros) || numeros.length === 0) {
        return [];
    }

    // Última capa de defensa (auditoría "reservas por número de cifras")
    // ANTES de tocar Supabase: sin importar quién llame a esta función ni
    // si detectarReserva.js ya filtró, ningún número cuyo formato textual
    // no tenga EXACTAMENTE las cifras configuradas del evento ("5" en un
    // evento de 2 cifras) puede llegar al UPDATE de abajo.
    //
    // Solo se aplica cuando el evento REALMENTE trae `cifras` configurado
    // (siempre el caso en producción: configEvento.js fija cifras=2 en
    // cada evento real). Si `cifras` no viene (código/tests que reservan
    // directamente por otros motivos, ajenos al formato de la dinámica —
    // p. ej. las pruebas de aislamiento de identidad/tenant), esta función
    // no inventa un valor por defecto ni les cambia su contrato: sigue
    // confiando en los `numeros` que ya le pasó el llamador, como siempre.
    if (Number.isInteger(evento?.cifras)) {

        numeros = numeros.filter(n => validarFormatoNumero(n, evento.cifras));

        if (numeros.length === 0) {
            return [];
        }

    }

    const ahora = new Date();

    const fechaReserva = ahora.toLocaleDateString("sv-SE", {
        timeZone: "America/Bogota"
    });

    const horaReserva = ahora.toLocaleTimeString("es-CO", {
        hour12: false,
        timeZone: "America/Bogota"
    });

    const telefono =
        usuario?.telefono ||
        contacto ||
        null;

    const lid =
        usuario?.lid ||
        null;

    const nombre =
        usuario?.nombre ||
        comprador ||
        null;

    const payload = {

        estado: "reservado",

        comprador: nombre,

        contacto: telefono,

        usuario_global_id:
            usuario?.id || null,

        telefono,

        lid,

        nombre,

        grupo_id:
            evento.grupo_id,

        grupo_nombre:
            evento.grupo_nombre,

        evento_id:
            evento.id,

        // Identidad del sorteo REAL (independiente del grupo) — permite que
        // consultarDisponibilidad/consultarReservas/actualizarEvento/
        // verificarTodosPagados/consultarMisNumeros/consultarNumero aíslen
        // correctamente esta reserva de otros eventos/tenants que compartan
        // la misma tabla física por rango de precio, sin dejar de
        // compartirla entre los grupos que son el MISMO sorteo. Ver
        // bot/funciones/eventos/identidadEventoReal.js.
        identidad_evento_real:
            evento.identidad_evento_real || null,

        usuario_id:
            evento.usuario_id,

        telefono_bot:
            evento.telefono_bot,

        fecha_reserva:
            fechaReserva,

        hora_reserva:
            horaReserva,

        lib

    };

    let { data, error } = await supabase
        .from(evento.tabla)
        .update(payload)
        .in("numero", numeros)
        .eq("estado", "libre")
        .select();

    // Red de seguridad de despliegue: si la migración 015 (columna
    // identidad_evento_real) todavía no se aplicó en Supabase cuando este
    // código ya se está ejecutando, Postgres devuelve 42703 (columna
    // inexistente) y SIN esto la reserva completa fallaría — se reintenta
    // una vez sin ese campo para no romper reservas reales mientras se
    // aplica la migración.
    if (error?.code === "42703") {

        console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — reservando sin ella por ahora.");

        const { identidad_evento_real, ...payloadSinIdentidad } = payload;

        const reintento = await supabase
            .from(evento.tabla)
            .update(payloadSinIdentidad)
            .in("numero", numeros)
            .eq("estado", "libre")
            .select();

        data = reintento.data;
        error = reintento.error;

    }

    if (error) {

        console.error("❌ Error reservando números");
        console.error(error);

        return [];

    }

    if (!data || data.length === 0) {

        console.log("⚠ No se reservó ningún número.");

        return [];

    }

    // Registro de actividad para el panel (Actividad reciente). Aditivo y
    // best-effort: si falla o la tabla todavía no existe, nunca debe
    // afectar la reserva que ya se guardó arriba.
    try {

        if (evento.usuario_id) {

            await supabase
                .from("reservas_actividad")
                .insert(data.map((fila) => ({

                    usuario_id: evento.usuario_id,
                    tabla: evento.tabla,
                    numero: fila.numero,
                    evento_id: evento.id,
                    tipo: "reservado",

                    detalle: {
                        comprador: nombre,
                        contacto: telefono,
                        grupo_nombre: evento.grupo_nombre
                    },

                    realizado_por: "bot"

                })));

        }

    } catch (errorActividad) {

        console.error("⚠ No se pudo registrar actividad de reserva:", errorActividad);

    }

    return data;

}

module.exports = {

    reservarNumeros

};