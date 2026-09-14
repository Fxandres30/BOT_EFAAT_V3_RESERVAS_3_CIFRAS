// ==========================================================================
// agregarTelefonoContacto() — acción manual del panel Contactos: "Agregar
// teléfono" cuando falta. Asocia el teléfono al usuario YA EXISTENTE (por
// usuarios.id) — nunca crea un contacto nuevo, nunca sobrescribe un
// teléfono ya asignado, nunca deja que dos contactos terminen con el mismo
// teléfono.
// ==========================================================================
// Reutiliza:
//   - limpiarTelefono() de identityScanner/normalizarCandidatos.js — el
//     MISMO criterio de validación (10 dígitos, empieza en 3) que ya usa
//     todo el sistema de identidad, para no inventar una regla nueva aquí.
//   - El índice UNIQUE parcial ya existente en Supabase
//     (supabase_migrations/014_unique_lid_telefono_usuarios.sql) como
//     última defensa — este archivo además valida ANTES de escribir, para
//     devolver un motivo claro al panel en vez de un error crudo de
//     Postgres.
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { limpiarTelefono } = require("./identityScanner/normalizarCandidatos");

async function agregarTelefonoContacto({ contactoId, telefono }) {

    if (!contactoId || !telefono) {
        return { ok: false, motivo: "faltan_parametros" };
    }

    const soloDigitos = String(telefono).replace(/\D/g, "");

    // Se reutiliza limpiarTelefono() pasándole un JID sintético — es el
    // MISMO criterio (57 inicial opcional, 10 dígitos, empieza en 3) que
    // ya aplica el resto del sistema, sin reimplementarlo aparte.
    const { valor, valido } = limpiarTelefono(`${soloDigitos}@s.whatsapp.net`);

    if (!valido) {
        return { ok: false, motivo: "telefono_invalido" };
    }

    const { data: contacto, error: errorSelect } = await supabase
        .from("usuarios")
        .select("*")
        .eq("id", contactoId)
        .maybeSingle();

    if (errorSelect) {
        console.error("❌ [CONTACTOS] error buscando contacto:", errorSelect.message);
        return { ok: false, motivo: "error_supabase" };
    }

    if (!contacto) {
        return { ok: false, motivo: "contacto_no_existe" };
    }

    // Regla única del sistema (obtenerUsuarioGlobal.js): un teléfono ya
    // asignado NUNCA se sobrescribe con uno distinto.
    if (contacto.telefono) {

        return contacto.telefono === valor
            ? { ok: true, usuario: contacto, sinCambios: true }
            : { ok: false, motivo: "ya_tiene_otro_telefono" };

    }

    // Evitar duplicar: ¿algún OTRO contacto ya tiene este teléfono?
    const { data: colision, error: errorColision } = await supabase
        .from("usuarios")
        .select("id")
        .eq("telefono", valor)
        .neq("id", contactoId)
        .maybeSingle();

    if (errorColision) {
        console.error("❌ [CONTACTOS] error verificando duplicado:", errorColision.message);
        return { ok: false, motivo: "error_supabase" };
    }

    if (colision) {
        return { ok: false, motivo: "telefono_ya_asignado_a_otro", contactoExistenteId: colision.id };
    }

    const { data: actualizado, error: errorUpdate } = await supabase
        .from("usuarios")
        .update({ telefono: valor, ultima_actividad: new Date() })
        .eq("id", contactoId)
        .select()
        .single();

    if (errorUpdate) {

        // 23505 = unique_violation -- el índice parcial de la migración
        // 014 ganó la carrera contra otra escritura concurrente. No es un
        // error real del usuario: alguien más ya lo asignó justo ahora.
        if (errorUpdate.code === "23505") {
            return { ok: false, motivo: "telefono_ya_asignado_a_otro" };
        }

        console.error("❌ [CONTACTOS] error actualizando teléfono:", errorUpdate.message);
        return { ok: false, motivo: "error_supabase" };

    }

    return { ok: true, usuario: actualizado, sinCambios: false };

}

module.exports = { agregarTelefonoContacto };
