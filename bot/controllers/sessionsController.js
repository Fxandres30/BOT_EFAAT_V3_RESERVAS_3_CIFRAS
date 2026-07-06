const baileysService = require("../../services/baileysService");
const manager = require("../../services/baileys/manager");
const supabase = require("../../lib/supabase");


async function connect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Conectar:", sessionId);

        const data = await baileysService.connect(sessionId);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function disconnect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Desconectar:", sessionId);

        const data = await baileysService.disconnect(sessionId);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function status(req, res) {

    try {

        const { id } = req.params;

        const data = await baileysService.status(id);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function setActive(req, res) {

    try {

        const { sessionId } = req.body;

        const ok = await manager.setActive(sessionId);

        if (!ok) {

            return res.status(404).json({
                success: false
            });

        }

        res.json({
            success: true
        });

    }

    catch (err) {

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

}

async function getActive(req, res) {

    const { data } = await supabase
        .from("sesiones")
        .select("*")
        .eq("activa", true)
        .maybeSingle();

    res.json(data);

}

module.exports = {

    connect,
    disconnect,
    status,

    setActive,
    getActive

};