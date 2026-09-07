// ==========================================================================
// Utilidad manual de línea de comandos para ROTAR la credencial de un
// dispositivo Android YA EXISTENTE (pagos_dispositivos) — para cuando el
// secreto original se perdió (solo se muestra una vez, ver
// backend/pagos/crearDispositivo.js) o se sospecha que se filtró.
//
// Actualiza la MISMA fila (mismo id, mismo usuario_id, mismo nombre) —
// nunca crea un dispositivo nuevo. La credencial anterior queda inválida
// de inmediato: su hash se sobreescribe, así que ya no hay forma de
// verificarla contra nada.
//
// Uso:
//   node backend/pagos/rotarCredencialDispositivo.js <dispositivo_id>
//
// Imprime el secreto NUEVO en TEXTO PLANO una sola vez — igual que
// crearDispositivo.js, no se guarda en ningún lado (solo su hash).
// ==========================================================================

require("dotenv").config();

const supabase = require("../lib/supabase");
const { generarSecreto, hashCredencial } = require("./credenciales");

async function main() {

    const [, , dispositivoId] = process.argv;

    if (!dispositivoId) {

        console.error("Uso: node backend/pagos/rotarCredencialDispositivo.js <dispositivo_id>");
        process.exit(1);

    }

    // Lectura previa de confirmación — nunca incluye credencial_hash en el
    // select, para no tener siquiera el hash viejo dando vueltas en memoria
    // más de lo necesario.
    const { data: existente, error: errorLectura } = await supabase
        .from("pagos_dispositivos")
        .select("id, usuario_id, nombre, activo")
        .eq("id", dispositivoId)
        .maybeSingle();

    if (errorLectura) {

        console.error("❌ Error consultando el dispositivo:", errorLectura.message);
        process.exit(1);

    }

    if (!existente) {

        console.error(`❌ No existe ningún dispositivo con id ${dispositivoId} — no se creó nada.`);
        process.exit(1);

    }

    console.log("Dispositivo encontrado (se va a ROTAR su credencial, no se crea uno nuevo):");
    console.log("   id:", existente.id);
    console.log("   usuario_id:", existente.usuario_id);
    console.log("   nombre:", existente.nombre);
    console.log("   activo:", existente.activo);
    console.log("");

    const secretoNuevo = generarSecreto();
    const credencialHashNueva = hashCredencial(secretoNuevo);

    const { data: actualizado, error: errorUpdate } = await supabase
        .from("pagos_dispositivos")
        .update({
            credencial_hash: credencialHashNueva,
            updated_at: new Date().toISOString()
        })
        .eq("id", dispositivoId)
        .select("id, usuario_id, nombre, activo, updated_at")
        .single();

    if (errorUpdate) {

        console.error("❌ Error rotando la credencial:", errorUpdate.message);
        process.exit(1);

    }

    console.log("✅ Credencial rotada — misma fila, mismo id (no se creó ningún dispositivo nuevo)");
    console.log("   La credencial ANTERIOR quedó inválida de inmediato (su hash fue sobreescrito).");
    console.log("");
    console.log("Guarda esta credencial AHORA — no se puede recuperar después (Supabase solo guarda su hash):");
    console.log("");
    console.log(`   Authorization: Bearer ${actualizado.id}.${secretoNuevo}`);
    console.log("");

    process.exit(0);

}

main().catch(err => {

    console.error("💥 Error inesperado:", err);
    process.exit(1);

});
