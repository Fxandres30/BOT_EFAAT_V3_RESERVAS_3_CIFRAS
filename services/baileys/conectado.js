const supabase = require("../../lib/supabase");

async function conectado(sessionId, sock) {

    console.log("CONECTADO");

    const numero = sock.user?.id?.split(":")[0] || null;

    const { error } = await supabase
        .from("sesiones")
        .update({
            telefono: numero,
            estado: "conectado",
            qr: null
        })
        .eq("id", sessionId);

    console.log("OPEN ERROR:", error);

}

module.exports = conectado;