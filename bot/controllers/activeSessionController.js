const manager = require("../../services/baileys/manager");
const supabase = require("../../lib/supabase");

async function setActive(req, res) {

    const { sessionId } = req.body;

    const ok = manager.setActive(sessionId);

    if (!ok) {

        return res.status(404).json({
            success: false,
            message: "La sesión no está conectada."
        });

    }

    try {

        // Quitar la marca de activa a todas
        await supabase
            .from("sesiones")
            .update({
                activa: false
            })
            .neq("id", "");

        // Marcar la nueva sesión activa
        await supabase
            .from("sesiones")
            .update({
                activa: true
            })
            .eq("id", sessionId);

        return res.json({

            success: true,

            sessionId

        });

    }

    catch (error) {

        console.error(
            "Error actualizando sesión activa:",
            error
        );

        return res.status(500).json({

            success: false,

            message: "No se pudo actualizar la sesión activa."

        });

    }

}

async function getActive(req, res) {

    return res.json({

        success: true,

        sessionId: manager.getActiveSession()

    });

}

module.exports = {

    setActive,

    getActive

};