const supabase = require("../../../lib/supabase");
const { soloDelCliente } = require("../reservas/filtroCliente");
const { clasificarSolicitud } = require("../reservas/estadoNumeros");
const { filtroDelSorteo } = require("./consultarMisNumeros");
const { motorNuevo } = require("../../../rifas/motor");
const rifasBot = require("../../../rifas/bot");

// READ-ONLY. Determina el estado real de UN número con la regla única de
// estadoNumeros.js (la misma que usa la reserva). estadoReal:
//   libre
//   reservado_por_usuario / pagado_por_usuario  -> suyo en esta tabla (= este
//                                                   sorteo, venga de donde venga)
//   reservado_por_otro / pagado_por_otro         -> de otra persona
//   bloqueado / en_proceso
//   sin_registro / duplicado / desconocido       -> no disponible (integridad)
//   error_lectura      -> no se pudo leer: nunca se afirma un estado
// No filtra por evento_id (ver nota en consultarMisNumeros.js).
async function consultarNumero({ evento, usuario, numero }) {

    // Motor nuevo: el número en la rifa del sorteo. La rifa ES el sorteo:
    // no hace falta separar por identidad (no comparte números con nadie).
    if (motorNuevo()) {
        if (!usuario?.id || !numero) return null;
        const filas = await rifasBot.leerFilas(evento, { numeros: [numero] });
        if (filas === null) return { numero, estadoReal: "error_lectura" };
        const clase = clasificarSolicitud({ numeros: [filas[0]?.numero ?? numero], filas, evento, usuario }).get(String(filas[0]?.numero ?? numero));
        const fila = filas[0];
        if (clase === "libre") return { numero, estadoReal: "libre" };
        if (clase === "propio") return { numero, estadoReal: fila.estado === "pagado" ? "pagado_por_usuario" : "reservado_por_usuario" };
        if (clase === "ocupado") return { numero, estadoReal: fila.estado === "pagado" ? "pagado_por_otro" : "reservado_por_otro" };
        return { numero, estadoReal: clase };
    }

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

        case "propio": {
            // Aislamiento por sorteo (06/11/2026): si la fila es de OTRO
            // sorteo vigente que comparte la tabla física (otro precio), no
            // es suya en ESTE sorteo; no se afirma nada de aquel.
            const delSorteo = await filtroDelSorteo(evento);
            if (delSorteo === null) return { numero, estadoReal: "error_lectura" };
            if (!delSorteo(fila)) return { numero, estadoReal: "no_disponible" };
            return { numero, estadoReal: fila.estado === "pagado" ? "pagado_por_usuario" : "reservado_por_usuario" };
        }

        case "ocupado":
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
