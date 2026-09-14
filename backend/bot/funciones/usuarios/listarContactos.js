// ==========================================================================
// listarContactos() — directorio central de usuarios que el bot conoce,
// para el panel "Contactos" (reemplaza a /chats como pantalla principal).
// ==========================================================================
// REESCRITO (diagnóstico de arquitectura, 2026-09: "Contactos muestra ~147
// en vez de ~2.800"). La fuente de QUIÉN EXISTE como contacto de este
// tenant es ahora, exclusivamente:
//
//     contactos_tenant (migración 018) JOIN usuarios
//
// — la relación real tenant<->identidad, poblada por
// obtenerUsuarioGlobal.js::registrarContactoTenant desde CUALQUIER punto
// donde se resuelva una identidad para este tenant (escaneo de grupos,
// mensaje en vivo, IdentitySync). Reservas y mensajes YA NO deciden si un
// contacto existe — se agregan aparte, solo como actividad/conteo, sobre
// el conjunto de contactos que contactos_tenant ya determinó.
//
// "usuarios" sigue siendo la identidad GLOBAL (nombre/telefono/lid) — se
// lee siempre en vivo, nunca se copia, así que un teléfono que el Identity
// Resolver complete más tarde aparece solo con volver a llamar a este
// mismo listado.
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { obtenerTablasConocidas } = require("../eventos/configEvento");

const COLUMNAS_RESERVA = "usuario_global_id, estado";

// ==========================================================================
// Lotes para leer "usuarios" por id (optimización 2026-09 — informe "Bad
// Request" en producción con ~2.800 contactos_tenant). Un solo
// .in("id", ids) con ~2.800 UUIDs genera una URL de ~100.000 caracteres,
// que el gateway delante de PostgREST rechaza con 400 Bad Request ANTES de
// llegar a ejecutar SQL — no es un error de sintaxis ni de permisos, es un
// límite de transporte HTTP. Se trocea en lotes de tamaño seguro y se
// ejecutan con concurrencia acotada (no los ~12 lotes todos a la vez, ni
// uno por uno).
// ==========================================================================
const TAMANO_LOTE_IDS = 250;
const CONCURRENCIA_LOTES_IDS = 5;

function trocear(array, tamano) {

    const lotes = [];

    for (let i = 0; i < array.length; i += tamano) {
        lotes.push(array.slice(i, i + tamano));
    }

    return lotes;

}

// Ejecuta `fn` sobre `items` con concurrencia limitada — mismo patrón que
// ya usa diagnosticoTelefonosLid.js::enLotes, reutilizado aquí en vez de
// reimplementarlo aparte.
async function conConcurrenciaLimitada(items, concurrencia, fn) {

    const resultados = [];

    for (let i = 0; i < items.length; i += concurrencia) {

        const grupo = items.slice(i, i + concurrencia);
        const parcial = await Promise.all(grupo.map(fn));
        resultados.push(...parcial);

    }

    return resultados;

}

// Divide `ids` en lotes seguros y los combina — misma consulta
// (select "id, nombre, telefono, lid"), mismo resultado final que un único
// .in("id", ids), solo que sin exceder el límite de URL. Un lote que falle
// se loguea y se omite (los contactos de ESE lote no aparecen esta vez, en
// vez de vaciar el listado completo por un problema puntual).
async function obtenerUsuariosPorIds(ids) {

    const lotes = trocear(ids, TAMANO_LOTE_IDS);

    const resultadosPorLote = await conConcurrenciaLimitada(lotes, CONCURRENCIA_LOTES_IDS, async (lote) => {

        const { data, error } = await supabase
            .from("usuarios")
            .select("id, nombre, telefono, lid")
            .in("id", lote);

        return { data, error, tamanoLote: lote.length };

    });

    const usuarios = [];
    let huboError = false;

    for (const r of resultadosPorLote) {

        if (r.error) {

            huboError = true;
            console.error(`❌ [CONTACTOS] error leyendo identidades (lote de ${r.tamanoLote}):`, r.error.message);
            continue;

        }

        if (r.data) usuarios.push(...r.data);

    }

    return { usuarios, huboError };

}

// Solo para AGREGAR conteos (cantidadReservas/cantidadPagadas) sobre
// contactos que contactos_tenant ya determinó que existen — nunca para
// decidir existencia. Mismo criterio tenant-scoped de siempre
// (evento.tabla.usuario_id).
async function obtenerFilasDeReservasPorTenant(usuarioId) {

    const tablas = obtenerTablasConocidas();

    const resultados = await Promise.all(
        tablas.map((tabla) =>
            supabase
                .from(tabla)
                .select(COLUMNAS_RESERVA)
                .eq("usuario_id", usuarioId)
                .not("usuario_global_id", "is", null)
        )
    );

    const filas = [];

    for (const { data, error } of resultados) {

        if (error) {
            // Una tabla dinámica puntual con error (p. ej. todavía no
            // migrada) no debe tumbar el resto del directorio.
            console.error("❌ [CONTACTOS] error leyendo tabla dinámica:", error.message);
            continue;
        }

        if (data) filas.push(...data);

    }

    return filas;

}

function agregarConteosPorCliente(filas) {

    const porCliente = new Map();

    for (const fila of filas) {

        const id = fila.usuario_global_id;

        if (!porCliente.has(id)) {
            porCliente.set(id, { cantidadReservas: 0, cantidadPagadas: 0 });
        }

        const agregado = porCliente.get(id);

        agregado.cantidadReservas++;

        if (fila.estado === "pagado") agregado.cantidadPagadas++;

    }

    return porCliente;

}

// 'completo' | 'solo_lid' | 'solo_telefono' | 'sin_identificar' — mismo
// criterio en listado y perfil (ver obtenerPerfilContacto.js).
function estadoIdentificacion(telefono, lid) {

    if (telefono && lid) return "completo";
    if (lid) return "solo_lid";
    if (telefono) return "solo_telefono";
    return "sin_identificar";

}

// ==========================================================================
// listarContactos({ usuarioId }) — usuarioId es SIEMPRE el tenant (dueño
// del bot/panel), nunca la identidad del cliente — mismo criterio que
// evento.usuario_id en todo el resto del proyecto.
// ==========================================================================
async function listarContactos({ usuarioId }) {

    if (!usuarioId) {
        return { contactos: [] };
    }

    // Fuente PRINCIPAL — determina QUIÉN existe, con o sin actividad.
    const { data: relaciones, error: errorRelaciones } = await supabase
        .from("contactos_tenant")
        .select("usuario_global_id, primer_visto_en, ultimo_visto_en")
        .eq("usuario_id", usuarioId)
        .order("ultimo_visto_en", { ascending: false });

    if (errorRelaciones) {

        // 42P01 = undefined_table -- la migración 018 todavía no se aplicó
        // en este entorno. Se distingue del resto de errores para que el
        // panel pueda mostrar un mensaje claro en vez de "0 contactos" sin
        // explicación.
        if (errorRelaciones.code === "42P01") {

            console.error("❌ [CONTACTOS] la tabla contactos_tenant no existe todavía (falta aplicar supabase_migrations/018_contactos_tenant.sql).");
            return { contactos: [], migracionPendiente: true };

        }

        console.error("❌ [CONTACTOS] error leyendo contactos_tenant:", errorRelaciones.message);
        return { contactos: [] };

    }

    if (!relaciones || relaciones.length === 0) {
        return { contactos: [] };
    }

    const ids = relaciones.map((r) => r.usuario_global_id);

    const [resultadoUsuarios, filasReserva] = await Promise.all([
        obtenerUsuariosPorIds(ids),
        obtenerFilasDeReservasPorTenant(usuarioId)
    ]);

    // Solo se corta en seco si TODOS los lotes fallaron (0 identidades
    // leídas) — un fallo parcial ya se logueó por lote y simplemente deja
    // fuera a esos contactos de esta respuesta, en vez de vaciar todo el
    // directorio por un problema puntual en un lote.
    if (resultadoUsuarios.huboError && resultadoUsuarios.usuarios.length === 0) {
        return { contactos: [] };
    }

    const usuariosPorId = new Map(resultadoUsuarios.usuarios.map((u) => [u.id, u]));
    const conteosPorCliente = agregarConteosPorCliente(filasReserva);

    const contactos = relaciones

        .map((rel) => {

            const u = usuariosPorId.get(rel.usuario_global_id);

            // Defensivo: no debería pasar (contactos_tenant.usuario_global_id
            // referencia usuarios.id con FK), pero si la fila de usuarios ya
            // no existe por algún motivo, se omite en vez de romper el listado.
            if (!u) return null;

            const conteo = conteosPorCliente.get(u.id) || { cantidadReservas: 0, cantidadPagadas: 0 };

            return {

                id: u.id,
                nombre: u.nombre || null,
                telefono: u.telefono || null,
                lid: u.lid || null,

                estadoIdentificacion: estadoIdentificacion(u.telefono, u.lid),
                telefonoPendiente: !u.telefono && !!u.lid,

                cantidadReservas: conteo.cantidadReservas,
                cantidadPagadas: conteo.cantidadPagadas,

                primeraVezVisto: rel.primer_visto_en,
                ultimaActividad: rel.ultimo_visto_en

            };

        })
        .filter(Boolean);

    // Más recientes primero — ya viene así de la query, se reafirma aquí
    // por si el merge de arriba alterara el orden.
    contactos.sort((a, b) => new Date(b.ultimaActividad).getTime() - new Date(a.ultimaActividad).getTime());

    return { contactos };

}

module.exports = {
    listarContactos,
    obtenerFilasDeReservasPorTenant,
    estadoIdentificacion,

    // Exportados para pruebas e instrumentación (lotes de .in() por ids).
    obtenerUsuariosPorIds,
    trocear,
    conConcurrenciaLimitada,
    TAMANO_LOTE_IDS
};
