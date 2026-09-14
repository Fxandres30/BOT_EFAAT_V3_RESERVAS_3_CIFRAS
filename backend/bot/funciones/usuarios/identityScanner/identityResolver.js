// ==========================================================================
// IdentityResolver — capa 3 de 3: Baileys -> IdentityScanner ->
// IdentityNormalizer -> IdentityResolver -> "usuarios".
// ==========================================================================
// Este módulo NO reimplementa enriquecimiento ni detección de conflicto —
// ambos ya existen, probados, en
// bot/funciones/usuarios/obtenerUsuarioGlobal.js (el ÚNICO punto de
// escritura real de "usuarios" en todo el sistema — regla arquitectónica
// de identidad, ver cabecera de ese archivo). Este resolver es un
// orquestador delgado:
//
//   1. Recibe un resultado YA normalizado del IdentityScanner para UNA
//      persona (un participante, un remitente de mensaje) — nunca mezcla
//      candidatos de personas distintas en una sola llamada.
//   2. Elige el mejor teléfono/LID candidato de esa persona.
//   3. Canonicaliza el LID contra lo que YA existe en Supabase — ver
//      canonicalizarLid() — para no duplicar un usuario solo porque el LID
//      llegó con/sin sufijo de dispositivo distinto (auditoría de
//      identidad, 2026-09: bug real ya documentado en
//      escanerIdentidades.js::usuarioDeJid para el propio bot; aquí se
//      corrige también para clientes normales).
//   4. Delega en obtenerUsuarioGlobal() — que ya decide "enriquecer",
//      "crear" o "IDENTITY_CONFLICT (no fusionar)".
//   5. Devuelve también si hubo un cambio real, para que quien llame
//      pueda decidir si vale la pena loguear (ver reglas de logging en
//      identitySync — "no llenar el log si no pasó nada").
// ==========================================================================

const supabase = require("../../../../lib/supabase");
const { jidDecode } = require("@whiskeysockets/baileys");

const {
    obtenerUsuarioGlobal,
    buscarPorCampo
} = require("../obtenerUsuarioGlobal");

const { quitarSufijoDispositivo } = require("./normalizarCandidatos");

// ==========================================================================
// Busca, SOLO LECTURA, un usuario cuyo lid comparta el mismo "user"
// (decodificado, sin dispositivo) pero con un sufijo de dispositivo
// DISTINTO al que llegó — p. ej. llegó "123:11@lid" y ya existe guardado
// "123:5@lid" (nunca se vio la variante exacta ni la variante sin sufijo).
// Usa LIKE porque ni buscarPorCampo() ni el resto del sistema hacen
// coincidencia por patrón — este es el único lugar que lo necesita, y solo
// se ejecuta cuando la búsqueda exacta y la búsqueda "sin sufijo" ya
// fallaron (camino frío, no el camino normal de cada mensaje).
// Ambigüedad (2+ filas) o error -> null: mejor no arriesgar una fusión
// incorrecta que forzar una.
// ==========================================================================
// Devuelve la FILA completa (no solo el string del lid) — optimización
// 2026-09 (informe "Bad Request" / escaneo lento): quien llama
// (canonicalizarLid) necesitaba antes hacer una consulta APARTE para
// obtener la fila completa de este mismo lid; con esto ya no hace falta,
// se ahorra un SELECT redundante por participante sin cambiar ningún
// criterio de búsqueda (mismo LIKE, mismo límite, misma regla de
// ambigüedad).
async function buscarLidConCualquierSufijo(user) {

    const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .like("lid", `${user}:%@lid`)
        .limit(2);

    if (error || !data || data.length !== 1) return null;

    return data[0];

}

// ==========================================================================
// canonicalizarLid(lidCrudo) — decide qué valor de LID pasarle a
// obtenerUsuarioGlobal() para que reconozca a esta persona aunque el
// sufijo de dispositivo no coincida byte a byte con lo ya guardado.
//
//   1. ¿Existe una fila EXACTA con este lid? -> se usa tal cual (camino
//      normal de siempre, sin ningún cambio de comportamiento).
//   2. ¿Existe la variante SIN sufijo de dispositivo? -> se usa esa (ya
//      guardada), en vez del crudo con sufijo.
//   3. ¿Existe alguna variante con OTRO sufijo de dispositivo? -> se usa
//      esa.
//   4. Nada de lo anterior existe todavía -> se usa el crudo tal cual
//      (comportamiento normal: obtenerUsuarioGlobal decide crear).
//
// El valor crudo ORIGINAL nunca se pierde: quien llama a resolverIdentidad
// sigue teniendo el candidato con su `crudo` original para logging/
// auditoría — esta función solo decide qué valor usar para la
// RESOLUCIÓN/ESCRITURA en "usuarios", no descarta el dato visto.
//
// Devuelve { lid, usuarioEncontrado } — no solo el string. `usuarioEncontrado`
// es la fila YA leída en el proceso de canonicalizar (o null si de verdad no
// existe todavía / hay colisión). Optimización 2026-09 (informe "escaneo
// lento" — ~2.800 participantes tardaban ~40min): antes, resolverIdentidad()
// volvía a consultar por este mismo lid justo después ("snapshot antes"),
// repitiendo exactamente la misma lectura que esta función ya había hecho.
// Reutilizar el resultado aquí ahorra 1 SELECT por participante con LID
// (la inmensa mayoría) sin cambiar ningún criterio de búsqueda/canonicalización.
// ==========================================================================
async function canonicalizarLid(lidCrudo) {

    const exacto = await buscarPorCampo("lid", lidCrudo);

    if (exacto.estado === "encontrado") {
        return { lid: lidCrudo, usuarioEncontrado: exacto.usuario };
    }

    if (exacto.estado === "colision") {
        // Mismo comportamiento que antes: no se intenta bare/otro-dispositivo
        // ante una colisión ya detectada -- obtenerUsuarioGlobal la vuelve a
        // detectar y decide qué hacer (nunca fusiona).
        return { lid: lidCrudo, usuarioEncontrado: null };
    }

    const user = jidDecode(lidCrudo)?.user || null;

    if (!user) return { lid: lidCrudo, usuarioEncontrado: null };

    const bare = `${user}@lid`;

    if (bare !== lidCrudo) {

        const porBare = await buscarPorCampo("lid", bare);

        if (porBare.estado === "encontrado") {
            return { lid: bare, usuarioEncontrado: porBare.usuario };
        }

    }

    const porOtroDispositivo = await buscarLidConCualquierSufijo(user);

    if (porOtroDispositivo) {
        return { lid: porOtroDispositivo.lid, usuarioEncontrado: porOtroDispositivo };
    }

    return { lid: lidCrudo, usuarioEncontrado: null };

}

// ==========================================================================
// Elige el mejor candidato de teléfono de una persona: preferir uno
// "válido" (10 dígitos, empieza en 3 — ver normalizarCandidatos.js). Si
// ninguno lo es, no se manda ninguno — mejor nada que un dato corrupto en
// "usuarios" (obtenerUsuarioGlobal.js no vuelve a validar longitud).
// ==========================================================================
function elegirTelefono(candidatos) {

    const valido = candidatos.find(c => c.tipo === "phone" && c.valido);

    return valido ? valido.valor : null;

}

// ==========================================================================
// resolverIdentidad({ telefonos, lids, candidatos, nombre, fromMe })
//
// `telefonos`/`lids`/`candidatos` — la salida de normalizarCandidatos()
// para UNA sola persona (no un grupo completo ni un mensaje con varios
// remitentes mezclados).
//
// Devuelve:
//   { usuario, esNuevo, fueEnriquecido, conflicto, lidUsado, telefonoUsado }
// — nunca lanza (el try/catch de quien orquesta el escaneo/sync decide qué
// hacer ante un fallo real de Supabase, esta función deja pasar el error
// tal cual para que ese try/catch lo capture, ver identitySync).
// ==========================================================================
async function resolverIdentidad({

    telefonos = [],
    lids = [],
    candidatos = [],
    nombre = null,
    fromMe = false,

    // Propagados a obtenerUsuarioGlobal para registrar contactos_tenant
    // (ver diagnóstico de arquitectura, 2026-09) — opcionales, sin efecto
    // si el llamador no conoce el tenant todavía.
    usuarioIdTenant = null,
    origenContacto = null

}) {

    if (fromMe || (telefonos.length === 0 && lids.length === 0)) {

        return { usuario: null, esNuevo: false, fueEnriquecido: false, conflicto: false, lidUsado: null, telefonoUsado: null };

    }

    if (lids.length > 1) {

        console.warn(`⚠️ [IDENTITY RESOLVER] más de un LID distinto encontrado para la misma persona — se usa el primero. Todos: ${lids.join(", ")}`);

    }

    const telefono = elegirTelefono(candidatos);
    let lid = lids[0] || null;

    // ---- snapshot "antes" (para saber si hubo enriquecimiento real) ----
    // canonicalizarLid() ya lee la fila por LID como parte de su propio
    // trabajo (ver su cabecera) — se reutiliza ese resultado como "antes"
    // en vez de volver a consultar por el mismo lid (optimización 2026-09).
    // Si no hay LID (o no se encontró nada por LID), se intenta por
    // teléfono — así se detecta correctamente el caso "ya existía por
    // teléfono y ahora se le agrega el LID", donde una búsqueda que solo
    // mirara por LID nunca lo habría encontrado.
    let antes = null;

    if (lid) {

        const canonicalizado = await canonicalizarLid(lid);
        lid = canonicalizado.lid;
        antes = canonicalizado.usuarioEncontrado;

    }

    if (!antes && telefono) {

        const resultado = await buscarPorCampo("telefono", telefono);
        if (resultado.estado === "encontrado") antes = resultado.usuario;

    }

    const usuario = await obtenerUsuarioGlobal({ lid, telefono, nombre, fromMe: false, usuarioIdTenant, origenContacto });

    if (!usuario) {

        // obtenerUsuarioGlobal ya registra la contingencia detallada
        // (DUPLICATE_ROWS_* / IDENTITY_CONFLICT) por su cuenta. Aquí solo
        // se informa el hecho a quien llama, para el log condensado de
        // identitySync.
        return { usuario: null, esNuevo: false, fueEnriquecido: false, conflicto: true, lidUsado: lid, telefonoUsado: telefono };

    }

    const esNuevo = !antes;

    const fueEnriquecido = !!(
        !esNuevo &&
        antes.id === usuario.id &&
        (
            (!antes.telefono && usuario.telefono) ||
            (!antes.lid && usuario.lid) ||
            (nombre && antes.nombre !== usuario.nombre)
        )
    );

    return { usuario, esNuevo, fueEnriquecido, conflicto: false, lidUsado: lid, telefonoUsado: telefono };

}

module.exports = {
    resolverIdentidad,
    canonicalizarLid,
    elegirTelefono
};
