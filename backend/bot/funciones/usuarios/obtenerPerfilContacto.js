// ==========================================================================
// obtenerPerfilContacto() — detalle de UN contacto para el panel Contactos:
// identidad + reservas + pagos + actividad (+ mensajes recientes, cuando
// hay forma de acotarlos de forma segura a este tenant).
// ==========================================================================
// Mismo criterio de reutilización que listarContactos.js: ninguna tabla ni
// columna nueva. "usuarioId" es siempre el tenant; "contactoId" es
// usuarios.id (identidad global del cliente).
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { obtenerTablasConocidas } = require("../eventos/configEvento");
const { estadoIdentificacion } = require("./listarContactos");

const COLUMNAS_RESERVA_DETALLE =
    "numero, estado, fecha_reserva, hora_reserva, fecha_pago, hora_pago, grupo_nombre, grupo_id, evento_id, comprador, contacto";

async function obtenerReservasDelContacto({ usuarioId, contactoId }) {

    const tablas = obtenerTablasConocidas();

    const resultados = await Promise.all(
        tablas.map(async (tabla) => {

            const { data, error } = await supabase
                .from(tabla)
                .select(COLUMNAS_RESERVA_DETALLE)
                .eq("usuario_id", usuarioId)
                .eq("usuario_global_id", contactoId);

            if (error) {
                console.error(`❌ [CONTACTOS] error leyendo reservas (${tabla}):`, error.message);
                return [];
            }

            return (data || []).map((fila) => ({ ...fila, tabla }));

        })
    );

    return resultados.flat();

}

// Actividad real (reservas_actividad, log de solo-inserción — ver
// supabase_migrations/002_reservas_actividad.sql) para ESTE tenant, en las
// filas (tabla+numero) que ya se confirmó que son de este contacto —
// reservas_actividad no guarda usuario_global_id/lid, así que el único
// cruce seguro es por (tabla, numero) sobre las reservas YA acotadas arriba.
async function obtenerActividadDelContacto({ usuarioId, reservas }) {

    if (reservas.length === 0) return [];

    const porTabla = new Map();

    for (const r of reservas) {

        if (!porTabla.has(r.tabla)) porTabla.set(r.tabla, new Set());
        porTabla.get(r.tabla).add(r.numero);

    }

    const resultados = await Promise.all(
        [...porTabla.entries()].map(async ([tabla, numerosSet]) => {

            const { data, error } = await supabase
                .from("reservas_actividad")
                .select("id, tipo, detalle, realizado_por, creado_en, numero")
                .eq("usuario_id", usuarioId)
                .eq("tabla", tabla)
                .in("numero", [...numerosSet])
                .order("creado_en", { ascending: false })
                .limit(50);

            if (error) {
                console.error(`❌ [CONTACTOS] error leyendo actividad (${tabla}):`, error.message);
                return [];
            }

            return (data || []).map((fila) => ({ ...fila, tabla }));

        })
    );

    return resultados
        .flat()
        .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime())
        .slice(0, 50);

}

// Mensajes recientes del contacto (mensajes_grupos_sorteos.usuario_id ES la
// identidad global del remitente — ver guardarMensajeGrupo.js). Se acota
// además a los grupos REALES de este tenant (eventos_bot.grupo_id, mismo
// tenant) — reutiliza esa relación en vez de confiar solo en la identidad
// global, que por diseño es compartida entre tenants.
async function obtenerMensajesDelContacto({ usuarioId, contactoId }) {

    const { data: eventos, error: errorEventos } = await supabase
        .from("eventos_bot")
        .select("grupo_id")
        .eq("usuario_id", usuarioId);

    if (errorEventos || !eventos || eventos.length === 0) return [];

    const gruposDelTenant = [...new Set(eventos.map((e) => e.grupo_id).filter(Boolean))];

    if (gruposDelTenant.length === 0) return [];

    const { data, error } = await supabase
        .from("mensajes_grupos_sorteos")
        .select("id, texto, tipo_mensaje, timestamp_whatsapp, accion, grupo_id, grupo_nombre")
        .eq("usuario_id", contactoId)
        .in("grupo_id", gruposDelTenant)
        .order("timestamp_whatsapp", { ascending: false })
        .limit(30);

    if (error) {
        console.error("❌ [CONTACTOS] error leyendo mensajes:", error.message);
        return [];
    }

    return data || [];

}

async function obtenerPerfilContacto({ usuarioId, contactoId }) {

    if (!usuarioId || !contactoId) return null;

    // Existencia REAL del contacto para este tenant: la relación
    // contactos_tenant (migración 018) — nunca reservas/mensajes. Un
    // contacto recién descubierto (escaneo de grupo, nunca escribió ni
    // reservó) debe poder abrirse igual.
    const { data: relacion, error: errorRelacion } = await supabase
        .from("contactos_tenant")
        .select("primer_visto_en, ultimo_visto_en")
        .eq("usuario_id", usuarioId)
        .eq("usuario_global_id", contactoId)
        .maybeSingle();

    if (errorRelacion) {

        if (errorRelacion.code === "42P01") {
            console.error("❌ [CONTACTOS] la tabla contactos_tenant no existe todavía (falta aplicar supabase_migrations/018_contactos_tenant.sql).");
        } else {
            console.error("❌ [CONTACTOS] error leyendo relación tenant/contacto:", errorRelacion.message);
        }

        return null;

    }

    // Sin relación = este usuario_global_id no es (o ya no es) un contacto
    // conocido de ESTE tenant — puede ser real, pero de OTRO tenant. Nunca
    // se expone su identidad en ese caso.
    if (!relacion) return null;

    const { data: identidad, error: errorIdentidad } = await supabase
        .from("usuarios")
        .select("id, nombre, telefono, lid")
        .eq("id", contactoId)
        .maybeSingle();

    if (errorIdentidad) {
        console.error("❌ [CONTACTOS] error leyendo identidad:", errorIdentidad.message);
        return null;
    }

    // Defensivo: la relación existe (FK a usuarios.id) pero la fila ya no
    // — no debería pasar nunca en la práctica.
    if (!identidad) return null;

    const reservas = await obtenerReservasDelContacto({ usuarioId, contactoId });

    const [actividad, mensajes] = await Promise.all([
        obtenerActividadDelContacto({ usuarioId, reservas }),
        obtenerMensajesDelContacto({ usuarioId, contactoId })
    ]);

    reservas.sort((a, b) => {

        const ta = new Date(`${a.fecha_pago || a.fecha_reserva || "1970-01-01"}T${a.hora_pago || a.hora_reserva || "00:00:00"}`).getTime();
        const tb = new Date(`${b.fecha_pago || b.fecha_reserva || "1970-01-01"}T${b.hora_pago || b.hora_reserva || "00:00:00"}`).getTime();

        return tb - ta;

    });

    return {

        identidad: {
            id: identidad.id,
            nombre: identidad.nombre || null,
            telefono: identidad.telefono || null,
            lid: identidad.lid || null,
            estadoIdentificacion: estadoIdentificacion(identidad.telefono, identidad.lid),
            telefonoPendiente: !identidad.telefono && !!identidad.lid,
            primeraVezVisto: relacion.primer_visto_en,
            ultimaActividad: relacion.ultimo_visto_en
        },

        reservas,
        actividad,
        mensajes

    };

}

module.exports = { obtenerPerfilContacto };
