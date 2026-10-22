// ==========================================================================
// restaurarSesiones() — al arrancar el proceso, vuelve a levantar TODAS las
// sesiones que Supabase marca "conectado" (cada una con su propio lease) y
// pide como activa la sesión activa de CADA cliente (multisesión).
// Extraída de server.js sin cambiar su lógica para poder probarla
// (tests/sesiones/multisesion.test.js); supabase y manager inyectables.
// ==========================================================================

async function restaurarSesiones({
    supabase = require("../../lib/supabase"),
    manager = require("./manager")
} = {}) {

    const { data, error } = await supabase
        .from("sesiones")
        .select("id, estado, activa, usuario_id");

    if (error) {

        console.log(error);

        return;

    }

    const sesiones = data.filter(

        s => s.estado === "conectado"

    );

    console.log(

        `Restaurando ${sesiones.length} sesiones...`

    );

    // Fase 1: la sesión activa guardada en la BD se PIDE antes de crear los
    // sockets, pero solo se activa cuando su socket llega realmente a open
    // (manager.evaluarConexion). Antes se activaba aquí mismo con el socket
    // todavía "connecting", y el listener de negocio quedaba registrado
    // antes del handshake. Solo si esa sesión está entre las que se van a
    // restaurar (si no, nunca llegaría a open y bloquearía el failover).
    // Multisesión: la activa de CADA cliente (una por usuario_id). Una
    // sesión sin dueño se conecta igual pero nunca se activa ni procesa.
    const clientesPedidos = new Set();

    for (const activa of sesiones.filter(s => s.activa === true && s.usuario_id)) {

        if (clientesPedidos.has(activa.usuario_id)) continue;

        clientesPedidos.add(activa.usuario_id);

        await manager.solicitarActivacion(activa.id, { permitirSinSocket: true });

    }

    for (const sesion of sesiones) {

        try {

            const resultado = await manager.start(

                sesion.id

            );

            // La sesión sigue "conectado" en Supabase pero el lease
            // distribuido (LOCAL/VPS) pertenece a la OTRA instancia — NO es
            // una desconexión: puede estar funcionando correctamente ahí.
            // No se toca su estado en Supabase ni se reintenta aquí.
            if (resultado === manager.LEASE_NO_DISPONIBLE) {

                console.log(

                    "⏳ [LEASE] sigue conectada en otra instancia, no se restaura aquí:",

                    sesion.id

                );

            } else {

                console.log(

                    "✅ Restaurada:",

                    sesion.id

                );

            }

        }

        catch (err) {

            console.log(

                "❌",

                sesion.id,

                err.message

            );

        }

    }

}

module.exports = { restaurarSesiones };
