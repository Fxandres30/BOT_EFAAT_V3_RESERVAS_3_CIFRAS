// ==========================================================================
// Utilidad manual de línea de comandos para dar de alta un dispositivo
// Android autorizado (pagos_dispositivos) — P1 no tiene endpoint HTTP de
// registro (no existe todavía ningún panel/admin para pagos, ver README).
//
// Uso:
//   node backend/pagos/crearDispositivo.js <usuario_id> <nombre del dispositivo>
//
// Imprime el secreto en TEXTO PLANO una sola vez — no se guarda en ningún
// lado (solo su hash queda en Supabase). Si se pierde, no hay forma de
// recuperarlo: hay que crear un dispositivo nuevo.
// ==========================================================================

require("dotenv").config();

const supabase = require("../lib/supabase");
const { generarSecreto, hashCredencial } = require("./credenciales");

async function main() {

    const [, , usuarioId, ...resto] = process.argv;
    const nombre = resto.join(" ").trim();

    if (!usuarioId || !nombre) {

        console.error("Uso: node backend/pagos/crearDispositivo.js <usuario_id> <nombre del dispositivo>");
        process.exit(1);

    }

    const secreto = generarSecreto();
    const credencialHash = hashCredencial(secreto);

    const { data, error } = await supabase
        .from("pagos_dispositivos")
        .insert({
            usuario_id: usuarioId,
            nombre,
            credencial_hash: credencialHash,
            activo: true
        })
        .select()
        .single();

    if (error) {

        console.error("❌ Error creando dispositivo:", error.message);
        process.exit(1);

    }

    console.log("✅ Dispositivo creado");
    console.log("   id:", data.id);
    console.log("   usuario_id:", data.usuario_id);
    console.log("   nombre:", data.nombre);
    console.log("");
    console.log("Guarda esta credencial AHORA — no se puede recuperar después (Supabase solo guarda su hash):");
    console.log("");
    console.log(`   Authorization: Bearer ${data.id}.${secreto}`);
    console.log("");

    process.exit(0);

}

main().catch(err => {

    console.error("💥 Error inesperado:", err);
    process.exit(1);

});
