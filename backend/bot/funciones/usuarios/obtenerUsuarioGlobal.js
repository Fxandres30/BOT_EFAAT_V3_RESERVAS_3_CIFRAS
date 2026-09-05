const supabase = require("../../../lib/supabase");

// ==========================================================================
// IDENTIDAD DE USUARIO — punto único de resolución/creación
// ==========================================================================
// Reglas (auditoría de identidad, 2026-09):
//
//  - usuarios.id es la ÚNICA identidad interna válida de una persona.
//  - usuarios.lid y usuarios.telefono son claves de BÚSQUEDA, no identidad.
//  - reservas.usuario_global_id = usuarios.id es la identidad real del
//    comprador (esta función no toca reservas; solo la alimenta).
//  - Un JID terminado en "@lid" JAMÁS se convierte en teléfono.
//  - Si hay LID, se resuelve primero por LID; el teléfono se usa para
//    completar datos o como respaldo si no hay LID.
//  - Si LID y teléfono llegan juntos pero apuntan a DOS usuarios distintos
//    ya existentes: NO se fusiona, NO se crea, NO se sobrescribe nada.
//    Se registra como IDENTITY_CONFLICT y se devuelve null (seguridad
//    primero; la aplicación decide después qué hacer).
//  - Un campo (lid o telefono) que YA tiene valor en la fila NUNCA se
//    sobrescribe con un valor distinto. Solo se completa si está vacío.
//  - "nombre" es dato auxiliar: sí puede actualizarse.
//  - Mensajes fromMe NUNCA deben llegar aquí a crear/actualizar/resolver
//    identidad de cliente. El bloqueo real ocurre antes (ver
//    bot/middleware/obtenerUsuario.js y guardarMensajeGrupo.js); el
//    parámetro `fromMe` de esta función es una segunda barrera defensiva.
// ==========================================================================

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505"; // unique_violation

function esErrorDeColisionUnica(error) {

    return !!error && error.code === CODIGO_VIOLACION_UNICA_POSTGRES;

}

// Registra una contingencia de identidad de forma clara y estructurada.
// Se invoca siempre como `module.exports.registrarContingenciaIdentidad(...)`
// desde dentro de este archivo para que las pruebas puedan interceptarla
// (sustituyendo module.exports.registrarContingenciaIdentidad) sin depender
// de parsear console.error.
function registrarContingenciaIdentidad(tipo, detalle) {

    console.error("🚨🚨🚨 CONTINGENCIA DE IDENTIDAD 🚨🚨🚨");
    console.error(JSON.stringify({

        contingencia: tipo,
        ...detalle,
        timestamp: new Date().toISOString()

    }, null, 2));

}

// ==========================================================================
// Busca por un campo único ("lid" o "telefono") y distingue explícitamente
// 0 / 1 / 2+ filas.
//
// NUNCA se usa .maybeSingle(): ante 2+ filas, maybeSingle() puede devolver
// { data: undefined, error: <PGRST116> } y un llamador que solo desestructura
// `{ data }` (como hacía el código anterior) trata esa colisión como
// "usuario inexistente" y termina insertando un duplicado más. Ese fue
// exactamente el mecanismo que, combinado con fromMe, generó los 474
// usuarios duplicados con teléfono del propio bot.
// ==========================================================================
async function buscarPorCampo(campo, valor) {

    const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq(campo, valor)
        .limit(2);

    if (error) {

        console.error(`❌ Error buscando usuario por ${campo}`);
        console.error(error);

        return { estado: "error", usuario: null, filas: [] };

    }

    const filas = data || [];

    if (filas.length === 0) {

        return { estado: "no_existe", usuario: null, filas };

    }

    if (filas.length >= 2) {

        module.exports.registrarContingenciaIdentidad(

            campo === "lid" ? "DUPLICATE_ROWS_LID" : "DUPLICATE_ROWS_TELEFONO",

            {
                campo,
                valor,
                usuarioIds: filas.map(f => f.id)
            }

        );

        return { estado: "colision", usuario: null, filas };

    }

    return { estado: "encontrado", usuario: filas[0], filas };

}

// ==========================================================================
// Resuelve la identidad EXISTENTE (si la hay) aplicando prioridad
// LID > teléfono y detectando conflicto cruzado. No crea ni modifica nada.
//
// Devuelve:
//   { conflicto: true,  usuario: null }        → colisión o error de lectura
//   { conflicto: false, usuario: {...} | null } → resuelto (o no encontrado)
// ==========================================================================
async function resolverIdentidadExistente({ lid, telefono }) {

    let porLid = null;
    let porTelefono = null;

    if (lid) {

        const resultado = await buscarPorCampo("lid", lid);

        if (resultado.estado === "colision" || resultado.estado === "error") {

            return { conflicto: true, usuario: null };

        }

        porLid = resultado.usuario;

    }

    if (telefono) {

        const resultado = await buscarPorCampo("telefono", telefono);

        if (resultado.estado === "colision" || resultado.estado === "error") {

            return { conflicto: true, usuario: null };

        }

        porTelefono = resultado.usuario;

    }

    if (porLid && porTelefono && porLid.id !== porTelefono.id) {

        // Caso sección 6: LID A → usuario X, teléfono B → usuario Y,
        // llega un mensaje con LID A + teléfono B. No fusionar.
        module.exports.registrarContingenciaIdentidad("IDENTITY_CONFLICT", {

            lid,
            telefono,
            usuarioIdEncontradoPorLid: porLid.id,
            usuarioIdEncontradoPorTelefono: porTelefono.id

        });

        return { conflicto: true, usuario: null };

    }

    // Prioridad: LID primero.
    return { conflicto: false, usuario: porLid || porTelefono || null };

}

async function obtenerUsuarioGlobal({

    jid = null,
    telefono = null,
    lid = null,
    nombre = null,
    fromMe = false

}) {

    // ==========================================
    // Blindaje defensivo: nunca resolver/crear identidad de cliente para
    // mensajes del propio bot.
    // ==========================================

    if (fromMe) {

        console.log("⏭️ obtenerUsuarioGlobal: fromMe=true — identidad de cliente NO se resuelve.");

        return null;

    }

    // ==========================================
    // Normalizar valores
    // ==========================================

    jid = jid || null;
    telefono = telefono || null;
    lid = lid || null;
    nombre = nombre || null;

    if (jid === "null@s.whatsapp.net") jid = null;
    if (telefono === "null") telefono = null;
    if (lid === "null") lid = null;
    if (nombre === "null") nombre = null;

    // ==========================================
    // Extraer teléfono desde JID — SOLO si es "@s.whatsapp.net".
    // ==========================================

    if (!telefono && jid && jid.endsWith("@s.whatsapp.net")) {

        telefono = jid
            .split("@")[0]
            .split(":")[0]
            .replace(/^57/, "");

    }

    // ==========================================
    // Extraer LID — un JID "@lid" JAMÁS se convierte en teléfono.
    // ==========================================

    if (!lid && jid && jid.endsWith("@lid")) {

        lid = jid;

    }

    // ==========================================
    // Si no hay identificadores, salir
    // ==========================================

    if (!telefono && !lid) {

        console.log("⚠ Usuario sin teléfono ni LID");
        return null;

    }

    // ==========================================
    // Resolver identidad existente (LID > teléfono). Ninguna colisión ni
    // conflicto provoca INSERT.
    // ==========================================

    const resolucion = await resolverIdentidadExistente({ lid, telefono });

    if (resolucion.conflicto) {

        // Sección 6: seguridad primero. No fusionar, no crear, no mover nada.
        return null;

    }

    let usuario = resolucion.usuario;

    // ==========================================
    // Completar / actualizar usuario existente
    // ==========================================

    if (usuario) {

        const cambios = {};

        if (!usuario.telefono && telefono) {

            cambios.telefono = telefono;

        } else if (usuario.telefono && telefono && usuario.telefono !== telefono) {

            // Nunca sobrescribir un teléfono ya asignado.
            console.warn(
                `⚠ Teléfono entrante (${telefono}) difiere del ya registrado ` +
                `(${usuario.telefono}) para usuario ${usuario.id}. Se conserva el existente.`
            );

        }

        if (!usuario.lid && lid) {

            cambios.lid = lid;

        } else if (usuario.lid && lid && usuario.lid !== lid) {

            // Nunca sobrescribir un LID ya asignado.
            console.warn(
                `⚠ LID entrante (${lid}) difiere del ya registrado ` +
                `(${usuario.lid}) para usuario ${usuario.id}. Se conserva el existente.`
            );

        }

        if (nombre && usuario.nombre !== nombre) {

            cambios.nombre = nombre;

        }

        if (Object.keys(cambios).length > 0) {

            cambios.ultima_actividad = new Date();

            const { error } = await supabase
                .from("usuarios")
                .update(cambios)
                .eq("id", usuario.id);

            if (!error) {

                usuario = { ...usuario, ...cambios };

            } else {

                console.error("❌ Error actualizando usuario");
                console.error(error);

            }

        }

        return usuario;

    }

    // ==========================================
    // Crear usuario (no existe ni por LID ni por teléfono)
    // ==========================================

    const { data: nuevo, error } = await supabase
        .from("usuarios")
        .insert({

            telefono,
            lid,
            nombre,
            ultima_actividad: new Date()

        })
        .select()
        .single();

    if (error) {

        // ==========================================
        // Concurrencia: SELECT → no encontrado → INSERT → si otro proceso
        // ganó la carrera, Postgres devuelve unique_violation (23505) una
        // vez exista la restricción UNIQUE (pendiente de crear en Supabase,
        // ver sección 8). NO se reintenta el INSERT: se reutiliza la fila
        // que ganó la carrera. Hoy, sin el índice UNIQUE, esta rama solo se
        // activa si Supabase ya reporta 23505 por algún otro motivo; el
        // código queda listo para cuando se agregue el índice.
        // ==========================================

        if (esErrorDeColisionUnica(error)) {

            console.warn("⚠ unique_violation al crear usuario — otro proceso ganó la carrera. Reutilizando fila existente.");

            const recuperado = await resolverIdentidadExistente({ lid, telefono });

            if (!recuperado.conflicto && recuperado.usuario) {

                return recuperado.usuario;

            }

        }

        console.error("❌ Error creando usuario");
        console.error(error);

        return null;

    }

    return nuevo;

}

module.exports = {

    obtenerUsuarioGlobal,

    // Exportados para pruebas e instrumentación — no forman parte del
    // "flujo de negocio" de reservas.
    registrarContingenciaIdentidad,
    resolverIdentidadExistente,
    buscarPorCampo,
    esErrorDeColisionUnica

};
