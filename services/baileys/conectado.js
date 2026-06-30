const supabase = require("../../lib/supabase");

const {
    cancelarTimeout
} = require("./timeout");

async function conectado(sessionId, sock) {

    cancelarTimeout(sessionId);

    console.log("CONECTADO");

    const numero =
        sock.user?.id?.split(":")[0] || null;

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