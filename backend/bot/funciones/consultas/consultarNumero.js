const supabase = require("../../../lib/supabase");
const { soloDelCliente } = require("../reservas/filtroCliente");
const { clasificarSolicitud, esPropioDeOtroSorteo } = require("../reservas/estadoNumeros");

// READ-ONLY. Determina el estado real de UN número con la regla única de
// estadoNumeros.js (la misma que usa la reserva). estadoReal:
//   libre
//   reservado_por_usuario / pagado_por_usuario  -> suyo en ESTE sorteo
//   reservado_por_otro / pagado_por_otro         -> de otra persona (en
//                                                   cualquier sorteo)
//   propio_otro_sorteo -> suyo, pero de OTRO sorteo: aquí no está disponible
//   bloqueado / en_proceso
//   sin_registro / duplicado / desconocido       -> no disponible (integridad)
//   error_lectura      -> no se pudo leer: nunca se afirma un estado
// No filtra por evento_id (ver nota en consultarMisNumeros.js).
async function consultarNumero({ evento, usuario, numero }) {

    if (!evento?.tabla || !usuario?.id || !numero) {
        return null;
    }

    // Todas las filas del número (no maybeSingle): un número repetido es un
    // dato real que se informa, no un error de lectura.
    const { data, error } = await soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("numero, estado, usuario_global_id, lid, telefono, contacto, identidad_evento_real")
            .eq("numero", numero),
        evento
    );

    if (error) {

        console.log("❌ Error consultando número:", error.message);

        return { numero, estadoReal: "error_lectura" };

    }

    const filas = data || [];
    const clase = clasificarSolicitud({ numeros: [numero], filas, evento, usuario }).get(String(numero));
    const fila = filas[0];

    switch (clase) {

        case "libre":
            return { numero, estadoReal: "libre" };

        case "propio":
            return { numero, estadoReal: fila.estado === "pagado" ? "pagado_por_usuario" : "reservado_por_usuario" };

        case "ocupado":
            if (esPropioDeOtroSorteo(fila, { evento, usuario })) return { numero, estadoReal: "propio_otro_sorteo" };
            return { numero, estadoReal: fila.estado === "pagado" ? "pagado_por_otro" : "reservado_por_otro" };

        default:
            if (clase !== "bloqueado" && clase !== "en_proceso") {
                console.warn(`⚠️ [CONSULTA] número ${numero} sin una fila válida en ${evento.tabla} (cliente ${evento.usuario_id}): ${clase}`);
            }
            return { numero, estadoReal: clase };

    }

}

module.exports = {
    consultarNumero
};
