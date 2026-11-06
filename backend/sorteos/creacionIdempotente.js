// ==========================================================================
// K4 (F4-F, 06/11/2026): CREAR un sorteo (borrador) una sola vez por
// solicitud del panel.
//
// Contrato de POST /sorteos: `solicitud_id` OPCIONAL en el cuerpo.
//   - Formato: 8–100 caracteres [A-Za-z0-9_-] (p. ej. un UUID). Otro formato:
//     error de validación (400), no se crea nada.
//   - Mismo cliente + mismo solicitud_id = UNA operación: el doble clic, un
//     reintento tras perder la respuesta o dos peticiones simultáneas
//     devuelven EL MISMO borrador (la respuesta original), sin crear otro.
//   - solicitud_id distintos = operaciones distintas.
//   - Sin solicitud_id (clientes antiguos): como siempre, cada petición crea
//     su borrador.
//   - Alcance: la clave lleva el usuario del TOKEN (nunca del cuerpo), así que
//     el mismo solicitud_id de otro cliente es otra operación y nunca da
//     acceso a sus sorteos.
// Una creación rechazada (validación) queda «error» y se puede repetir con el
// mismo solicitud_id. Sin registro disponible se crea como antes.
// ==========================================================================

"use strict";

const reclamos = require("../automation/reclamos");
const { UMBRALES } = require("../automation/recuperacion");

const TIPO = "CREAR_SORTEO";
const FORMATO = /^[A-Za-z0-9_-]{8,100}$/;
const EN_PROGRESO_VENCIDO_MS = UMBRALES.RECLAMO_CREACION_MS;
const RONDAS = 3;
// automation_actions.grupo_id es NOT NULL: la creación no es de un grupo.
const SIN_GRUPO = "panel";

// -> { ok: true, solicitudId | null } | { ok: false }
function validarSolicitud(valor) {
    if (valor === undefined || valor === null || valor === "") return { ok: true, solicitudId: null };
    if (typeof valor !== "string" || !FORMATO.test(valor)) return { ok: false };
    return { ok: true, solicitudId: valor };
}

const claveCreacion = ({ usuarioId, solicitudId }) => `${TIPO}:${usuarioId}:${solicitudId}`;

// crear()     -> la respuesta de siempre ({ ok, data: sorteo } | { ok: false, … })
// obtener(id) -> el sorteo del cliente ({ ok, data })
async function crearUnaVez({ db, usuarioId, solicitudId, crear, obtener }) {

    if (!solicitudId || !usuarioId) return crear();

    const clave = claveCreacion({ usuarioId, solicitudId });

    for (let ronda = 0; ronda < RONDAS; ronda++) {

        let respuesta = null;
        const r = await reclamos.reclamar({
            db, clave, tipo: TIPO, usuarioId, grupoId: SIN_GRUPO,
            detalle: { solicitud_id: solicitudId },
            retomar: { trasError: true, enProgresoVencidoMs: EN_PROGRESO_VENCIDO_MS },
            ejecutar: async () => {
                respuesta = await crear();
                if (!respuesta?.ok) throw new Error(`creación rechazada (${respuesta?.motivo || "error"})`);
                return { sorteo_id: respuesta.data.id };
            }
        });

        if (r.estado === "ejecutado") return respuesta;
        if (r.estado === "fallo") {
            if (respuesta) return respuesta;
            throw r.error;
        }
        if (r.estado === "sin_registro") return crear();
        if (r.estado === "completado") {
            const id = r.accion?.detalle?.resultado?.sorteo_id;
            return id ? obtener(id) : { ok: false, motivo: "error_supabase" };
        }
        // en_curso (la otra petición sigue creando) o fallido_previo (otra lo
        // retomó a la vez): se espera y se vuelve a mirar.
        if (r.estado === "en_curso") await reclamos.esperar({ db, clave });
    }

    return { ok: false, motivo: "solicitud_en_curso" };

}

module.exports = { crearUnaVez, validarSolicitud, claveCreacion, TIPO, FORMATO };
